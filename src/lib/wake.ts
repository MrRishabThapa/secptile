/**
 * Secptile wake-word handling (AGENTS.md §9).
 *
 * Normalizes words so punctuation/formatting artifacts from Whisper
 * don't prevent detection ("Hey Secptile, I am here" matches).
 */

export const WAKE_PHRASE = "hey secptile i am here";
export const WAKE_GREETING = "welcome boss, how was your day?";

const WORD_SPLIT = /\s+/;

function cleanWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type WakeResult = {
  /** True when the wake phrase appears contiguously in the transcript. */
  woke: boolean;
  /** Transcript with the wake phrase removed (may be empty). */
  remainder: string;
};

export function detectWakePhrase(transcript: string): WakeResult {
  const words = transcript.trim().split(WORD_SPLIT).filter(Boolean);
  const phraseWords = WAKE_PHRASE.split(" ");
  const n = phraseWords.length;

  for (let i = 0; i + n <= words.length; i++) {
    let matched = true;
    for (let j = 0; j < n; j++) {
      if (cleanWord(words[i + j]) !== phraseWords[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      const remainder = [
        ...words.slice(0, i),
        ...words.slice(i + n),
      ]
        .join(" ")
        .replace(/\s+([,.!?;:])/g, "$1")
        .trim();
      return { woke: true, remainder };
    }
  }

  return { woke: false, remainder: transcript.trim() };
}
