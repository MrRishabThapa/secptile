import { z } from "zod";
import { BlogError, savePost } from "./blog-db";
import { syncToPortfolio } from "./portfolio-blog";

export class PublishError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "PublishError";
    this.status = status;
  }
}

export const publishInputSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(50_000),
  /** The hook-format LinkedIn text the owner reviewed and approved. */
  linkedin: z.string().min(1).max(5_000),
  tags: z.array(z.string().min(1)).min(1).max(10),
  /** The uploaded cover photo — required before anything can be published. */
  photoId: z.string().min(1).max(64),
  /**
   * The client must literally send `approved: true` — the publisher writes
   * the post into the owner's blog DB and LinkedIn posting is a separate,
   * equally explicit act afterwards (AGENTS.md hard rule 1).
   */
  approved: z.literal(true),
  /** Links the publish to this day's history record, when known. */
  sessionId: z.string().min(1).optional(),
});

export type PublishInput = z.infer<typeof publishInputSchema>;

export type PublishResult = {
  id: string;
  /** URL the stored photo is served from (/api/photos/{photoId}). */
  photoUrl: string;
  /** Best-effort mirror to the portfolio site's Supabase (see portfolio-blog). */
  portfolio: {
    synced: boolean;
    /** Public cover-photo URL on the blog site, when synced. */
    url: string | null;
    error: string | null;
  };
};

/**
 * Save the approved post (title, body, LinkedIn text, tags, cover photo)
 * into the local SQLite blog DB, then best-effort mirror it to the
 * portfolio site so rishabthapa.com.np/blog shows it. A failed mirror
 * never fails the publish — the local DB is the source of truth.
 */
export async function publishPost(input: PublishInput): Promise<PublishResult> {
  if (input.approved !== true) {
    // zod already enforces this; belt-and-braces for the hard rule.
    throw new PublishError("Not approved — refusing to publish.", 403);
  }
  if (!input.photoId.trim()) {
    // Required by the owner: a post always carries a cover photo.
    throw new PublishError("A cover photo is required before publishing.", 400);
  }
  if (input.linkedin.trim().length > 5000) {
    throw new PublishError("The LinkedIn text is too long to store.", 400);
  }

  let id: string;
  try {
    id = savePost({
      sessionId: input.sessionId,
      title: input.title.trim(),
      body: input.body.trim(),
      linkedinText: input.linkedin.trim(),
      tags: input.tags,
      photoId: input.photoId.trim(),
    });
  } catch (error) {
    if (error instanceof BlogError) {
      throw new PublishError(error.message, error.status);
    }
    throw error;
  }

  const portfolio = await syncToPortfolio({
    title: input.title.trim(),
    body: input.body.trim(),
    tags: input.tags,
    photoId: input.photoId.trim(),
  });

  return {
    id,
    photoUrl: `/api/photos/${input.photoId.trim()}`,
    portfolio,
  };
}
