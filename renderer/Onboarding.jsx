import { useEffect, useRef, useState } from 'react'
import './Onboarding.css'

const ENGINES = [
  { val: 'parakeet', label: 'Parakeet', sub: 'Fast · Apple Silicon · Offline' },
  { val: 'whisper',  label: 'Whisper',  sub: 'Flexible · All hardware · Offline' },
]

const PARAKEET_MODELS = [
  { val: 'mlx-community/parakeet-tdt-0.6b-v3', label: 'parakeet-tdt-0.6b-v3', sub: 'Latest · Recommended' },
  { val: 'mlx-community/parakeet-tdt-0.6b-v2', label: 'parakeet-tdt-0.6b-v2', sub: 'Stable' },
]

const WHISPER_MODELS = [
  { val: 'base.en',   label: 'base.en',   sub: 'Fast · Good quality' },
  { val: 'small.en',  label: 'small.en',  sub: 'Balanced' },
  { val: 'medium.en', label: 'medium.en', sub: 'High quality · Slower' },
]

const LLM_MODELS = [
  { val: 'LiquidAI/LFM2.5-1.2B-Instruct-MLX-6bit',         label: 'LFM2.5 1.2B',    sub: 'Recommended · Fast correction' },
  { val: 'mlx-community/Qwen2.5-3B-Instruct-4bit',          label: 'Qwen2.5 3B',     sub: 'Strong · Slower' },
  { val: 'mlx-community/TinyLlama-1.1B-Chat-v1.0-4bit',     label: 'TinyLlama 1.1B', sub: 'Lightest · Basic correction' },
  { val: null,                                               label: 'Skip',           sub: 'No AI correction' },
]

// ─── Step indicator ─────────────────────────────────────────────
function Steps({ step, total }) {
  return (
    <div className="ob-steps">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className={`ob-step-dot ${i === step ? 'active' : i < step ? 'done' : ''}`} />
      ))}
    </div>
  )
}

