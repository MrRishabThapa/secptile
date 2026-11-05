/**
 * Client-safe text helpers shared by the mail adapters (no server-only
 * import here — the reading pane may also use it in future).
 *
 * Providers emit mail text with HTML-escaped entities (&apos;, &quot;,
 * &lt;…&gt; in addresses, &#39; in snippets from both Gmail and Zoho). The
 * list renders snippets as React text — escaping there must be reversed
 * ONCE, here, not at render time (React re-escapes safety-wise on its own).
 */
export function unescapeText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    // Zero-width/combining trackers some senders spam snippets with — they
    // are invisible but still push real text off the row.
    .replace(/[\u034F\u200B-\u200F\u2060\u2800]/g, "");
}
