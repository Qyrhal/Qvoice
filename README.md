# Qvoice

Local voice-to-text for macOS, a superwhisper clone. Double-tap **Control** to start recording, double-tap again to transcribe and paste — all on-device, no cloud, no subscription.

UI inspired by [glass](https://github.com/pickle-com/glass). Transcription powered by [Whisper](https://github.com/openai/whisper) via [faster-whisper](https://github.com/SYSTRAN/faster-whisper).

![macOS](https://img.shields.io/badge/macOS-12%2B-black?logo=apple) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## How it works

1. Double-tap **Control** — glass panel slides in, recording starts
2. Speak
3. Double-tap **Control** again — the panel shows each stage, then pastes

```
Recording → Transcribing → Correcting → Pasted
```

**Whisper** converts your speech to text. A local **Qwen2.5-0.5B** model then fixes grammar, punctuation, and misheard words before the result hits your clipboard. Everything runs on-device — no network calls.

## Requirements

- macOS 12+
- [Node.js](https://nodejs.org) 18+
- [Python](https://python.org) 3.12 (via [uv](https://github.com/astral-sh/uv), installed automatically)
- [uv](https://github.com/astral-sh/uv) — `brew install uv`

## Setup

```bash
git clone https://github.com/Qyrhal/qvoice
cd qvoice
bash setup.sh
```

The setup script:

- Creates a Python 3.12 venv and installs `faster-whisper`
- Generates the menu bar icon
- Runs `npm install`

On **first launch**, two models are downloaded and cached (~490 MB total). Subsequent launches are instant.

| Model                    | Size    | Purpose                    |
| ------------------------ | ------- | -------------------------- |
| Whisper `base.en`        | ~140 MB | Speech-to-text             |
| Qwen2.5-0.5B-Instruct Q4 | ~350 MB | Grammar & error correction |

## Run

```bash
npm start
```

The app lives in your menu bar as **Q**. No dock icon.

## Permissions

Two macOS permissions are required:

**Accessibility** (for the global double-Control hotkey)

> System Settings → Privacy & Security → Accessibility → add Terminal (or your IDE)

**Microphone** (prompted automatically on first recording)

## Model size

The default model is `base.en` — fast (~2–3s) and good for English. Swap it via env var:

| Model               | Size   | Speed | Accuracy |
| ------------------- | ------ | ----- | -------- |
| `base.en` (default) | 140 MB | ~2–3s | Good     |
| `small.en`          | 460 MB | ~4–6s | Better   |
| `medium.en`         | 1.4 GB | ~10s+ | Best     |

```bash
QVOICE_MODEL=small.en npm start
```

## Tech stack

| Layer         | Technology                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------- |
| App shell     | [Electron](https://electronjs.org)                                                              |
| Global hotkey | [uiohook-napi](https://github.com/SnosMe/uiohook-napi)                                          |
| Transcription | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) — Whisper base.en                   |
| Correction    | [llama-cpp-python](https://github.com/abetlen/llama-cpp-python) — Qwen2.5-0.5B-Instruct (Metal) |
| Audio format  | 16 kHz mono WAV (encoded in-browser, no ffmpeg needed)                                          |
| Paste         | AppleScript `System Events` keystroke                                                           |

## License

MIT — see [LICENSE](LICENSE).
