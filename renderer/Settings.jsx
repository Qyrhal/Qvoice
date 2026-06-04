import { useEffect, useRef, useState } from 'react'
import { LiquidCanvas, GlassContainer, Glass, Frame } from '@liquid-dom/react'
import './Settings.css'

const ENGINE_META = {
  whisper:  'CPU · faster-whisper + LLM correction',
  parakeet: 'Apple Silicon GPU · parakeet-mlx',
}

// ─── Glass Card ────────────────────────────────────────────────
function GlassCard({ children }) {
  const hostRef = useRef(null)
  const [proposal, setProposal] = useState(null)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0 && width < 8192 && height < 8192)
        setProposal({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={hostRef} className="glass-card">
      {proposal && (
        <LiquidCanvas
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          canvasStyle={{
            position: 'absolute', top: 0, left: 0,
            width: `${proposal.width}px`, height: `${proposal.height}px`,
            mixBlendMode: 'screen',
          }}
          proposal={proposal}
          maxDpr={Math.min(window.devicePixelRatio || 1, 2)}
          frameloop="demand"
          onError={(err) => console.error('LiquidCanvas error:', err)}
        >
          <Frame maxWidth={Infinity} maxHeight={Infinity}>
            <GlassContainer
              blur={0}
              tint={{ r: 0, g: 0, b: 0, a: 0 }}
              specularStrength={0.7}
              specularWidth={0.5}
              specularFalloff={2}
              bezelWidth={1.5}
              thickness={6}
              shadowColor={{ r: 0, g: 0, b: 0, a: 0 }}
              shadowOffsetX={0}
              shadowOffsetY={0}
              shadowBlur={0}
            >
              <Frame maxWidth={Infinity} maxHeight={Infinity}>
                <Glass cornerRadius={12} />
              </Frame>
            </GlassContainer>
          </Frame>
        </LiquidCanvas>
      )}
      <div className="glass-card-content">
        {children}
      </div>
    </div>
  )
}

// ─── Toggle ────────────────────────────────────────────────────
function Toggle({ on, onClick }) {
  return <div className={`toggle ${on ? 'on' : ''}`} onClick={onClick} />
}

