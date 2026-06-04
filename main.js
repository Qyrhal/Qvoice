const {
  app, BrowserWindow, ipcMain, Tray, Menu,
  nativeImage, clipboard, screen, globalShortcut,
  systemPreferences, shell
} = require('electron')
const path = require('path')
const { execSync, spawn, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')

// WebGPU for liquid-dom glass in the Settings window.
// HTMLInCanvas was only needed for the <Html> component inside LiquidCanvas — removed.
app.commandLine.appendSwitch('enable-features', 'WebGPU')

// ─── Memory / performance flags ───────────────────────────────
// Disable Chromium subsystems Qvoice never uses
app.commandLine.appendSwitch('disable-features',
  'TranslateUI,AutofillServerCommunication,MediaRouter,' +
  'OptimizationHints,CertificateTransparencyComponentUpdater'
)
// Cap V8 old-generation heap — overlay + settings are tiny UIs
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128 --max-semi-space-size=8')
// Don't run spelling/grammar checks
app.commandLine.appendSwitch('disable-spell-checking')
// No crash reporting
app.commandLine.appendSwitch('disable-breakpad')

const EventEmitter = require('events')

// ─── State ────────────────────────────────────────────────────
let win = null
let tray = null
let settingsWin = null
let onboardingWin = null
let isRecording = false
let transcribeProcess = null
let serverReady = false
let serverBuffer = ''
let pendingQueue = []  // array of { onProgress, resolve, reject }
let isPreviewing = false
let previewText = ''
let previousAppPID = null
let previousAppName = ''
let recordingToken = null
let correctionEnabled = true
let settings = {}
let uIOhookRef = null
let uiohookKeydownHandler = null
let uiohookKeyupHandler = null
const serverEvents = new EventEmitter()

// ─── Instruction Blocks ───────────────────────────────────────
const DEFAULT_INSTRUCTION_BLOCKS = [
  { id: 'course-correction', name: 'Course Correction', type: 'preset', enabled: true,
    instruction: 'If the speaker self-corrects mid-sentence (e.g. "meet at 2, actually 3 pm"), output only the corrected value ("meet at 3 pm"). Do not include the original erroneous value.' },
  { id: 'filler-words', name: 'Filler Word Removal', type: 'preset', enabled: true,
    instruction: 'Remove filler words and sounds: "um", "uh", "like", "you know", "sort of", "kind of", "basically", "literally", "right", "so yeah".' },
  { id: 'punctuation', name: 'Punctuation & Capitalisation', type: 'preset', enabled: true,
    instruction: 'Fix punctuation, capitalisation, and sentence boundaries. Use the appropriate punctuation for the tone of the text.' },
  { id: 'dialect-au', name: '🇦🇺 Australian English', type: 'dialect', enabled: false,
    instruction: 'Use Australian English spelling and conventions: "colour", "realise", "organisation", "arvo" (afternoon), "servo" (service station). Prefer -ise over -ize endings.' },
  { id: 'dialect-us', name: '🇺🇸 American English', type: 'dialect', enabled: false,
    instruction: 'Use American English spelling and conventions: "color", "realize", "organization". Prefer -ize over -ise endings.' },
  { id: 'dialect-uk', name: '🇬🇧 British English', type: 'dialect', enabled: false,
    instruction: 'Use British English spelling and conventions: "colour", "realise", "organisation", "whilst", "amongst". Prefer -ise over -ize endings.' },
]

function buildSystemPrompt(blocks) {
  const base = 'You are a speech transcription corrector. Return ONLY the corrected text — no explanation, no quotes, no preamble.'
  const active = (blocks || []).filter(b => b.enabled).map(b => b.instruction.trim()).filter(Boolean)
  return active.length ? base + '\n\n' + active.join('\n') : base
}

// ─── Settings ─────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  engine: 'parakeet',
  whisperModel: 'base.en',
  llmRepo: 'LiquidAI/LFM2.5-1.2B-Instruct-MLX-6bit',
  instructionBlocks: [],
  autoPaste: true,
  symmetricWaveform: false,
  correctionEnabled: true,
  beamSize: 5,
  parakeetModel: 'mlx-community/parakeet-tdt-0.6b-v2',
  hotkeyKey: 'control',
  hotkeyMode: 'double-tap',
  theme: 'default',
  onboardingComplete: false,
}

