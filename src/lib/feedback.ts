/**
 * Blog comment review (Phase 4b). The portfolio blog stores comments in a
 * Supabase project: new comments arrive with approved=false and the public
 * anon API can never change them (RLS), by design ("...your separate posting
 * app should use the service_role key" — see the portfolio's init migration).
 * This module is that reviewer: server-only, service-role credentials from
 * .env.local, plain REST (no supabase-js dependency needed).
 */
import { z } from "zod";

export class FeedbackError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "FeedbackError";
    this.status = status;
  }
}

/** Mirrors the CHECK constraints in the portfolio's init_blog migration. */
export const MAX_AUTHOR_NAME_LENGTH = 60;
export const MAX_MESSAGE_LENGTH = 1000;

export const pendingCommentSchema = z.object({
  id: z.number(),
  author_name: z.string(),
  message: z.string(),
  created_at: z.string(),
  posts: z
    .object({ title: z.string().nullable(), slug: z.string().nullable() })
    .nullable(),
});

export type PendingComment = {
  id: number;
  authorName: string;
  message: string;
  createdAt: string;
  postTitle: string | null;
  postSlug: string | null;
};

export const actionSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(["approve", "delete"]),
});
export type CommentAction = z.infer<typeof actionSchema>;

export const editCommentSchema = z
  .object({
    id: z.number().int().positive(),
    authorName: z
      .string()
      .trim()
      .min(1)
      .max(MAX_AUTHOR_NAME_LENGTH)
      .optional(),
    message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH).optional(),
  })
  .refine((data) => data.authorName !== undefined || data.message !== undefined, {
    message: "Provide an author name and/or a message to save.",
  });
export type CommentEdit = z.infer<typeof editCommentSchema>;

function config(): { base: string; key: string } {
  const base = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return { base: base ?? "", key: key ?? "" };
}

export function feedbackConfigured(): boolean {
  const { base, key } = config();
  return Boolean(base && key);
}

function headers(key: string): HeadersInit {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function base(): string {
  const { base } = config();
  if (!base || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new FeedbackError(
      "Feedback is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
      500,
    );
  }
  return base;
}

/** REST base + auth headers + a tolerable error envelope. */
async function supabaseFetch(
  url: string,
  init: RequestInit,
  failure: string,
): Promise<Response> {
  const { key } = config();
  const response = await fetch(url, { ...init, headers: headers(key) });
  if (!response.ok) {
    const detail = (await response.text()).split("\n")[0]?.trim();
    throw new FeedbackError(
      `${failure} (${response.status}${detail ? `: ${detail}` : ""})`,
      502,
    );
  }
  return response;
}

/**
 * Pending queue: approved=false, newest first, joined with the post's
 * title/slug for context (the FK makes the embed available).
 */
export async function listPendingComments(): Promise<PendingComment[]> {
  const url = new URL(`${base()}/rest/v1/comments`);
  url.searchParams.set("approved", "eq.false");
  url.searchParams.set(
    "select",
    "id,author_name,message,created_at,posts(title,slug)",
  );
  url.searchParams.set("order", "created_at.desc");

  const response = await supabaseFetch(url, { method: "GET" }, "Could not list pending comments");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) return [];

  const pending: PendingComment[] = [];
  for (const row of rows) {
    const parsed = pendingCommentSchema.safeParse(row);
    if (!parsed.success) continue; // tolerate odd rows, keep the rest working
    const { id, author_name, message, created_at, posts } = parsed.data;
    pending.push({
      id,
      authorName: author_name,
      message,
      createdAt: created_at,
      postTitle: posts?.title ?? null,
      postSlug: posts?.slug ?? null,
    });
  }
  return pending;
}

/** Edit name/message before deciding — service role bypasses RLS. */
export async function saveCommentEdit(edit: CommentEdit): Promise<void> {
  const url = `${base()}/rest/v1/comments?id=eq.${edit.id}`;
  const body: Record<string, string> = {};
  if (edit.authorName !== undefined) body.author_name = edit.authorName;
  if (edit.message !== undefined) body.message = edit.message;
  await supabaseFetch(
    url,
    { method: "PATCH", body: JSON.stringify(body) },
    "Could not save the comment edit",
  );
}

export async function approveComment(id: number): Promise<void> {
  const url = `${base()}/rest/v1/comments?id=eq.${id}`;
  await supabaseFetch(
    url,
    { method: "PATCH", body: JSON.stringify({ approved: true }) },
    "Could not approve the comment",
  );
}

export async function deleteComment(id: number): Promise<void> {
  const url = `${base()}/rest/v1/comments?id=eq.${id}`;
  await supabaseFetch(url, { method: "DELETE" }, "Could not delete the comment");
}
