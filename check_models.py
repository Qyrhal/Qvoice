#!/usr/bin/env python3
"""
Qvoice model verification.
Checks that models are downloaded and can actually load.

Usage:
    npm run check-models
    .venv/bin/python check_models.py
"""
import sys
import os
import json
import time
from pathlib import Path

CACHE_DIR = Path.home() / ".cache" / "huggingface"
ENGINE = os.environ.get("QVOICE_ENGINE", "parakeet")
WHISPER_MODEL = os.environ.get("QVOICE_MODEL", "base.en")
LLM_REPO = os.environ.get("QVOICE_LLM_REPO",
                          "LiquidAI/LFM2.5-1.2B-Instruct-MLX-6bit")
PARAKEET_MODEL = os.environ.get("QVOICE_PARAKEET_MODEL",
                                "mlx-community/parakeet-tdt-0.6b-v2")


def step(n, label, ok, detail=""):
    status = "✅" if ok else "❌"
    print(f"  {status}  [{n}] {label}" + (f"  — {detail}" if detail else ""))


def check_imports():
    """Verify all required packages can be imported."""
    required = [
        ("numpy", "numpy"),
        ("faster-whisper", "faster_whisper"),
        ("parakeet-mlx", "parakeet_mlx"),
        ("mlx", "mlx"),
        ("librosa", "librosa"),
    ]
    optional = [("mlx-lm", "mlx_lm")]
    all_ok = True
    for label, mod in required:
        try:
            __import__(mod)
            step(2, label, True)
        except ImportError as e:
            step(2, label, False, str(e))
            all_ok = False
    for label, mod in optional:
        try:
            __import__(mod)
            step(2, label, True)
        except ImportError:
            step(2, label, True, "not installed (optional — only needed for LLM correction)")
    return all_ok


def find_cached_model(hf_name: str) -> bool:
    """Check if a model exists in the HuggingFace hub cache."""
    # huggingface_hub stores models as: models--org--name
    cache_key = "models--" + hf_name.replace("/", "--")
    model_dir = CACHE_DIR / "hub" / cache_key
    if not model_dir.exists():
        return False
    snapshots = model_dir / "snapshots"
    if not snapshots.exists():
        return False
    # Check if any snapshot has actual blobs/files
    for snap in snapshots.iterdir():
        if snap.is_dir() and any(f for f in snap.rglob("*") if f.is_file() and not f.name.endswith(".json")):
            return True
    return False


def cache_size_mb() -> int:
    """Total bytes in huggingface cache as MB."""
    if not CACHE_DIR.exists():
        return 0
    total = 0
    for dp, _, filenames in os.walk(CACHE_DIR):
        for f in filenames:
            try:
                total += (Path(dp) / f).stat().st_size
            except OSError:
                pass
    return total // (1024 * 1024)


