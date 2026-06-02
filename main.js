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
let previousAppPID = null  // PID of the frontmost process when recording started
let recordingToken = null
let correctionEnabled = true
let settings = {}
const serverEvents = new EventEmitter()

// ─── Settings ─────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  whisperModel: 'base.en',
  llmRepo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
  llmFile: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  systemPrompt: 'You are a speech transcription corrector. Fix grammar, punctuation, and misheard words in the user\'s text. Return ONLY the corrected text — no explanation, no quotes, nothing else.',
  autoPaste: false,
  correctionEnabled: true,
  beamSize: 5,
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
    width: 520,
    height: 110,
    x: Math.floor(workAreaSize.width / 2 - 260),
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
  tray.setToolTip('Qvoice — Double-tap Control to toggle recording')
  updateTrayMenu()
}

function updateTrayMenu(state = 'idle') {
  const status = {
    idle:      'Double-tap Control to record',
    recording: '⏺ Recording...',
    loading:   '○ Loading models...',
  }[state] || 'Double-tap Control to record'

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Qvoice', enabled: false },
    { label: status, enabled: false },
    { type: 'separator' },
    {
      label: 'AI Correction',
      type: 'checkbox',
      checked: correctionEnabled,
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
    QVOICE_MODEL: settings.whisperModel || DEFAULT_SETTINGS.whisperModel,
    QVOICE_LLM_REPO: settings.llmRepo || DEFAULT_SETTINGS.llmRepo,
    QVOICE_LLM_FILE: settings.llmFile || DEFAULT_SETTINGS.llmFile,
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
  win.hide()
  win.setSize(520, 110)

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

  // Capture frontmost process PID NOW — before our window appears — so doPaste can re-activate it
  try {
    previousAppPID = parseInt(execSync(
      `osascript -e 'tell application "System Events" to unix id of first process whose frontmost is true'`,
      { timeout: 1000 }
    ).toString().trim(), 10) || null
  } catch { previousAppPID = null }

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

  win.webContents.send('recording-start')
}

function stopRecording() {
  if (!isRecording) return
  isRecording = false
  recordingToken = null
  updateTrayMenu('idle')
  win.webContents.send('recording-stop')
}

// ─── Global Hotkey (double-tap Control to toggle) ─────────────
function setupHotkey() {
  try {
    const { uIOhook } = require('uiohook-napi')

    const CTRL_LEFT  = 29
    const CTRL_RIGHT = 3613
    const DOUBLE_TAP_MS = 350

    let lastCtrlTime = 0

    uIOhook.on('keydown', ({ keycode }) => {
      if (keycode !== CTRL_LEFT && keycode !== CTRL_RIGHT) return

      const now = Date.now()
      if (now - lastCtrlTime < DOUBLE_TAP_MS) {
        lastCtrlTime = 0  // reset so triple-tap doesn't re-fire
        if (isRecording) stopRecording()
        else if (isPreviewing) doPaste(previewText)
        else startRecording()
      } else {
        lastCtrlTime = now
      }
    })

    uIOhook.start()
    console.log('Double-tap Control to toggle recording')
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
  win.setSize(520, Math.max(80, Math.min(h, 400)))
})

ipcMain.on('hide-window', () => {
  isPreviewing = false
  previewText = ''
  win.hide()
  win.setSize(520, 110)
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
    backgroundColor: '#111113',
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),
      contextIsolation: true,
    }
  })
  settingsWin.loadFile('renderer/settings.html')
  settingsWin.on('closed', () => { settingsWin = null })
}

ipcMain.handle('get-settings', () => ({ ...settings }))

ipcMain.handle('save-settings', (_, newSettings) => {
  const needsRestart =
    newSettings.whisperModel !== settings.whisperModel ||
    newSettings.llmRepo      !== settings.llmRepo      ||
    newSettings.llmFile      !== settings.llmFile

  settings = { ...settings, ...newSettings }
  correctionEnabled = settings.correctionEnabled
  saveSettingsToDisk(settings)
  win?.webContents.send('settings-update', { autoPaste: settings.autoPaste })
  updateTrayMenu()

  if (needsRestart) restartTranscribeServer()
})
