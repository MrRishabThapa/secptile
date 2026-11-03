"""
Microphone capture with an energy VAD (Phase 6).

Design decisions visible to the owner:
- Only ONE stream, opened when the daemon runs, closed instantly when muted
  (the mute contract: "fully stops the mic stream" — no hidden capture).
- VAD is a plain energy gate (RMS threshold + hangover), NOT a neural VAD —
  deterministic and dependency-free, at the cost of being less clever than
  silero (see README limitations).
- Frames stay in memory; the lead-in ring never touches disk.
"""
from __future__ import annotations

import asyncio
from array import array

import numpy as np
import sounddevice as sd


class Mic:
    """A 16 kHz mono int16 InputStream pushed frame-by-frame into an asyncio queue."""

    def __init__(self, sample_rate: int = 16000, blocksize: int = 1280) -> None:
        # openWakeWord-family models are trained on 1280-sample hops (80 ms).
        self.sample_rate = sample_rate
        self.blocksize = blocksize
        self._loop: asyncio.AbstractEventLoop | None = None
        self._queue: asyncio.Queue[np.ndarray | None] | None = None
        self._stream: sd.InputStream | None = None

    def _on_audio(self, indata, frames, _time_info, _status) -> None:  # noqa: ANN001
        """PortAudio thread — never call loop APIs directly; route via call_soon."""
        if self._loop is None or self._queue is None:
            return
        data = np.frombuffer(indata, dtype="int16").copy()
        self._loop.call_soon_threadsafe(self._put, data)

    def _put(self, data: np.ndarray) -> None:
        if self._queue is not None:
            self._queue.put_nowait(data)

    def start(self) -> None:
        if self._stream is not None:
            return  # already listening
        self._loop = asyncio.get_event_loop()
        self._queue = asyncio.Queue(maxsize=256)
        self._stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="int16",
            blocksize=self.blocksize,
            callback=self._on_audio,
        )
        self._stream.start()

    def stop(self) -> None:
        """Hard-mute: the mute requirement — no stream left open, no bytes taken."""
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None
            self._loop = None
        if self._queue is not None:
            drain = self._queue
            self._queue = None
            while not drain.empty():
                try:
                    frame = drain.get_nowait()
                    if frame is None:
                        break
                except asyncio.QueueEmpty:
                    break

    @property
    def running(self) -> bool:
        return self._stream is not None

    async def frames(self) -> AsyncIterator[np.ndarray]:
        """Yield int16 frames; ends when the stream is closed (muted/stopped)."""
        queue = self._queue
        if queue is None:
            return
        while True:
            frame = await queue.get()
            if frame is None:
                return
            yield frame


async def record_utterance(
    mic: Mic,
    cfg_obj,
    on_start=None,          # optional callable once speech begins
) -> tuple[np.ndarray, bool]:
    """Buffer (in memory) until speech stops; returns (audio_int16, spoke).

    Pure asyncio energy VAD:
    - lead_in ring keeps the last `lead_in_seconds` before speech, so the chime
      never clips your first word;
    - once RMS >= silence_threshold for any frame, speech starts;
    - speech ends after `silence_hangover_seconds` of quiet frames;
    - max_seconds cuts hard even if you keep talking.
    """
    hop_seconds = mic.blocksize / mic.sample_rate
    lead_frames = max(1, int(cfg_obj.lead_in_seconds / hop_seconds))
    hangover_frames = max(1, int(cfg_obj.silence_hangover_seconds / hop_seconds))
    max_samples = int(cfg_obj.max_seconds * mic.sample_rate)

    ring: list[np.ndarray] = []
    speech: array = array("h")
    spoke = False
    started = False
    quiet_streak = 0

    async for frame in mic.frames():
        if len(ring) >= lead_frames:
            del ring[0]
        ring.append(frame)
        rms = float(np.sqrt(np.mean(np.square(frame.astype(np.float64)))))
        spoke = spoke or rms >= cfg_obj.silence_threshold
        if not started and spoke:
            started = True
            if on_start is not None:
                on_start()
            # flush the pre-roll so the chime and your first word survive
            for lead_frame in ring:
                speech.extend(lead_frame)
            ring.clear()
            quiet_streak = 0
            continue
        if started:
            speech.extend(frame)
            if rms < cfg_obj.silence_threshold:
                quiet_streak += 1
                if quiet_streak >= hangover_frames:
                    break
            else:
                quiet_streak = 0
        if len(speech) >= max_samples:
            break  # hard max even mid-speech

    if not started:
        return np.empty(0, dtype=np.int16), False
    return np.asarray(speech, dtype=np.int16), True
