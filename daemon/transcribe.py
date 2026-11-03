"""
Transcription (Phase 6): reuse the Phase 2 setup end-to-end — the daemon
uploads the utterance (multipart `file`, like the browser clip) to the app's
/api/transcribe route, which forwards to the local whisper.cpp server. Nothing
is duplicated: no local model is even loaded here.
"""
from __future__ import annotations

import httpx
import numpy as np


class TranscribeError(RuntimeError):
    pass


def to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    """16 kHz 16-bit mono PCM -> RIFF/WAV, the format whisper.cpp expects."""
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(audio.tobytes())
    return buf.getvalue()


async def transcribe(
    audio: np.ndarray,
    sample_rate: int,
    app_base_url: str,
    app_transcribe_path: str,
) -> str:
    wav = to_wav_bytes(audio, sample_rate)
    if not wav or len(wav) < 128:  # empty clip: header alone is ~44 bytes
        raise TranscribeError("Utterance was empty — say something after the chime.")
    files = {"file": ("utterance.wav", wav, "audio/wav")}
    async with httpx.AsyncClient(timeout=300.0) as client:
        response = await client.post(
            app_base_url.rstrip("/") + app_transcribe_path,
            files=files,
            data={"response_format": "json"},
        )
    if response.status_code != 200:
        raise TranscribeError(f"Transcribe endpoint returned {response.status_code}")
    payload = response.json()
    text = str(payload.get("text", "")).strip()
    if not text:
        raise TranscribeError("Transcription produced no text.")
    return text
