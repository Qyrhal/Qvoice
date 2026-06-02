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
Electron 42 (desktop shell) · Node.js 18+ · Python 3.12 (uv venv) · faster-whisper · mlx-lm · parakeet-mlx · uiohook-napi · React 19 · Vite 8 · @liquid-dom/react

## Commands
```bash
build:   npm run build          (Vite builds renderer/ → renderer/dist/)
test:    .venv/bin/python test_pipeline.py          (integration: transcription server)
         .venv/bin/python test_settings_defaults.py (unit: settings config consistency)
lint:    (none — no linter configured)
run:     npm start              (build + electron .)
```

## Structure
```
main.js                   ← Electron entry: window, tray, hotkey, IPC, settings persistence
preload.js                ← contextBridge: qvoice API for overlay window
preload-settings.js       ← contextBridge: qvoiceSettings API for settings window
renderer/
  index.html              ← Vite entry for overlay (React)
  main.jsx / App.jsx      ← Overlay UI with liquid-dom glass panel
  settings.html           ← Vite entry for settings window (React)
  settings-main.jsx       ← Settings entry point
  Settings.jsx / .css     ← Settings UI with liquid-dom glass cards
transcribe_server.py      ← Python subprocess: Whisper/Parakeet + LFM2.5 correction
test_pipeline.py          ← Integration tests for transcription server
test_settings_defaults.py ← Unit tests for settings config consistency
```

## Code style
- Single quotes, no semicolons (JS), no trailing commas in arrays
- Arrow functions for most callbacks; named `function` for top-level modules
- Snake_case for Python, camelCase for JS
- Section dividers use `──` style comments
- Clear docstrings on Python functions; inline comments for non-obvious logic
- No external calls — all processing on-device

## Testing
- `test_pipeline.py` — integration tests: spawns the whisper server, runs 22 cases (silence, tone, partial, error recovery, stress)
- `test_settings_defaults.py` — unit tests: validates DEFAULT_SETTINGS keys/defaults, cross-checks main.js vs transcribe_server.py env defaults, checks settings.js for stale element refs

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
