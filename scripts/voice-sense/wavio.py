"""WAV decoding shared by the LayanX voice servers (voice sense and Cohere speech recognition)."""
import io
import wave

import numpy as np

RATE = 16000


def read_wav(data, max_seconds=60.0):
    """WAV bytes (PCM16, 8-48 kHz, mono/stereo) -> float32 mono at 16 kHz in [-1, 1].

    Rate, channels and length are checked before any work, so a small file that claims an odd rate
    cannot make the server allocate huge buffers.
    """
    with wave.open(io.BytesIO(data), "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError("only 16-bit PCM WAV is supported")
        channels, rate, frames = w.getnchannels(), w.getframerate(), w.getnframes()
        if not 8000 <= rate <= 48000:
            raise ValueError("sample rate must be between 8 and 48 kHz")
        if channels not in (1, 2):
            raise ValueError("mono or stereo only")
        if frames / rate > max_seconds:
            raise ValueError(f"audio longer than {int(max_seconds)} s")
        raw = w.readframes(frames)
    x = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        x = x[: len(x) // channels * channels].reshape(-1, channels).mean(axis=1)
    if rate != RATE and len(x):
        n = int(len(x) * RATE / rate)
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
    return x


def local_host_ok(host_header, port):
    """Reject requests whose Host is not this computer (DNS rebinding from a web page)."""
    host = (host_header or "").strip().lower()
    return host in (f"127.0.0.1:{port}", f"localhost:{port}", f"[::1]:{port}")
