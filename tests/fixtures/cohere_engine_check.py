"""Runs the Cohere engine's real transcribe() with stand-ins for torch, the processor and the model, shaped
like the transformers 5.4 objects (BatchFeature keeps audio_chunk_index as a list). A real PC once failed
with "'list' object has no attribute 'to'" because every value was moved like a tensor."""
import contextlib
import collections
import json
import os
import sys

sys.path.insert(0, sys.argv[1])
import numpy as np  # noqa: E402
import cohere_asr_server as srv  # noqa: E402

moves = []


class Tensor:
    def __init__(self, name, floating):
        self.name, self.floating = name, floating

    def is_floating_point(self):
        return self.floating

    def to(self, *args, **kwargs):
        moves.append((self.name, args, tuple(sorted(kwargs.items()))))
        return self


class FakeTorch:
    @staticmethod
    def is_tensor(v):
        return isinstance(v, Tensor)

    @staticmethod
    def inference_mode():
        return contextlib.nullcontext()


class BatchFeature(collections.UserDict):
    """Same rule as transformers' BatchFeature.to: floating tensors get the dtype, other tensors the device."""

    def to(self, device, dtype=None):
        for k, v in self.data.items():
            if isinstance(v, Tensor):
                v.to(device, dtype) if v.is_floating_point() else v.to(device)
        return self


class Processor:
    def __init__(self, as_batch):
        self.as_batch = as_batch

    def __call__(self, audio, sampling_rate, return_tensors, language):
        assert sampling_rate == 16000 and return_tensors == "pt" and language == "ar"
        data = {"input_features": Tensor("input_features", True), "attention_mask": Tensor("attention_mask", False), "audio_chunk_index": [0, 0]}
        return BatchFeature(data) if self.as_batch else data

    def decode(self, out, skip_special_tokens, audio_chunk_index=None, language=None):
        assert skip_special_tokens and audio_chunk_index == [0, 0] and language == "ar"
        return [" مرحبا بك "]


class Model:
    def generate(self, **inputs):
        assert inputs["audio_chunk_index"] == [0, 0], "the chunk index reaches generate like on the model card"
        assert inputs["input_features"].name == "input_features"
        return "tokens"


results = {}
for as_batch in (True, False):
    moves.clear()
    engine = object.__new__(srv.Engine)
    engine.fake, engine.torch, engine.device, engine.dtype = False, FakeTorch, "cpu", "float32"
    engine.processor, engine.model = Processor(as_batch), Model()
    text = engine.transcribe(np.zeros(16000, dtype=np.float32), "ar")
    results["batch" if as_batch else "dict"] = {"text": text, "moves": [m[0] for m in moves]}
print(json.dumps(results, ensure_ascii=False))
