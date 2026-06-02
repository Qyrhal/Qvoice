import { useEffect, useRef, useState } from 'react'
import { LiquidCanvas, GlassContainer, Glass, Frame } from '@liquid-dom/react'
import './App.css'

// ─── State machine ─────────────────────────────────────────────
const PHASES = {
  idle:        { label: null,      dot: '' },
  loading:     { label: 'Loading model',  dot: 'dot-idle' },
  recording:   { label: 'Recording',      dot: 'dot-record' },
  transcribing:{ label: 'Transcribing',   dot: 'dot-process' },
  correcting:  { label: 'Correcting',     dot: 'dot-correct' },
  result:      { label: 'Pasted',         dot: 'dot-done' },
}

const PARTIAL_INTERVAL_MS = 2000
const MIN_PARTIAL_SAMPLES = 16000 // 1 second of audio before first partial

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

  // Returns WAV of all audio recorded so far without stopping the recorder
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
    for (const c of this.chunks) {
      pcm.set(c, offset)
      offset += c.length
    }
    return this._toWav(pcm, this.RATE)
  }

  _toWav(samples, rate) {
    const buf = new ArrayBuffer(44 + samples.length * 2)
    const v = new DataView(buf)
    const str = (o, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
    }

    str(0, 'RIFF')
    v.setUint32(4, 36 + samples.length * 2, true)
    str(8, 'WAVE')
    str(12, 'fmt ')
    v.setUint32(16, 16, true)
    v.setUint16(20, 1, true)
    v.setUint16(22, 1, true)
    v.setUint32(24, rate, true)
    v.setUint32(28, rate * 2, true)
    v.setUint16(32, 2, true)
    v.setUint16(34, 16, true)
    str(36, 'data')
    v.setUint32(40, samples.length * 2, true)

    let off = 44
    for (const s of samples) {
      const clamped = Math.max(-1, Math.min(1, s))
      v.setInt16(off, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
      off += 2
    }
    return buf
  }
}

// ─── Waveform Bars ─────────────────────────────────────────────
const NUM_BARS = 13

function Waveform({ analyser }) {
  const barRefs = useRef([])

  useEffect(() => {
    if (!analyser) return

    const data = new Uint8Array(analyser.frequencyBinCount)
    const step = Math.floor(data.length / NUM_BARS)
    let frame = null

    barRefs.current.forEach(el => el?.classList.remove('idle'))

    function tick() {
      frame = requestAnimationFrame(tick)
      analyser.getByteFrequencyData(data)
      const half = Math.floor(NUM_BARS / 2)
      const heights = []
      for (let i = 0; i <= half; i++) {
        let sum = 0
        for (let j = 0; j < step; j++) sum += data[i * step + j]
        const avg = sum / step
        heights[i] = Math.max(3, Math.min(34, (avg / 255) * 38 + 3))
      }
      for (let i = 0; i < NUM_BARS; i++) {
        const idx = i <= half ? half - i : i - half
        const el = barRefs.current[i]
        if (el) el.style.height = `${heights[idx]}px`
      }
    }
    tick()

    return () => {
      if (frame) cancelAnimationFrame(frame)
      barRefs.current.forEach(el => el?.classList.add('idle'))
    }
  }, [analyser])

  return (
    <div className="waveform">
      {Array.from({ length: NUM_BARS }, (_, i) => (
        <div
          key={i}
          className="bar idle"
          ref={(el) => (barRefs.current[i] = el)}
        />
      ))}
    </div>
  )
}

// ─── Loading Dots ──────────────────────────────────────────────
function LoadingDots() {
  return (
    <div className="dots">
      <span />
      <span />
      <span />
    </div>
  )
}

// ─── Status Row ────────────────────────────────────────────────
function StatusRow({ phase }) {
  if (!phase.label) return null
  return (
    <div className="status-row">
      <div className={`dot ${phase.dot}`} />
      <span className="status-label">{phase.label}</span>
    </div>
  )
}

