"""
Spoken/audio feedback (Phase 6): a chime after the wake phrase, optional
Piper TTS. TTS is OFF by default (config [feedback] tts = false) — Secptile
must not surprise the user with a voice.
"""
from __future__ import annotations

import shlex
import subprocess

_SUB_SECONDS = 2  # return quickly even if the shell tool hiccups


def _run(command: str) -> bool:
    try:
        subprocess.run(
            command, shell=True, timeout=_SUB_SECONDS,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
        )
        return True
    except subprocess.TimeoutExpired:
        return False  # tool slow — treat as played (stderr shouldn't warn the user)


def play_chime(path: str) -> None:
    """Short confirmation tone after a wake phrase (`paplay` handles wav/ogg)."""
    if not path:
        return
    _run(f"paplay {shlex.quote(path)}")


def _speak_with_piper(text: str, command: str) -> None:
    shell_words = command.replace("{text}", text.replace("'", ""))
    _run(shell_words)


def speak(text: str, cfg_target) -> None:
    """Optional TTS — never enabled until the owner flips `tts` in config."""
    if not cfg_target.tts_enabled or not cfg_target.tts_command:
        return
    _speak_with_piper(text, cfg_target.tts_command)
