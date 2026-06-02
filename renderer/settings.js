let settings = {}

const ENGINE_META = {
  whisper:   'CPU · faster-whisper + LLM correction',
  parakeet:  'Apple Silicon GPU · parakeet-mlx',
}

function setToggle(el, value) {
  el.classList.toggle('on', !!value)
}

function applyEngine(engine) {
  const isParakeet = engine === 'parakeet'

  // Segmented control active state
  document.querySelectorAll('#engine-ctrl .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === engine)
  })

  // Subtitle
  document.getElementById('engine-sub').textContent = ENGINE_META[engine] || ''

  // Whisper-only rows inside Models section
  document.getElementById('row-whisper-model').classList.toggle('hidden', isParakeet)
  document.getElementById('row-llm-repo').classList.toggle('hidden', isParakeet)
  document.getElementById('row-llm-file').classList.toggle('hidden', isParakeet)

  // Parakeet-only rows
  document.getElementById('row-parakeet-model').classList.toggle('hidden', !isParakeet)

  // Whole sections
  document.getElementById('section-transcription').classList.toggle('hidden', isParakeet)
  document.getElementById('section-prompt').classList.toggle('hidden', isParakeet)
}

async function init() {
  settings = await window.qvoiceSettings.getSettings()

  const engine = settings.engine || 'whisper'
  applyEngine(engine)

  document.getElementById('whisperModel').value  = settings.whisperModel
  document.getElementById('llmRepo').value        = settings.llmRepo
  document.getElementById('systemPrompt').value   = settings.systemPrompt
  document.getElementById('beamSize').value       = settings.beamSize
  document.getElementById('parakeetModel').value  = settings.parakeetModel || 'mlx-community/parakeet-tdt-0.6b-v3'

  setToggle(document.getElementById('toggle-correction'), settings.correctionEnabled)
  setToggle(document.getElementById('toggle-autopaste'),  settings.autoPaste)
}

// Engine segmented control
document.getElementById('engine-ctrl').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn')
  if (!btn) return
  settings.engine = btn.dataset.value
  applyEngine(settings.engine)
})

document.getElementById('toggle-correction').addEventListener('click', (e) => {
  settings.correctionEnabled = !settings.correctionEnabled
  setToggle(e.currentTarget, settings.correctionEnabled)
})

document.getElementById('toggle-autopaste').addEventListener('click', (e) => {
  settings.autoPaste = !settings.autoPaste
  setToggle(e.currentTarget, settings.autoPaste)
})

document.getElementById('btn-save').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save')
  if (btn.classList.contains('saved')) return

  const newSettings = {
    engine:            settings.engine || 'whisper',
    whisperModel:      document.getElementById('whisperModel').value,
    llmRepo:           document.getElementById('llmRepo').value.trim(),
    systemPrompt:      document.getElementById('systemPrompt').value.trim(),
    beamSize:          Math.max(1, Math.min(10, parseInt(document.getElementById('beamSize').value, 10) || 5)),
    parakeetModel:     document.getElementById('parakeetModel').value,
    correctionEnabled: settings.correctionEnabled,
    autoPaste:         settings.autoPaste,
  }

  await window.qvoiceSettings.saveSettings(newSettings)
  settings = { ...settings, ...newSettings }

  btn.textContent = 'Saved!'
  btn.classList.add('saved')
  setTimeout(() => {
    btn.textContent = 'Save Settings'
    btn.classList.remove('saved')
  }, 1500)
})

init()
