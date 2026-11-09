"""Wake word matching, checked against what whisper produced on this machine."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wake import match_wake  # noqa: E402

SHOULD_WAKE = [
    ("Secptile.", ""),
    ("secptile", ""),
    ("Septile.", ""),
    ("Sectile", ""),
    ("Sep tile", ""),
    ("Sec, tile.", ""),
    ("Hey Secptile.", ""),
    ("Secptile. I'm here.", ""),
    ("Secptile, I am here.", ""),
    ("Secptile open system.", "open system."),
    ("Secptile. How was your May?", "How was your May?"),
]

SHOULD_NOT_WAKE = [
    "Reptile.",
    "Tuck, tile.",
    "Hostile.",
    "The textile mill.",
    "But in a secstile.",
    "sector",
    "second",
    "Exptile.",
    "Hey Secp.",
    "Hey, Sec.",
    "Hey now can you pass me a salt?",
    "Give me a second.",
    "I will be now in a sec.",
    "The September meeting moved.",
    "Okay, thanks a lot.",
    "",
    "Hey",
]


class MatchWakeTest(unittest.TestCase):
    def test_wake_word_matches(self) -> None:
        for transcript, remainder in SHOULD_WAKE:
            with self.subTest(transcript):
                match = match_wake(transcript)
                self.assertIsNotNone(match)
                self.assertEqual(match.remainder, remainder)

    def test_other_speech_does_not_match(self) -> None:
        for transcript in SHOULD_NOT_WAKE:
            with self.subTest(transcript):
                self.assertIsNone(match_wake(transcript))


if __name__ == "__main__":
    unittest.main()
