import { useEffect, useRef, useState } from 'react'
import { LiquidCanvas, GlassContainer, Glass, Frame } from '@liquid-dom/react'
import './Settings.css'

// ─── Glass Card ────────────────────────────────────────────────
function GlassCard({ children, className = '' }) {
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
    <div ref={hostRef} className={`glass-card ${className}`}>
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

// ─── Settings ──────────────────────────────────────────────────
export function Settings() {
  const [form, setForm] = useState({
    whisperModel: 'base.en',
    llmRepo: '',
    llmFile: '',
    systemPrompt: '',
    beamSize: 5,
    correctionEnabled: true,
    autoPaste: false,
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

  return (
    <>
      <div className="titlebar">Settings</div>
      <div className="content">

        <div className="section">
          <div className="section-title">Models</div>
          <GlassCard>
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
            <div className="row">
              <span className="label">LLM File</span>
              <input type="text" value={form.llmFile} onChange={e => set('llmFile', e.target.value)} placeholder="model.gguf" />
            </div>
          </GlassCard>
          <div className="note">Model changes restart the AI server</div>
        </div>

        <div className="section">
          <div className="section-title">Transcription</div>
          <GlassCard>
            <div className="row">
              <span className="label">AI Correction</span>
              <Toggle on={form.correctionEnabled} onClick={() => set('correctionEnabled', !form.correctionEnabled)} />
            </div>
            <div className="row">
              <span className="label">Beam Size</span>
              <input type="number" value={form.beamSize} min="1" max="10" onChange={e => set('beamSize', e.target.value)} />
            </div>
          </GlassCard>
        </div>

        <div className="section">
          <div className="section-title">System Prompt</div>
          <textarea
            value={form.systemPrompt}
            onChange={e => set('systemPrompt', e.target.value)}
            placeholder="Instructions for the AI correction model…"
          />
        </div>

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
