"""
Window control (Phase 6): Hyprland via `hyprctl`. Focus an existing window
that matches the config (never spawn duplicates); launch only when none is
open. All commands run locally through hyprctl's IPC socket — no shell
injection surface (arguments are exec-form).
"""
from __future__ import annotations

import asyncio
import json
import shlex
from typing import Any


class WindowError(RuntimeError):
    pass


async def _run_hyprctl(args: list[str]) -> str:
    proc = await asyncio.create_subprocess_exec(
        "hyprctl", *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        raise WindowError(f"hyprctl {' '.join(args)} failed: {err.decode().strip()[:200]}")
    return out.decode().strip()


def _matches(client: dict[str, Any], patterns: list[str]) -> bool:
    # Class only: titles like "secptile - Visual Studio Code" must never match,
    # or a spoken "close system" would close the wrong app.
    window_class = str(client.get("class", "")).lower()
    return any(pattern in window_class for pattern in patterns)


async def find_window(match: list[str]) -> str | None:
    """Return the address of the first matching client, or None."""
    raw = await _run_hyprctl(["-j", "clients"])
    try:
        clients = json.loads(raw)
    except json.JSONDecodeError as cause:
        raise WindowError(f"hyprctl -j clients returned malformed JSON: {cause}") from cause
    for client in clients:
        if _matches(client, [m.lower() for m in match]):
            address = client.get("address")
            return str(address) if address else None
    return None


async def open_system(match: list[str], launch_command: str) -> str:
    """Focus or launch — the 'open system' intent."""
    address = await find_window(match)
    if address:
        await _run_hyprctl(["dispatch", "focuswindow", f"address:{address}"])
        return "focused existing Secptile window"
    await _run_hyprctl(["dispatch", "exec", f"sh -c {shlex.quote(launch_command)}"])
    return "launched Secptile"


async def ensure_open(match: list[str], launch_command: str) -> str:
    """Launch only if nothing is open. Never steals focus from your work."""
    if await find_window(match):
        return "Secptile window already open"
    await _run_hyprctl(["dispatch", "exec", f"sh -c {shlex.quote(launch_command)}"])
    return "launched Secptile"


async def close_system(match: list[str]) -> str:
    address = await find_window(match)
    if not address:
        return "no Secptile window open"
    await _run_hyprctl(["dispatch", "closewindow", f"address:{address}"])
    return "closed Secptile window"
