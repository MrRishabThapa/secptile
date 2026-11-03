import { z } from "zod";

/**
 * Shared /api/journal request body. Lives here instead of inside
 * route.ts so the streaming variant validates exactly the same shape
 * (route files only export HTTP handlers).
 */
export const journalBodySchema = z
  .object({
    /** OpenCode session from a previous turn (same journal loop). */
    sessionId: z.string().min(1).optional(),
    /** Day summary transcript — first turn. */
    transcript: z.string().min(1).max(20_000).optional(),
    /** Private notes — context only, never published. */
    privateNotes: z.string().max(20_000).optional(),
    /** Answers to the previous questions, in the same order. */
    answers: z.array(z.string().min(1)).min(1).max(10).optional(),
    /** Owner's correction/feedback for regenerating the draft. */
    note: z.string().min(1).max(2_000).optional(),
  })
  .refine(
    (b) =>
      (b.transcript?.length ?? 0) > 0 ||
      (b.answers?.length ?? 0) > 0 ||
      (b.note?.length ?? 0) > 0,
    { message: "Provide a transcript, answers, or a regeneration note." },
  )
  .refine((b) => !b.note || b.sessionId, {
    message: "A regeneration note needs the sessionId of its journal loop.",
  });

export type JournalRequestBody = z.infer<typeof journalBodySchema>;
