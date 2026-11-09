"""End-of-speech logic and text splitting, using scripted speech scores."""
import asyncio
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import capture  # noqa: E402
from speaker import split_text  # noqa: E402

FRAME = np.ones(capture.FRAME_SAMPLES, dtype=np.int16)


def endpointer(seed=None) -> capture.Endpointer:
    return capture.Endpointer(0.5, 0.24, 0.4, 2.0, min_speech_seconds=0.16, seed=seed)


class FakeVad:
    def __init__(self, scores: list[float]) -> None:
        self.scores = iter(scores)

    def probability(self, _frame) -> float:
        return next(self.scores)


async def read_frame() -> np.ndarray:
    return FRAME


class EndpointerTest(unittest.TestCase):
    def test_noise_blip_does_not_start_speech(self) -> None:
        ep = endpointer()
        ep.push(FRAME, 0.9)
        ep.push(FRAME, 0.1)
        self.assertFalse(ep.started)

    def test_ends_after_trailing_silence(self) -> None:
        ep = endpointer()
        results = [ep.push(FRAME, score) for score in [0.9, 0.9, 0.9] + [0.1] * 5]
        self.assertTrue(ep.started)
        self.assertEqual(results[-1], "end")
        self.assertNotIn("end", results[:-1])

    def test_keeps_lead_in_audio_before_speech(self) -> None:
        ep = endpointer()
        ep.push(FRAME, 0.1)
        ep.push(FRAME, 0.9)
        ep.push(FRAME, 0.9)
        self.assertEqual(ep.audio().size, 3 * capture.FRAME_SAMPLES)

    def test_stops_at_length_limit(self) -> None:
        ep = endpointer()
        results = [ep.push(FRAME, 0.9) for _ in range(30)]
        self.assertIn("max", results)

    def test_seed_counts_as_speech_already_started(self) -> None:
        ep = endpointer(seed=[FRAME, FRAME])
        self.assertTrue(ep.started)
        self.assertEqual(ep.audio().size, 2 * capture.FRAME_SAMPLES)


class RecordUtteranceTest(unittest.TestCase):
    def record(self, scores: list[float], **kwargs):
        return asyncio.run(capture.record_utterance(
            read_frame, FakeVad(scores), threshold=0.5, pre_roll_seconds=0.24,
            end_seconds=0.4, max_seconds=5.0, **kwargs,
        ))

    def test_gives_up_when_nobody_speaks(self) -> None:
        self.assertIsNone(self.record([0.0] * 20, no_speech_seconds=0.8))

    def test_returns_a_spoken_turn(self) -> None:
        audio = self.record([0.9] * 5 + [0.0] * 5, no_speech_seconds=0.8)
        self.assertIsNotNone(audio)
        self.assertGreater(audio.size, 0)


class SplitTextTest(unittest.TestCase):
    def test_splits_into_sentences(self) -> None:
        self.assertEqual(
            split_text("First one? Second one! Third one."),
            ["First one?", "Second one!", "Third one."],
        )

    def test_empty_text_has_no_pieces(self) -> None:
        self.assertEqual(split_text("   "), [])

    def test_one_huge_sentence_still_fits(self) -> None:
        pieces = split_text("word " * 300, limit=100)
        self.assertTrue(all(len(piece) <= 100 for piece in pieces))
        self.assertEqual(" ".join(pieces).split(), ["word"] * 300)


if __name__ == "__main__":
    unittest.main()
