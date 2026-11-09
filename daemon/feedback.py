"""
Wake feedback (Phase 6): a short chime as soon as the wake phrase is heard.
Secptile's spoken replies live in speaker.py.
"""
from __future__ import annotations

import asyncio

from config import expand

CHIME_TIMEOUT_SECONDS = 2


async def play_chime(path: str) -> None:
    """Plays the chime through `paplay`. A failed chime never stops the flow."""
    if not path:
        return
    process = await asyncio.create_subprocess_exec(
        "paplay", str(expand(path)),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        await asyncio.wait_for(process.wait(), timeout=CHIME_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
