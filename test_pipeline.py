#!/usr/bin/env python3
"""
Integration tests for transcribe_server.py.

Spawns the server once (expensive model load), runs all cases, reports results.
Usage: .venv/bin/python test_pipeline.py
"""
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import time
import wave

ROOT   = os.path.dirname(os.path.abspath(__file__))
PYTHON = os.path.join(ROOT, '.venv', 'bin', 'python')
SERVER = os.path.join(ROOT, 'transcribe_server.py')

GREEN = '\033[32m'
RED   = '\033[31m'
RESET = '\033[0m'


def make_wav_stereo(path, duration=1.0, rate=16000):
    n = int(duration * rate)
    with wave.open(path, 'w') as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(b'\x00\x00\x00\x00' * n)


def make_wav_highrate(path, duration=1.0, rate=44100):
    n = int(duration * rate)
    with wave.open(path, 'w') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(b'\x00\x00' * n)


def make_wav(path, duration=1.0, silent=False, rate=16000):
    n = int(duration * rate)
    with wave.open(path, 'w') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(rate)
        if silent:
            f.writeframes(b'\x00\x00' * n)
        else:
            # 440 Hz tone — detectable by VAD, unlikely to produce meaningful words
            data = b''.join(
                struct.pack('<h', int(16000 * math.sin(2 * math.pi * 440 * i / rate)))
                for i in range(n)
            )
            f.writeframes(data)


