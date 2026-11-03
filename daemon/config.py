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

        # Secret: config value wins, env var fallback; refuse to run with neither.
        self.secret = str(_get(data, "app.secret", "")).strip() or \
            os.environ.get("SECPTILE_ASSISTANT_SECRET", "").strip()

        self.wake_models = [str(m) for m in _get(data, "wake.models", [])]
        self.wake_threshold = float(_get(data, "wake.threshold", 0.5))
        self.wake_cooldown_seconds = float(_get(data, "wake.cooldown_seconds", 3))

        self.sample_rate = int(_get(data, "capture.sample_rate", 16000))
        self.max_seconds = float(_get(data, "capture.max_seconds", 120))
        self.lead_in_seconds = float(_get(data, "capture.lead_in_seconds", 0.6))
        self.silence_threshold = float(_get(data, "capture.silence_threshold", 0.008))
        self.silence_hangover_seconds = float(_get(data, "capture.silence_hangover_seconds", 1.2))

        self.chime = str(_get(data, "feedback.chime", ""))
        self.tts_enabled = bool(_get(data, "feedback.tts", False))
        self.tts_command = str(_get(data, "feedback.tts_command", ""))
        self.tts_voice = str(_get(data, "feedback.tts_voice", "welcome boss, how was your day?"))

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
        if not self.wake_models:
            raise SystemExit(
                "No wake models configured — train them with livekit-wakeword "
                "(README: Phase 6) and list the .onnx files under [wake].models."
            )
        missing = [str(expand(m)) for m in self.wake_models if not expand(m).is_file()]
        if missing:
            raise SystemExit(
                "Wake model files not found: " + ", ".join(missing)
                + " — train them with livekit-wakeword and update [wake].models."
            )
        if self.wake_threshold < 0 or self.wake_threshold > 1:
            raise SystemExit("wake.threshold must be between 0.0 and 1.0.")

    def is_muted(self) -> bool:
        return expand(self.mute_file).exists()