const THEME_WIDTHS = { 'default': 300, 'whisper-flow': 340, 'superwhisper': 460 }
function themeWidth() { return THEME_WIDTHS[settings.theme] || 300 }

function loadSettings() {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), 'qvoice-settings.json'), 'utf8')
    const saved = JSON.parse(raw)
    const merged = { ...DEFAULT_SETTINGS, ...saved }
    // Ensure all default preset blocks exist (add new ones on upgrade)
    if (!merged.instructionBlocks || merged.instructionBlocks.length === 0) {
      merged.instructionBlocks = DEFAULT_INSTRUCTION_BLOCKS
    } else {
      const ids = new Set(merged.instructionBlocks.map(b => b.id))
      for (const b of DEFAULT_INSTRUCTION_BLOCKS) {
        if (!ids.has(b.id)) merged.instructionBlocks.push(b)
      }
    }
    return merged
  } catch {
    return { ...DEFAULT_SETTINGS, instructionBlocks: DEFAULT_INSTRUCTION_BLOCKS }
  }
}

function saveSettingsToDisk(s) {
  fs.writeFileSync(path.join(app.getPath('userData'), 'qvoice-settings.json'), JSON.stringify(s, null, 2))
}

// ─── App Init ─────────────────────────────────────────────────
app.setName('Qvoice')
if (app.dock) app.dock.hide()

app.whenReady().then(() => {
  settings = loadSettings()
  correctionEnabled = settings.correctionEnabled
  createWindow()
  createTray()
  startTranscribeServer()
  setupHotkey()
  if (!settings.onboardingComplete) openOnboardingWindow()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  transcribeProcess?.kill()
})

// ─── Window ───────────────────────────────────────────────────
function createWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay()

  const w = themeWidth()
  win = new BrowserWindow({
    width: w,
    height: 46,
    x: Math.floor(workAreaSize.width / 2 - w / 2),
    y: 56,
    frame: false,
    vibrancy: 'hud',
    visualEffectState: 'active',
    transparent: true,
    hasShadow: true,
    roundedCorners: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    }
  })

  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Load Vite-built renderer; fall back to source for dev
  const rendererPath = path.join(__dirname, 'renderer', 'dist', 'index.html')
  const loadPath = fs.existsSync(rendererPath)
    ? rendererPath
    : path.join(__dirname, 'renderer', 'index.html')
  win.loadFile(loadPath)

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('settings-update', { autoPaste: settings.autoPaste, symmetricWaveform: settings.symmetricWaveform, theme: settings.theme })
  })
}

// ─── Tray ─────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png')
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()

  if (!icon.isEmpty()) icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setTitle('Q')
  tray.setToolTip(`Qvoice — ${hotkeyLabel()}`)
  updateTrayMenu()
}

function updateTrayMenu(state = 'idle') {
  const status = {
    idle:      hotkeyLabel(),
    recording: '⏺ Recording...',
    loading:   '○ Loading models...',
  }[state] || hotkeyLabel()

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Qvoice', enabled: false },
    { label: status, enabled: false },
    { type: 'separator' },
    {
      label: 'AI Correction',
      type: 'checkbox',
      checked: correctionEnabled,
      enabled: (settings.engine || 'whisper') !== 'parakeet',
      click: (item) => {
        correctionEnabled = item.checked
        settings.correctionEnabled = item.checked
        saveSettingsToDisk(settings)
      },
    },
    { label: 'Settings…', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]))
}

// ─── Transcription Server ─────────────────────────────────────
function getPython() {
  const venvPy = path.join(__dirname, '.venv', 'bin', 'python')
  return fs.existsSync(venvPy) ? venvPy : 'python3'
}

function restartTranscribeServer() {
  serverReady = false
  serverBuffer = ''
  while (pendingQueue.length > 0) {
    const { reject } = pendingQueue.shift()
    reject(new Error('Server restarting'))
  }
  transcribeProcess?.kill()
  transcribeProcess = null
  startTranscribeServer()
}

