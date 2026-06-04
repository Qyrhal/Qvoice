#!/usr/bin/env python3
"""Download a HuggingFace model to local cache, streaming JSON progress per file."""
import sys
import json


def _emit(**data):
    print(json.dumps(data), flush=True)


def download(repo_id: str, model_type: str):
    if model_type == 'whisper':
        repo_id = f'Systran/faster-whisper-{repo_id}'

    try:
        from huggingface_hub import list_repo_files, hf_hub_download
    except ImportError as e:
        _emit(type='error', error=f'huggingface_hub not installed: {e}')
        return

    try:
        files = [f for f in list_repo_files(repo_id) if not f.startswith('.')]
    except Exception as e:
        _emit(type='error', error=str(e))
        return

    total = len(files)
    for i, filename in enumerate(files):
        _emit(type='progress', pct=round(i / total, 3) if total else 0, file=filename)
        try:
            hf_hub_download(repo_id=repo_id, filename=filename)
        except Exception:
            pass  # skip unresolvable files (git-lfs pointers, etc.), continue

    _emit(type='done', pct=1.0)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        _emit(type='error', error='Usage: download_model.py <repo_or_size> <model_type>')
        sys.exit(1)
    download(sys.argv[1], sys.argv[2])
