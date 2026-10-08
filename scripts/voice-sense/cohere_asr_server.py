#!/usr/bin/env python3
"""Arabic speech recognition with Cohere Transcribe Arabic (07-2026) on this computer.

  Model: CohereLabs/cohere-transcribe-arabic-07-2026 (2B, Apache-2.0, open weights; Hugging Face asks you to
  accept its terms once). Strongest on Gulf and other dialects (average WER 25.9 vs 36.9 for Whisper large-v3
  on the Open Universal Arabic ASR leaderboard, Gulf 24.4 vs 46.1).

The server speaks the same OpenAI-compatible API as whisper.cpp's whisper-server, so LayanX uses it with the
same client:

  GET  /                          -> {"ok": true, "engine": "cohere-transcribe-arabic", "ready": bool}
  POST /v1/audio/transcriptions   multipart/form-data: file=<WAV>, language=ar  -> {"text": "..."}

  python cohere_asr_server.py --model <downloaded model folder> [--port 8181] [--device cpu|cuda]
  python cohere_asr_server.py --model <folder> --selftest <file.wav>    (load, transcribe once, exit)

Requests must come from this computer (Host check) and carry the x-layanx-client header, which a web
page cannot add without a CORS preflight that this server never answers.

Loopback only. LAYANX_COHERE_FAKE=1 answers without loading the model (used by tests).
"""
import argparse
import json
import os
import sys
import threading
import time
from email.parser import BytesParser
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wavio import RATE, local_host_ok, read_wav  # noqa: E402

MAX_BODY = 32 * 1024 * 1024


def parse_form(content_type, body):
    """multipart/form-data -> {name: bytes} (the cgi module is gone in Python 3.13)."""
    msg = BytesParser(policy=HTTP).parsebytes(b"Content-Type: " + content_type.encode() + b"\r\n\r\n" + body)
    if not msg.is_multipart():
        raise ValueError("expected multipart/form-data")
    fields = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if name:
            fields[name] = part.get_payload(decode=True) or b""
    return fields


def to_device(inputs, torch, device, dtype):
    """Move the processor output the way the model card does (BatchFeature.to): floating tensors to the
    device and dtype, other tensors to the device, everything else (audio_chunk_index is a list) unchanged."""
    if callable(getattr(inputs, "to", None)) and not isinstance(inputs, dict):
        return inputs.to(device, dtype=dtype)
    moved = {}
    for k, v in dict(inputs).items():
        if torch.is_tensor(v):
            moved[k] = v.to(device, dtype) if v.is_floating_point() else v.to(device)
        else:
            moved[k] = v
    return moved


def decode_text(processor, out, chunk_index, language):
    """Decode like the model card: long audio is split into chunks that decode() joins with audio_chunk_index."""
    if chunk_index is not None:
        text = processor.decode(out, skip_special_tokens=True, audio_chunk_index=chunk_index, language=language)
    else:
        text = processor.decode(out, skip_special_tokens=True)
    if isinstance(text, (list, tuple)):
        text = text[0] if text else ""
    return str(text).strip()


class Engine:
    def __init__(self, model_dir, device):
        if os.environ.get("LAYANX_COHERE_FAKE") == "1":
            self.fake = True
            self.device = "fake"
            return
        self.fake = False
        import torch
        from transformers import AutoProcessor
        try:  # the class the model card uses (transformers 5.4+)
            from transformers import CohereAsrForConditionalGeneration as ModelClass
        except ImportError:
            from transformers import AutoModelForSpeechSeq2Seq as ModelClass

        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        # GTX 16xx / RTX 20xx have no bfloat16: half precision on the GPU, full precision on the CPU.
        dtype = torch.float16 if device == "cuda" else torch.float32
        self.torch = torch
        self.device = device
        self.processor = AutoProcessor.from_pretrained(model_dir)
        self.model = ModelClass.from_pretrained(model_dir, dtype=dtype).to(device).eval()
        self.dtype = dtype

    def transcribe(self, audio, language):
        if self.fake:
            return f"[fake:{language}:{len(audio) / RATE:.1f}s]"
        lang = language or "ar"
        inputs = self.processor(audio, sampling_rate=RATE, return_tensors="pt", language=lang)
        chunk_index = inputs.get("audio_chunk_index")
        inputs = to_device(inputs, self.torch, self.device, self.dtype)
        with self.torch.inference_mode():
            out = self.model.generate(**inputs, max_new_tokens=256)
        return decode_text(self.processor, out, chunk_index, lang)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--port", type=int, default=8181)
    ap.add_argument("--device", default=os.environ.get("LAYANX_COHERE_DEVICE", "cpu"), choices=["cpu", "cuda", "auto"])
    ap.add_argument("--selftest")
    args = ap.parse_args()
    if os.environ.get("LAYANX_COHERE_FAKE") != "1" and not os.path.exists(os.path.join(args.model, "model.safetensors")):
        sys.exit(f"cohere-asr: no model in {args.model}; run scripts\\windows\\install-cohere-asr.ps1")
    if args.selftest:
        started = time.time()
        engine = Engine(args.model, args.device)
        with open(args.selftest, "rb") as f:
            text = engine.transcribe(read_wav(f.read(), max_seconds=120), "ar")
        print(json.dumps({"ok": bool(text.strip()), "text": text, "device": engine.device, "seconds": round(time.time() - started, 1)}, ensure_ascii=False), flush=True)
        sys.exit(0 if text.strip() else 1)
    # The port opens at once (LayanX finds the engine while it starts); the model loads in the background.
    state = {"engine": None, "error": None}

    def load():
        started = time.time()
        try:
            state["engine"] = Engine(args.model, args.device)
            print(f"cohere-asr ready on {state['engine'].device} in {time.time() - started:.0f} s", flush=True)
        except Exception as e:  # missing packages, out of memory ...
            state["error"] = str(e)[:300]
            print("cohere-asr failed to load: " + state["error"], file=sys.stderr, flush=True)

    threading.Thread(target=load, daemon=True).start()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, status, body):
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if not local_host_ok(self.headers.get("host"), args.port):
                return self.send(403, {"error": "local_only"})
            if self.path in ("/", "/health"):
                engine = state["engine"]
                return self.send(200, {"ok": state["error"] is None, "engine": "cohere-transcribe-arabic", "ready": engine is not None,
                                       "device": engine.device if engine else args.device, **({"error": state["error"]} if state["error"] else {})})
            self.send(404, {"error": "not_found"})

        def do_POST(self):
            if not local_host_ok(self.headers.get("host"), args.port) or not self.headers.get("x-layanx-client"):
                return self.send(403, {"error": "local_only"})
            if self.path.rstrip("/") not in ("/v1/audio/transcriptions", "/inference"):
                return self.send(404, {"error": "not_found"})
            length = int(self.headers.get("content-length") or 0)
            if length <= 0 or length > MAX_BODY:
                return self.send(413 if length > MAX_BODY else 400, {"error": "audio body required"})
            engine = state["engine"]
            if engine is None:
                return self.send(503, {"error": state["error"] or "the Arabic speech model is still loading, try again in a moment"})
            try:
                fields = parse_form(self.headers.get("content-type", ""), self.rfile.read(length))
                if "file" not in fields:
                    return self.send(400, {"error": "file is required"})
                lang = (fields.get("language") or b"ar").decode().strip().lower() or "ar"
                text = engine.transcribe(read_wav(fields["file"], max_seconds=120), "ar" if lang == "auto" else lang)
                self.send(200, {"text": text})
            except Exception as e:
                self.send(400, {"error": str(e)[:300]})

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
