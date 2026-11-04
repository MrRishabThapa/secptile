/**
 * LinkedIn posts are plain text — no markdown. This converts the journal
 * draft's markdown body into the text a LinkedIn post would show, and
 * exposes LinkedIn's hard limit for a live character count.
 */

export const LINKEDIN_TEXT_LIMIT = 3000;

/**
 * Strip markdown syntax for LinkedIn-style preview:
 * - headings and emphasis markers removed (headline/bold don't exist there)
 * - list markers become "• " (LinkedIn shows bullets fine)
 * - links [text](url) keep their text
 * - hashtags (#tag) are kept — LinkedIn highlights them
 */
export function stripMarkdown(md: string): string {
  return md
    .split("\n")
    .map((line) => {
      // links first, inside potential emphasis
      line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
      // headings: leading #'s
      line = line.replace(/^\s*#{1,6}\s+/, "");
      // unordered list markers -> bullet
      line = line.replace(/^\s*[-*+]\s+/, "• ");
      // emphasis (bold, then italic), dot-leaving
      line = line.replace(/\*\*(.+?)\*\*/g, "$1");
      line = line.replace(/(^|\s)\*(\S.*?\S|\S)\*(?=\s|$)/g, "$1$2");
      line = line.replace(/__(.+?)__/g, "$1");
      line = line.replace(/(^|[\s(])`([^`]+)`/g, "$1$2");
      // blockquote marker
      line = line.replace(/^\s*>\s?/, "");
      // strip residual emphasis pairs like _underline_ kept plain
      line = line.replace(/(^|\s)_(\S.*?\S|\S)_(?=\s|$)/g, "$1$2");
      return line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * LinkedIn commentary is "little text" (docs: little-text-format). These
 * characters are reserved for the little grammar (mentions, hashtags,
 * templates) and must be backslash-escaped to survive as literal plaintext —
 * docs: "All reserved characters need to be escaped with a backslash, even if
 * those characters are not used in one of the supported elements or
 * templates."
 *
 * A single pass is safe: every reserved character (including the backslash
 * itself) is in one character class, so nothing is escaped twice.
 */
const RESERVED_CHARS = /[\\|{}@[\]()<>#*_~]/g;

export function escapeLittleText(text: string): string {
  return text.replace(RESERVED_CHARS, "\\$&");
}

/**
 * The text actually posted to LinkedIn: markdown stripped, then every
 * reserved little-text character escaped. Use for the real `commentary`;
 * `stripMarkdown` alone stays for the on-screen preview (no visible
 * backslashes there).
 */
export function toLinkedInText(md: string): string {
  return escapeLittleText(stripMarkdown(md));
}

/**
 * Hashtag line from the draft tags. The owner's convention, confirmed live
 * on LinkedIn: multi-word tags join with an UNDERSCORE, never a hyphen —
 * e.g. "build in public" → "#build_in_public".
 */
export function tagsToHashtags(tags: string[]): string {
  return tags
    .map((tag) =>
      `#${tag
        .trim()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_]+/g, "_")
        .replace(/_{2,}/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase()}`,
    )
    .filter((tag) => tag.length > 1)
    .join(" ");
}

/** A line that is only hashtag tokens: "#ai #secptile". */
const HASHTAG_LINE = /^\s*#[A-Za-z0-9_]+(?:\s+#[A-Za-z0-9_]+)*\s*$/;

/**
 * Trailing hashtag lines on a text (legacy drafts or a model that ignored
 * the "no hashtags" rule) — so the app can append its tag line exactly
 * once and the post never shows the set twice.
 */
export function stripTrailingHashtags(text: string): string {
  const lines = text.trimEnd().split("\n");
  while (lines.length > 0 && HASHTAG_LINE.test(lines[lines.length - 1])) {
    lines.pop();
  }
  return lines.join("\n").trimEnd();
}

/**
 * The full post text: hook + gap + body, then the app-owned hashtag line
 * appended exactly once even if the text already carries trailing tags.
 */
export function withAppendedHashtags(text: string, tags: string[]): string {
  const base = stripTrailingHashtags(text);
  const hashtags = tagsToHashtags(tags);
  return hashtags ? `${base.trimEnd()}\n\n${hashtags}` : base;
}
