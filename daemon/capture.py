"""
Microphone capture and end-of-speech detection (Phase 6).

- The mic is a `pw-record` process, so PipeWire can give us the echo-cancelled
  source by name. Stopping the process closes the mic, which is what mute means.
- Frames stay in memory in a short rolling buffer and never touch disk.
- Speech boundaries come from Silero (vad.py), not raw loudness.
"""
from __future__ import annotations

import asyncio
from collections import deque
from typing import Awaitable, Callable, Iterable

import numpy as np

from vad import SileroVad

SAMPLE_RATE = 16000
FRAME_SAMPLES = 1280  # 80 ms, the step the wake models expect
HOP_SECONDS = FRAME_SAMPLES / SAMPLE_RATE
BACKLOG_SECONDS = 20  # oldest audio is dropped while whisper is busy
SPEECH_RELEASE_MARGIN = 0.15  # end of speech needs a clearly lower score

ReadFrame = Callable[[], Awaitable[np.ndarray]]


async def source_exists(name: str) -> bool:
    """True when PipeWire currently offers a capture source with this name."""
    process = await asyncio.create_subprocess_exec(
        "pactl", "list", "short", "sources",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    output, _ = await process.communicate()
    return any(
        len(columns) > 1 and columns[1] == name
        for columns in (line.split("\t") for line in output.decode().splitlines())
    )


class Mic:
    """16 kHz mono int16 frames from `pw-record`; "" uses the default source."""

    def __init__(self) -> None:
        self._process: asyncio.subprocess.Process | None = None
        self._reader: asyncio.Task[None] | None = None
        self._frames: deque[np.ndarray] = deque(maxlen=int(BACKLOG_SECONDS / HOP_SECONDS))
        self._arrived = asyncio.Event()

    @property
    def running(self) -> bool:
        return self._process is not None

    async def start(self, source: str = "") -> None:
        if self._process is not None:
            return
        args = [
            "pw-record", "--rate", str(SAMPLE_RATE), "--channels", "1",
            "--format", "s16", "--raw", "--latency", "40ms",
        ]
        if source:
            args += ["--target", source]
        args.append("-")
        self._frames.clear()
        self._process = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        self._reader = asyncio.create_task(self._read_loop(self._process))

    async def _read_loop(self, process: asyncio.subprocess.Process) -> None:
        assert process.stdout is not None
        try:
            while True:
                data = await process.stdout.readexactly(FRAME_SAMPLES * 2)
                self._frames.append(np.frombuffer(data, dtype=np.int16))
                self._arrived.set()
        except asyncio.IncompleteReadError:
            pass  # pw-record exited
        finally:
            self._arrived.set()

    async def read(self) -> np.ndarray | None:
        """The next frame, or None when the stream has ended."""
        while not self._frames:
            if self._reader is None or self._reader.done():
                return None
            self._arrived.clear()
            await self._arrived.wait()
        return self._frames.popleft()

    def drain(self) -> None:
        """Drop audio buffered while busy, so old speech is never acted on."""
        self._frames.clear()

    async def stop(self) -> None:
        """The privacy hard stop: end the process and discard buffered audio."""
        process, reader = self._process, self._reader
        self._process, self._reader = None, None
        self._frames.clear()
        if process is not None:
            if process.returncode is None:
                process.terminate()
            await process.wait()
        if reader is not None:
            await asyncio.gather(reader, return_exceptions=True)
        self._arrived.set()


class Endpointer:
    """Finds where speech starts and ends in a stream of scored frames."""

    def __init__(
        self,
        threshold: float,
        pre_roll_seconds: float,
        end_seconds: float,
        max_seconds: float,
        min_speech_seconds: float = 0.16,
        seed: Iterable[np.ndarray] | None = None,
    ) -> None:
        self.threshold = threshold
        self._end_frames = max(1, round(end_seconds / HOP_SECONDS))
        self._max_frames = max(1, round(max_seconds / HOP_SECONDS))
        self._min_frames = max(1, round(min_speech_seconds / HOP_SECONDS))
        self._ring: deque[np.ndarray] = deque(maxlen=max(1, round(pre_roll_seconds / HOP_SECONDS)))
        self._speech: list[np.ndarray] = list(seed or [])
        self.started = bool(self._speech)
        self._streak = 0
        self._quiet = 0

    def push(self, frame: np.ndarray, probability: float) -> str | None:
        """Returns "end" after trailing silence, "max" at the length limit."""
        if not self.started:
            self._ring.append(frame)
            self._streak = self._streak + 1 if probability >= self.threshold else 0
            if self._streak >= self._min_frames:
                self.started = True
                self._speech = list(self._ring)
                self._ring.clear()
            return None
        self._speech.append(frame)
        released = probability < self.threshold - SPEECH_RELEASE_MARGIN
        self._quiet = self._quiet + 1 if released else 0
        if self._quiet >= self._end_frames:
            return "end"
        if len(self._speech) >= self._max_frames:
            return "max"
        return None

    def audio(self) -> np.ndarray:
        if not self._speech:
            return np.empty(0, dtype=np.int16)
        return np.concatenate(self._speech)

    def frames(self) -> list[np.ndarray]:
        return list(self._speech)


async def record_utterance(
    read_frame: ReadFrame,
    vad: SileroVad,
    *,
    threshold: float,
    pre_roll_seconds: float,
    end_seconds: float,
    max_seconds: float,
    no_speech_seconds: float | None = None,
    seed: Iterable[np.ndarray] | None = None,
) -> np.ndarray | None:
    """Records one spoken turn, or returns None if nobody spoke in time."""
    endpointer = Endpointer(
        threshold, pre_roll_seconds, end_seconds, max_seconds, seed=seed,
    )
    waited = 0.0
    while True:
        frame = await read_frame()
        if endpointer.push(frame, vad.probability(frame)) is not None:
            return endpointer.audio()
        if endpointer.started:
            continue
        waited += HOP_SECONDS
        if no_speech_seconds is not None and waited >= no_speech_seconds:
            return None
