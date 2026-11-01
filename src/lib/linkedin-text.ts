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

/** Hashtags line from the draft tags, e.g. "#build-in-public #ux". */
export function tagsToHashtags(tags: string[]): string {
  return tags
    .map((tag) => `#${tag.trim().replace(/\s+/g, "-").toLowerCase()}`)
    .filter((tag) => tag.length > 1)
    .join(" ");
}