// ─── Segmented Control ─────────────────────────────────────────
function SegControl({ value, options, onChange }) {
  return (
    <div className="seg-ctrl">
      {options.map(({ val, label }) => (
        <button
          key={val}
          className={`seg-btn ${value === val ? 'active' : ''}`}
          onClick={() => onChange(val)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ─── SVG Icons ─────────────────────────────────────────────────
function SpinnerIcon() {
  return <svg className="spinner" viewBox="0 0 16 16" fill="none" width="14" height="14"><circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5"/><path d="M8 2a6 6 0 0 1 6 6" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round"/></svg>
}
function CheckIcon() {
  return <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><circle cx="8" cy="8" r="6" fill="rgba(48,209,88,0.12)" stroke="#30d158" strokeWidth="1.2"/><path d="M5 8.5l2 2 4-4" stroke="#30d158" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function DownloadIcon() {
  return <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><circle cx="8" cy="8" r="6" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)" strokeWidth="1.2"/><path d="M8 5v5M5.5 8.5L8 11l2.5-2.5" stroke="rgba(255,255,255,0.45)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function CircleProgress({ pct }) {
  const r = 5.5
  const circ = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
      <circle cx="8" cy="8" r={r} stroke="rgba(255,255,255,0.15)" strokeWidth="1.5"/>
      <circle cx="8" cy="8" r={r}
        stroke="rgba(255,255,255,0.85)" strokeWidth="1.5"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.max(0, Math.min(1, pct)))}
        strokeLinecap="round"
        style={{ transform: 'rotate(-90deg)', transformOrigin: '8px 8px', transition: 'stroke-dashoffset 0.25s ease' }}
      />
    </svg>
  )
}
function StatusIcon({ kind, pct }) {
  if (kind === 'downloading') return <CircleProgress pct={pct ?? 0} />
  if (kind === 'ready')       return <CheckIcon />
  if (kind === 'missing')     return <DownloadIcon />
  return <SpinnerIcon />
}

// ─── Model Select ─────────────────────────────────────────────
function ModelSelect({ value, options, onChange, onSelectModel, modelKey, modelStatus, downloads, modelStatusFor }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selected = options.find(o => o.val === value)

  const handleSelect = (val) => {
    onChange(val)
    setOpen(false)
    if (onSelectModel) onSelectModel(val, modelKey)
  }

  const triggerSt = modelStatusFor ? modelStatusFor(value, modelKey) : null

  return (
    <div className="model-select" ref={ref}>
      <button className={`model-select-trigger ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
        <span className="model-select-label">{selected?.label ?? value}</span>
        <span className="model-select-trigger-icon">{triggerSt && <StatusIcon kind={triggerSt.kind} pct={triggerSt.pct} />}</span>
        <svg className="model-select-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="rgba(255,255,255,0.3)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      {open && (
        <div className="model-select-dropdown">
          {options.map(opt => {
            const s = modelStatusFor ? modelStatusFor(opt.val, modelKey) : null
            return (
              <button key={opt.val} className={`model-select-option ${opt.val === value ? 'active' : ''}`} onClick={() => handleSelect(opt.val)}>
                {s ? <StatusIcon kind={s.kind} pct={s.pct} /> : null}
                {opt.label || opt.val}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Model Combo ──────────────────────────────────────────────
function ModelCombo({ value, options, onChange, onSelectModel, modelStatus, downloads, modelStatusFor, placeholder }) {
  const [open, setOpen] = useState(false)
  const [customMode, setCustomMode] = useState(false)
  const [customVal, setCustomVal] = useState('')
  const ref = useRef(null)
  const isPreset = options.some(o => o.val === value)

  useEffect(() => { if (isPreset) setCustomMode(false) }, [value, isPreset])
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const commitCustom = () => { const t = customVal.trim(); if (t) onChange(t); setCustomMode(false); setOpen(false); if (onSelectModel) onSelectModel(t, 'llm') }
  const handleSelect = (val) => { onChange(val); setOpen(false); if (onSelectModel) onSelectModel(val, 'llm') }

  const triggerSt = modelStatusFor ? modelStatusFor(value, 'llm') : null

  return (
    <div className="model-select" ref={ref}>
      {customMode ? (
        <input type="text" autoFocus value={customVal} onChange={e => setCustomVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') commitCustom(); if (e.key === 'Escape') { setCustomMode(false); setOpen(false) } }} onBlur={commitCustom} placeholder={placeholder} className="model-combo-input" />
      ) : (
        <button className={`model-select-trigger ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
          <span className="model-select-label">{isPreset ? options.find(o => o.val === value)?.label : value || placeholder}</span>
          <span className="model-select-trigger-icon">{triggerSt && <StatusIcon kind={triggerSt.kind} pct={triggerSt.pct} />}</span>
          <svg className="model-select-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="rgba(255,255,255,0.3)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      )}
      {open && !customMode && (
        <div className="model-select-dropdown">
          {options.map(opt => {
            const s = modelStatusFor ? modelStatusFor(opt.val, 'llm') : null
            return (
              <button key={opt.val} className={`model-select-option ${opt.val === value ? 'active' : ''}`} onClick={() => handleSelect(opt.val)}>
                {s ? <StatusIcon kind={s.kind} pct={s.pct} /> : null}
                {opt.label || opt.val}
              </button>
            )
          })}
          <div className="model-select-divider" />
          <button className="model-select-option model-select-custom" onClick={() => { setCustomVal(!isPreset && value ? value : ''); setCustomMode(true) }}>
            <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M8 3v10M3 8h10" stroke="rgba(255,255,255,0.45)" strokeWidth="1.3" strokeLinecap="round"/></svg>
            Custom model…
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Settings ──────────────────────────────────────────────────
export function Settings() {
  const [form, setForm] = useState({
    engine: 'whisper',
    whisperModel: 'base.en',
    llmRepo: '',
    systemPrompt: '',
    beamSize: 5,
    parakeetModel: 'mlx-community/parakeet-tdt-0.6b-v2',
    correctionEnabled: true,
    autoPaste: true,
    hotkeyKey: 'control',
    hotkeyMode: 'double-tap',
  })
  const [saved, setSaved] = useState(false)
  const [modelStatus, setModelStatus] = useState(null)
  const [downloads, setDownloads] = useState({})

  async function runCheck() {
    const result = await window.qvoiceSettings.checkModels()
    if (result.ok) setModelStatus(result.models || {})
  }

  useEffect(() => {
    window.qvoiceSettings.getSettings().then(s => setForm(f => ({ ...f, ...s })))
    const t = setTimeout(runCheck, 300)
    const unsub = window.qvoiceSettings.onDownloadProgress(({ repo, type, pct }) => {
      if (type === 'progress' || type === 'file') {
        setDownloads(d => ({ ...d, [repo]: { kind: 'downloading', pct: pct ?? 0 } }))
      } else if (type === 'done' || type === 'error') {
        setDownloads(d => { const n = { ...d }; delete n[repo]; return n })
        if (type === 'done') runCheck()
      }
    })
    return () => { clearTimeout(t); unsub() }
  }, [])

  function set(key, value) { setForm(f => ({ ...f, [key]: value })) }

  async function save() {
    if (saved) return
    const newSettings = { ...form, beamSize: Math.max(1, Math.min(10, parseInt(form.beamSize, 10) || 5)) }
    await window.qvoiceSettings.saveSettings(newSettings)
    setForm(newSettings); setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const isParakeet = form.engine === 'parakeet'
  const hotkeyKeyName = { control: 'Control', command: 'Command', option: 'Option', shift: 'Shift' }[form.hotkeyKey] || 'Control'

  function modelStatusFor(val, group) {
    const dl = downloads[val]
    if (dl) return dl
    const g = modelStatus?.[group]
    if (!g) return null
    return { kind: g.cached ? 'ready' : 'missing', pct: 0 }
  }

  function onSelectModel(val, group) {
    const st = modelStatusFor(val, group)
    if (!st || st.kind === 'missing') {
      setDownloads(d => ({ ...d, [val]: { kind: 'downloading', pct: 0 } }))
      window.qvoiceSettings.downloadModel(val, group)
    }
  }

  const whisperOptions = [
    { val: 'tiny.en', label: 'tiny.en — Fastest' },
    { val: 'base.en', label: 'base.en — Fast' },
    { val: 'small.en', label: 'small.en — Balanced' },
    { val: 'medium.en', label: 'medium.en — Accurate' },
    { val: 'large-v3', label: 'large-v3 — Best' },
  ]
  const parakeetOptions = [
    { val: 'mlx-community/parakeet-tdt-0.6b-v3', label: '0.6B v3 — Latest' },
    { val: 'mlx-community/parakeet-tdt-0.6b-v2', label: '0.6B v2' },
  ]
  const llmOptions = [
    { val: 'LiquidAI/LFM2.5-1.2B-Instruct-MLX-6bit', label: 'LFM2.5 1.2B (MLX 6bit) — Default' },
    { val: 'mlx-community/Qwen2.5-3B-Instruct-4bit', label: 'Qwen2.5 3B (MLX 4bit)' },
    { val: 'mlx-community/TinyLlama-1.1B-Chat-v1.0-4bit', label: 'TinyLlama 1.1B (MLX 4bit)' },
    { val: 'mlx-community/Mistral-7B-Instruct-v0.3-4bit', label: 'Mistral 7B (MLX 4bit)' },
  ]

  return (
    <>
      <div className="titlebar">Settings</div>
      <div className="content">

        {/* Engine */}
        <div className="section">
          <div className="section-title">Transcription Engine</div>
          <GlassCard>
            <div className="row">
              <span className="label">Engine<div className="label-sub">{ENGINE_META[form.engine] || ''}</div></span>
              <SegControl value={form.engine} options={[{ val: 'whisper', label: 'Whisper' }, { val: 'parakeet', label: 'Parakeet' }]} onChange={v => set('engine', v)} />
            </div>
          </GlassCard>
        </div>

        {/* Models */}
        <div className="section">
          <div className="section-title">Models</div>
          <GlassCard>
            {!isParakeet && (
              <>
                <div className="row"><span className="label">Whisper Model</span><ModelSelect value={form.whisperModel} options={whisperOptions} onChange={v => set('whisperModel', v)} modelKey="whisper" modelStatus={modelStatus} onSelectModel={onSelectModel} downloads={downloads} modelStatusFor={modelStatusFor} /></div>
                <div className="row"><span className="label">LLM Repo</span><ModelCombo value={form.llmRepo} options={llmOptions} onChange={v => set('llmRepo', v)} modelStatus={modelStatus} onSelectModel={onSelectModel} downloads={downloads} modelStatusFor={modelStatusFor} placeholder="HuggingFace repo ID" /></div>
              </>
            )}
            {isParakeet && (
              <>
                <div className="row"><span className="label">Parakeet Model</span><ModelSelect value={form.parakeetModel} options={parakeetOptions} onChange={v => set('parakeetModel', v)} modelKey="parakeet" modelStatus={modelStatus} onSelectModel={onSelectModel} downloads={downloads} modelStatusFor={modelStatusFor} /></div>
                <div className="row"><span className="label">LLM Repo</span><ModelCombo value={form.llmRepo} options={llmOptions} onChange={v => set('llmRepo', v)} modelStatus={modelStatus} onSelectModel={onSelectModel} downloads={downloads} modelStatusFor={modelStatusFor} placeholder="HuggingFace repo ID" /></div>
              </>
            )}
          </GlassCard>
          <div className="note">Model changes restart the AI server</div>
        </div>

        {/* Transcription */}
        <div className="section">
          <div className="section-title">Transcription</div>
          <GlassCard>
            <div className="row"><span className="label">AI Correction</span><Toggle on={form.correctionEnabled} onClick={() => set('correctionEnabled', !form.correctionEnabled)} /></div>
            {!isParakeet && <div className="row"><span className="label">Beam Size</span><input type="number" value={form.beamSize} min="1" max="10" onChange={e => set('beamSize', e.target.value)} /></div>}
          </GlassCard>
        </div>

        {/* System Prompt */}
        <div className="section"><div className="section-title">System Prompt</div><textarea value={form.systemPrompt} onChange={e => set('systemPrompt', e.target.value)} placeholder="Instructions for the AI correction model…" /></div>

        {/* Hotkey */}
        <div className="section">
          <div className="section-title">Hotkey</div>
          <GlassCard>
            <div className="row"><span className="label">Key</span><SegControl value={form.hotkeyKey} options={[{ val: 'control', label: 'Control' }, { val: 'command', label: 'Command' }, { val: 'option', label: 'Option' }, { val: 'shift', label: 'Shift' }]} onChange={v => set('hotkeyKey', v)} /></div>
            <div className="row"><span className="label">Mode<div className="label-sub">{form.hotkeyMode === 'push-to-talk' ? `Hold ${hotkeyKeyName} to record` : `Double-tap ${hotkeyKeyName} to toggle`}</div></span><SegControl value={form.hotkeyMode} options={[{ val: 'double-tap', label: 'Double-tap' }, { val: 'push-to-talk', label: 'Hold key' }]} onChange={v => set('hotkeyMode', v)} /></div>
          </GlassCard>
        </div>

        {/* Behavior */}
        <div className="section">
          <div className="section-title">Behavior</div>
          <GlassCard>
            <div className="row"><div className="label">Auto Paste<div className="label-sub">Skip preview and paste immediately</div></div><Toggle on={form.autoPaste} onClick={() => set('autoPaste', !form.autoPaste)} /></div>
          </GlassCard>
        </div>

        <button className={`btn-save ${saved ? 'saved' : ''}`} onClick={save}>{saved ? 'Saved!' : 'Save Settings'}</button>

      </div>
    </>
  )
}