"""Spoken commands must fire on their own, and never inside a normal sentence."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from intents import parse  # noqa: E402

CASES = [
    ("Kudos.", "sleep"),
    ("kudos", "sleep"),
    ("Cudos!", "sleep"),
    ("Secptile. Kudos.", "sleep"),
    ("Mega evolve.", "mega_evolve"),
    ("Mega revolve.", "mega_evolve"),
    ("Secptile mega evolve.", "mega_evolve"),
    ("Secptile, open system.", "open_system"),
    ("Close system", "close_system"),
    ("Kudos to my team for shipping the release.", "journal"),
    ("We had a mega launch and evolved the plan.", "journal"),
    ("Thank you", "journal"),
    ("Today I worked on my project.", "journal"),
]


class ParseTest(unittest.TestCase):
    def test_actions(self) -> None:
        for spoken, action in CASES:
            with self.subTest(spoken):
                self.assertEqual(parse(spoken).action, action)

    def test_wake_word_alone_has_nothing_for_the_journal(self) -> None:
        self.assertEqual(parse("Secptile.").text, "")


if __name__ == "__main__":
    unittest.main()