// ─── State Content ─────────────────────────────────────────────
function StateContent({ state, analyser, resultText, liveText }) {
  switch (state) {
    case 'loading':
      return <LoadingDots />
    case 'recording':
      return (
        <>
          <Waveform analyser={analyser} />
          {liveText && <div className="live-text">{liveText}</div>}
        </>
      )
    case 'transcribing':
      return <LoadingDots />
    case 'correcting':
      return <div className="result-text">{resultText}</div>
    case 'result':
      return <div className="result-text">{resultText}</div>
    default:
      return null
  }
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
      if (width > 0 && height > 0 && width < 8192 && height < 8192) {
        setProposal({ width, height })
      }
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
                <Glass cornerRadius={18} />
              </Frame>
            </GlassContainer>
          </Frame>
        </LiquidCanvas>
      )}
    </div>
  )
}

export function App() {
  const [state, setState] = useState('idle')
  const [resultText, setResultText] = useState('')
  const [liveText, setLiveText] = useState('')
  const [visible, setVisible] = useState(false)
  const [animating, setAnimating] = useState(false)
  const [analyser, setAnalyser] = useState(null)
  const recorderRef = useRef(null)
  const stateRef = useRef(state)
  const overlayRef = useRef(null)
  const partialTimerRef = useRef(null)
  const partialInFlightRef = useRef(false)
  stateRef.current = state

  function showPanel() {
    setVisible(true)
    setAnimating(true)
  }

  function hidePanel() {
    setAnimating(false)
    setVisible(false)
    setLiveText('')
    window.qvoice.hideWindow()
  }

  function stopPartialTimer() {
    if (partialTimerRef.current) {
      clearInterval(partialTimerRef.current)
      partialTimerRef.current = null
    }
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
        const result = await window.qvoice.transcribePartial(snap)
        if (result?.text?.trim()) setLiveText(result.text.trim())
      } catch {}
      partialInFlightRef.current = false
    }, PARTIAL_INTERVAL_MS)
  }

  // IPC listeners
  useEffect(() => {
    const qv = window.qvoice

    qv.onServerReady(() => {
      if (stateRef.current === 'loading') hidePanel()
    })

    qv.onShowLoading(() => {
      setState('loading')
      showPanel()
    })

    qv.onRecordingStart(async () => {
      setState('recording')
      setLiveText('')
      showPanel()
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
      setState('transcribing')
      const recorder = recorderRef.current
      recorderRef.current = null
      setAnalyser(null)
      if (!recorder) return

      let wavBuf
      try {
        wavBuf = recorder.stop()
      } catch (err) {
        console.error('Recorder error:', err)
        hidePanel()
        return
      }

      let result
      try {
        result = await qv.transcribeAudio(wavBuf)
      } catch (err) {
        console.error('Transcription error:', err)
        hidePanel()
        return
      }

      if (!result || result.status !== 'ok' || !result.text?.trim()) {
        hidePanel()
        return
      }

      setResultText(result.text.trim())
      setLiveText('')
      setState('result')
      setTimeout(() => {
        setAnimating(false)
        qv.resultReady(result.text.trim())
      }, 180)
    })

    qv.onTranscriptionProgress((data) => {
      if (data.status === 'transcribed') {
        setResultText(data.text)
        setState('correcting')
      }
    })
  }, [])

  // Sync window height to content
  useEffect(() => {
    if (visible && overlayRef.current) {
      const panel = overlayRef.current.parentElement
      if (panel) {
        const h = panel.getBoundingClientRect().height
        window.qvoice.setHeight(Math.round(h))
      }
    }
  }, [visible, state, resultText, liveText])

  if (!visible) return null

  const phase = PHASES[state]

  return (
    <div className={`glass-panel ${animating ? 'entering' : 'exiting'}`}>
      <div ref={overlayRef} className="glass-overlay">
        <StatusRow phase={phase} />
        <StateContent
          state={state}
          analyser={analyser}
          resultText={resultText}
          liveText={liveText}
        />
      </div>
    </div>
  )
}
