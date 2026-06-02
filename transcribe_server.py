#!/usr/bin/env python3
"""
Qvoice transcription server.
Supports two engines:
  - whisper  : faster-whisper (CPU) + optional LFM2.5 correction via mlx-lm
  - parakeet : parakeet-mlx (Apple Silicon Metal GPU, no LLM step needed)
"""
import sys
import json
import os
import wave
import numpy as np

ENGINE         = os.environ.get("QVOICE_ENGINE", "whisper")
WHISPER_MODEL  = os.environ.get("QVOICE_MODEL", "base.en")
LLM_REPO       = os.environ.get("QVOICE_LLM_REPO", "LiquidAI/LFM2.5-1.2B-Instruct-MLX-6bit")
PARAKEET_MODEL = os.environ.get("QVOICE_PARAKEET_MODEL", "mlx-community/parakeet-tdt-0.6b-v3")

DEFAULT_SYSTEM_PROMPT = (
    "You are a speech transcription corrector. "
    "Fix grammar, punctuation, and misheard words in the user's text. "
    "Return ONLY the corrected text — no explanation, no quotes, nothing else."
)

def load_wav_direct(path, target_sr):
    """Read a 16-bit PCM WAV without ffmpeg. Resamples if sample rate differs."""
    with wave.open(str(path), 'rb') as wf:
        channels  = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        rate      = wf.getframerate()
        frames    = wf.readframes(wf.getnframes())

    if sampwidth != 2:
        raise ValueError(f"Unsupported WAV sample width: {sampwidth} bytes")

    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0

    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)

    if rate != target_sr:
        import librosa
        audio = librosa.resample(audio, orig_sr=rate, target_sr=target_sr)

    return audio

# ─── Load models ──────────────────────────────────────────────
if ENGINE == "parakeet":
    import mlx.core as mx
    from parakeet_mlx import from_pretrained, DecodingConfig
    from parakeet_mlx.audio import get_logmel

    print(f"Loading Parakeet '{PARAKEET_MODEL}'...", file=sys.stderr, flush=True)
    asr_model = from_pretrained(PARAKEET_MODEL)
    print("Parakeet ready.", file=sys.stderr, flush=True)
    whisper = None
    llm_model = None
    llm_tokenizer = None

    def parakeet_transcribe(audio_path):
        audio = load_wav_direct(audio_path, asr_model.preprocessor_config.sample_rate)
        mel   = get_logmel(mx.array(audio, dtype=mx.float32), asr_model.preprocessor_config)
        results = asr_model.generate(mel)
        return results[0].text.strip() if results else ''

else:
    print(f"Loading Whisper '{WHISPER_MODEL}'...", file=sys.stderr, flush=True)
    from faster_whisper import WhisperModel
    whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    print("Whisper ready.", file=sys.stderr, flush=True)

    print(f"Loading correction model '{LLM_REPO}'...", file=sys.stderr, flush=True)
    from mlx_lm import load, generate
    llm_model, llm_tokenizer = load(LLM_REPO)
    print("Correction model ready.", file=sys.stderr, flush=True)
    asr_model = None

print(json.dumps({"status": "ready"}), flush=True)

# ─── Request loop ─────────────────────────────────────────────
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        audio_path = req["audio_path"]

        # ── Parakeet engine ───────────────────────────────────
        if ENGINE == "parakeet":
            text = parakeet_transcribe(audio_path)
            if req.get("partial"):
                print(json.dumps({"status": "ok", "text": text}), flush=True)
            else:
                # Mirror the whisper flow so the renderer shows text before closing
                print(json.dumps({"status": "transcribed", "text": text}), flush=True)
                print(json.dumps({"status": "ok",          "text": text}), flush=True)
            continue

        # ── Whisper engine ────────────────────────────────────
        system_prompt = req.get("system_prompt") or DEFAULT_SYSTEM_PROMPT
        beam_size = int(req.get("beam_size", 5))

        # Partial mode: fast Whisper only, no LLM (used for live preview during recording)
        if req.get("partial"):
            segments, _ = whisper.transcribe(audio_path, beam_size=1, vad_filter=True)
            raw = " ".join(seg.text.strip() for seg in segments).strip()
            print(json.dumps({"status": "ok", "text": raw}), flush=True)
            continue

        # Step 1 — Whisper
        segments, _ = whisper.transcribe(
            audio_path,
            beam_size=beam_size,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
        )
        raw = " ".join(seg.text.strip() for seg in segments).strip()

        # Notify renderer so it can show raw text while LLM corrects
        print(json.dumps({"status": "transcribed", "text": raw}), flush=True)

        if not raw:
            print(json.dumps({"status": "ok", "text": ""}), flush=True)
            continue

        # Step 2 — LLM correction (skipped if disabled from tray)
        if not req.get("correction", True):
            print(json.dumps({"status": "ok", "text": raw}), flush=True)
            continue

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": raw},
        ]
        prompt = llm_tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        corrected = generate(llm_model, llm_tokenizer, prompt=prompt, max_tokens=512, temp=0.1).strip()

        print(json.dumps({"status": "ok", "text": corrected}), flush=True)

    except Exception as exc:
        print(json.dumps({"status": "error", "error": str(exc)}), flush=True)
        print(f"[error] {exc}", file=sys.stderr, flush=True)
