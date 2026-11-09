"""
Transcription (Phase 6).

- Spoken turns go through the app's /api/transcribe route (the accurate model).
- Wake checks go straight to a small dedicated whisper server, because they
  must answer in under a second. Its clips are never stored.
"""
from __future__ import annotations

import io
import re
import wave

import httpx
import numpy as np

# Teaches whisper the spoken commands. This exact wording was picked by testing:
# "Secp. Secptile." made it hear "september" and "subtle" as the wake word, leaving
# the commands out made it hear "Cue Dose" and "Mega Revolve", and ending on
# "Mega evolve." sent it into a 7 s repetition loop on that phrase. Re-test
# false wakes and timing before changing it.
WAKE_PROMPT = "Mega evolve. Kudos. Talking to Secptile."
NON_SPEECH = re.compile(r"[\[(][^\])]*[\])]")


class TranscribeError(RuntimeError):
    pass


def to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    """16-bit mono PCM to RIFF/WAV, the format whisper.cpp expects."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(audio.tobytes())
    return buffer.getvalue()


def clean_text(text: str) -> str:
    """Removes whisper's non-speech tags, such as [BLANK_AUDIO] or (wind)."""
    return NON_SPEECH.sub("", text).strip()


async def transcribe(
    client: httpx.AsyncClient,
    audio: np.ndarray,
    sample_rate: int,
    app_base_url: str,
    app_transcribe_path: str,
) -> str:
    """Transcribes a spoken turn through the app."""
    files = {"file": ("utterance.wav", to_wav_bytes(audio, sample_rate), "audio/wav")}
    response = await client.post(
        app_base_url.rstrip("/") + app_transcribe_path,
        files=files,
        data={"response_format": "json"},
        timeout=300.0,
    )
    if response.status_code != 200:
        raise TranscribeError(f"Transcribe endpoint returned {response.status_code}")
    text = clean_text(str(response.json().get("text", "")))
    if not text:
        raise TranscribeError("Transcription produced no text.")
    return text


async def spot(
    client: httpx.AsyncClient,
    audio: np.ndarray,
    sample_rate: int,
    whisper_url: str,
) -> str:
    """Transcribes a short clip on the wake server. Returns "" on any failure."""
    files = {"file": ("clip.wav", to_wav_bytes(audio, sample_rate), "audio/wav")}
    try:
        response = await client.post(
            whisper_url.rstrip("/") + "/inference",
            files=files,
            data={"response_format": "json", "prompt": WAKE_PROMPT},
            timeout=15.0,
        )
        response.raise_for_status()
        return clean_text(str(response.json().get("text", "")))
    except (httpx.HTTPError, ValueError):
        return ""
