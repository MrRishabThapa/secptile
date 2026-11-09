"""
Secptile's voice on the desktop (Phase 6): gets local Piper speech from the
app's /api/tts route, one sentence at a time, and plays it with `pw-cat`.

Piper generates speech far faster than it plays, so the next sentence is ready
before the current one ends. To interrupt playback, cancel the task running
play(). That kills the player at once and skips the sentences still to come.
"""
from __future__ import annotations

import asyncio
import io
import re
import wave

import httpx

MAX_CHARS = 600  # keeps one very long sentence from delaying the first sound
SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


class SpeechError(RuntimeError):
    pass


def split_text(text: str, limit: int = MAX_CHARS) -> list[str]:
    """Splits into sentences, breaking any sentence longer than the limit."""
    pieces: list[str] = []
    for sentence in SENTENCE_END.split(text.strip()):
        while len(sentence) > limit:
            cut = sentence.rfind(" ", 0, limit)
            cut = cut if cut > 0 else limit
            pieces.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip()
        if sentence:
            pieces.append(sentence)
    return pieces


def read_wav(data: bytes) -> tuple[int, bytes]:
    """Returns (sample rate, raw 16-bit mono PCM)."""
    try:
        with wave.open(io.BytesIO(data)) as clip:
            if clip.getsampwidth() != 2 or clip.getnchannels() != 1:
                raise SpeechError("expected 16-bit mono speech")
            return clip.getframerate(), clip.readframes(clip.getnframes())
    except (wave.Error, EOFError) as cause:
        raise SpeechError(f"speech was not valid audio: {cause}") from cause


async def _start_player(sample_rate: int) -> asyncio.subprocess.Process:
    return await asyncio.create_subprocess_exec(
        "pw-cat", "--playback", "--raw", "--rate", str(sample_rate),
        "--channels", "1", "--format", "s16", "--latency", "50ms", "-",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )


class Speaker:
    def __init__(self, client: httpx.AsyncClient, tts_url: str) -> None:
        self._client = client
        self._tts_url = tts_url

    async def _synthesize(self, text: str) -> tuple[int, bytes]:
        try:
            response = await self._client.post(
                self._tts_url, json={"text": text}, timeout=60.0,
            )
        except httpx.HTTPError as cause:
            raise SpeechError(f"speech request failed: {cause}") from cause
        if response.status_code != 200:
            raise SpeechError(f"/api/tts {response.status_code}: {response.text[:200]}")
        return read_wav(response.content)

    async def play(self, text: str) -> None:
        """Speaks the text. Raises SpeechError if speech can't be produced."""
        process: asyncio.subprocess.Process | None = None
        try:
            for piece in split_text(text):
                sample_rate, audio = await self._synthesize(piece)
                if process is None:
                    process = await _start_player(sample_rate)
                assert process.stdin is not None
                process.stdin.write(audio)
                await process.stdin.drain()
            if process is not None and process.stdin is not None:
                process.stdin.close()
                await process.wait()
        except (BrokenPipeError, ConnectionResetError) as cause:
            raise SpeechError("audio player stopped unexpectedly") from cause
        finally:
            if process is not None and process.returncode is None:
                process.kill()
                await process.wait()
