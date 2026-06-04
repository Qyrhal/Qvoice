import { useEffect, useRef, useState } from 'react'
import { LiquidCanvas, GlassContainer, Glass, Frame } from '@liquid-dom/react'
import './App.css'

const PARTIAL_INTERVAL_MS = 2000
const MIN_PARTIAL_SAMPLES = 16000

// ─── WAV Recorder ──────────────────────────────────────────────
class WavRecorder {
  constructor() {
    this.ctx = null
    this.stream = null
    this.processor = null
    this.analyser = null
    this.chunks = []
    this.RATE = 16000
  }

  async start() {
    this.chunks = []
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: this.RATE, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
    this.ctx = new AudioContext({ sampleRate: this.RATE })
    const src = this.ctx.createMediaStreamSource(this.stream)

    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 256
    src.connect(this.analyser)

    this.processor = this.ctx.createScriptProcessor(4096, 1, 1)
    this.processor.onaudioprocess = (e) => {
      this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    }
    src.connect(this.processor)
    this.processor.connect(this.ctx.destination)

    return this.analyser
  }

  snapshot() {
    if (this.chunks.length === 0) return null
    const total = this.chunks.reduce((n, c) => n + c.length, 0)
    if (total < MIN_PARTIAL_SAMPLES) return null
    const pcm = new Float32Array(total)
    let offset = 0
    for (const c of this.chunks) { pcm.set(c, offset); offset += c.length }
    return this._toWav(pcm, this.RATE)
  }

  stop() {
    this.processor.disconnect()
    this.stream.getTracks().forEach((t) => t.stop())
    this.ctx.close()

    const total = this.chunks.reduce((n, c) => n + c.length, 0)
    const pcm = new Float32Array(total)
    let offset = 0
    for (const c of this.chunks) { pcm.set(c, offset); offset += c.length }
    return this._toWav(pcm, this.RATE)
  }

  _toWav(samples, rate) {
    const buf = new ArrayBuffer(44 + samples.length * 2)
    const v = new DataView(buf)
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }

    str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true)
    str(8, 'WAVE'); str(12, 'fmt ')
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true)
    v.setUint16(32, 2, true); v.setUint16(34, 16, true)
    str(36, 'data'); v.setUint32(40, samples.length * 2, true)

    let off = 44
    for (const s of samples) {
      const c = Math.max(-1, Math.min(1, s))
      v.setInt16(off, c < 0 ? c * 0x8000 : c * 0x7fff, true)
      off += 2
    }
    return buf
  }
}

// ─── Signal Bars ───────────────────────────────────────────────
const BAR_HEIGHTS = [4, 7, 11, 15]

