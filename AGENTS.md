<!--
  FILE: AGENTS.md
  PURPOSE: Universal agent instructions for this project.
           Works across Claude Code, OpenAI Codex, Cursor, Windsurf,
           Gemini CLI, Aider, GitHub Copilot, Amp, and others.
           Ref: https://agents.md/
  MAINTENANCE: Update commands, structure, and conventions when the project changes.
               For nested packages, place a child AGENTS.md inside each subdirectory.
-->

# Qvoice

## Overview
Local voice-to-text for macOS — double-tap Control to record, transcribe, and paste, all on-device.

## Stack
Electron 42 (desktop shell) · Node.js 18+ · Python 3.12 (uv venv) · faster-whisper · llama-cpp-python · uiohook-napi

## Commands
```bash
build:   (none — electron . runs directly)
test:    (none — no test suite)
lint:    (none — no linter configured)
run:     npm start
```

## Structure
```
main.js           ← Electron entry: window, tray, hotkey, IPC
preload.js        ← contextBridge: IPC bridge to renderer
renderer/         ← HTML/CSS/JS: glass panel UI + waveform
transcribe_server.py  ← Python subprocess: Whisper + Qwen2.5 correction loop
```

## Code style
- Single quotes, no semicolons (JS), no trailing commas in arrays
- Arrow functions for most callbacks; named `function` for top-level modules
- Snake_case for Python, camelCase for JS
- Section dividers use `──` style comments
- Clear docstrings on Python functions; inline comments for non-obvious logic
- No external calls — all processing on-device

## Testing
- Run the app (`npm start`) to manually verify UI states and transcription flow
- No automated test suite currently

## Security
- All processing runs on-device (Whisper + Qwen2.5) — no network calls
- Audio is written to `/tmp` and cleaned up after transcription
- macOS Accessibility and Microphone permissions required (noted in README)

## Conventions
- Touch only what the task requires
- Clarify ambiguities before implementing
- Prefer the simplest solution that works
- Keep CLAUDE.md ≤ 80 lines; delegate to .claude/memory/ for overflow
- AGENTS.md is the cross-agent source of truth; CLAUDE.md defers to it
