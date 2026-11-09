"""
Secptile's voice on the desktop (Phase 6): streams Qwen speech from the app's
/api/tts route and plays it with `pw-cat`. The API key stays in the app.

To interrupt playback, cancel the task running play(). That kills the player
at once and closes the stream, so the rest of the sentence is not generated.
"""
from __future__ import annotations

import asyncio
import re

import httpx

PCM_RATE = "24000"
MAX_CHARS = 600  # the /api/tts limit per request
SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


class SpeechError(RuntimeError):
    pass


def split_text(text: str, limit: int = MAX_CHARS) -> list[str]:
    """Splits at sentence ends so each piece fits one speech request."""
    pieces: list[str] = []
    current = ""
    for sentence in SENTENCE_END.split(text.strip()):
        while len(sentence) > limit:
            cut = sentence.rfind(" ", 0, limit)
            cut = cut if cut > 0 else limit
            if current:
                pieces.append(current)
                current = ""
            pieces.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip()
        joined = f"{current} {sentence}".strip()
        if len(joined) > limit:
            pieces.append(current)
            current = sentence
        else:
            current = joined
    if current:
        pieces.append(current)
    return pieces


class Speaker:
    def __init__(self, client: httpx.AsyncClient, tts_url: str) -> None:
        self._client = client
        self._tts_url = tts_url

    async def play(self, text: str) -> None:
        """Speaks the text. Raises SpeechError if speech can't be produced."""
        process = await asyncio.create_subprocess_exec(
            "pw-cat", "--playback", "--raw", "--rate", PCM_RATE,
            "--channels", "1", "--format", "s16", "--latency", "50ms", "-",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        assert process.stdin is not None
        try:
            for piece in split_text(text):
                async with self._client.stream(
                    "POST", self._tts_url,
                    json={"text": piece, "format": "pcm"},
                    timeout=httpx.Timeout(30.0, read=60.0),
                ) as response:
                    if response.status_code != 200:
                        detail = (await response.aread()).decode(errors="replace")
                        raise SpeechError(f"/api/tts {response.status_code}: {detail[:200]}")
                    async for audio in response.aiter_bytes():
                        process.stdin.write(audio)
                        await process.stdin.drain()
            process.stdin.close()
            await process.wait()
        except httpx.HTTPError as cause:
            raise SpeechError(f"speech request failed: {cause}") from cause
        except (BrokenPipeError, ConnectionResetError) as cause:
            raise SpeechError("audio player stopped unexpectedly") from cause
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
