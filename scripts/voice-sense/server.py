#!/usr/bin/env python3
"""LayanX voice sense: speech detection and end-of-turn detection on this computer.

  Silero VAD v6.2 (MIT)            is there speech in this audio?   (keeps noise away from Whisper)
  Smart Turn v3.2 CPU (BSD-2)      did the speaker finish the sentence?  (23 languages incl. Arabic)

Loopback HTTP only (127.0.0.1), numpy + onnxruntime only (no torch). Bodies are WAV files (PCM16).

  GET  /health -> {"ok": true, ...}
  POST /vad    -> {"speech": bool, "maxProb": float, "speechMs": int, "durationMs": int}
  POST /turn   -> {"complete": bool, "probability": float, "ms": int}

  python server.py --models <folder with the two .onnx files> [--port 8180]

Each model file must match its pinned SHA-256, otherwise the server refuses to start.
"""
import argparse
import hashlib
import io
import json
import os
import sys
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnxruntime as ort

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from whisper_features import compute_whisper_log_mel_features  # noqa: E402

MODELS = {
    "silero_vad.onnx": "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3",
    "smart-turn-v3.2-cpu.onnx": "2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f",
}
RATE = 16000
MAX_BODY = 12 * 1024 * 1024


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def read_wav(data):
    """WAV bytes (PCM16, any rate, mono/stereo) -> float32 mono at 16 kHz in [-1, 1]."""
    with wave.open(io.BytesIO(data), "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError("only 16-bit PCM WAV is supported")
        channels, rate, frames = w.getnchannels(), w.getframerate(), w.readframes(w.getnframes())
    x = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        x = x[: len(x) // channels * channels].reshape(-1, channels).mean(axis=1)
    if rate != RATE and len(x):
        n = int(len(x) * RATE / rate)
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
    return x


def session(path):
    so = ort.SessionOptions()
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    so.inter_op_num_threads = 1
    so.intra_op_num_threads = max(1, min(4, (os.cpu_count() or 2) // 2))
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(path, sess_options=so, providers=["CPUExecutionProvider"])


class Vad:
    """Silero VAD: 512-sample chunks at 16 kHz with 64 samples of context (as in silero's OnnxWrapper)."""

    def __init__(self, path):
        self.s = session(path)

    def probs(self, x):
        state = np.zeros((2, 1, 128), dtype=np.float32)
        context = np.zeros((1, 64), dtype=np.float32)
        sr = np.array(RATE, dtype=np.int64)
        out = []
        for i in range(0, len(x), 512):
            chunk = x[i : i + 512]
            if len(chunk) < 512:
                chunk = np.pad(chunk, (0, 512 - len(chunk)))
            inp = np.concatenate([context, chunk[None, :].astype(np.float32)], axis=1)
            prob, state = self.s.run(None, {"input": inp, "state": state, "sr": sr})
            context = inp[:, -64:]
            out.append(float(prob[0][0]))
        return out

    def check(self, x, threshold=0.5, min_speech_ms=150):
        p = self.probs(x)
        speech_ms = sum(32 for v in p if v >= threshold)
        return {"speech": speech_ms >= min_speech_ms, "maxProb": round(max(p) if p else 0.0, 4),
                "speechMs": speech_ms, "durationMs": int(len(x) * 1000 / RATE)}


class Turn:
    """Smart Turn v3.2: the last 8 s of the turn (zero-padded at the start) -> probability it is complete."""

    def __init__(self, path):
        self.s = session(path)

    def check(self, x):
        n = RATE * 8
        x = x[-n:] if len(x) > n else np.pad(x, (n - len(x), 0))
        started = time.time()
        feats = compute_whisper_log_mel_features(x, do_normalize=True)[None, :, :]
        prob = float(self.s.run(None, {"input_features": feats})[0][0].item())
        return {"complete": prob > 0.5, "probability": round(prob, 4), "ms": int((time.time() - started) * 1000)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    ap.add_argument("--port", type=int, default=8180)
    args = ap.parse_args()
    for name, digest in MODELS.items():
        path = os.path.join(args.models, name)
        if not os.path.exists(path):
            sys.exit(f"voice-sense: {name} is missing in {args.models}; run scripts\\windows\\install-voice-sense.ps1")
        if sha256(path) != digest:
            sys.exit(f"voice-sense: {name} does not match its pinned SHA-256; refusing to load it")
    vad = Vad(os.path.join(args.models, "silero_vad.onnx"))
    turn = Turn(os.path.join(args.models, "smart-turn-v3.2-cpu.onnx"))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                return self.send(200, {"ok": True, "vad": "silero_vad.onnx", "turn": "smart-turn-v3.2-cpu.onnx", "onnxruntime": ort.__version__})
            self.send(404, {"error": "not_found"})

        def do_POST(self):
            length = int(self.headers.get("content-length") or 0)
            if length <= 44 or length > MAX_BODY:
                return self.send(413 if length > MAX_BODY else 400, {"error": "send a WAV body"})
            try:
                x = read_wav(self.rfile.read(length))
                if self.path == "/vad":
                    return self.send(200, vad.check(x))
                if self.path == "/turn":
                    return self.send(200, turn.check(x))
                self.send(404, {"error": "not_found"})
            except Exception as e:  # malformed audio
                self.send(400, {"error": str(e)[:200]})

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"voice-sense listening on 127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
