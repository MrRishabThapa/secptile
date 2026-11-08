import { z } from "zod";
import { phaseSchema, type Draft } from "./schema";

/** Shape of /api/journal's success body — re-validated client-side. */
const apiBodySchema = phaseSchema.extend({ sessionId: z.string().min(1) });
export type ApiBody = z.infer<typeof apiBodySchema>;
export type { Draft };

/**
 * One streamed journal turn: progress pings arrive as NDJSON lines, the
 * final line is the validated phase. Progress messages go to the optional
 * callback so both pages can show their own busy line.
 */
export async function callJournalStream(
  body: Record<string, unknown>,
  onProgress?: (message: string) => void,
): Promise<ApiBody> {
  const response = await fetch("/api/journal/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // Pre-flight validation errors arrive as plain JSON.
    const json: unknown = await response.json().catch(() => null);
    const message =
      typeof json === "object" && json !== null && "error" in json
        ? String((json as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  if (!response.body) throw new Error("The server stopped streaming early.");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let phase: ApiBody | null = null;
  while (phase === null) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let index: number;
    while ((index = buffer.indexOf("\n")) !== -1 && phase === null) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const event: unknown = JSON.parse(line);
      if (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        (event as { type: unknown }).type === "progress"
      ) {
        const message = (event as { type: unknown; message?: unknown }).message;
        if (typeof message === "string") onProgress?.(message);
        continue;
      }
      if (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        (event as { type: unknown }).type === "error"
      ) {
        let message = "The journal response was malformed. Try again.";
        if (typeof event === "object" && event !== null) {
          const err = (event as { error?: unknown }).error;
          if (typeof err === "string") message = err;
        }
        throw new Error(message);
      }
      // Final phase line — validated here, ONCE, for every caller.
      const candidate = apiBodySchema.safeParse(event);
      if (!candidate.success) {
        throw new Error("The journal response was malformed. Try again.");
      }
      phase = candidate.data;
    }
  }
  if (!phase) throw new Error("The journal response was malformed. Try again.");
  return phase;
}
