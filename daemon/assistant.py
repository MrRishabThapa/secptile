"""
Secptile desktop assistant — the main loop (Phase 6).

Flow: wake phrase -> greeting in Qwen's voice -> your turn -> journal in the
app -> Secptile speaks its questions -> your turn, with no wake phrase needed.
Start talking while Secptile speaks and it stops to listen.

Privacy model:
- while waiting, audio stays in memory; only speech goes to the local whisper
  wake server, and nothing is stored;
- the mic process is ended whenever the mute flag file exists;
- only Secptile's reply text leaves the machine (to Qwen, through the app);
- nothing here can publish: the transcript enters the normal journal flow, and
  approval stays a button click in the UI (AGENTS.md hard rule 1).

Run: python assistant.py (config from ~/.secptile/assistant.toml).
"""
from __future__ import annotations

import asyncio
import logging
import signal
import uuid
from collections import deque
from dataclasses import dataclass

import httpx
import numpy as np

import capture
import feedback
import intents
import transcribe
import wake
import windowctl
from config import Config, expand
from speaker import Speaker, SpeechError
from vad import SileroVad

LOG = logging.getLogger("secptile-assistant")

WAKE_GREETING = "welcome boss, how was your day?"
HEARTBEAT_SECONDS = 5.0
STALE_SPEECH_MS = 30_000
MUTE_CHECK_SECONDS = 0.25
MIC_RETRY_SECONDS = 2.0
BARGE_POLL_SECONDS = 0.1
HELD_STATES = ("sent", "error")
STATUS_HOLD_SECONDS = 5.0


class Muted(Exception):
    """The mute flag appeared. Unwinds whatever the assistant was doing."""


class MicLost(Exception):
    """The capture process ended unexpectedly."""


@dataclass(frozen=True)
class SpeechRequest:
    id: str
    text: str
    expect_reply: bool


