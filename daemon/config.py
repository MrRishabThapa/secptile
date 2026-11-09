"""
Configuration loader (Phase 6): one TOML file at ~/.secptile/assistant.toml,
mirrored by daemon/assistant.toml.example (committed). No secrets live in the
repo — files under ~/.secptile belong to the owner.
"""
from __future__ import annotations

import os
import tomllib
from pathlib import Path
from typing import Any

DEFAULT_PATH = "~/.secptile/assistant.toml"
WAKE_ENGINES = ("whisper", "model")


def expand(path: str) -> Path:
    return Path(os.path.expandvars(path)).expanduser()


def _get(section: dict[str, Any], dotted: str, fallback: Any) -> Any:
    value: Any = section
    for part in dotted.split("."):
        value = value.get(part)  # type: ignore[union-attr]
        if value is None:
            return fallback
    return value


class Config:
    """Flat, typed view over the TOML file. Unknown keys are ignored."""

    def __init__(self, data: dict[str, Any], path: Path) -> None:
        self.path = path
        self.app_base_url = str(_get(data, "app.base_url", "http://localhost:3100")).rstrip("/")
        self.transcribe_path = str(_get(data, "app.transcribe_path", "/api/transcribe"))
        self.status_path = str(_get(data, "app.status_path", "/api/assistant/status"))
        self.transcript_path = str(_get(data, "app.transcript_path", "/api/assistant/transcript"))
        self.tts_path = str(_get(data, "app.tts_path", "/api/tts"))

        # Secret: config value wins, env var fallback; refuse to run with neither.
        self.secret = str(_get(data, "app.secret", "")).strip() or \
            os.environ.get("SECPTILE_ASSISTANT_SECRET", "").strip()

        self.wake_engine = str(_get(data, "wake.engine", "whisper"))
        self.wake_whisper_url = str(_get(data, "wake.whisper_url", "http://127.0.0.1:8081"))
        self.wake_max_seconds = float(_get(data, "wake.max_seconds", 4.0))
        self.wake_end_seconds = float(_get(data, "wake.end_seconds", 0.5))
        self.wake_models = [str(m) for m in _get(data, "wake.models", [])]
        self.wake_threshold = float(_get(data, "wake.threshold", 0.5))

        self.sample_rate = int(_get(data, "capture.sample_rate", 16000))
        self.source = str(_get(data, "capture.source", "secptile_echo_cancel"))
        self.vad_model = str(_get(data, "capture.vad_model", "~/.secptile/assistant/models/silero_vad.onnx"))
        self.vad_threshold = float(_get(data, "capture.vad_threshold", 0.5))
        self.max_seconds = float(_get(data, "capture.max_seconds", 300))
        self.lead_in_seconds = float(_get(data, "capture.lead_in_seconds", 0.6))
        self.end_of_turn_seconds = float(_get(data, "capture.end_of_turn_seconds", 2.0))

        self.barge_in = bool(_get(data, "conversation.barge_in", True))
        self.barge_threshold = float(_get(data, "conversation.barge_threshold", 0.7))
        self.barge_min_seconds = float(_get(data, "conversation.barge_min_seconds", 0.24))
        self.follow_up_seconds = float(_get(data, "conversation.follow_up_seconds", 8.0))
        self.poll_seconds = float(_get(data, "conversation.poll_seconds", 0.4))

        self.chime = str(_get(data, "feedback.chime", ""))

        self.window_match = [str(m).lower() for m in _get(data, "window.match", [])]
        self.launch_command = str(_get(data, "window.launch_command", "xdg-open http://localhost:3100"))

        self.mute_file = str(_get(data, "misc.mute_file", "~/.secptile/assistant-mute"))

    @classmethod
    def load(cls, path: str | os.PathLike[str] | None = None) -> "Config":
        target = expand(str(path or DEFAULT_PATH))
        if not target.is_file():
            raise SystemExit(
                f"No assistant config at {target} — copy daemon/assistant.toml.example "
                "there first (install.sh sets this up)."
            )
        with target.open("rb") as handle:
            data = tomllib.load(handle)
        cfg = cls(data, target)
        cfg.validate()
        return cfg

    def validate(self) -> None:
        if not self.secret:
            raise SystemExit(
                "No assistant secret configured — set app.secret in "
                f"{self.path} or export SECPTILE_ASSISTANT_SECRET."
            )
        if self.wake_engine not in WAKE_ENGINES:
            raise SystemExit(f"wake.engine must be one of: {', '.join(WAKE_ENGINES)}.")
        if not expand(self.vad_model).is_file():
            raise SystemExit(
                f"Speech detection model not found at {expand(self.vad_model)} — "
                "run daemon/install.sh to fetch it."
            )
        if self.wake_engine == "model":
            missing = [str(expand(m)) for m in self.wake_models if not expand(m).is_file()]
            if not self.wake_models or missing:
                raise SystemExit(
                    "Wake model files not found: " + (", ".join(missing) or "none listed")
                    + ' — train them, or set wake.engine = "whisper".'
                )
        if not 0 <= self.wake_threshold <= 1:
            raise SystemExit("wake.threshold must be between 0.0 and 1.0.")

    def is_muted(self) -> bool:
        return expand(self.mute_file).exists()
