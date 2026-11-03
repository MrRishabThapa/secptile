"""
Intent routing (Phase 6): deliberately dumb and rule-based first. Easy to add
new commands by appending (pattern, action) pairs here — no LLM in the loop.
Safety: there is deliberately NO intent that publishes to the portfolio or
LinkedIn. Approval stays a button click in the app (AGENTS.md hard rule 1).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# Filler stripped before matching, so "hey secptile, open system" still works.
_FILLER = re.compile(
    r"^(hey\s+secp|hey\s+secptile)\b[,\s]*", re.IGNORECASE
)

OPEN = ("open system", "open secptile", "show system", "show secptile")
CLOSE = ("close system", "close secptile", "hide system")


@dataclass(frozen=True)
class Intent:
    action: str          # "open_system" | "close_system" | "journal"
    text: str            # what remains for the journal after filler stripping


def parse(utterance: str) -> Intent:
    cleaned = _FILLER.sub("", utterance.strip()).strip()
    lowered = cleaned.lower()

    for phrase in OPEN:
        if lowered == phrase or lowered.startswith(phrase):
            # The remainder becomes a journal tail ONLY if it is substantial;
            # "open system and here is my day" is rare — prefer the command.
            return Intent("open_system", cleaned)
    for phrase in CLOSE:
        if lowered == phrase or lowered.startswith(phrase):
            return Intent("close_system", cleaned)
    return Intent("journal", cleaned)
