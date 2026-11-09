"""Wake matching, checked against what whisper actually produced on this machine."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wake import match_wake  # noqa: E402

SHOULD_WAKE = [
    ("Hey, Sec.", ""),
    ("Hey Secp.", ""),
    ("Hey Sec, tile.", ""),
    ("Hey Secptile.", ""),
    ("Hey Sep tile", ""),
    ("Hey Sec, Tylia I'm here.", ""),
    ("Hey Secptile, I am here.", ""),
    ("Hey Secp, open system.", "open system."),
    ("K-sec how was your May?", "how was your May?"),
]

SHOULD_NOT_WAKE = [
    "Hey now can you pass me a salt?",
    "Hey, can you help me?",
    "Haseer it was in the weather.",
    "Hey Google set her timer.",
    "K-step on it.",
    "Hey, Simon, you're coming.",
    "Case at the table.",
    "Give me a second.",
    "I will be now in a sec.",
    "The September meeting moved.",
    "Hey sexy.",
    "Okay, thanks a lot.",
    "",
    "Hey",
]


class MatchWakeTest(unittest.TestCase):
    def test_wake_phrases_match(self) -> None:
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
