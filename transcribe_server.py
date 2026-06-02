#!/usr/bin/env python3
"""
Qvoice transcription server.
Pipeline: Whisper (speech-to-text) → LFM2.5-1.2B (correction) → stdout
"""
import sys
import json
import os

WHISPER_MODEL  = os.environ.get("QVOICE_MODEL", "base.en")
LLM_REPO       = os.environ.get("QVOICE_LLM_REPO", "LiquidAI/LFM2.5-1.2B-Instruct-MLX-6bit")

# ─── Load Whisper ─────────────────────────────────────────────
print(f"Loading Whisper '{WHISPER_MODEL}'...", file=sys.stderr, flush=True)
from faster_whisper import WhisperModel
whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
print("Whisper ready.", file=sys.stderr, flush=True)

# ─── Load correction LLM ──────────────────────────────────────
print(f"Loading correction model '{LLM_REPO}'...", file=sys.stderr, flush=True)
from mlx_lm import load, generate

llm_model, llm_tokenizer = load(LLM_REPO)
print("Correction model ready.", file=sys.stderr, flush=True)

print(json.dumps({"status": "ready"}), flush=True)

# ─── Request loop ─────────────────────────────────────────────
DEFAULT_SYSTEM_PROMPT = (
    "You are a speech transcription corrector. "
    "Fix grammar, punctuation, and misheard words in the user's text. "
    "Return ONLY the corrected text — no explanation, no quotes, nothing else."
)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        audio_path = req["audio_path"]
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

        # Notify renderer so it can show "Correcting" state
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