function startTranscribeServer() {
  const script = path.join(__dirname, 'transcribe_server.py')
  const env = {
    ...process.env,
    QVOICE_ENGINE:         settings.engine        || DEFAULT_SETTINGS.engine,
    QVOICE_MODEL:          settings.whisperModel  || DEFAULT_SETTINGS.whisperModel,
    QVOICE_LLM_REPO:       settings.llmRepo       || DEFAULT_SETTINGS.llmRepo,
    QVOICE_PARAKEET_MODEL: settings.parakeetModel || DEFAULT_SETTINGS.parakeetModel,
  }
  transcribeProcess = spawn(getPython(), [script], { stdio: ['pipe', 'pipe', 'pipe'], env })

  transcribeProcess.stdout.on('data', (data) => {
    serverBuffer += data.toString()
    const lines = serverBuffer.split('\n')
    serverBuffer = lines.pop()

    for (const line of lines) {
      if (!line.trim()) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }

      if (msg.status === 'ready') {
        serverReady = true
        serverEvents.emit('ready')
        win?.webContents.send('server-ready')
      } else if (msg.status === 'transcribed' && pendingQueue.length > 0) {
        pendingQueue[0].onProgress(msg)
      } else if ((msg.status === 'ok' || msg.status === 'error') && pendingQueue.length > 0) {
        const { resolve, reject } = pendingQueue.shift()
        msg.status === 'ok' ? resolve(msg) : reject(new Error(msg.error))
      }
    }
  })

  transcribeProcess.stderr.on('data', (d) => {
    process.stdout.write(`[Python] ${d}`)
  })

  transcribeProcess.on('error', (e) => {
    console.error('Transcribe server error:', e.message)
  })
}

function runTranscription(audioPath, onProgress, options = {}) {
  return new Promise((resolve, reject) => {
    if (!transcribeProcess || !serverReady) {
      reject(new Error('Server not ready'))
      return
    }

    const timeoutMs = options.partial ? 10000 : 60000
    let settled = false

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        const idx = pendingQueue.findIndex(p => p.resolve === wrappedResolve)
        if (idx !== -1) pendingQueue.splice(idx, 1)
        reject(new Error('Transcription timed out'))
      }
    }, timeoutMs)

    const wrappedResolve = (val) => { if (!settled) { settled = true; clearTimeout(timeout); resolve(val) } }
    const wrappedReject  = (err) => { if (!settled) { settled = true; clearTimeout(timeout); reject(err)  } }

    pendingQueue.push({ onProgress: onProgress || (() => {}), resolve: wrappedResolve, reject: wrappedReject })

    transcribeProcess.stdin.write(JSON.stringify({
      audio_path: audioPath,
      correction: !options.partial && correctionEnabled,
      partial: options.partial || false,
      system_prompt: buildSystemPrompt(settings.instructionBlocks),
      beam_size: options.partial ? 1 : (settings.beamSize || DEFAULT_SETTINGS.beamSize),
    }) + '\n')
  })
}

function doPaste(text) {
  isPreviewing = false
  previewText = ''
  clipboard.writeText(text)
  win?.webContents.send('preview-confirmed')
  win.hide()
  win.setSize(300, 46)

  const pid = previousAppPID
  previousAppPID = null

  setTimeout(() => {
    try {
      if (pid) {
        // Activate by PID — reliable regardless of internal process name ("stable" for Cursor,
        // "Electron" for some apps) which breaks "tell application <name> to activate".
        spawnSync('osascript', [
          '-e', `tell application "System Events" to set frontmost of first process whose unix id is ${pid} to true`,
          '-e', 'delay 0.2',
          '-e', 'tell application "System Events" to keystroke "v" using {command down}',
        ], { timeout: 3000 })
      } else {
        execSync(
          `osascript -e 'tell application "System Events" to keystroke "v" using {command down}'`,
          { timeout: 1000 }
        )
      }
    } catch (e) {
      console.error('Auto-paste failed:', e.message)
    }
  }, 100)
}

