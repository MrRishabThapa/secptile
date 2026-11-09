"""
Wake phrase detection (Phase 6). Two engines, chosen by [wake] engine:

- "whisper" (default): Silero finds speech, a small local whisper model
  transcribes it, and match_wake() looks for the phrase at the start.
- "model": a trained livekit-wakeword .onnx model scores every frame. Training
  needs a CUDA GPU or Apple silicon, so the import stays inside the class.

Either way, audio is processed on this machine and is not stored.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

GREETING_WORDS = {"hey", "hay", "hei", "heh", "hi", "ey", "k"}
SHORT_NAME = "secp"
FULL_NAME = "secptile"
SHORT_NAME_TOLERANCE = 1  # "sec", "sep"
FULL_NAME_TOLERANCE = 3  # "sectile", "septile"
JOINED_NAME_TOLERANCE = 2  # "sep tile" read as two words
SPLIT_NAME_ENDING = re.compile(r"^[^a-z]*(tile|tyle|tylia|tylo|tie light)\b", re.IGNORECASE)
WAKE_COMMAND_ENDING = re.compile(r"^(?:.{0,24}\b)?(?:i am|i'm|im) here[.!?]*$", re.IGNORECASE)
WORD = re.compile(r"[a-z0-9']+", re.IGNORECASE)


@dataclass(frozen=True)
class WakeMatch:
    remainder: str  # what was said after the wake phrase


def _distance(a: str, b: str) -> int:
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, start=1):
        current = [i]
        for j, right in enumerate(b, start=1):
            current.append(min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (left != right),
            ))
        previous = current
    return previous[-1]


def _clean_remainder(text: str) -> str:
    """Drops the rest of a split name and the "i am here" wake command."""
    remainder = text.lstrip(" ,.!?;:-")
    remainder = SPLIT_NAME_ENDING.sub("", remainder).lstrip(" ,.!?;:-")
    if WAKE_COMMAND_ENDING.match(remainder):
        return ""
    return remainder.strip()


def match_wake(transcript: str) -> WakeMatch | None:
    """Matches "hey secp" or "hey secptile" at the start of a transcript."""
    words = list(WORD.finditer(transcript))
    if len(words) < 2 or words[0].group().lower() not in GREETING_WORDS:
        return None
    first = words[1].group().lower()
    if len(words) > 2:
        joined = first + words[2].group().lower()
        joined_distance = _distance(joined, FULL_NAME)
        # Must beat the first word alone, or "Secptile, I" would swallow the "I".
        if joined_distance <= JOINED_NAME_TOLERANCE and joined_distance < _distance(first, FULL_NAME):
            return WakeMatch(_clean_remainder(transcript[words[2].end():]))
    is_short_name = len(first) >= 3 and _distance(first, SHORT_NAME) <= SHORT_NAME_TOLERANCE
    is_full_name = _distance(first, FULL_NAME) <= FULL_NAME_TOLERANCE
    if is_short_name or is_full_name:
        return WakeMatch(_clean_remainder(transcript[words[1].end():]))
    return None


class ModelWatcher:
    """Scores frames with trained livekit-wakeword models."""

    def __init__(self, model_paths: list[str], threshold: float) -> None:
        from livekit.wakeword import WakeWordModel  # type: ignore[import-unverified]

        self.threshold = threshold
        self._model = WakeWordModel(models=[str(path) for path in model_paths])

    def fired(self, frame) -> bool:
        scores = self._model.predict(frame)
        return any(float(score) >= self.threshold for score in scores.values())
