#!/usr/bin/env python3
"""
Tests for permissions, packaging, and settings integrity.

Covers:
  - main.js has all required permission IPC handlers
  - DEFAULT_SETTINGS includes onboardingComplete, instructionBlocks
  - DEFAULT_INSTRUCTION_BLOCKS has correct structure (ids, types, instructions)
  - getUnpackedDir / getScript logic is correct in main.js
  - askForMediaAccess called at app startup (TCC sync fix)
  - Python env: librosa __init__.pyi exists (lazy_loader requirement)
  - Python env: libpython3.12.dylib exists in .venv/lib
  - Python scripts exist and have correct syntax
  - Packaged app paths correct (app.asar.unpacked) if dist exists

Usage: .venv/bin/python test_permissions.py
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
VENV = os.path.join(ROOT, '.venv')
DIST_APP = os.path.join(ROOT, 'dist', 'mac-arm64', 'Qvoice.app',
                        'Contents', 'Resources', 'app.asar.unpacked')

GREEN = '\033[32m'
RED   = '\033[31m'
YELLOW = '\033[33m'
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

def skip(name, reason):
    results.append((name, True, ''))
    print(f'  {YELLOW}SKIP{RESET}  {name} ({reason})')

with open(os.path.join(ROOT, 'main.js')) as f:
    main_js = f.read()

# ─── 1. IPC Handler presence ──────────────────────────────────
print('\n── IPC Handlers ─────────────────────────────────────────')

def test_check_permissions_handler():
    assert "ipcMain.handle('check-permissions'" in main_js, \
        "check-permissions handler missing from main.js"
case('check_permissions_handler_exists', test_check_permissions_handler)

def test_request_mic_handler():
    assert "ipcMain.handle('request-mic-permission'" in main_js, \
        "request-mic-permission handler missing from main.js"
case('request_mic_permission_handler_exists', test_request_mic_handler)

def test_open_accessibility_handler():
    assert "ipcMain.on('open-accessibility-settings'" in main_js, \
        "open-accessibility-settings handler missing from main.js"
case('open_accessibility_settings_handler_exists', test_open_accessibility_handler)

def test_redo_onboarding_handler():
    assert "ipcMain.handle('redo-onboarding'" in main_js, \
        "redo-onboarding handler missing from main.js"
case('redo_onboarding_handler_exists', test_redo_onboarding_handler)

def test_complete_onboarding_handler():
    assert "ipcMain.handle('complete-onboarding'" in main_js, \
        "complete-onboarding handler missing from main.js"
case('complete_onboarding_handler_exists', test_complete_onboarding_handler)

def test_download_model_uses_event_sender():
    # Extract just the download-model handler by finding the line range
    lines = main_js.splitlines()
    start = next((i for i, l in enumerate(lines) if "ipcMain.on('download-model'" in l), None)
    assert start is not None, 'download-model handler not found'
    # Collect lines until the handler closing })
    depth = 0
    handler_lines = []
    for line in lines[start:]:
        handler_lines.append(line)
        depth += line.count('{') - line.count('}')
        if depth <= 0 and len(handler_lines) > 1:
            break
    handler = '\n'.join(handler_lines)
    assert 'event.sender' in handler or ("sender = event.sender" in handler), \
        "download-model must use event.sender"
    assert 'settingsWin' not in handler, \
        "download-model still references hardcoded settingsWin"
case('download_model_uses_event_sender', test_download_model_uses_event_sender)

# ─── 2. Startup TCC sync ──────────────────────────────────────
print('\n── Startup TCC sync ─────────────────────────────────────')

def test_ask_for_media_access_at_startup():
    # Use line numbers: askForMediaAccess must appear before createWindow()
    # inside the app.whenReady block
    lines = main_js.splitlines()
    when_ready_line = next((i for i, l in enumerate(lines) if 'app.whenReady()' in l), None)
    assert when_ready_line is not None, 'app.whenReady() not found'
    # Find askForMediaAccess and createWindow() after whenReady
    ask_line = next((i for i, l in enumerate(lines) if i > when_ready_line
                     and 'askForMediaAccess' in l and 'check-permissions' not in l
                     and 'request-mic' not in l), None)
    create_line = next((i for i, l in enumerate(lines) if i > when_ready_line
                        and 'createWindow()' in l), None)
    assert ask_line is not None, \
        "askForMediaAccess not called in/after app.whenReady — mic TCC sync missing"
    assert create_line is not None, 'createWindow() call not found'
    assert ask_line < create_line, \
        f"askForMediaAccess (line {ask_line+1}) must come before createWindow() (line {create_line+1})"
case('ask_for_media_access_called_at_startup', test_ask_for_media_access_at_startup)

def test_check_permissions_syncs_not_determined():
    # check-permissions must call askForMediaAccess when status is not-determined
    m = re.search(r"ipcMain\.handle\('check-permissions'.*?}\)", main_js, re.DOTALL)
    assert m, 'check-permissions handler not found'
    handler = m.group(0)
    assert 'askForMediaAccess' in handler, \
        "check-permissions should call askForMediaAccess to sync not-determined status"
    assert 'not-determined' in handler, \
        "check-permissions should specifically handle not-determined case"
case('check_permissions_syncs_not_determined_mic', test_check_permissions_syncs_not_determined)

# ─── 3. Asar path logic ───────────────────────────────────────
print('\n── Asar path logic ──────────────────────────────────────')

def test_get_unpacked_dir_exists():
    assert 'function getUnpackedDir()' in main_js, \
        "getUnpackedDir() helper missing from main.js"
case('get_unpacked_dir_helper_exists', test_get_unpacked_dir_exists)

def test_get_unpacked_dir_replaces_asar():
    assert "replace('app.asar', 'app.asar.unpacked')" in main_js or \
           'replace("app.asar", "app.asar.unpacked")' in main_js, \
        "getUnpackedDir must replace app.asar with app.asar.unpacked"
case('get_unpacked_dir_replaces_asar_path', test_get_unpacked_dir_replaces_asar)

def test_get_script_helper_exists():
    assert 'function getScript(' in main_js, \
        "getScript() helper missing from main.js"
case('get_script_helper_exists', test_get_script_helper_exists)

def test_scripts_use_get_script():
    for script in ['transcribe_server.py', 'check_models.py', 'download_model.py']:
        assert f"getScript('{script}')" in main_js, \
            f"{script} path not using getScript() — will fail in packaged app"
case('all_python_scripts_use_get_script', test_scripts_use_get_script)

def test_no_raw_dirname_for_scripts():
    # No path.join(__dirname, '*.py') patterns should remain
    bad = re.findall(r"path\.join\(__dirname,\s*['\"][^'\"]+\.py['\"]", main_js)
    assert not bad, f"Raw __dirname script paths found (use getScript()): {bad}"
case('no_raw_dirname_python_paths', test_no_raw_dirname_for_scripts)

def test_pythonpath_uses_get_unpacked_dir():
    # PYTHONPATH env var must use getUnpackedDir() not __dirname
    m = re.findall(r'PYTHONPATH:.*', main_js)
    for line in m:
        assert '__dirname' not in line, \
            f"PYTHONPATH still uses __dirname instead of getUnpackedDir(): {line}"
case('pythonpath_uses_get_unpacked_dir', test_pythonpath_uses_get_unpacked_dir)

def test_get_python_uses_get_unpacked_dir():
    m = re.search(r'function getPython\(\).*?}', main_js, re.DOTALL)
    assert m, 'getPython() not found'
    fn = m.group(0)
    assert 'getUnpackedDir()' in fn, \
        "getPython() must use getUnpackedDir() not __dirname"
case('get_python_uses_get_unpacked_dir', test_get_python_uses_get_unpacked_dir)

# ─── 4. DEFAULT_SETTINGS integrity ───────────────────────────
print('\n── DEFAULT_SETTINGS ─────────────────────────────────────')

def test_onboarding_complete_in_defaults():
    assert 'onboardingComplete' in main_js, \
        "onboardingComplete missing from DEFAULT_SETTINGS"
    m = re.search(r'onboardingComplete:\s*(true|false)', main_js)
    assert m and m.group(1) == 'false', \
        "onboardingComplete should default to false"
case('onboarding_complete_defaults_false', test_onboarding_complete_in_defaults)

def test_instruction_blocks_in_defaults():
    assert 'instructionBlocks' in main_js, \
        "instructionBlocks missing from DEFAULT_SETTINGS"
case('instruction_blocks_in_default_settings', test_instruction_blocks_in_defaults)

def test_theme_in_defaults():
    m = re.search(r"theme:\s*['\"]([^'\"]+)['\"]", main_js)
    assert m, "theme missing from DEFAULT_SETTINGS"
    assert m.group(1) == 'default', f"theme should default to 'default', got {m.group(1)!r}"
case('theme_defaults_to_default', test_theme_in_defaults)

# ─── 5. DEFAULT_INSTRUCTION_BLOCKS integrity ─────────────────
print('\n── Instruction Blocks ───────────────────────────────────')

def test_default_blocks_constant_exists():
    assert 'DEFAULT_INSTRUCTION_BLOCKS' in main_js, \
        "DEFAULT_INSTRUCTION_BLOCKS constant not found in main.js"
case('default_instruction_blocks_constant_exists', test_default_blocks_constant_exists)

def test_required_preset_blocks_exist():
    for block_id in ['course-correction', 'filler-words', 'punctuation']:
        assert f"'{block_id}'" in main_js or f'"{block_id}"' in main_js, \
            f"Required preset block '{block_id}' missing from DEFAULT_INSTRUCTION_BLOCKS"
case('required_preset_blocks_present', test_required_preset_blocks_exist)

def test_dialect_blocks_exist():
    for dialect in ['dialect-au', 'dialect-us', 'dialect-uk']:
        assert f"'{dialect}'" in main_js or f'"{dialect}"' in main_js, \
            f"Dialect block '{dialect}' missing"
case('dialect_blocks_present', test_dialect_blocks_exist)

def test_dialect_blocks_default_disabled():
    # Dialect blocks should default to enabled: false
    m = re.search(r'DEFAULT_INSTRUCTION_BLOCKS\s*=\s*\[(.*?)\]', main_js, re.DOTALL)
    assert m, 'DEFAULT_INSTRUCTION_BLOCKS array not found'
    block_content = m.group(1)
    # Find dialect blocks and check they have enabled: false
    dialect_sections = re.findall(r"'dialect-[^']+',.*?enabled:\s*(true|false)", block_content, re.DOTALL)
    for enabled in dialect_sections:
        assert enabled == 'false', f"Dialect block should default to enabled:false, got {enabled!r}"
case('dialect_blocks_default_disabled', test_dialect_blocks_default_disabled)

def test_build_system_prompt_exists():
    assert 'function buildSystemPrompt(' in main_js, \
        "buildSystemPrompt() missing from main.js"
case('build_system_prompt_function_exists', test_build_system_prompt_exists)

def test_transcription_uses_build_system_prompt():
    assert 'buildSystemPrompt(settings.instructionBlocks)' in main_js, \
        "Transcription not using buildSystemPrompt(settings.instructionBlocks)"
case('transcription_uses_build_system_prompt', test_transcription_uses_build_system_prompt)

# ─── 6. Preload API completeness ─────────────────────────────
print('\n── Preload APIs ─────────────────────────────────────────')

with open(os.path.join(ROOT, 'preload-settings.js')) as f:
    preload_settings = f.read()

with open(os.path.join(ROOT, 'preload.js')) as f:
    preload_overlay = f.read()

def test_preload_settings_exposes_permissions():
    for fn in ['checkPermissions', 'requestMicPermission', 'openAccessibilitySettings',
               'completeOnboarding', 'redoOnboarding']:
        assert fn in preload_settings, \
            f"preload-settings.js missing: {fn}"
case('preload_settings_exposes_all_permission_apis', test_preload_settings_exposes_permissions)

def test_preload_overlay_exposes_recording_cancel():
    assert 'cancelRecording' in preload_overlay, \
        "preload.js missing cancelRecording"
    assert 'stopRecording' in preload_overlay, \
        "preload.js missing stopRecording"
case('preload_overlay_exposes_cancel_and_stop', test_preload_overlay_exposes_recording_cancel)

def test_preload_settings_no_request_mic_uses_ipc():
    # requestMicPermission must call IPC invoke, not a renderer API
    m = re.search(r'requestMicPermission.*', preload_settings)
    assert m, 'requestMicPermission not found'
    assert 'ipcRenderer.invoke' in m.group(0), \
        "requestMicPermission must use ipcRenderer.invoke"
case('request_mic_uses_ipc_invoke', test_preload_settings_no_request_mic_uses_ipc)

# ─── 7. Python env — dev venv ────────────────────────────────
print('\n── Python environment (dev .venv) ───────────────────────')

site_packages = os.path.join(VENV, 'lib', 'python3.12', 'site-packages')

def test_librosa_pyi_exists_in_venv():
    pyi = os.path.join(site_packages, 'librosa', '__init__.pyi')
    assert os.path.exists(pyi), \
        f"librosa/__init__.pyi missing — lazy_loader will crash: {pyi}"
case('librosa_init_pyi_exists_in_venv', test_librosa_pyi_exists_in_venv)

def test_librosa_importable():
    py = os.path.join(VENV, 'bin', 'python')
    r = subprocess.run([py, '-c', 'import librosa'], capture_output=True, text=True)
    assert r.returncode == 0, f"librosa import failed: {r.stderr.strip()}"
case('librosa_importable_in_venv', test_librosa_importable)

def test_parakeet_mlx_importable():
    py = os.path.join(VENV, 'bin', 'python')
    r = subprocess.run([py, '-c', 'import parakeet_mlx'], capture_output=True, text=True)
    assert r.returncode == 0, f"parakeet_mlx import failed: {r.stderr.strip()}"
case('parakeet_mlx_importable_in_venv', test_parakeet_mlx_importable)

def test_transcribe_server_syntax():
    py = os.path.join(VENV, 'bin', 'python')
    r = subprocess.run([py, '-m', 'py_compile',
                        os.path.join(ROOT, 'transcribe_server.py')],
                       capture_output=True, text=True)
    assert r.returncode == 0, f"transcribe_server.py syntax error: {r.stderr}"
case('transcribe_server_syntax_ok', test_transcribe_server_syntax)

def test_check_models_syntax():
    py = os.path.join(VENV, 'bin', 'python')
    r = subprocess.run([py, '-m', 'py_compile',
                        os.path.join(ROOT, 'check_models.py')],
                       capture_output=True, text=True)
    assert r.returncode == 0, f"check_models.py syntax error: {r.stderr}"
case('check_models_syntax_ok', test_check_models_syntax)

def test_download_model_syntax():
    py = os.path.join(VENV, 'bin', 'python')
    r = subprocess.run([py, '-m', 'py_compile',
                        os.path.join(ROOT, 'download_model.py')],
                       capture_output=True, text=True)
    assert r.returncode == 0, f"download_model.py syntax error: {r.stderr}"
case('download_model_syntax_ok', test_download_model_syntax)

def test_check_models_runs():
    py = os.path.join(VENV, 'bin', 'python')
    r = subprocess.run([py, os.path.join(ROOT, 'check_models.py'), '--json'],
                       capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, f"check_models.py failed: {r.stderr.strip()}"
    import json
    out = r.stdout[r.stdout.find('{'):]
    data = json.loads(out)
    assert data.get('ok'), f"check_models returned ok=false: {data}"
case('check_models_runs_and_returns_ok', test_check_models_runs)

# ─── 8. Packaged app integrity (if dist exists) ───────────────
print('\n── Packaged app (dist) ──────────────────────────────────')

if not os.path.exists(DIST_APP):
    skip('packaged_librosa_pyi_exists', 'dist not built yet')
    skip('packaged_libpython_dylib_exists', 'dist not built yet')
    skip('packaged_python_scripts_exist', 'dist not built yet')
    skip('packaged_python_importable', 'dist not built yet')
else:
    dist_site = os.path.join(DIST_APP, '.venv', 'lib', 'python3.12', 'site-packages')
    dist_py   = os.path.join(DIST_APP, '.venv', 'bin', 'python')

    def test_packaged_librosa_pyi():
        pyi = os.path.join(dist_site, 'librosa', '__init__.pyi')
        assert os.path.exists(pyi), \
            f"librosa/__init__.pyi missing in packaged app — rebuild with .pyi exclusion removed"
    case('packaged_librosa_pyi_exists', test_packaged_librosa_pyi)

    def test_packaged_libpython_dylib():
        dylib = os.path.join(DIST_APP, '.venv', 'lib', 'libpython3.12.dylib')
        assert os.path.exists(dylib), \
            "libpython3.12.dylib missing — run npm run repair-venv after dist build"
    case('packaged_libpython_dylib_exists', test_packaged_libpython_dylib)

    def test_packaged_scripts_exist():
        for script in ['transcribe_server.py', 'check_models.py', 'download_model.py']:
            p = os.path.join(DIST_APP, script)
            assert os.path.exists(p), \
                f"{script} missing from app.asar.unpacked — add to asarUnpack in package.json"
    case('packaged_python_scripts_exist', test_packaged_scripts_exist)

    def test_packaged_python_importable():
        r = subprocess.run([dist_py, '-c', 'import librosa; import parakeet_mlx'],
                           capture_output=True, text=True, timeout=30)
        assert r.returncode == 0, \
            f"Python imports fail in packaged app: {r.stderr.strip()}"
    case('packaged_python_imports_ok', test_packaged_python_importable)

# ─── Summary ──────────────────────────────────────────────────
passed = sum(1 for _, ok, _ in results if ok)
total  = len(results)
print(f'\n{passed}/{total} passed')

if passed < total:
    print('\nFailed:')
    for name, ok, err in results:
        if not ok:
            print(f'  - {name}: {err}')
    sys.exit(1)
