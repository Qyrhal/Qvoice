const {
  app, BrowserWindow, ipcMain, Tray, Menu,
  nativeImage, clipboard, screen, globalShortcut
} = require('electron')
const path = require('path')
const { execSync, spawn, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')

// WebGPU for liquid-dom rendering.
// HTMLInCanvas is the correct Blink feature name for HTML-in-Canvas (chrome://flags/#canvas-draw-element).
app.commandLine.appendSwitch('enable-features', 'WebGPU')
app.commandLine.appendSwitch('enable-blink-features', 'HTMLInCanvas')

const EventEmitter = require('events')

// ─── State ────────────────────────────────────────────────────
let win = null
let tray = null
let settingsWin = null
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

// ─── Settings ─────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  engine: 'parakeet',
  whisperModel: 'base.en',
  llmRepo: 'LiquidAI/LFM2.5-1.2B-Instruct-MLX-6bit',
  systemPrompt: 'You are a speech transcription corrector. Fix grammar, punctuation, and misheard words in the user\'s text. Return ONLY the corrected text — no explanation, no quotes, nothing else.',
  autoPaste: true,
  correctionEnabled: true,
  beamSize: 5,
  parakeetModel: 'mlx-community/parakeet-tdt-0.6b-v2',
  hotkeyKey: 'control',
  hotkeyMode: 'double-tap',
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), 'qvoice-settings.json'), 'utf8')
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
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
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  transcribeProcess?.kill()
})

// ─── Window ───────────────────────────────────────────────────
function createWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay()

  win = new BrowserWindow({
    width: 300,
    height: 46,
    x: Math.floor(workAreaSize.width / 2 - 150),
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
    win.webContents.send('settings-update', { autoPaste: settings.autoPaste })
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
      system_prompt: settings.systemPrompt || DEFAULT_SETTINGS.systemPrompt,
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
  control: [29, 3613],
  command: [3675, 3676],
  option:  [56, 3608],
  shift:   [42, 54],
}

function hotkeyLabel() {
  const keyName = { control: 'Control', command: 'Command', option: 'Option', shift: 'Shift' }[settings.hotkeyKey || 'control'] || 'Control'
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
    console.log('Fallback: Ctrl+Shift+R to toggle')
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
  win.setSize(300, Math.max(46, Math.min(h, 400)))
})

ipcMain.on('hide-window', () => {
  isPreviewing = false
  previewText = ''
  win.hide()
  win.setSize(300, 46)
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

  settings = { ...settings, ...newSettings }
  correctionEnabled = settings.correctionEnabled
  saveSettingsToDisk(settings)
  win?.webContents.send('settings-update', { autoPaste: settings.autoPaste })
  updateTrayMenu()
  if (tray) tray.setToolTip(`Qvoice — ${hotkeyLabel()}`)

  if (needsRestart) restartTranscribeServer()
  if (needsHotkeyUpdate) registerHotkeyHandlers()
})
