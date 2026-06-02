#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "── Qvoice Setup ──────────────────────────────────────────"

# 1. Python deps (use uv with Python 3.12 for ctranslate2 wheel compatibility)
echo ""
echo "Creating Python venv with Python 3.12..."
uv venv .venv --python 3.12
echo "Installing Python packages..."
uv pip install --python .venv/bin/python faster-whisper mlx-lm parakeet-mlx

# 2. Tray icon (22x22 white circle PNG for macOS menu bar)
echo ""
echo "Generating tray icon..."
python3 - <<'PYEOF'
import struct, zlib, math, os

W, H = 22, 22
cx, cy = W / 2, H / 2
R = W / 2 - 1.5  # radius with 1.5px padding

rows = []
for y in range(H):
    row = bytearray([0])  # PNG filter type None
    for x in range(W):
        d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        # Anti-aliased alpha
        a = max(0, min(255, int((R - d + 1.0) * 255)))
        row += bytearray([255, 255, 255, a])  # RGBA white
    rows.append(bytes(row))

compressed = zlib.compress(b"".join(rows), 9)

def chunk(tag, data):
    c = tag + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

png = (
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
    + chunk(b"IDAT", compressed)
    + chunk(b"IEND", b"")
)

os.makedirs("assets", exist_ok=True)
with open("assets/tray.png", "wb") as f:
    f.write(png)
print("  assets/tray.png created (22×22 white circle)")
PYEOF

# 3. npm deps
echo ""
echo "Installing npm dependencies..."
npm install

echo ""
echo "── Done ──────────────────────────────────────────────────"
echo ""
echo "IMPORTANT — first-launch steps:"
echo ""
echo "  1. Grant Accessibility permission:"
echo "     System Settings → Privacy & Security → Accessibility"
echo "     Add Terminal (or your IDE) to the list."
echo "     This is required for hold-to-record (⌥Space)."
echo ""
echo "  2. Grant Microphone permission when prompted."
echo ""
echo "  3. Run the app:"
echo "     npm start"
echo ""
echo "  On first launch models are downloaded and cached:"
echo "    Whisper base.en      ~140 MB  (Whisper engine)"
echo "    LFM2.5-1.2B          ~900 MB  (Whisper engine, LLM correction)"
echo "    Parakeet-TDT-0.6B    ~1.2 GB  (Parakeet engine, on first use)"
echo "  Subsequent launches are instant."
echo ""
echo "  Double-tap Control to start/stop recording."