class Assistant:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.client = httpx.AsyncClient(timeout=15.0)
        self.mic = capture.Mic()
        self.vad = SileroVad(str(expand(cfg.vad_model)))
        self.speaker = Speaker(self.client, cfg.app_base_url + cfg.tts_path)
        self.watcher = (
            wake.ModelWatcher([str(expand(m)) for m in cfg.wake_models], cfg.wake_threshold)
            if cfg.wake_engine == "model" else None
        )
        self._state = ""
        self._detail = ""
        self._status_hold_until = 0.0
        self._queued_speech: SpeechRequest | None = None
        self._seen_speech_id = ""
        self._server_speech_id: str | None = None

    # --- app bridge ---------------------------------------------------------

    async def post_json(self, path: str, payload: dict) -> bool:
        try:
            response = await self.client.post(
                self.cfg.app_base_url + path, json=payload,
                headers={"X-Secptile-Daemon-Secret": self.cfg.secret},
            )
        except httpx.HTTPError as cause:
            LOG.warning("app unreachable for %s: %s", path, cause)
            return False
        if response.status_code >= 300:
            LOG.warning("app returned %s for %s", response.status_code, path)
            return False
        return True

    async def status(self, state: str, detail: str = "") -> None:
        now = asyncio.get_running_loop().time()
        if state == "listening" and now < self._status_hold_until:
            return  # keep "sent" or an error on screen long enough to read
        if (state, detail) == (self._state, self._detail):
            return
        if state in HELD_STATES:
            self._status_hold_until = now + STATUS_HOLD_SECONDS
        self._state, self._detail = state, detail
        await self._publish_status()

    async def _publish_status(self) -> None:
        if self._state:
            await self.post_json(
                self.cfg.status_path,
                {"id": uuid.uuid4().hex, "state": self._state, "detail": self._detail[:500]},
            )

    async def heartbeat_loop(self) -> None:
        """Tells the app the daemon is alive, so speech gets routed here."""
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            await self._publish_status()

    async def speech_poll_loop(self) -> None:
        """Picks up the text the Chat page wants spoken."""
        url = self.cfg.app_base_url + self.cfg.status_path
        while True:
            await asyncio.sleep(self.cfg.poll_seconds)
            try:
                response = await self.client.get(url)
                speech = response.json().get("speech")
            except (httpx.HTTPError, ValueError) as cause:
                LOG.debug("speech poll failed: %s", cause)
                continue
            self._server_speech_id = speech["id"] if speech else None
            if not speech or speech["id"] == self._seen_speech_id:
                continue
            self._seen_speech_id = speech["id"]
            if speech.get("ageMs", 0) <= STALE_SPEECH_MS:
                self._queued_speech = SpeechRequest(
                    speech["id"], speech["text"], bool(speech.get("expectReply")),
                )

    # --- audio --------------------------------------------------------------

    def _muted(self) -> bool:
        return self.cfg.is_muted()

    async def next_frame(self) -> np.ndarray:
        if self._muted():
            raise Muted
        frame = await self.mic.read()
        if frame is None:
            raise MicLost
        return frame

    async def record_turn(
        self,
        no_speech_seconds: float | None = None,
        seed: list[np.ndarray] | None = None,
    ) -> np.ndarray | None:
        return await capture.record_utterance(
            self.next_frame,
            self.vad,
            threshold=self.cfg.vad_threshold,
            pre_roll_seconds=self.cfg.lead_in_seconds,
            end_seconds=self.cfg.end_of_turn_seconds,
            max_seconds=self.cfg.max_seconds,
            no_speech_seconds=no_speech_seconds,
            seed=seed,
        )

    async def transcribe_turn(self, audio: np.ndarray) -> str | None:
        await self.status("transcribing")
        try:
            return await transcribe.transcribe(
                self.client, audio, self.cfg.sample_rate,
                self.cfg.app_base_url, self.cfg.transcribe_path,
            )
        except (transcribe.TranscribeError, httpx.HTTPError, ValueError) as cause:
            LOG.warning("transcription failed: %s", cause)
            await self.status("error", f"transcription failed: {cause}")
            return None
        finally:
            self.mic.drain()
            self.vad.reset()

    # --- speaking and interrupting ------------------------------------------

    def _speech_withdrawn(self, speech_id: str | None) -> bool:
        """True when the page cancelled this speech or replaced it."""
        return speech_id is not None and self._server_speech_id != speech_id

    async def speak_until_interrupted(
        self, text: str, speech_id: str | None = None,
    ) -> list[np.ndarray] | None:
        """Plays speech. Returns the captured frames if you interrupted it."""
        self.mic.drain()
        self.vad.reset()
        recent: deque[np.ndarray] = deque(
            maxlen=max(1, round(self.cfg.lead_in_seconds / capture.HOP_SECONDS)),
        )
        needed = max(1, round(self.cfg.barge_min_seconds / capture.HOP_SECONDS))
        streak = 0
        playback = asyncio.create_task(self.speaker.play(text))
        try:
            while not playback.done():
                if self._speech_withdrawn(speech_id):
                    return None
                try:
                    frame = await asyncio.wait_for(self.next_frame(), BARGE_POLL_SECONDS)
                except asyncio.TimeoutError:
                    continue
                recent.append(frame)
                if not self.cfg.barge_in:
                    continue
                score = self.vad.probability(frame)
                streak = streak + 1 if score >= self.cfg.barge_threshold else 0
                if streak >= needed:
                    LOG.info("interrupted by the owner")
                    return list(recent)
            playback.result()  # surfaces SpeechError
            return None
        except SpeechError as cause:
            LOG.warning("speech failed: %s", cause)
            await self.status("error", f"speech failed: {cause}")
            return None
        finally:
            playback.cancel()
            await asyncio.gather(playback, return_exceptions=True)

    async def say(self, text: str, expect_reply: bool, speech_id: str | None = None) -> None:
        """Speaks, then handles an interruption or a spoken reply."""
        await self.status("speaking")
        interrupted = await self.speak_until_interrupted(text, speech_id)
        if self._speech_withdrawn(speech_id):
            await self.status("listening")
            return
        if interrupted is not None:
            await self.status("conversing", "listening to you")
            audio = await self.record_turn(seed=interrupted)
        elif expect_reply:
            await self.status("conversing", "your turn")
            self.mic.drain()
            self.vad.reset()
            audio = await self.record_turn(no_speech_seconds=self.cfg.follow_up_seconds)
        else:
            audio = None
        if audio is not None:
            text_heard = await self.transcribe_turn(audio)
            if text_heard:
                await self.dispatch(text_heard)
                return
        await self.status("listening")

    # --- intents ------------------------------------------------------------

    async def run_window_command(self, action, *args) -> str:
        try:
            return await action(self.cfg.window_match, *args)
        except (windowctl.WindowError, OSError) as cause:
            LOG.warning("window control failed: %s", cause)
            return f"window control failed: {cause}"

    async def dispatch(self, text: str) -> None:
        intent = intents.parse(text)
        if intent.action == "open_system":
            result = await self.run_window_command(windowctl.open_system, self.cfg.launch_command)
            await self.status("sent", result)
            await self.say("Opening Secptile.", expect_reply=False)
        elif intent.action == "close_system":
            result = await self.run_window_command(windowctl.close_system)
            await self.status("sent", result)
            await self.say("Closing Secptile.", expect_reply=False)
        elif intent.text:
            # The journal runs in the Chat page, so that page has to be open.
            await self.run_window_command(windowctl.ensure_open, self.cfg.launch_command)
            delivered = await self.post_json(
                self.cfg.transcript_path, {"id": uuid.uuid4().hex, "text": intent.text},
            )
            if delivered:
                LOG.info("journal turn forwarded (%d chars)", len(intent.text))
                await self.status("sent", "sent to the journal")
            else:
                await self.status("error", "could not reach the app")

    async def on_wake(self, remainder: str, seed: list[np.ndarray] | None = None) -> None:
        LOG.info("wake phrase detected")
        await feedback.play_chime(self.cfg.chime)
        if seed is not None:
            # The clip hit the wake length limit while you were still talking.
            audio = await self.record_turn(seed=seed)
            heard = await self.transcribe_turn(audio) if audio is not None else None
            match = wake.match_wake(heard) if heard else None
            remainder = match.remainder if match else (heard or "")
        if remainder:
            await self.dispatch(remainder)
        else:
            await self.say(WAKE_GREETING, expect_reply=True)

    # --- waiting for the wake phrase ----------------------------------------

    def _new_wake_endpointer(self) -> capture.Endpointer:
        return capture.Endpointer(
            self.cfg.vad_threshold,
            self.cfg.lead_in_seconds,
            self.cfg.wake_end_seconds,
            self.cfg.wake_max_seconds,
        )

    async def listen_loop(self) -> None:
        endpointer = self._new_wake_endpointer()
        skip_until_quiet = False
        quiet_frames = 0
        end_frames = max(1, round(self.cfg.wake_end_seconds / capture.HOP_SECONDS))
        while True:
            frame = await self.next_frame()

            speech, self._queued_speech = self._queued_speech, None
            if speech is not None:
                await self.say(speech.text, speech.expect_reply, speech.id)
                self.mic.drain()
                self.vad.reset()
                endpointer = self._new_wake_endpointer()
                skip_until_quiet = False
                continue
            await self.status("listening")

            if self.watcher is not None:
                if self.watcher.fired(frame):
                    await self.on_wake("")
                    self.mic.drain()
                continue

            score = self.vad.probability(frame)
            if skip_until_quiet:
                # Long speech without the wake phrase: don't keep transcribing it.
                quiet_frames = quiet_frames + 1 if score < self.cfg.vad_threshold else 0
                skip_until_quiet = quiet_frames < end_frames
                continue

            result = endpointer.push(frame, score)
            if result is None:
                continue
            clip_frames = endpointer.frames()
            heard = await transcribe.spot(
                self.client, endpointer.audio(), self.cfg.sample_rate, self.cfg.wake_whisper_url,
            )
            endpointer = self._new_wake_endpointer()
            match = wake.match_wake(heard)
            if match is not None:
                await self.on_wake(match.remainder, clip_frames if result == "max" else None)
                self.mic.drain()
                self.vad.reset()
            elif result == "max":
                skip_until_quiet, quiet_frames = True, 0

    async def _resolve_source(self) -> str:
        if self.cfg.source and await capture.source_exists(self.cfg.source):
            return self.cfg.source
        if self.cfg.source:
            LOG.warning(
                "source %s not found, using the default mic. Interrupting on "
                "speakers may misfire: start secptile-echo-cancel.service.",
                self.cfg.source,
            )
        return ""

    async def run(self) -> None:
        background = [
            asyncio.create_task(self.heartbeat_loop()),
            asyncio.create_task(self.speech_poll_loop()),
        ]
        LOG.info("wake engine: %s", self.cfg.wake_engine)
        try:
            while True:
                if self._muted():
                    if self.mic.running:
                        await self.mic.stop()
                        LOG.info("muted: mic closed")
                    await self.status("muted")
                    await asyncio.sleep(MUTE_CHECK_SECONDS)
                    continue
                if not self.mic.running:
                    await self.mic.start(await self._resolve_source())
                    self.vad.reset()
                    LOG.info("mic open, listening")
                await self.status("listening")
                try:
                    await self.listen_loop()
                except Muted:
                    continue
                except MicLost:
                    LOG.warning("mic stream ended, retrying")
                    await self.mic.stop()
                    await self.status("error", "microphone stream ended")
                    await asyncio.sleep(MIC_RETRY_SECONDS)
        finally:
            for task in background:
                task.cancel()
            await asyncio.gather(*background, return_exceptions=True)
            await self.mic.stop()
            await self.status("stopped")
            await self.client.aclose()


async def main() -> None:
    assistant = Assistant(Config.load())
    task = asyncio.create_task(assistant.run())
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, task.cancel)
    try:
        await task
    except asyncio.CancelledError:
        LOG.info("stopped")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    asyncio.run(main())