def try_load_parakeet():
    """Load Parakeet and run a tiny inference to confirm it works."""
    import mlx.core as mx
    import parakeet_mlx
    from parakeet_mlx import from_pretrained
    from parakeet_mlx.audio import get_logmel

    t0 = time.time()
    model = from_pretrained(PARAKEET_MODEL)
    loaded = time.time() - t0
    sr = model.preprocessor_config.sample_rate

    # Run 0.5 s of silence through to trigger JIT and verify inference.
    audio = mx.zeros(sr // 2, dtype=mx.float32)
    mel = get_logmel(audio, model.preprocessor_config)
    result = model.generate(mel)
    text = result[0].text.strip() if result else ''
    total = time.time() - t0
    step(4, f"Parakeet '{PARAKEET_MODEL}'", True,
         f"load={loaded:.1f}s  infer={total - loaded:.1f}s  text={text!r}")


def try_load_whisper():
    """Load Whisper and run a tiny inference."""
    from faster_whisper import WhisperModel
    t0 = time.time()
    model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    # force full load by checking model size
    params = model.model.num_parameters
    loaded = time.time() - t0
    # Transcribe 1 s of silence
    import numpy as np
    audio = np.zeros(16000, dtype=np.float32)
    segments, info = model.transcribe(audio, beam_size=1)
    text = " ".join(s.text for s in segments)
    total = time.time() - t0
    step(4, f"Whisper '{WHISPER_MODEL}'", True,
         f"load={loaded:.1f}s  infer={total - loaded:.1f}s  text={text!r}")


def main():
    pyver = sys.version.split()[0]
    print(f"\nQvoice Model Check")
    print(f"  Python {pyver}  |  Engine: {ENGINE}")
    print()

    # 1. Python interpreter
    step(1, "Python interpreter", True, str(Path(sys.executable)))

    # 2. Package imports
    print(f"\n  Checking packages...")
    imports_ok = check_imports()

    # 3. Cache summary
    print(f"\n  Model cache...")
    if CACHE_DIR.exists():
        mb = cache_size_mb()
        step(2, f"HuggingFace cache: {mb} MB", True, str(CACHE_DIR))
    else:
        step(2, "HuggingFace cache", False, "not found")
        print("\n  ❌  No models cached. Run the app once to download.")
        return

    # 4. Check individual models
    print(f"\n  Cached models...")
    check = []
    if ENGINE == "parakeet":
        check = [(f"Parakeet '{PARAKEET_MODEL}'", PARAKEET_MODEL)]
    else:
        check = [
            (f"Whisper '{WHISPER_MODEL}'", WHISPER_MODEL),
            (f"LLM '{LLM_REPO}'", LLM_REPO),
        ]
    all_cached = True
    for label, repo in check:
        cached = find_cached_model(repo)
        if cached:
            step(3, label, True)
        else:
            step(3, label, False, "not cached — will download on first launch")
            all_cached = False

    # 5. Live load test (only if cached)
    if imports_ok and all_cached:
        print(f"\n  Loading models (may take a moment)...")
        try:
            if ENGINE == "parakeet":
                try_load_parakeet()
            else:
                try_load_whisper()
        except Exception as e:
            step(4, "Load test", False, str(e))
            all_cached = False
    elif imports_ok and not all_cached:
        print(f"\n  ⚠️  Models not cached yet. Run the app once or use PARATKEET_MODEL/WHISPER_MODEL env vars.")
    else:
        print(f"\n  ⚠️  Missing packages. Run `bash setup.sh` first.")

    # Summary
    print()
    if imports_ok and all_cached:
        print("  ✅  All checks passed. Models are ready.")
    else:
        print("  ⚠️   Some checks failed.")
    print()

# All known model options — must stay in sync with Settings.jsx dropdowns.
_WHISPER_SIZES = ['tiny.en', 'base.en', 'small.en', 'medium.en', 'large-v3']
_PARAKEET_REPOS = [
    'mlx-community/parakeet-tdt-0.6b-v3',
    'mlx-community/parakeet-tdt-0.6b-v2',
]
_LLM_REPOS = [
    'LiquidAI/LFM2.5-1.2B-Instruct-MLX-6bit',
    'mlx-community/Qwen2.5-3B-Instruct-4bit',
    'mlx-community/TinyLlama-1.1B-Chat-v1.0-4bit',
    'mlx-community/Mistral-7B-Instruct-v0.3-4bit',
]


def json_main():
    """Cache-only status for all known model options. Fast — no model loading."""
    models: dict = {'whisper': {}, 'parakeet': {}, 'llm': {}}

    # faster-whisper downloads from Systran/faster-whisper-{size} on HuggingFace
    for size in _WHISPER_SIZES:
        models['whisper'][size] = {'cached': find_cached_model(f'Systran/faster-whisper-{size}')}

    for repo in _PARAKEET_REPOS:
        models['parakeet'][repo] = {'cached': find_cached_model(repo)}

    for repo in _LLM_REPOS:
        models['llm'][repo] = {'cached': find_cached_model(repo)}

    print(json.dumps({
        'ok': True,
        'cache_mb': cache_size_mb() if CACHE_DIR.exists() else 0,
        'models': models,
    }))


if __name__ == "__main__":
    if "--json" in sys.argv:
        json_main()
    else:
        main()