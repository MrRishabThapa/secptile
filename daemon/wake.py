"""
Wake word detection (Phase 6). The wake word is "secptile". Two engines, chosen
by [wake] engine:

- "whisper" (default): Silero finds speech, a small local whisper model
  transcribes it, and match_wake() looks for the word at the start.
- "model": a trained livekit-wakeword .onnx model scores every frame. Training
  needs a CUDA GPU or Apple silicon, so the import stays inside the class.

Either way, audio is processed on this machine and is not stored.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

WAKE_WORD = "secptile"
OPTIONAL_LEAD_IN = {"hey", "hay", "hi"}
# One word is easy to hit by accident, so a near match must also sound the same
# at the start: this accepts "septile" and "sectile" but not "reptile".
FIRST_LETTERS = ("s", "z")
WAKE_TOLERANCE = 2
WAKE_COMMAND_ENDING = re.compile(r"^(?:i am|i'm|im) here[.!?]*$", re.IGNORECASE)
WORD = re.compile(r"[a-z0-9']+", re.IGNORECASE)


@dataclass(frozen=True)
class WakeMatch:
    remainder: str  # what was said after the wake word


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


def _sounds_like_wake_word(word: str) -> bool:
    return word.startswith(FIRST_LETTERS) and _distance(word, WAKE_WORD) <= WAKE_TOLERANCE


def _clean_remainder(text: str) -> str:
    remainder = text.lstrip(" ,.!?;:-").strip()
    return "" if WAKE_COMMAND_ENDING.match(remainder) else remainder


def match_wake(transcript: str) -> WakeMatch | None:
    """Matches the wake word as the first word of a transcript."""
    words = list(WORD.finditer(transcript))
    if words and words[0].group().lower() in OPTIONAL_LEAD_IN:
        words = words[1:]
    if not words:
        return None
    first = words[0].group().lower()
    if len(words) > 1:
        # Whisper sometimes splits the word: "Sep tile", "Sec, tile".
        joined = first + words[1].group().lower()
        if _sounds_like_wake_word(joined) and _distance(joined, WAKE_WORD) < _distance(first, WAKE_WORD):
            return WakeMatch(_clean_remainder(transcript[words[1].end():]))
    if _sounds_like_wake_word(first):
        return WakeMatch(_clean_remainder(transcript[words[0].end():]))
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
