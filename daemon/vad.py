"""
Silero VAD (Phase 6): neural speech detection, running locally through ONNX.

It decides when you started and stopped talking, and tells your voice from
background noise when you interrupt Secptile. Audio stays in memory.

The tensor layout mirrors silero_vad's own OnnxWrapper (v6): each step feeds
64 samples of context + 512 new samples at 16 kHz, plus a (2, 1, 128) state.
"""
from __future__ import annotations

import numpy as np
import onnxruntime

SAMPLE_RATE = 16000
CHUNK_SAMPLES = 512
CONTEXT_SAMPLES = 64


class SileroVad:
    def __init__(self, model_path: str) -> None:
        options = onnxruntime.SessionOptions()
        options.inter_op_num_threads = 1
        options.intra_op_num_threads = 1
        self._session = onnxruntime.InferenceSession(
            model_path, sess_options=options, providers=["CPUExecutionProvider"],
        )
        self.reset()

    def reset(self) -> None:
        """Forget earlier audio. Call this when the stream restarts."""
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._context = np.zeros((1, CONTEXT_SAMPLES), dtype=np.float32)
        self._pending = np.zeros(0, dtype=np.float32)

    def probability(self, frame: np.ndarray) -> float:
        """Highest speech probability among the chunks this int16 frame completes."""
        audio = frame.astype(np.float32) / 32768.0
        self._pending = np.concatenate((self._pending, audio))
        best = 0.0
        while self._pending.size >= CHUNK_SAMPLES:
            chunk = self._pending[:CHUNK_SAMPLES].reshape(1, -1)
            self._pending = self._pending[CHUNK_SAMPLES:]
            model_input = np.concatenate((self._context, chunk), axis=1)
            output, self._state = self._session.run(
                None,
                {
                    "input": model_input,
                    "state": self._state,
                    "sr": np.array(SAMPLE_RATE, dtype=np.int64),
                },
            )
            self._context = model_input[:, -CONTEXT_SAMPLES:]
            best = max(best, float(output[0][0]))
        return best
