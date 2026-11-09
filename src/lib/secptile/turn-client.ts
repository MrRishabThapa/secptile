import { z } from "zod";

const turnResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("journal") }),
  z.object({ kind: z.literal("start_blog"), text: z.string(), transcript: z.string().optional() }),
  z.object({ kind: z.literal("cancel_blog"), text: z.string() }),
  z.object({
    kind: z.literal("reply"),
    text: z.string(),
    items: z.array(z.string()).optional(),
    href: z.string().optional(),
    hrefLabel: z.string().optional(),
    navigate: z.boolean().optional(),
    chatSessionId: z.string().optional(),
  }),
]);

export type TurnResult = z.infer<typeof turnResultSchema>;

/** Asks the app what this turn wants. Blog turns come back as `journal`. */
export async function sendAssistantTurn(body: {
  text: string;
  mode: "idle" | "collecting" | "session";
  chatSessionId?: string;
}): Promise<TurnResult> {
  const response = await fetch("/api/assistant/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof json === "object" && json !== null && "error" in json
        ? String((json as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  const parsed = turnResultSchema.safeParse(json);
  if (!parsed.success) throw new Error("The assistant's reply was malformed. Try again.");
  return parsed.data;
}
