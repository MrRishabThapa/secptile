import { z } from "zod";

/**
 * DashScope's streaming speech reply: server-sent events whose
 * `output.audio.data` holds base64 PCM (16-bit mono, 24 kHz). The last event
 * carries an empty string plus a URL, which is not needed here.
 *
 * https://www.alibabacloud.com/help/en/model-studio/qwen-tts-api
 */
const eventSchema = z.object({
  output: z
    .object({ audio: z.object({ data: z.string().optional() }).optional() })
    .optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});

const DATA_PREFIX = "data:";

/** Returns the PCM bytes in one SSE line, or null for lines without audio. */
function audioFromLine(line: string): Uint8Array | null {
  if (!line.startsWith(DATA_PREFIX)) return null;
  const event = eventSchema.parse(JSON.parse(line.slice(DATA_PREFIX.length).trim()));
  if (event.code) {
    throw new Error(`Speech synthesis error (${event.code}): ${event.message ?? "no details"}`);
  }
  const base64 = event.output?.audio?.data;
  return base64 ? new Uint8Array(Buffer.from(base64, "base64")) : null;
}

/** Turns DashScope's SSE body into a stream of raw PCM bytes. */
export function pcmFromSse(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const lineEnd = pending.indexOf("\n");
          if (lineEnd >= 0) {
            const line = pending.slice(0, lineEnd).trim();
            pending = pending.slice(lineEnd + 1);
            const audio = audioFromLine(line);
            if (audio) {
              controller.enqueue(audio);
              return;
            }
            continue;
          }
          const { done, value } = await reader.read();
          if (done) {
            const audio = audioFromLine(pending.trim());
            if (audio) controller.enqueue(audio);
            controller.close();
            return;
          }
          pending += decoder.decode(value, { stream: true });
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
