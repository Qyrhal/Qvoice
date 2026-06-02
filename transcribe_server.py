#!/usr/bin/env python3
"""
Qvoice transcription server.
Pipeline: Whisper (speech-to-text) → Qwen2.5-0.5B (correction) → stdout
"""
import sys
import json
import os

WHISPER_MODEL  = os.environ.get("QVOICE_MODEL", "base.en")
LLM_REPO       = os.environ.get("QVOICE_LLM_REPO", "Qwen/Qwen2.5-0.5B-Instruct-GGUF")
LLM_FILE       = os.environ.get("QVOICE_LLM_FILE", "qwen2.5-0.5b-instruct-q4_k_m.gguf")

# ─── Load Whisper ─────────────────────────────────────────────
print(f"Loading Whisper '{WHISPER_MODEL}'...", file=sys.stderr, flush=True)
from faster_whisper import WhisperModel
whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
print("Whisper ready.", file=sys.stderr, flush=True)

# ─── Load correction LLM ──────────────────────────────────────
print(f"Downloading correction model '{LLM_FILE}'...", file=sys.stderr, flush=True)
from huggingface_hub import hf_hub_download
from llama_cpp import Llama

model_path = hf_hub_download(repo_id=LLM_REPO, filename=LLM_FILE)

print("Loading correction model...", file=sys.stderr, flush=True)
llm = Llama(
    model_path=model_path,
    n_ctx=512,
    n_gpu_layers=-1,   # full Metal acceleration on Apple Silicon
    verbose=False,
)
print("Correction model ready.", file=sys.stderr, flush=True)

print(json.dumps({"status": "ready"}), flush=True)

# ─── Request loop ─────────────────────────────────────────────
SYSTEM_PROMPT = (
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

        # Partial mode: fast Whisper only, no LLM (used for live preview during recording)
        if req.get("partial"):
            segments, _ = whisper.transcribe(audio_path, beam_size=1, vad_filter=True)
            raw = " ".join(seg.text.strip() for seg in segments).strip()
            print(json.dumps({"status": "ok", "text": raw}), flush=True)
            continue

        # Step 1 — Whisper
        segments, _ = whisper.transcribe(
            audio_path,
            beam_size=5,
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

        response = llm.create_chat_completion(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": raw},
            ],
            max_tokens=512,
            temperature=0.1,
        )
        corrected = response["choices"][0]["message"]["content"].strip()

        print(json.dumps({"status": "ok", "text": corrected}), flush=True)

    except Exception as exc:
        print(json.dumps({"status": "error", "error": str(exc)}), flush=True)
