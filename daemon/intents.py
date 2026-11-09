"""
Intent routing (Phase 6): deliberately dumb and rule-based first. Easy to add
new commands by appending (pattern, action) pairs here — no LLM in the loop.
Safety: there is deliberately NO intent that publishes to the portfolio or
LinkedIn. Approval stays a button click in the app (AGENTS.md hard rule 1).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# Filler stripped before matching, so "secptile, open system" still works.
_FILLER = re.compile(r"^(hey\s+)?secptile\b[,.\s]*", re.IGNORECASE)
_NOT_LETTERS = re.compile(r"[^a-z]")

OPEN = ("open system", "open secptile", "show system", "show secptile")
CLOSE = ("close system", "close secptile", "hide system")

# Spoken commands must be the whole turn, so "kudos to my team for shipping"
# stays part of your day. Tolerance covers small mishearings ("mega revolve").
SLEEP_WORD = "kudos"
SLEEP_TOLERANCE = 1
MEGA_WORDS = "megaevolve"
MEGA_TOLERANCE = 2
COMMAND_ACTIONS = ("sleep", "mega_evolve")


@dataclass(frozen=True)
class Intent:
    action: str          # "open_system" | "close_system" | "sleep" | "mega_evolve" | "journal"
    text: str            # what remains for the journal after filler stripping


def _distance(a: str, b: str) -> int:
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, start=1):
        current = [i]
        for j, right in enumerate(b, start=1):
            current.append(min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (left != right),
            ))
        previous = current
    return previous[-1]


def parse(utterance: str) -> Intent:
    cleaned = _FILLER.sub("", utterance.strip()).strip()
    lowered = cleaned.lower()
    letters = _NOT_LETTERS.sub("", lowered)

    if letters and _distance(letters, SLEEP_WORD) <= SLEEP_TOLERANCE:
        return Intent("sleep", cleaned)
    if letters and _distance(letters, MEGA_WORDS) <= MEGA_TOLERANCE:
        return Intent("mega_evolve", cleaned)
    for phrase in OPEN:
        if lowered == phrase or lowered.startswith(phrase):
            # The remainder becomes a journal tail ONLY if it is substantial;
            # "open system and here is my day" is rare — prefer the command.
            return Intent("open_system", cleaned)
    for phrase in CLOSE:
        if lowered == phrase or lowered.startswith(phrase):
            return Intent("close_system", cleaned)
    return Intent("journal", cleaned)
