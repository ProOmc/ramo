"""Ramo-owned local Pocket TTS HTTP worker. No dependency on the AI-glasses project.

Uses Kyutai's official pocket-tts Python API. Packages and model weights are
managed in the current user's profile by the Electron host on first enable.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = '127.0.0.1'
TOKEN = os.environ.get('RAMO_POCKET_TOKEN', '')
MAX_TEXT = 6000
MAX_BODY = 24000
MODEL_CACHE = {}
VOICE_CACHE = {}
LOCK = threading.Lock()


class ExclusiveServer(ThreadingHTTPServer):
    """One owner per port.

    ThreadingHTTPServer inherits allow_reuse_address = 1, and on Windows that
    lets a second server bind a port that is already in use while the first
    one keeps every connection. Two Ramo instances then shared a port, the
    losing server answered "403 Unauthorized" to its own app, and the pet
    reported a Pocket TTS error. Binding exclusively makes a duplicate fail
    loudly instead of silently stealing nothing.
    """

    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

try:
    os.environ.setdefault('OMP_NUM_THREADS', str(min(8, os.cpu_count() or 4)))
    os.environ.setdefault('MKL_NUM_THREADS', os.environ['OMP_NUM_THREADS'])
    import torch
    torch.set_num_threads(int(os.environ['OMP_NUM_THREADS']))
except Exception:
    pass


def get_voice(language: str, voice: str):
    from pocket_tts import TTSModel

    model_lang = 'spanish' if language == 'es' else 'english'
    if model_lang not in MODEL_CACHE:
        MODEL_CACHE[model_lang] = TTSModel.load_model(language=model_lang)
    if language == 'es':
        voice = 'lola'
    elif voice not in ('michael', 'george', 'alba'):
        voice = 'michael'
    key = (model_lang, voice)
    if key not in VOICE_CACHE:
        VOICE_CACHE[key] = MODEL_CACHE[model_lang].get_state_for_audio_prompt(voice)
    return MODEL_CACHE[model_lang], VOICE_CACHE[key], voice


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        pass

    def respond(self, status: int, content: bytes, kind='application/json', extra=None):
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Ramo-Pocket', '1')
        for k, v in (extra or {}).items():
            self.send_header(k, str(v))
        self.end_headers()
        try:
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def error_json(self, status, error):
        self.respond(status, json.dumps({'error': str(error)[:350]}).encode())

    def authorized(self):
        # The service is loopback-only, and a per-launch token also protects
        # against unintended requests from other local applications.
        return bool(TOKEN) and self.headers.get('X-Ramo-Token', '') == TOKEN

    def do_GET(self):
        if self.path != '/v1/health':
            return self.error_json(404, 'Not found')
        if not self.authorized():
            return self.error_json(403, 'Unauthorized')
        self.respond(200, b'{"ready":true,"owner":"ramo"}')

    def do_POST(self):
        if self.path == '/v1/warm':
            if not self.authorized():
                return self.error_json(403, 'Unauthorized')
            try:
                count = int(self.headers.get('Content-Length', '0') or 0)
                obj = {}
                if count:
                    obj = json.loads(self.rfile.read(count))
                language = obj.get('language', 'en') if isinstance(obj, dict) else 'en'
                voice = obj.get('voice', 'michael') if isinstance(obj, dict) else 'michael'
                if language not in ('en', 'es'):
                    language = 'en'
                if not isinstance(voice, str):
                    voice = 'michael'
                with LOCK:
                    model, state, voice_used = get_voice(language, voice)
                    # Touch the inference path once so the first real request
                    # does not pay model loading and graph compilation costs.
                    try:
                        audio = model.generate_audio(state, 'Hi.')
                    except Exception:
                        pass
                self.send_response(204)
                self.send_header('X-Ramo-Pocket', '1')
                self.end_headers()
            except Exception as e:
                self.error_json(500, f'Warm failed: {type(e).__name__}: {str(e)[:200]}')
            return
        if self.path != '/v1/pcm':
            return self.error_json(404, 'Not found')
        if not self.authorized():
            return self.error_json(403, 'Unauthorized')
        try:
            count = int(self.headers.get('Content-Length', '0'))
            if not (0 < count <= MAX_BODY):
                return self.error_json(413, 'Request too large')
            obj = json.loads(self.rfile.read(count))
            text = obj.get('text', '')
            if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
                return self.error_json(400, 'Invalid text length')
            language = obj.get('language', 'en')
            voice = obj.get('voice', 'michael')
            if language not in ('en', 'es'):
                return self.error_json(400, 'Unsupported language')
            if not isinstance(voice, str):
                return self.error_json(400, 'Invalid voice')
            with LOCK:
                import numpy as np
                model, state, voice_used = get_voice(language, voice)
                audio = model.generate_audio(state, text)
                pcm = audio.detach().cpu().numpy().astype('<f4', copy=False).tobytes()
                # bound the resulting audio before answering
                if len(pcm) > 35 * 1024 * 1024:
                    return self.error_json(413, 'Audio exceeds limit')
                self.respond(200, pcm, 'application/octet-stream', {
                    'X-Sample-Rate': model.sample_rate, 'X-Voice-Used': voice_used
                })
        except Exception as e:
            self.error_json(500, f'Synthesis failed: {type(e).__name__}: {str(e)[:200]}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=7792)
    args = parser.parse_args()
    if not TOKEN or args.port < 1024 or args.port > 65535:
        raise SystemExit('Pocket runtime must be started by Ramo with a valid configuration.')
    import pocket_tts  # noqa: F401; fail startup visibly if package missing
    server = ExclusiveServer((HOST, args.port), Handler)
    # Warm the default voice model in the background so the first request is
    # faster. It runs only after the port is ours, so a duplicate launch
    # fails before it spends memory on the model.
    def _warm_default():
        try:
            model, state, used = get_voice('en', 'michael')
            _ = model.generate_audio(state, 'Hi.')
        except Exception:
            pass
    threading.Thread(target=_warm_default, daemon=True).start()
    print(f'[Ramo Pocket] ready on {HOST}:{args.port}', flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()

if __name__ == '__main__':
    main()
