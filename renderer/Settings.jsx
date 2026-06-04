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

  useEffect(() => {
    window.qvoiceSettings.getSettings().then(s => setForm(f => ({ ...f, ...s })))
  }, [])

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function save() {
    if (saved) return
    const newSettings = {
      ...form,
      beamSize: Math.max(1, Math.min(10, parseInt(form.beamSize, 10) || 5)),
    }
    await window.qvoiceSettings.saveSettings(newSettings)
    setForm(newSettings)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const isParakeet = form.engine === 'parakeet'
  const hotkeyKeyName = { control: 'Control', command: 'Command', option: 'Option', shift: 'Shift' }[form.hotkeyKey] || 'Control'

  return (
    <>
      <div className="titlebar">Settings</div>
      <div className="content">

        {/* Engine */}
        <div className="section">
          <div className="section-title">Transcription Engine</div>
          <GlassCard>
            <div className="row">
              <span className="label">
                Engine
                <div className="label-sub">{ENGINE_META[form.engine] || ''}</div>
              </span>
              <SegControl
                value={form.engine}
                options={[{ val: 'whisper', label: 'Whisper' }, { val: 'parakeet', label: 'Parakeet' }]}
                onChange={v => set('engine', v)}
              />
            </div>
          </GlassCard>
        </div>

        {/* Models */}
        <div className="section">
          <div className="section-title">Models</div>
          <GlassCard>
            {!isParakeet && (
              <>
                <div className="row">
                  <span className="label">Whisper Model</span>
                  <select value={form.whisperModel} onChange={e => set('whisperModel', e.target.value)}>
                    <option value="tiny.en">tiny.en — Fastest</option>
                    <option value="base.en">base.en — Fast</option>
                    <option value="small.en">small.en — Balanced</option>
                    <option value="medium.en">medium.en — Accurate</option>
                    <option value="large-v3">large-v3 — Best</option>
                  </select>
                </div>
                <div className="row">
                  <span className="label">LLM Repo</span>
                  <input type="text" value={form.llmRepo} onChange={e => set('llmRepo', e.target.value)} placeholder="HuggingFace repo ID" />
                </div>
              </>
            )}
            {isParakeet && (
              <>
                <div className="row">
                  <span className="label">Parakeet Model</span>
                  <select value={form.parakeetModel} onChange={e => set('parakeetModel', e.target.value)}>
                    <option value="mlx-community/parakeet-tdt-0.6b-v3">0.6B v3 — Latest</option>
                    <option value="mlx-community/parakeet-tdt-0.6b-v2">0.6B v2</option>
                  </select>
                </div>
                <div className="row">
                  <span className="label">LLM Repo</span>
                  <input type="text" value={form.llmRepo} onChange={e => set('llmRepo', e.target.value)} placeholder="HuggingFace repo ID" />
                </div>
              </>
            )}
          </GlassCard>
          <div className="note">Model changes restart the AI server</div>
        </div>

        {/* Transcription */}
        <div className="section">
          <div className="section-title">Transcription</div>
          <GlassCard>
            <div className="row">
              <span className="label">AI Correction</span>
              <Toggle on={form.correctionEnabled} onClick={() => set('correctionEnabled', !form.correctionEnabled)} />
            </div>
            {!isParakeet && (
              <div className="row">
                <span className="label">Beam Size</span>
                <input type="number" value={form.beamSize} min="1" max="10" onChange={e => set('beamSize', e.target.value)} />
              </div>
            )}
          </GlassCard>
        </div>

        {/* System Prompt */}
        <div className="section">
          <div className="section-title">System Prompt</div>
          <textarea
            value={form.systemPrompt}
            onChange={e => set('systemPrompt', e.target.value)}
            placeholder="Instructions for the AI correction model…"
          />
        </div>

        {/* Hotkey */}
        <div className="section">
          <div className="section-title">Hotkey</div>
          <GlassCard>
            <div className="row">
              <span className="label">Key</span>
              <SegControl
                value={form.hotkeyKey}
                options={[
                  { val: 'control', label: 'Control' },
                  { val: 'command', label: 'Command' },
                  { val: 'option',  label: 'Option'  },
                  { val: 'shift',   label: 'Shift'   },
                ]}
                onChange={v => set('hotkeyKey', v)}
              />
            </div>
            <div className="row">
              <span className="label">
                Mode
                <div className="label-sub">
                  {form.hotkeyMode === 'push-to-talk'
                    ? `Hold ${hotkeyKeyName} to record`
                    : `Double-tap ${hotkeyKeyName} to toggle`}
                </div>
              </span>
              <SegControl
                value={form.hotkeyMode}
                options={[
                  { val: 'double-tap',   label: 'Double-tap' },
                  { val: 'push-to-talk', label: 'Hold key'   },
                ]}
                onChange={v => set('hotkeyMode', v)}
              />
            </div>
          </GlassCard>
        </div>

        {/* Behavior */}
        <div className="section">
          <div className="section-title">Behavior</div>
          <GlassCard>
            <div className="row">
              <div className="label">
                Auto Paste
                <div className="label-sub">Skip preview and paste immediately</div>
              </div>
              <Toggle on={form.autoPaste} onClick={() => set('autoPaste', !form.autoPaste)} />
            </div>
          </GlassCard>
        </div>

        <button className={`btn-save ${saved ? 'saved' : ''}`} onClick={save}>
          {saved ? 'Saved!' : 'Save Settings'}
        </button>

      </div>
    </>
  )
}