// ─── Recording ────────────────────────────────────────────────
async function startRecording() {
  if (isRecording) return
  isRecording = true
  const token = Symbol()
  recordingToken = token

  // Capture frontmost process PID + name before our window appears
  try {
    const raw = spawnSync('osascript', ['-e', `
      tell application "System Events"
        set p to first process whose frontmost is true
        ((unix id of p) as string) & "|" & (name of p)
      end tell
    `], { timeout: 1000, encoding: 'utf8' }).stdout?.trim() || ''
    const sep = raw.indexOf('|')
    previousAppPID  = parseInt(raw.slice(0, sep), 10) || null
    previousAppName = raw.slice(sep + 1).trim()
  } catch { previousAppPID = null; previousAppName = '' }

  win.showInactive()
  updateTrayMenu('recording')

  if (!serverReady) {
    win.webContents.send('show-loading')
    updateTrayMenu('loading')
    await new Promise(resolve => serverEvents.once('ready', resolve))
  }

  if (recordingToken !== token || !isRecording) {
    win.hide()
    updateTrayMenu('idle')
    return
  }

  win.webContents.send('recording-start', { appName: previousAppName })
}

function stopRecording() {
  if (!isRecording) return
  isRecording = false
  recordingToken = null
  updateTrayMenu('idle')
  win.webContents.send('recording-stop')
}

// ─── Global Hotkey ────────────────────────────────────────────
const HOTKEY_KEYCODES = {
  'control':       [29, 3613],
  'left-control':  [29],
  'right-control': [3613],
  'command':       [3675, 3676],
  'left-command':  [3675],
  'right-command': [3676],
  'option':        [56, 3608],
  'left-option':   [56],
  'right-option':  [3608],
  'shift':         [42, 54],
  'left-shift':    [42],
  'right-shift':   [54],
}

function hotkeyLabel() {
  const keyName = { control: 'Control', 'left-control': 'Left Control', 'right-control': 'Right Control', command: 'Command', 'left-command': 'Left Command', 'right-command': 'Right Command', option: 'Option', 'left-option': 'Left Option', 'right-option': 'Right Option', shift: 'Shift', 'left-shift': 'Left Shift', 'right-shift': 'Right Shift' }[settings.hotkeyKey || 'control'] || 'Control'
  return (settings.hotkeyMode || 'double-tap') === 'push-to-talk'
    ? `Hold ${keyName} to record`
    : `Double-tap ${keyName} to toggle`
}

function registerHotkeyHandlers() {
  if (!uIOhookRef) return

  if (uiohookKeydownHandler) uIOhookRef.off('keydown', uiohookKeydownHandler)
  if (uiohookKeyupHandler)   uIOhookRef.off('keyup',   uiohookKeyupHandler)
  uiohookKeyupHandler = null

  const keycodes = HOTKEY_KEYCODES[settings.hotkeyKey || 'control'] || HOTKEY_KEYCODES.control
  const mode     = settings.hotkeyMode || 'double-tap'

  if (mode === 'push-to-talk') {
    let ptActive = false

    uiohookKeydownHandler = ({ keycode }) => {
      if (!keycodes.includes(keycode) || ptActive) return
      ptActive = true
      if (isPreviewing) doPaste(previewText)
      else startRecording()
    }

    uiohookKeyupHandler = ({ keycode }) => {
      if (!keycodes.includes(keycode)) return
      ptActive = false
      if (isRecording) stopRecording()
    }

    uIOhookRef.on('keydown', uiohookKeydownHandler)
    uIOhookRef.on('keyup',   uiohookKeyupHandler)
  } else {
    const DOUBLE_TAP_MS = 350
    let lastTapTime = 0

    uiohookKeydownHandler = ({ keycode }) => {
      if (!keycodes.includes(keycode)) return
      const now = Date.now()
      if (now - lastTapTime < DOUBLE_TAP_MS) {
        lastTapTime = 0
        if (isRecording) stopRecording()
        else if (isPreviewing) doPaste(previewText)
        else startRecording()
      } else {
        lastTapTime = now
      }
    }

    uIOhookRef.on('keydown', uiohookKeydownHandler)
  }

  console.log(hotkeyLabel())
}

function setupHotkey() {
  try {
    const { uIOhook } = require('uiohook-napi')
    uIOhookRef = uIOhook
    registerHotkeyHandlers()
    uIOhook.start()
  } catch (e) {
    console.warn('uiohook unavailable, falling back to Ctrl+Shift+R:', e.message)
    globalShortcut.register('Ctrl+Shift+R', () => {
      if (isRecording) stopRecording()
      else if (isPreviewing) doPaste(previewText)
      else startRecording()
    })
  }
}