// ─── Option card ─────────────────────────────────────────────────
function OptionCard({ val, label, sub, selected, cached, onClick }) {
  return (
    <button className={`ob-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="ob-card-left">
        <div className="ob-card-label">{label}</div>
        {sub && <div className="ob-card-sub">{sub}</div>}
      </div>
      {cached && <div className="ob-cached">cached</div>}
      <div className="ob-radio">{selected && <div className="ob-radio-fill" />}</div>
    </button>
  )
}

// ─── Download bar ─────────────────────────────────────────────────
function DownloadBar({ pct }) {
  return (
    <div className="ob-bar-track">
      <div className="ob-bar-fill" style={{ width: `${Math.round(pct * 100)}%` }} />
    </div>
  )
}

// ─── Permission item ──────────────────────────────────────────────
function PermissionRow({ icon, label, sub, status, onGrant }) {
  const granted = status === true || status === 'granted'
  const denied  = status === 'denied'
  return (
    <div className="perm-row">
      <div className="perm-icon">{icon}</div>
      <div className="perm-text">
        <div className="perm-label">{label}</div>
        <div className="perm-sub">{sub}</div>
      </div>
      {granted
        ? <div className="perm-badge granted">Granted</div>
        : denied
          ? <div className="perm-badge denied">Denied — open System Settings</div>
          : <button className="perm-btn" onClick={onGrant}>Grant</button>
      }
    </div>
  )
}

// ─── Onboarding ───────────────────────────────────────────────────
export function Onboarding() {
  const [step, setStep] = useState(-1)     // -1: permissions, 0: engine, 1: model, 2: confirm, 3: download
  const [perms, setPerms] = useState({ mic: 'not-determined', accessibility: false })
  const [engine, setEngine] = useState('parakeet')
  const [model, setModel] = useState('mlx-community/parakeet-tdt-0.6b-v3')
  const [llm, setLlm] = useState('LiquidAI/LFM2.5-1.2B-Instruct-MLX-6bit')
  const [cachedMap, setCachedMap] = useState({})
  const [downloads, setDownloads] = useState({})
  const [allDone, setAllDone] = useState(false)
  const unsubRef = useRef(null)

  // Poll permissions every 2s so UI updates after user grants in System Settings
  useEffect(() => {
    function refresh() {
      window.qvoiceSettings.checkPermissions().then(setPerms)
    }
    refresh()
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [])

  const micGranted = perms.mic === 'granted'
  const accGranted = perms.accessibility === true
  const allPermsGranted = micGranted && accGranted

  useEffect(() => {
    window.qvoiceSettings.checkModels().then(r => {
      if (!r.ok) return
      const map = {}
      Object.values(r.models).forEach(group => {
        Object.entries(group).forEach(([k, v]) => { map[k] = v.cached })
      })
      setCachedMap(map)
    })
  }, [])

  function selectEngine(e) {
    setEngine(e)
    setModel(e === 'parakeet' ? 'mlx-community/parakeet-tdt-0.6b-v3' : 'base.en')
  }

  function modelOptions() {
    return engine === 'parakeet' ? PARAKEET_MODELS : WHISPER_MODELS
  }

  function isCached(val) { return val && cachedMap[val] }

  // Step 3: download
  function startDownloads() {
    setStep(3)
    const toDownload = []
    if (model && !isCached(model)) toDownload.push({ repo: model, key: engine })
    if (llm && !isCached(llm))    toDownload.push({ repo: llm,   key: 'llm' })

    if (toDownload.length === 0) { setAllDone(true); return }

    const dl = {}
    toDownload.forEach(({ repo }) => { dl[repo] = { pct: 0, done: false } })
    setDownloads(dl)

    if (unsubRef.current) unsubRef.current()
    unsubRef.current = window.qvoiceSettings.onDownloadProgress(({ repo, type, pct }) => {
      setDownloads(prev => {
        const next = { ...prev }
        if (type === 'progress') next[repo] = { pct: pct ?? 0, done: false }
        if (type === 'done' || type === 'error') next[repo] = { pct: 1, done: true }
        const done = Object.values(next).every(d => d.done)
        if (done) setAllDone(true)
        return next
      })
    })

    toDownload.forEach(({ repo, key }) => window.qvoiceSettings.downloadModel(repo, key))
  }

  function finish() {
    const selectedSettings = {
      engine,
      parakeetModel: engine === 'parakeet' ? model : undefined,
      whisperModel:  engine === 'whisper'  ? model : undefined,
      llmRepo: llm || undefined,
      correctionEnabled: !!llm,
    }
    Object.keys(selectedSettings).forEach(k => selectedSettings[k] === undefined && delete selectedSettings[k])
    window.qvoiceSettings.completeOnboarding(selectedSettings)
  }

  // ── Step -1: Permissions ────────────────────────────────────────
  if (step === -1) return (
    <div className="ob-root">
      <div className="ob-titlebar" />
      <div className="ob-body">
        <div className="ob-heading">Allow access</div>
        <div className="ob-sub">Qvoice needs two permissions to work. These are never used outside the app.</div>
        <div className="perm-list">
          <PermissionRow
            icon="🎙️"
            label="Microphone"
            sub="Required to record your voice"
            status={perms.mic}
            onGrant={() => window.qvoiceSettings.requestMicPermission().then(() =>
              window.qvoiceSettings.checkPermissions().then(setPerms)
            )}
          />
          <PermissionRow
            icon="⌨️"
            label="Accessibility"
            sub="Required for the global hotkey and auto-paste"
            status={perms.accessibility}
            onGrant={() => window.qvoiceSettings.openAccessibilitySettings()}
          />
        </div>
        {!allPermsGranted && (
          <div className="perm-hint">Grant both permissions above, then continue.</div>
        )}
      </div>
      <div className="ob-footer">
        <button
          className="ob-btn-primary"
          disabled={!allPermsGranted}
          style={!allPermsGranted ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
          onClick={() => setStep(0)}
        >
          Continue
        </button>
      </div>
    </div>
  )

  // ── Step 0: Engine ──────────────────────────────────────────────
  if (step === 0) return (
    <div className="ob-root">
      <div className="ob-titlebar" />
      <Steps step={0} total={3} />
      <div className="ob-body">
        <div className="ob-heading">Choose your transcription engine</div>
        <div className="ob-sub">Both run fully on-device. No data leaves your Mac.</div>
        <div className="ob-cards">
          {ENGINES.map(e => (
            <OptionCard key={e.val} {...e} selected={engine === e.val} cached={false} onClick={() => selectEngine(e.val)} />
          ))}
        </div>
      </div>
      <div className="ob-footer">
        <button className="ob-btn-primary" onClick={() => setStep(1)}>Continue</button>
      </div>
    </div>
  )

  // ── Step 1: Model ───────────────────────────────────────────────
  if (step === 1) return (
    <div className="ob-root">
      <div className="ob-titlebar" />
      <Steps step={1} total={3} />
      <div className="ob-body">
        <div className="ob-heading">Choose a model</div>
        <div className="ob-sub">{engine === 'parakeet' ? 'Parakeet models are optimised for Apple Neural Engine.' : 'Whisper runs on CPU and GPU.'}</div>
        <div className="ob-cards">
          {modelOptions().map(m => (
            <OptionCard key={m.val} {...m} selected={model === m.val} cached={isCached(m.val)} onClick={() => setModel(m.val)} />
          ))}
        </div>
        <div className="ob-section-label">AI correction (optional)</div>
        <div className="ob-sub ob-sub-sm">Fixes grammar and punctuation after transcription.</div>
        <div className="ob-cards">
          {LLM_MODELS.map(m => (
            <OptionCard key={m.val ?? 'skip'} {...m} val={m.val} selected={llm === m.val} cached={isCached(m.val)} onClick={() => setLlm(m.val)} />
          ))}
        </div>
      </div>
      <div className="ob-footer">
        <button className="ob-btn-ghost" onClick={() => setStep(0)}>Back</button>
        <button className="ob-btn-primary" onClick={() => setStep(2)}>Continue</button>
      </div>
    </div>
  )

  // ── Step 2: Confirm ─────────────────────────────────────────────
  if (step === 2) {
    const needsDownload = [model, llm].filter(r => r && !isCached(r))
    return (
      <div className="ob-root">
        <div className="ob-titlebar" />
        <Steps step={2} total={3} />
        <div className="ob-body">
          <div className="ob-heading">Ready to set up</div>
          <div className="ob-summary">
            <div className="ob-summary-row"><span className="ob-summary-key">Engine</span><span className="ob-summary-val">{engine}</span></div>
            <div className="ob-summary-row"><span className="ob-summary-key">Model</span><span className="ob-summary-val">{model?.split('/').pop() ?? '—'}</span></div>
            <div className="ob-summary-row"><span className="ob-summary-key">LLM</span><span className="ob-summary-val">{llm ? llm.split('/').pop() : 'None'}</span></div>
          </div>
          {needsDownload.length > 0 && (
            <div className="ob-note">
              {needsDownload.length} model{needsDownload.length > 1 ? 's' : ''} will be downloaded (~1–4 GB).
            </div>
          )}
        </div>
        <div className="ob-footer">
          <button className="ob-btn-ghost" onClick={() => setStep(1)}>Back</button>
          <button className="ob-btn-primary" onClick={startDownloads}>
            {needsDownload.length > 0 ? 'Download & Start' : 'Start Qvoice'}
          </button>
        </div>
      </div>
    )
  }

  // ── Step 3: Download ─────────────────────────────────────────────
  return (
    <div className="ob-root">
      <div className="ob-titlebar" />
      <div className="ob-body ob-body-center">
        {!allDone ? (
          <>
            <div className="ob-heading">Downloading models</div>
            <div className="ob-sub">This may take a few minutes.</div>
            <div className="ob-dl-list">
              {Object.entries(downloads).map(([repo, { pct, done }]) => (
                <div key={repo} className="ob-dl-item">
                  <div className="ob-dl-name">{repo.split('/').pop()}</div>
                  {done
                    ? <div className="ob-dl-done">Done</div>
                    : <DownloadBar pct={pct} />
                  }
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="ob-check">✓</div>
            <div className="ob-heading">You're all set</div>
            <div className="ob-sub">Use your hotkey (double-tap Control) to start recording.</div>
          </>
        )}
      </div>
      {allDone && (
        <div className="ob-footer">
          <button className="ob-btn-primary" onClick={finish}>Open Qvoice</button>
        </div>
      )}
    </div>
  )
}
