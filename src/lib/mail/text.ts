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
    .replace(/&amp;/g, "&");
}
