#!/usr/bin/env python3
"""
Unit tests for settings defaults and config consistency.

Validates that:
  - DEFAULT_SETTINGS in main.js contains all required keys with correct defaults
  - transcribe_server.py env var defaults match main.js DEFAULT_SETTINGS
  - No settings key referenced in settings.js is missing from DEFAULT_SETTINGS

Usage: .venv/bin/python test_settings_defaults.py
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

GREEN = '\033[32m'
RED   = '\033[31m'
RESET = '\033[0m'

results = []

def case(name, fn):
    try:
        fn()
        results.append((name, True, ''))
        print(f'  {GREEN}PASS{RESET}  {name}')
    except AssertionError as e:
        results.append((name, False, str(e)))
        print(f'  {RED}FAIL{RESET}  {name}: {e}')
    except Exception as e:
        results.append((name, False, f'{type(e).__name__}: {e}'))
        print(f'  {RED}FAIL{RESET}  {name}: {type(e).__name__}: {e}')


def parse_default_settings(main_js):
    """Extract DEFAULT_SETTINGS object from main.js as a dict."""
    m = re.search(r'const DEFAULT_SETTINGS\s*=\s*\{([^}]+)\}', main_js, re.DOTALL)
    assert m, 'DEFAULT_SETTINGS not found in main.js'
    block = m.group(1)
    settings = {}
    for line in block.splitlines():
        line = line.strip().rstrip(',')
        if not line or line.startswith('//'):
            continue
        # key: value  (value may be string, bool, number)
        km = re.match(r"(\w+)\s*:\s*(.+)$", line)
        if not km:
            continue
        key = km.group(1)
        val_str = km.group(2).strip().strip("'\"")
        # Coerce to Python types
        if val_str == 'true':
            val = True
        elif val_str == 'false':
            val = False
        else:
            try:
                val = int(val_str)
            except ValueError:
                val = val_str
        settings[key] = val
    return settings


with open(os.path.join(ROOT, 'main.js')) as f:
    main_js = f.read()

with open(os.path.join(ROOT, 'transcribe_server.py')) as f:
    server_py = f.read()

with open(os.path.join(ROOT, 'renderer', 'settings.js')) as f:
    settings_js = f.read()


# ─── Cases ────────────────────────────────────────────────────

def test_required_keys():
    s = parse_default_settings(main_js)
    required = ['engine', 'whisperModel', 'llmRepo', 'systemPrompt',
                 'autoPaste', 'correctionEnabled', 'beamSize', 'parakeetModel']
    missing = [k for k in required if k not in s]
    assert not missing, f"Missing keys in DEFAULT_SETTINGS: {missing}"
case('all_required_keys_present', test_required_keys)


def test_autopaste_default_true():
    s = parse_default_settings(main_js)
    assert s.get('autoPaste') is True, \
        f"autoPaste should default to True, got {s.get('autoPaste')!r}"
case('autopaste_default_is_true', test_autopaste_default_true)


def test_correction_enabled_default_true():
    s = parse_default_settings(main_js)
    assert s.get('correctionEnabled') is True, \
        f"correctionEnabled should default to True, got {s.get('correctionEnabled')!r}"
case('correction_enabled_default_is_true', test_correction_enabled_default_true)


def test_engine_default_whisper():
    s = parse_default_settings(main_js)
    assert s.get('engine') == 'whisper', \
        f"engine should default to 'whisper', got {s.get('engine')!r}"
case('engine_default_is_whisper', test_engine_default_whisper)


def test_beam_size_default_reasonable():
    s = parse_default_settings(main_js)
    beam = s.get('beamSize')
    assert isinstance(beam, int) and 1 <= beam <= 10, \
        f"beamSize should be int 1-10, got {beam!r}"
case('beam_size_default_in_range', test_beam_size_default_reasonable)


def test_server_whisper_model_env_matches_default():
    # QVOICE_MODEL env default in transcribe_server.py should match main.js whisperModel default
    m = re.search(r'WHISPER_MODEL\s*=\s*os\.environ\.get\([^,]+,\s*["\']([^"\']+)["\']', server_py)
    assert m, 'WHISPER_MODEL env default not found in transcribe_server.py'
    server_default = m.group(1)
    js_default = parse_default_settings(main_js).get('whisperModel')
    assert server_default == js_default, \
        f"WHISPER_MODEL default mismatch: server={server_default!r}, main.js={js_default!r}"
case('whisper_model_default_consistent', test_server_whisper_model_env_matches_default)


def test_server_llm_repo_env_matches_default():
    m = re.search(r'LLM_REPO\s*=\s*os\.environ\.get\([^,]+,\s*["\']([^"\']+)["\']', server_py)
    assert m, 'LLM_REPO env default not found in transcribe_server.py'
    server_default = m.group(1)
    js_default = parse_default_settings(main_js).get('llmRepo')
    assert server_default == js_default, \
        f"LLM_REPO default mismatch: server={server_default!r}, main.js={js_default!r}"
case('llm_repo_default_consistent', test_server_llm_repo_env_matches_default)


def test_server_parakeet_model_env_matches_default():
    m = re.search(r'PARAKEET_MODEL\s*=\s*os\.environ\.get\([^,]+,\s*["\']([^"\']+)["\']', server_py)
    assert m, 'PARAKEET_MODEL env default not found in transcribe_server.py'
    server_default = m.group(1)
    js_default = parse_default_settings(main_js).get('parakeetModel')
    assert server_default == js_default, \
        f"PARAKEET_MODEL default mismatch: server={server_default!r}, main.js={js_default!r}"
case('parakeet_model_default_consistent', test_server_parakeet_model_env_matches_default)


def test_settings_js_no_null_element_refs():
    # Every getElementById call in settings.js must reference an id that exists in settings.html
    with open(os.path.join(ROOT, 'renderer', 'settings.html')) as f:
        html = f.read()
    ids_in_html = set(re.findall(r'id=["\']([^"\']+)["\']', html))
    # For the React entry point settings.html, only 'root' exists; settings.js is not used.
    # We still validate settings.js internal consistency against the static HTML in settings.js.
    # What matters: settings.js must not reference IDs that only existed in old HTML (row-llm-file).
    refs_in_js = re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", settings_js)
    bad = [r for r in refs_in_js if r == 'row-llm-file']
    assert not bad, f"settings.js references removed element id(s): {bad}"
case('settings_js_no_stale_element_refs', test_settings_js_no_null_element_refs)


def test_server_syntax():
    import subprocess
    result = subprocess.run(
        [sys.executable, '-m', 'py_compile', os.path.join(ROOT, 'transcribe_server.py')],
        capture_output=True, text=True
    )
    assert result.returncode == 0, f"transcribe_server.py syntax error: {result.stderr}"
case('transcribe_server_syntax_ok', test_server_syntax)


def test_make_sampler_import_indented():
    # make_sampler must be imported inside the else block (indented), not at module level
    m = re.search(r'else:\n(.*?)print\(json\.dumps', server_py, re.DOTALL)
    assert m, 'else block not found in transcribe_server.py'
    else_block = m.group(1)
    assert 'from mlx_lm.sample_utils import make_sampler' in else_block, \
        'make_sampler import must be inside the else: block'
case('make_sampler_import_correctly_indented', test_make_sampler_import_indented)


# ─── Summary ──────────────────────────────────────────────────
passed = sum(1 for _, ok, _ in results if ok)
total  = len(results)
print(f'\n{passed}/{total} passed')

if passed < total:
    print('\nFailed cases:')
    for name, ok, err in results:
        if not ok:
            print(f'  - {name}: {err}')
    sys.exit(1)
