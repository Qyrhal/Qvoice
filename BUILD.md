# Building Qvoice

## Prerequisites

- macOS (Apple Silicon)
- Node.js 18+
- [uv](https://github.com/astral-sh/uv) — Python package manager
- Python 3.12 (uv will fetch it if missing)

## First-time setup

```bash
npm run setup
```

This creates the Python venv, installs Python deps (faster-whisper, mlx-lm, parakeet-mlx), generates the tray icon, and runs `npm install`.

## Run in development

```bash
npm start
```

Builds the Vite renderer, then launches Electron. On first run, models are downloaded and cached:

| Model | Size | Used by |
|---|---|---|
| Whisper base.en | ~140 MB | Whisper engine |
| LFM2.5-1.2B | ~900 MB | Whisper engine (LLM correction) |
| Parakeet-TDT-0.6B | ~1.2 GB | Parakeet engine |

Subsequent launches are instant.

## Build renderer only

```bash
npm run build
```

Outputs to `renderer/dist/`.

## Package as DMG

```bash
npm run dist
```

Produces `dist/Qvoice-<version>-arm64.dmg`.

The build is ad-hoc signed (no Apple Developer cert). On other machines Gatekeeper will warn — right-click → Open to bypass. For public distribution, add a Developer ID cert and notarization to the `build.mac` config in `package.json`.

## macOS permissions (required after install)

1. **Accessibility** — System Settings → Privacy & Security → Accessibility → add the app.  
   Required for the global hotkey (double-tap Control).
2. **Microphone** — granted on first recording attempt.

## Tests

```bash
# Integration: transcription server (22 cases)
.venv/bin/python test_pipeline.py

# Unit: settings config consistency
.venv/bin/python test_settings_defaults.py
```
