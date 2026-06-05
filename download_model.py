#!/usr/bin/env python3
"""Download a HuggingFace model to local cache, streaming JSON progress per file."""
import sys
import json


def _emit(**data):
    print(json.dumps(data), flush=True)


def _make_tqdm_class(pct_ref):
    """Return a tqdm subclass that emits JSON chunk-level progress."""
    from tqdm.auto import tqdm as base_tqdm

    class _Bar(base_tqdm):
        def update(self, n=1):
            super().update(n)
            if self.total and self.total > 0:
                file_pct = min(self.n / self.total, 1.0)
                overall = pct_ref['start'] + file_pct * (pct_ref['end'] - pct_ref['start'])
                _emit(type='progress', pct=round(overall, 3), file=pct_ref.get('file', ''))

    return _Bar


def download(repo_id: str, model_type: str):
    if model_type == 'whisper':
        repo_id = f'Systran/faster-whisper-{repo_id}'

    try:
        from huggingface_hub import list_repo_files, hf_hub_download
    except ImportError as e:
        _emit(type='error', error=f'huggingface_hub not installed: {e}')
        return

    _emit(type='progress', pct=0.0, file='scanning repository...')

    try:
        files = [f for f in list_repo_files(repo_id) if not f.startswith('.')]
    except Exception as e:
        _emit(type='error', error=str(e))
        return

    total = len(files)
    if total == 0:
        _emit(type='done', pct=1.0)
        return

    # Get file sizes for byte-weighted overall progress
    file_sizes = {}
    try:
        from huggingface_hub import list_repo_tree
        for entry in list_repo_tree(repo_id, recursive=True):
            if hasattr(entry, 'size') and entry.path in files:
                file_sizes[entry.path] = entry.size or 0
    except Exception:
        pass
    total_bytes = sum(file_sizes.values())

    pct_ref = {'start': 0.0, 'end': 1.0, 'file': ''}
    tqdm_cls = _make_tqdm_class(pct_ref)

    byte_offset = 0
    for i, filename in enumerate(files):
        file_bytes = file_sizes.get(filename, 0)

        if total_bytes > 0:
            pct_start = byte_offset / total_bytes
            pct_end = (byte_offset + file_bytes) / total_bytes
        else:
            pct_start = i / total
            pct_end = (i + 1) / total

        pct_ref.update(start=pct_start, end=pct_end, file=filename)
        _emit(type='progress', pct=round(pct_start, 3), file=filename)

        try:
            hf_hub_download(repo_id=repo_id, filename=filename, tqdm_class=tqdm_cls)
        except TypeError:
            # older huggingface_hub without tqdm_class param
            hf_hub_download(repo_id=repo_id, filename=filename)
        except Exception:
            pass  # skip unresolvable files

        byte_offset += file_bytes
        pct_after = round(byte_offset / total_bytes, 3) if total_bytes > 0 else round((i + 1) / total, 3)
        _emit(type='progress', pct=pct_after, file=filename)

    _emit(type='done', pct=1.0)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        _emit(type='error', error='Usage: download_model.py <repo_or_size> <model_type>')
        sys.exit(1)
    download(sys.argv[1], sys.argv[2])