// ─── IPC ──────────────────────────────────────────────────────
ipcMain.handle('transcribe-audio', async (event, audioBuffer) => {
  const tmpPath = path.join(os.tmpdir(), `qvoice-${Date.now()}.wav`)
  fs.writeFileSync(tmpPath, Buffer.from(audioBuffer))

  try {
    return await runTranscription(tmpPath, (progress) => {
      event.sender.send('transcription-progress', progress)
    })
  } finally {
    try { fs.unlinkSync(tmpPath) } catch {}
  }
})

ipcMain.handle('transcribe-partial', async (_, audioBuffer) => {
  const tmpPath = path.join(os.tmpdir(), `qvoice-partial-${Date.now()}.wav`)
  fs.writeFileSync(tmpPath, Buffer.from(audioBuffer))
  try {
    return await runTranscription(tmpPath, null, { partial: true })
  } finally {
    try { fs.unlinkSync(tmpPath) } catch {}
  }
})

ipcMain.on('preview-ready', (_, { text }) => {
  isPreviewing = true
  previewText = text
})

ipcMain.on('confirm-paste', (_, { text }) => {
  doPaste(text || previewText)
})

ipcMain.on('set-height', (_, h) => {
  const w = themeWidth()
  win.setSize(w, Math.max(46, Math.min(h, 600)))
})

ipcMain.on('hide-window', () => {
  isPreviewing = false
  previewText = ''
  win.hide()
  win.setSize(themeWidth(), 46)
})

ipcMain.on('stop-recording-request', () => { if (isRecording) stopRecording() })

ipcMain.on('cancel-recording', () => {
  if (!isRecording) return
  isRecording = false
  recordingToken = null
  updateTrayMenu('idle')
  win.webContents.send('recording-cancel')
})

// ─── Settings Window ──────────────────────────────────────────
function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus()
    return
  }
  settingsWin = new BrowserWindow({
    width: 520,
    height: 600,
    title: 'Qvoice Settings',
    resizable: false,
    minimizable: false,
    maximizable: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    transparent: true,
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),
      contextIsolation: true,
    }
  })
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'dist', 'settings.html'))
  settingsWin.on('closed', () => { settingsWin = null })
}

function openOnboardingWindow() {
  if (onboardingWin && !onboardingWin.isDestroyed()) { onboardingWin.focus(); return }
  onboardingWin = new BrowserWindow({
    width: 500,
    height: 580,
    title: 'Welcome to Qvoice',
    resizable: false,
    minimizable: false,
    maximizable: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    transparent: true,
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),
      contextIsolation: true,
    }
  })
  onboardingWin.loadFile(path.join(__dirname, 'renderer', 'dist', 'onboarding.html'))
  onboardingWin.on('closed', () => { onboardingWin = null })
}

ipcMain.handle('get-settings', () => ({ ...settings }))

ipcMain.handle('check-models', async () => {
  const script = path.join(__dirname, 'check_models.py')
  if (!fs.existsSync(script)) return { ok: false, error: 'check_models.py not found' }
  const python = getPython()
  const env = {
    ...process.env,
    PYTHONPATH: path.join(__dirname, '.venv', 'lib', 'python3.12', 'site-packages'),
  }
  return new Promise(resolve => {
    const proc = spawn(python, [script, '--json'], { env, timeout: 120_000 })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', d => stdout += d.toString())
    proc.stderr.on('data', d => stderr += d.toString())
    proc.on('close', () => {
      const jsonStart = stdout.indexOf('{')
      if (jsonStart >= 0) {
        try { return resolve(JSON.parse(stdout.slice(jsonStart))) }
        catch { /* fall through */ }
      }
      resolve({ ok: false, error: (stderr || stdout).trim() })
    })
    proc.on('error', e => resolve({ ok: false, error: e.message }))
  })
})

