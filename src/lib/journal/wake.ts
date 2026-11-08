/**
 * Secptile wake-word handling (AGENTS.md §9).
 *
 * STT reality: "secptile" gets misheard ("sep tile", "sec tile") and "i am"
 * comes back as "i'm". Detection therefore uses fuzzy span matching instead
 * of exact tokens: a dynamic-programming alignment where each phrase word
 * consumes 1–2 transcript words (joined), with a small skip budget for
 * garbled filler, and a normalized Levenshtein tolerance per word.
 *
 * Wildcards stay conservative: "here" and "hey" are common enough words that
 * a mostly-matching phrase still needs the brand word to be close.
 */

export const WAKE_PHRASE = "hey secptile i am here";
export const WAKE_GREETING = "welcome boss, how was your day?";

const WORD_SPLIT = /\s+/;
/** Absolute edit distance allowed, scaled by the longer token. */
function allowance(len: number): number {
  if (len <= 3) return 1; // short tokens: one typo tolerated ("i'm" -> "i")
  return Math.round(len * 0.45); // longer tokens: ~half mangled is fine
}
/** How many transcript tokens the alignment may skip inside the phrase. */
const MAX_SKIPS = 2;

function cleanWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

export type WakeResult = {
  /** True when the wake phrase (fuzzily) appears in the transcript. */
  woke: boolean;
  /** Transcript with the wake phrase removed (may be empty). */
  remainder: string;
};

type Step = { ok: boolean; consumed: number; skipped: number };

/**
 * Can phrase word `p` be covered by the next 1–2 cleaned transcript tokens
 * starting at `t`? Returns the token span consumed, or none.
 */
function matchSpan(tokens: string[], t: number, p: string): Step {
  if (t >= tokens.length) return { ok: false, consumed: 0, skipped: 0 };
  const one = tokens[t];
  if (levenshtein(one, p) <= allowance(Math.max(one.length, p.length))) {
    return { ok: true, consumed: 1, skipped: 0 };
  }
  // Two misheard half-words joining into one phrase word ("sep tile") only
  // makes sense for the long brand word — short words stay strict.
  if (p.length >= 5 && t + 1 < tokens.length) {
    const two = `${one}${tokens[t + 1]}`;
    if (levenshtein(two, p) <= allowance(Math.max(two.length, p.length))) {
      return { ok: true, consumed: 2, skipped: 0 };
    }
  }
  return { ok: false, consumed: 0, skipped: 0 };
}

export function detectWakePhrase(transcript: string): WakeResult {
  const items = transcript.trim().split(WORD_SPLIT).filter(Boolean);
  const raw = items.map((w) => w); // keep raw for remainder surgical removal
  const tokens = raw.map(cleanWord).filter((w) => w.length > 0);
  // tokens/items indexes can drift when a word is all punctuation; fall back
  // to exact behavior only when lengths agree.
  if (tokens.length !== items.length) {
    return exactFallback(transcript);
  }

  const phrase = WAKE_PHRASE.split(" ");
  const n = phrase.length;

  // dp[j][t] = best (least skipped) state for matching the first j phrase
  // words against tokens starting at t: -1 unreachable, else skips used.
  const dp: (number | null)[][] = Array.from({ length: n + 1 }, () =>
    Array(tokens.length + 1).fill(null),
  );
  // back[t][j] = how many tokens phrase word j consumed at this state
  const back: number[][] = Array.from({ length: n + 1 }, () =>
    Array(tokens.length + 1).fill(0),
  );

  dp[0][0] = 0;
  for (let j = 0; j < n; j++) {
    for (let t = 0; t <= tokens.length; t++) {
      const skips = dp[j][t];
      if (skips === null) continue;
      // Option A: skip one transcript token (garbled filler word).
      if (skips < MAX_SKIPS && t + 1 <= tokens.length && dp[j][t + 1] === null) {
        dp[j][t + 1] = skips + 1;
      }
      // Option B: match phrase word j to a 1–2 token span.
      const span = matchSpan(tokens, t, phrase[j]);
      if (span.ok && dp[j + 1][t + span.consumed] === null) {
        dp[j + 1][t + span.consumed] = skips;
        back[j + 1][t + span.consumed] = span.consumed;
      }
      // Option C (contraction): one token covers TWO phrase words, e.g. a
      // transcription renders "i am" as "i'm" — tokens[t] ≈ phrase[j]+phrase[j+1].
      if (j + 1 < n && t < tokens.length) {
        const joined = `${phrase[j]}${phrase[j + 1]}`;
        if (
          levenshtein(tokens[t], joined) <=
          allowance(Math.max(tokens[t].length, joined.length))
        ) {
          dp[j + 2][t + 1] = skips;
          // consumed 1 token for 2 phrase words; backtrack steps j by 2 too
          back[j + 2][t + 1] = 1;
        }
      }
    }
  }

  // Find a completion whose end position minimizes skipped tokens.
  let bestEnd = -1;
  let bestSkips = MAX_SKIPS + 1;
  for (let t = 0; t <= tokens.length; t++) {
    const skips = dp[n][t];
    if (skips !== null && skips < bestSkips) {
      bestSkips = skips;
      bestEnd = t;
    }
  }
  if (bestEnd < 0 || bestSkips >= MAX_SKIPS) {
    return exactFallback(transcript);
  }

  // Reconstruct consumed token indexes and remove them from the raw text.
  const consumedTokens = new Set<number>();
  let t = bestEnd;
  for (let j = n; j > 0; j--) {
    const spanTokens = back[j][t];
    for (let k = t - spanTokens; k < t; k++) consumedTokens.add(k);
    t -= spanTokens;
  }
  const remainderWords = raw.filter((_, index) => !consumedTokens.has(index));
  const remainder = remainderWords
    .join(" ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
  return { woke: true, remainder };
}

/** No punctuation-debris path: exact contiguous match, Phase 1 behavior. */
function exactFallback(transcript: string): WakeResult {
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
      const remainder = words
        .slice(0, i)
        .concat(words.slice(i + n))
        .join(" ")
        .replace(/\s+([,.!?;:])/g, "$1")
        .trim();
      return { woke: true, remainder };
    }
  }
  return { woke: false, remainder: transcript.trim() };
}
