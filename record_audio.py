#!/usr/bin/env python3
"""
Audio recording subprocess for Qvoice.

Reads commands from stdin:
  snapshot  — transcribe partial (sends current buffer as WAV, keeps recording)
  stop      — stop recording, write WAV to stdout as path, exit

Writes to stdout (JSON lines):
  {"type": "level", "rms": 0.12}          — audio level (~30fps)
  {"type": "snapshot_wav", "path": "..."}  — snapshot WAV path
  {"type": "done", "path": "..."}          — final WAV path on stop
  {"type": "error", "error": "..."}        — on failure
"""
import json, os, queue, select, struct, sys, tempfile, threading, time
import numpy as np

RATE     = 16000
CHANNELS = 1
DTYPE    = 'int16'
CHUNK    = 1024
LEVEL_INTERVAL = 0.033  # ~30fps level updates

def emit(**kwargs):
    print(json.dumps(kwargs), flush=True)

def to_wav(pcm_int16: np.ndarray, rate: int) -> bytes:
    n = len(pcm_int16)
    data = pcm_int16.tobytes()
    buf = bytearray()
    # RIFF header
    buf += b'RIFF'
    buf += struct.pack('<I', 36 + len(data))
    buf += b'WAVE'
    buf += b'fmt '
    buf += struct.pack('<IHHIIHH', 16, 1, CHANNELS, rate, rate * 2, 2, 16)
    buf += b'data'
    buf += struct.pack('<I', len(data))
    buf += data
    return bytes(buf)

try:
    import sounddevice as sd
except ImportError:
    emit(type='error', error='sounddevice not installed')
    sys.exit(1)

chunks = []
chunks_lock = threading.Lock()
stop_event = threading.Event()
snapshot_event = threading.Event()

def audio_callback(indata, frames, time_info, status):
    chunk = indata[:, 0].copy()  # mono
    with chunks_lock:
        chunks.append(chunk)

def level_thread():
    last = time.time()
    while not stop_event.is_set():
        now = time.time()
        if now - last >= LEVEL_INTERVAL:
            with chunks_lock:
                if chunks:
                    recent = chunks[-1]
                    rms = float(np.sqrt(np.mean(recent.astype(np.float32) ** 2)) / 32768)
                else:
                    rms = 0.0
            emit(type='level', rms=round(rms, 4))
            last = now
        time.sleep(0.01)

def get_pcm():
    with chunks_lock:
        if not chunks:
            return np.array([], dtype=DTYPE)
        return np.concatenate(chunks).astype(DTYPE)

try:
    stream = sd.InputStream(
        samplerate=RATE,
        channels=CHANNELS,
        dtype=DTYPE,
        blocksize=CHUNK,
        callback=audio_callback,
    )
    stream.start()
except Exception as e:
    emit(type='error', error=str(e))
    sys.exit(1)

lthread = threading.Thread(target=level_thread, daemon=True)
lthread.start()

emit(type='ready')

# Command loop (stdin)
for line in sys.stdin:
    cmd = line.strip()
    if not cmd:
        continue

    if cmd == 'snapshot':
        pcm = get_pcm()
        if len(pcm) >= RATE:  # at least 1 second
            fd, path = tempfile.mkstemp(suffix='.wav', prefix='qvoice-partial-')
            os.close(fd)
            with open(path, 'wb') as f:
                f.write(to_wav(pcm, RATE))
            emit(type='snapshot_wav', path=path)
        # else: too short, skip

    elif cmd == 'stop':
        stop_event.set()
        stream.stop()
        stream.close()
        pcm = get_pcm()
        fd, path = tempfile.mkstemp(suffix='.wav', prefix='qvoice-')
        os.close(fd)
        with open(path, 'wb') as f:
            f.write(to_wav(pcm, RATE))
        emit(type='done', path=path)
        break

    elif cmd == 'cancel':
        stop_event.set()
        stream.stop()
        stream.close()
        emit(type='cancelled')
        break