ipcMain.on('download-model', (_, { repo, modelKey }) => {
  const script = path.join(__dirname, 'download_model.py')
  if (!fs.existsSync(script)) {
    settingsWin?.webContents.send('download-progress', { repo, type: 'error', error: 'download_model.py not found' })
    return
  }
  const python = getPython()
  const env = {
    ...process.env,
    PYTHONPATH: path.join(__dirname, '.venv', 'lib', 'python3.12', 'site-packages'),
  }
  const proc = spawn(python, [script, repo, modelKey], { env })
  let buf = ''
  let finished = false

  proc.stdout.on('data', d => {
    buf += d.toString()
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        if (msg.type === 'done' || msg.type === 'error') finished = true
        settingsWin?.webContents.send('download-progress', { repo, ...msg })
      } catch {}
    }
  })

  proc.on('close', () => {
    if (!finished) settingsWin?.webContents.send('download-progress', { repo, type: 'done' })
  })

  proc.on('error', e => {
    settingsWin?.webContents.send('download-progress', { repo, type: 'error', error: e.message })
  })
})

ipcMain.handle('save-settings', (_, newSettings) => {
  const needsRestart =
    newSettings.engine        !== settings.engine        ||
    newSettings.whisperModel  !== settings.whisperModel  ||
    newSettings.llmRepo       !== settings.llmRepo       ||
    newSettings.parakeetModel !== settings.parakeetModel

  const needsHotkeyUpdate =
    newSettings.hotkeyKey  !== settings.hotkeyKey  ||
    newSettings.hotkeyMode !== settings.hotkeyMode

  const themeChanged = newSettings.theme !== settings.theme

  settings = { ...settings, ...newSettings }
  correctionEnabled = settings.correctionEnabled
  saveSettingsToDisk(settings)
  win?.webContents.send('settings-update', { autoPaste: settings.autoPaste, symmetricWaveform: settings.symmetricWaveform, theme: settings.theme })

  if (themeChanged && win && !win.isDestroyed()) {
    const { workAreaSize } = screen.getPrimaryDisplay()
    const w = themeWidth()
    win.setSize(w, win.getSize()[1])
    win.setPosition(Math.floor(workAreaSize.width / 2 - w / 2), win.getPosition()[1])
  }

  updateTrayMenu()
  if (tray) tray.setToolTip(`Qvoice — ${hotkeyLabel()}`)

  if (needsRestart) restartTranscribeServer()
  if (needsHotkeyUpdate) registerHotkeyHandlers()
})

ipcMain.handle('complete-onboarding', (_, selectedSettings) => {
  settings = { ...settings, ...selectedSettings, onboardingComplete: true }
  correctionEnabled = settings.correctionEnabled
  saveSettingsToDisk(settings)
  restartTranscribeServer()
  onboardingWin?.close()
})

ipcMain.handle('redo-onboarding', () => {
  settings.onboardingComplete = false
  saveSettingsToDisk(settings)
  openOnboardingWindow()
})

let accessibilityPrompted = false
let _accCache = null
let _accCacheAt = 0

// isTrustedAccessibilityClient has signature-caching bugs in dev/packaged apps.
// AXIsProcessTrusted() via system Python3 (stdlib ctypes only — no venv needed,
// no asar path issues) is the ground-truth check.
function checkAccessibility() {
  const now = Date.now()
  if (_accCache !== null && now - _accCacheAt < 3000) return _accCache
  try {
    const r = spawnSync('/usr/bin/python3', ['-c',
      'import ctypes; l=ctypes.cdll.LoadLibrary(' +
      '"/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"' +
      '); print(bool(l.AXIsProcessTrusted()))'
    ], { timeout: 2000, encoding: 'utf8' })
    _accCache = r.status === 0 && r.stdout?.trim() === 'True'
  } catch {
    _accCache = systemPreferences.isTrustedAccessibilityClient(false)
  }
  _accCacheAt = now
  return _accCache
}

ipcMain.handle('check-permissions', () => ({
  mic:           systemPreferences.getMediaAccessStatus('microphone'),
  accessibility: checkAccessibility(),
}))

ipcMain.handle('request-mic-permission', async () => {
  const result = await systemPreferences.askForMediaAccess('microphone')
  return result ? 'granted' : 'denied'
})

ipcMain.on('open-accessibility-settings', () => {
  _accCache = null  // bust cache so next poll re-checks
  if (!accessibilityPrompted) {
    accessibilityPrompted = true
    systemPreferences.isTrustedAccessibilityClient(true)
  }
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
})