def start_server():
    env = {**os.environ, 'QVOICE_MODEL': 'base.en'}
    proc = subprocess.Popen(
        [PYTHON, SERVER],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    print('  [server starting — loading models...]')
    for raw in proc.stdout:
        msg = json.loads(raw.strip())
        if msg.get('status') == 'ready':
            break
    return proc


def send(proc, req, timeout=60):
    """Send one request, collect responses until final status (ok/error)."""
    proc.stdin.write(json.dumps(req) + '\n')
    proc.stdin.flush()
    responses = []
    deadline = time.time() + timeout
    while time.time() < deadline:
        raw = proc.stdout.readline()
        if not raw:
            break
        resp = json.loads(raw.strip())
        responses.append(resp)
        if resp.get('status') in ('ok', 'error'):
            return responses
    return responses


# ─── Test runner ──────────────────────────────────────────────

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


# ─── Cases ────────────────────────────────────────────────────

print('Starting server...')
server = start_server()
print('  Server ready.\n')

with tempfile.TemporaryDirectory() as tmp:
    silence = os.path.join(tmp, 'silence.wav')
    tone    = os.path.join(tmp, 'tone.wav')
    missing = os.path.join(tmp, 'missing.wav')   # intentionally absent
    make_wav(silence, silent=True)
    make_wav(tone, duration=2.0)

    # 1. Silence through full pipeline — empty transcription, no crash
    def test_silence_full():
        resps = send(server, {'audio_path': silence, 'correction': True})
        assert resps, 'no response'
        final = resps[-1]
        assert final['status'] == 'ok', f"got {final}"
        assert final.get('text', '') == '', f"expected empty, got '{final.get('text')}'"
    case('silence_full_pipeline', test_silence_full)

    # 2. Partial mode — single response, no LLM call
    def test_partial():
        resps = send(server, {'audio_path': silence, 'partial': True})
        assert len(resps) == 1, f"expected 1 response, got {resps}"
        assert resps[0]['status'] == 'ok'
    case('silence_partial_mode', test_partial)

    # 3. Correction disabled — skips LLM, still emits "transcribed" then final "ok"
    def test_no_correction():
        resps = send(server, {'audio_path': silence, 'correction': False})
        assert resps, 'no response'
        assert resps[-1]['status'] == 'ok', f"got {resps[-1]}"
    case('correction_disabled', test_no_correction)

    # 4. Full pipeline emits intermediate "transcribed" before final "ok"
    # Only testable when Whisper finds speech; skip for silence (returns ok directly).
    # Tested implicitly via tone below.

    # 5. Missing audio file → error response, server stays alive
    def test_missing_file():
        resps = send(server, {'audio_path': missing})
        assert resps, 'no response'
        assert resps[-1]['status'] == 'error', f"expected error, got {resps[-1]}"
        assert resps[-1].get('error'), 'missing error message'
        # Server must still respond after the error
        resps2 = send(server, {'audio_path': silence, 'partial': True})
        assert resps2 and resps2[-1]['status'] == 'ok', f"server dead after error: {resps2}"
    case('missing_file_recovery', test_missing_file)

    # 6. Malformed JSON → error response, server stays alive
    def test_bad_json():
        server.stdin.write('not-valid-json\n')
        server.stdin.flush()
        raw = server.stdout.readline()
        resp = json.loads(raw.strip())
        assert resp['status'] == 'error', f"expected error, got {resp}"
        # Server must handle the next valid request
        resps = send(server, {'audio_path': silence, 'partial': True})
        assert resps and resps[-1]['status'] == 'ok', f"server dead after bad json: {resps}"
    case('bad_json_recovery', test_bad_json)

    # 7. Sequential requests don't cross-contaminate responses
    def test_sequential():
        r1 = send(server, {'audio_path': silence, 'partial': True})
        r2 = send(server, {'audio_path': silence, 'partial': True})
        r3 = send(server, {'audio_path': silence, 'partial': True})
        for i, r in enumerate([r1, r2, r3], 1):
            assert r and r[-1]['status'] == 'ok', f"request {i} failed: {r}"
    case('sequential_requests', test_sequential)

    # 8. Tone audio through full pipeline — no crash regardless of Whisper output
    def test_tone_full():
        resps = send(server, {'audio_path': tone, 'correction': True}, timeout=90)
        assert resps, 'no response'
        final = resps[-1]
        assert final['status'] in ('ok', 'error'), f"unexpected final status: {final}"
        if final['status'] == 'ok':
            assert 'text' in final, 'missing text field'
    case('tone_full_pipeline', test_tone_full)

    # 9. Custom system_prompt is accepted without error
    def test_custom_prompt():
        resps = send(server, {
            'audio_path': silence,
            'correction': False,
            'system_prompt': 'Return the text exactly as given.',
        })
        assert resps and resps[-1]['status'] == 'ok', f"got {resps}"
    case('custom_system_prompt', test_custom_prompt)

    # 10. Custom beam_size is accepted without error
    def test_beam_size():
        resps = send(server, {'audio_path': silence, 'beam_size': 1, 'correction': False})
        assert resps and resps[-1]['status'] == 'ok', f"got {resps}"
    case('custom_beam_size', test_beam_size)

    # 11. Missing audio_path key → error response, server stays alive
    def test_no_audio_path_key():
        resps = send(server, {'correction': False, 'beam_size': 1})
        assert resps and resps[-1]['status'] == 'error', f"expected error, got {resps}"
        resps2 = send(server, {'audio_path': silence, 'partial': True})
        assert resps2 and resps2[-1]['status'] == 'ok', f"server dead after missing key: {resps2}"
    case('missing_audio_path_key', test_no_audio_path_key)

    # 12. Empty string audio_path → error, server stays alive
    def test_empty_audio_path():
        resps = send(server, {'audio_path': '', 'partial': True})
        assert resps and resps[-1]['status'] == 'error', f"expected error, got {resps}"
        resps2 = send(server, {'audio_path': silence, 'partial': True})
        assert resps2 and resps2[-1]['status'] == 'ok', f"server dead after empty path: {resps2}"
    case('empty_audio_path', test_empty_audio_path)

    # 13. Stereo WAV — Whisper downmixes to mono internally
    stereo = os.path.join(tmp, 'stereo.wav')
    make_wav_stereo(stereo)
    def test_stereo():
        resps = send(server, {'audio_path': stereo, 'partial': True})
        assert resps and resps[-1]['status'] == 'ok', f"got {resps}"
        assert 'text' in resps[-1], f"missing text field: {resps[-1]}"
    case('stereo_wav', test_stereo)

    # 14. High sample rate WAV (44100 Hz) — Whisper resamples internally
    highrate = os.path.join(tmp, 'highrate.wav')
    make_wav_highrate(highrate)
    def test_highrate():
        resps = send(server, {'audio_path': highrate, 'partial': True})
        assert resps and resps[-1]['status'] == 'ok', f"got {resps}"
        assert 'text' in resps[-1], f"missing text field: {resps[-1]}"
    case('high_sample_rate_wav', test_highrate)

    # 15. Very short audio (0.1s) — VAD handles edge case without crash
    short = os.path.join(tmp, 'short.wav')
    make_wav(short, duration=0.1, silent=True)
    def test_very_short():
        resps = send(server, {'audio_path': short, 'partial': True})
        assert resps and resps[-1]['status'] == 'ok', f"got {resps}"
    case('very_short_wav', test_very_short)

    # 16. Long silence (5s) — completes in reasonable time
    long_sil = os.path.join(tmp, 'long_silence.wav')
    make_wav(long_sil, duration=5.0, silent=True)
    def test_long_silence():
        t0 = time.time()
        resps = send(server, {'audio_path': long_sil, 'partial': True}, timeout=30)
        elapsed = time.time() - t0
        assert resps and resps[-1]['status'] == 'ok', f"got {resps}"
        assert elapsed < 20, f"too slow: {elapsed:.1f}s"
    case('long_silence_completes', test_long_silence)

    # 17. Full pipeline response ordering: "transcribed" must precede "ok"
    def test_transcribed_ordering():
        resps = send(server, {'audio_path': silence, 'correction': True})
        statuses = [r['status'] for r in resps]
        assert statuses[-1] == 'ok', f"last status must be ok: {statuses}"
        assert 'transcribed' in statuses, f"must emit transcribed intermediate: {statuses}"
        assert statuses.index('transcribed') < statuses.index('ok'), f"wrong order: {statuses}"
    case('transcribed_precedes_ok', test_transcribed_ordering)

    # 18. Every ok response has a 'text' field
    def test_text_field_present():
        for req in [
            {'audio_path': silence, 'partial': True},
            {'audio_path': silence, 'correction': False},
            {'audio_path': silence, 'correction': True},
        ]:
            resps = send(server, req)
            assert resps, f"no response for {req}"
            final = resps[-1]
            assert final['status'] == 'ok', f"got {final}"
            assert 'text' in final, f"missing 'text' field in {final}"
    case('ok_response_has_text_field', test_text_field_present)

    # 19. Empty system_prompt string falls back to default — no crash
    def test_empty_system_prompt():
        resps = send(server, {'audio_path': silence, 'system_prompt': '', 'correction': False})
        assert resps and resps[-1]['status'] == 'ok', f"got {resps}"
    case('empty_system_prompt_fallback', test_empty_system_prompt)

    # 20. Blank stdin lines are ignored without response or crash
    def test_blank_lines():
        server.stdin.write('\n\n\n')
        server.stdin.flush()
        time.sleep(0.1)
        resps = send(server, {'audio_path': silence, 'partial': True})
        assert resps and resps[-1]['status'] == 'ok', f"server failed after blank lines: {resps}"
    case('blank_lines_ignored', test_blank_lines)

    # 21. 10 sequential partial requests — no state accumulation
    def test_many_partials():
        for i in range(10):
            resps = send(server, {'audio_path': silence, 'partial': True})
            assert resps and resps[-1]['status'] == 'ok', f"request {i+1} failed: {resps}"
    case('many_partials_stress', test_many_partials)

    # 22. Alternating partial/full requests — response routing stays correct
    def test_alternating():
        for i in range(5):
            rp = send(server, {'audio_path': silence, 'partial': True})
            assert rp and rp[-1]['status'] == 'ok', f"partial {i+1} failed: {rp}"
            rf = send(server, {'audio_path': silence, 'correction': False})
            assert rf and rf[-1]['status'] == 'ok', f"full {i+1} failed: {rf}"
    case('alternating_partial_full', test_alternating)

# ─── Summary ──────────────────────────────────────────────────

server.stdin.close()
try:
    server.wait(timeout=5)
except subprocess.TimeoutExpired:
    server.kill()

passed = sum(1 for _, ok, _ in results if ok)
total  = len(results)
print(f'\n{passed}/{total} passed')

if passed < total:
    print('\nFailed cases:')
    for name, ok, err in results:
        if not ok:
            print(f'  - {name}: {err}')
    sys.exit(1)
