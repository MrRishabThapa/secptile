"""
Wake-word watcher (Phase 6): loads livekit-wakeword .onnx models and scores
every 16 kHz int16 frame. Matches API verified from livekit-wakeword docs:
WakeWordModel(models=[...]).predict(frame) -> {name: score}.

Privacy contract while waiting for the wake word: frames are fed to the ONNX
models in memory only — no disk writes, no audio ever leaves the machine.
"""
from __future__ import annotations

from typing import Callable

from livekit.wakeword import WakeWordModel  # type: ignore[import-unverified]


class WakeWatcher:
    """Owns the loaded models; per-frame predict, no state kept beyond scores."""

    def __init__(self, model_paths: list[str], threshold: float) -> None:
        self.model_paths = model_paths
        self.threshold = threshold
        self._model = WakeWordModel(models=[str(p) for p in model_paths])

    def predict(self, frame) -> str | None:
        """Return the matched phrase name, or None until one scores above threshold."""
        scores = self._model.predict(frame)
        if not isinstance(scores, dict):
            return None
        best_name: str | None = None
        best_score = 0.0
        for name, score in scores.items():
            if isinstance(score, (int, float)) and score > best_score:
                best_name, best_score = str(name), float(score)
        if best_name is not None and best_score >= self.threshold:
            return best_name
        return None

    def matched_phrase(self, name: str) -> Callable[[], str]:
        return lambda: name
