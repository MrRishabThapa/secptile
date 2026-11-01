import { z } from "zod";

/**
 * Structured model contract (see AGENTS.md §4).
 *
 * OpenCode is prompted to reply with JSON and may need a little slack;
 * the strict zod schemas below are the real gate.
 */

export const draftSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
});
export type Draft = z.infer<typeof draftSchema>;

export const phaseSchema = z
  .object({
    status: z.enum(["needs_info", "ready"]),
    questions: z.array(z.string().min(1)).default([]),
    draft: draftSchema.nullish(),
  })
  .refine((p) => p.status !== "needs_info" || p.questions.length > 0, {
    message: "status 'needs_info' requires at least one question",
    path: ["questions"],
  })
  .refine((p) => p.status !== "ready" || p.draft != null, {
    message: "status 'ready' requires a draft",
    path: ["draft"],
  })
  .refine((p) => p.status === "ready" || p.draft == null, {
    message: "draft is only allowed when status is 'ready'",
    path: ["draft"],
  });
export type Phase = z.infer<typeof phaseSchema>;

