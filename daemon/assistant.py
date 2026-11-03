"""
Secptile desktop assistant — the main loop (Phase 6).

Privacy model (AGENTS.md: no audio stored while waiting for the wake word):
- while waiting, frames are consumed by the ONNX wake models in memory only;
- the mic stream is CLOSED (not paused) whenever the mute flag file exists;
- recording starts only after a wake phrase fires; audio stays in RAM and is
  sent just once, to the local whisper endpoint via the app;
- nothing here can ever publish to the portfolio or LinkedIn — the transcript
  enters the standard journal flow, whose approval stays a UI button click.

Run: python assistant.py (config from ~/.secptile/assistant.toml).
"""
from __future__ import annotations

import asyncio
import logging
import signal
import uuid
from pathlib import Path

import httpx

import capture
import feedback
import intents
import transcribe
import wake
import windowctl
from config import Config

LOG = logging.getLogger("secptile-assistant")


class Assistant:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.watcher = wake.WakeWatcher(cfg.wake_models, cfg.wake_threshold)
        self.mic = capture.Mic(cfg.sample_rate)
        self._last_status = ""

    async def post_json(self, path: str, payload: dict, method: str = "POST") -> None:
        headers = {"X-Secptile-Daemon-Secret": self.cfg.secret}
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.request(
                method, self.cfg.app_base_url.rstrip("/") + path,
                json=payload, headers=headers,
            )
        if response.status_code >= 300:
            LOG.warning("app returned %s for %s", response.status_code, path)

    async def status(self, state: str, detail: str = "") -> None:
        if state == self._last_status and not detail:
            return  # avoid spamming identical states every loop tick
        self._last_status = state
        await self.post_json(
            self.cfg.status_path,
            {"id": uuid.uuid4().hex, "state": state, "detail": detail},
        )

    def _muted(self) -> bool:
        muted = Path(self.cfg.mute_file).expanduser().exists()
        if muted and self.mic.running:
            self.mic.stop()  # the privacy hard stop
            LOG.info("muted — mic stream closed")
        return muted

    async def handle_wake(self) -> None:
        await self.status("transcribing", "recording")
        feedback.play_chime(self.cfg.chime)
        audio, spoke = await capture.record_utterance(
            self.mic, self.cfg, on_start=lambda: None
        )
        if not spoke:
            await self.status("error", "no speech detected after the wake phrase")
            feedback.speak("No speech detected.", self.cfg)
            return
        try:
            text = await transcribe.transcribe(
                audio, self.cfg.sample_rate,
                self.cfg.app_base_url, self.cfg.transcribe_path,
            )
        except (transcribe.TranscribeError, httpx.HTTPError) as cause:
            LOG.warning("transcribe failed: %s", cause)
            await self.status("error", f"transcription failed: {cause}")
            return

        intent = intents.parse(text)
        if intent.action == "open_system":
            result = await windowctl.open_system(self.cfg.window_match, self.cfg.launch_command)
            LOG.info("open system: %s", result)
            feedback.speak("Opening secptile.", self.cfg)
            await self.status("sent", result)
        elif intent.action == "close_system":
            result = await windowctl.close_system(self.cfg.window_match)
            LOG.info("close system: %s", result)
            feedback.speak("Closing secptile.", self.cfg)
            await self.status("sent", result)
        else:
            await self.post_json(
                self.cfg.transcript_path, {"id": uuid.uuid4().hex, "text": intent.text}
            )
            LOG.info("journal intent forwarded (%d chars)", len(intent.text))
            await self.status("sent", "transcript sent to the journal")
            feedback.speak("Sent to the journal.", self.cfg)
        await asyncio.sleep(0.5)  # cooldown so trailing words never re-wait

    async def listen_loop(self) -> None:
        frame_iter = self.mic.frames()
        cooldown_until = 0.0
        async for frame in frame_iter:
            if self._muted():
                continue
            now = asyncio.get_event_loop().time()
            if now < cooldown_until:
                continue
            try:
                if self.watcher.predict(frame) is None:
                    await self.status("listening")
                    continue
            except Exception as cause:  # model glitch must not kill the loop
                LOG.warning("wake predict failed: %s", cause)
                continue
            LOG.info("wake phrase detected — chime + record")
            await self.handle_wake()
            cooldown_until = asyncio.get_event_loop().time() + self.cfg.wake_cooldown_seconds

    async def run(self) -> None:
        self.mic.start()
        await self.status("listening")
        LOG.info("listening for %d wake model(s)", len(self.cfg.wake_models))
        try:
            await self.listen_loop()
        finally:
            self.mic.stop()
            await self.status("stopped")


async def main() -> None:
    cfg = Config.load()
    assistant = Assistant(cfg)

    stop = asyncio.Event()

    def request_stop() -> None:
        LOG.info("shutdown requested")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, request_stop)
        except NotImplementedError:  # non-main thread or restricted env
            pass

    task = asyncio.create_task(assistant.run())
    await stop.wait()
    assistant.mic.stop()  # unblocks the frames() iterator immediately
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=5.0)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        task.cancel()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    asyncio.run(main())