function SignalBars({ analyser }) {
  const barRefs = useRef([])

  useEffect(() => {
    if (!analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    let frame = null

    function tick() {
      frame = requestAnimationFrame(tick)
      analyser.getByteFrequencyData(data)
      let sum = 0
      const count = Math.min(24, data.length)
      for (let i = 0; i < count; i++) sum += data[i]
      const vol = sum / (count * 255)

      barRefs.current.forEach((el, i) => {
        if (!el) return
        el.style.height = `${BAR_HEIGHTS[i] + vol * 7}px`
        el.style.opacity = `${0.35 + vol * 0.65}`
      })
    }
    tick()

    return () => { if (frame) cancelAnimationFrame(frame) }
  }, [analyser])

  return (
    <div className="signal-bars">
      {BAR_HEIGHTS.map((h, i) => (
        <div key={i} ref={el => barRefs.current[i] = el} className="signal-bar" style={{ height: `${h}px` }} />
      ))}
    </div>
  )
}

// ─── Pill Spinner ──────────────────────────────────────────────
function PillSpinner() {
  return (
    <div className="pill-spinner">
      <span /><span /><span />
    </div>
  )
}

// ─── Timer ────────────────────────────────────────────────────
function formatTime(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// ─── Pill Content ─────────────────────────────────────────────
function PillContent({ state, analyser, elapsed, appName, liveText, resultText, onPaste, onDismiss }) {
  if (state === 'loading') {
    return (
      <div className="pill-row">
        <PillSpinner />
        <span className="pill-label">Loading model</span>
      </div>
    )
  }
  if (state === 'recording') {
    return (
      <>
        <div className="pill-row">
          <SignalBars analyser={analyser} />
          <div className="rec-dot" />
          <span className="rec-timer">{formatTime(elapsed)}</span>
          {appName && (
            <>
              <span className="rec-arrow">→</span>
              <span className="rec-app">{appName}</span>
            </>
          )}
        </div>
        {liveText && <div className="live-text">{liveText}</div>}
      </>
    )
  }
  if (state === 'transcribing') {
    return (
      <div className="pill-row">
        <PillSpinner />
        <span className="pill-label">Transcribing</span>
      </div>
    )
  }
  if (state === 'correcting') {
    return (
      <div className="pill-row">
        <PillSpinner />
        <span className="pill-label">Correcting</span>
      </div>
    )
  }
  if (state === 'preview') {
    return (
      <div className="pill-expand">
        <p className="result-text">{resultText}</p>
        <div className="preview-actions">
          <button className="preview-btn preview-btn-dismiss" onClick={onDismiss}>Dismiss</button>
          <button className="preview-btn preview-btn-paste" onClick={onPaste}>Paste</button>
        </div>
      </div>
    )
  }
  if (state === 'result') {
    return (
      <div className="pill-row">
        <div className="done-dot" />
        <span className="pill-label">Pasted</span>
      </div>
    )
  }
  return null
}

// ─── Glass Shape ───────────────────────────────────────────────
function GlassShape() {
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
    <div ref={hostRef} className="glass-canvas-layer">
      {proposal && (
        <LiquidCanvas
          style={{ width: '100%', height: '100%', display: 'block' }}
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
                <Glass cornerRadius={22} />
              </Frame>
            </GlassContainer>
          </Frame>
        </LiquidCanvas>
      )}
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────
export function App() {
  const [state, setState] = useState('idle')
  const [resultText, setResultText] = useState('')
  const [visible, setVisible] = useState(false)
  const [animating, setAnimating] = useState(false)
  const [analyser, setAnalyser] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [appName, setAppName] = useState('')
  const [liveText, setLiveText] = useState('')

  const recorderRef = useRef(null)
  const stateRef = useRef(state)
  const overlayRef = useRef(null)
  const partialTimerRef = useRef(null)
  const partialInFlightRef = useRef(false)
  const elapsedTimerRef = useRef(null)
  const autoPasteRef = useRef(true)
  stateRef.current = state

  function showPanel() { setVisible(true); setAnimating(true) }

  function hidePanel() {
    setAnimating(false)
    setVisible(false)
    setLiveText('')
    stopElapsedTimer()
    window.qvoice.hideWindow()
  }

  function startElapsedTimer() {
    setElapsed(0)
    elapsedTimerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
  }

  function stopElapsedTimer() {
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null }
    setElapsed(0)
  }

  function stopPartialTimer() {
    if (partialTimerRef.current) { clearInterval(partialTimerRef.current); partialTimerRef.current = null }
    partialInFlightRef.current = false
  }

  function startPartialTimer() {
    stopPartialTimer()
    partialTimerRef.current = setInterval(async () => {
      if (!recorderRef.current || partialInFlightRef.current) return
      const snap = recorderRef.current.snapshot()
      if (!snap) return
      partialInFlightRef.current = true
      try {
        const res = await window.qvoice.transcribePartial(snap)
        if (res?.text?.trim()) setLiveText(res.text.trim())
      } catch {}
      partialInFlightRef.current = false
    }, PARTIAL_INTERVAL_MS)
  }

  useEffect(() => {
    const qv = window.qvoice

    qv.onSettingsUpdate((s) => { if (s.autoPaste !== undefined) autoPasteRef.current = s.autoPaste })
    qv.onPreviewConfirmed(() => hidePanel())
    qv.onServerReady(() => { if (stateRef.current === 'loading') hidePanel() })
    qv.onShowLoading(() => { setState('loading'); showPanel() })

    qv.onRecordingStart(async (data) => {
      setAppName(data?.appName || '')
      setState('recording')
      showPanel()
      startElapsedTimer()
      recorderRef.current = new WavRecorder()
      try {
        const node = await recorderRef.current.start()
        setAnalyser(node)
        startPartialTimer()
      } catch (err) {
        console.error('Mic error:', err)
        hidePanel()
      }
    })

    qv.onRecordingStop(async () => {
      stopPartialTimer()
      stopElapsedTimer()
      setLiveText('')
      setState('transcribing')
      const recorder = recorderRef.current
      recorderRef.current = null
      setAnalyser(null)
      if (!recorder) return

      let wavBuf
      try { wavBuf = recorder.stop() } catch (err) { console.error('Recorder error:', err); hidePanel(); return }

      let result
      try { result = await qv.transcribeAudio(wavBuf) } catch (err) { console.error('Transcription error:', err); hidePanel(); return }

      if (!result || result.status !== 'ok' || !result.text?.trim()) { hidePanel(); return }

      const text = result.text.trim()
      setResultText(text)
      if (autoPasteRef.current) {
        setState('result')
        setTimeout(() => { setAnimating(false); qv.resultReady(text) }, 300)
      } else {
        setState('preview')
        qv.previewReady(text)
      }
    })

    qv.onTranscriptionProgress((data) => {
      if (data.status === 'transcribed') setState('correcting')
    })
  }, [])

  useEffect(() => {
    if (visible && overlayRef.current) {
      const panel = overlayRef.current.parentElement
      if (panel) window.qvoice.setHeight(Math.round(panel.getBoundingClientRect().height))
    }
  }, [visible, state, resultText, liveText])

  if (!visible) return null

  return (
    <div className={`glass-panel ${animating ? 'entering' : 'exiting'}`}>
      <GlassShape />
      <div ref={overlayRef} className="glass-overlay">
        <PillContent
          state={state}
          analyser={analyser}
          elapsed={elapsed}
          appName={appName}
          liveText={liveText}
          resultText={resultText}
          onPaste={() => window.qvoice.confirmPaste(resultText)}
          onDismiss={hidePanel}
        />
      </div>
    </div>
  )
}
