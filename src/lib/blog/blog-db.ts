/**
 * Local blog storage (Phase 4): approved posts and their cover photos live in
 * a single SQLite database (node:sqlite — no server, zero npm dependencies).
 * Files: SECPTILE_BLOG_DIR (default ~/.secptile/blog)/blog.db — outside any
 * repo, never committed. Photos are the raw bytes; the app serves them back
 * through /api/photos/[id].
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class BlogError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "BlogError";
    this.status = status;
  }
}

export type PhotoRow = {
  id: string;
  mime: string;
  bytes: Uint8Array;
  createdAt: string;
};

export type PostRow = {
  id: string;
  sessionId: string | null;
  title: string;
  body: string;
  linkedinText: string;
  tags: string[];
  photoId: string;
  linkedInUrn: string | null;
  linkedinPostedAt: string | null;
  views: number;
  createdAt: string;
};

/** LinkedIn accepts JPEG, PNG, and GIF only (docs: Images API). */
export const PHOTO_MIMES = ["image/jpeg", "image/png", "image/gif"];

/** Hard cap; LinkedIn returns 413 far beyond this, uploading stays snappy. */
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export function blogDir(): string {
  return (
    process.env.SECPTILE_BLOG_DIR?.trim() ||
    path.join(homedir(), ".secptile", "blog")
  );
}

let database: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (database) return database;
  const dir = blogDir();
  mkdirSync(dir, { recursive: true });
  database = new DatabaseSync(path.join(dir, "blog.db"));
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS photos (
      id         TEXT PRIMARY KEY,
      mime       TEXT NOT NULL,
      bytes      BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS posts (
      id            TEXT PRIMARY KEY,
      session_id    TEXT,
      title         TEXT NOT NULL,
      body          TEXT NOT NULL,
      linkedin_text TEXT NOT NULL,
      tags          TEXT NOT NULL,
      photo_id      TEXT NOT NULL REFERENCES photos(id),
      linkedin_urn  TEXT,
      created_at    TEXT NOT NULL
    );
  `);
  // Safe schema migration for databases created before views / LinkedIn
  // posting timestamps existed.
  for (const alter of [
    "ALTER TABLE posts ADD COLUMN views INTEGER DEFAULT 0",
    "ALTER TABLE posts ADD COLUMN linkedin_posted_at TEXT",
  ]) {
    try {
      database.exec(alter);
    } catch {
      /* column already exists — that's the goal */
    }
  }
  return database;
}

/** Store a cover photo, return its id for later serving. */
export function savePhoto(bytes: Uint8Array, mime: string): string {
  const conn = db();
  const id = randomUUID();
  conn
    .prepare("INSERT INTO photos (id, mime, bytes, created_at) VALUES (?, ?, ?, ?)")
    .run(id, mime, bytes, new Date().toISOString());
  return id;
}

export function getPhoto(id: string): PhotoRow | null {
  const row = db()
    .prepare("SELECT id, mime, bytes, created_at FROM photos WHERE id = ?")
    .get(id) as
    | { id: string; mime: string; bytes: Uint8Array; created_at: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    mime: row.mime,
    bytes: row.bytes,
    createdAt: row.created_at,
  };
}

export type SavePostInput = {
  sessionId?: string;
  title: string;
  body: string;
  linkedinText: string;
  tags: string[];
  photoId: string;
};

/** Insert a published post; the cover photo must already exist. */
export function savePost(input: SavePostInput): string {
  const conn = db();
  const photo = getPhoto(input.photoId);
  if (!photo) {
    throw new BlogError("The cover photo is missing — attach it again.", 400);
  }
  const now = new Date().toISOString();
  const tagsJson = JSON.stringify(input.tags);

  // Idempotent: re-publishing the same journal session updates its record
  // instead of stacking duplicates in the tracker.
  if (input.sessionId) {
    const existing = conn
      .prepare("SELECT id FROM posts WHERE session_id = ?")
      .get(input.sessionId) as { id: string } | undefined;
    if (existing) {
      conn
        .prepare(
          `UPDATE posts SET title = ?, body = ?, linkedin_text = ?, tags = ?,
          photo_id = ?, created_at = ? WHERE id = ?`,
        )
        .run(
          input.title,
          input.body,
          input.linkedinText,
          tagsJson,
          input.photoId,
          now,
          existing.id,
        );
      return existing.id;
    }
  }

  const id = randomUUID();
  conn
    .prepare(
      `INSERT INTO posts (id, session_id, title, body, linkedin_text, tags, photo_id, linkedin_urn, linkedin_posted_at, views, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)`,
    )
    .run(
      id,
      input.sessionId ?? null,
      input.title,
      input.body,
      input.linkedinText,
      tagsJson,
      input.photoId,
      now,
    );
  return id;
}

/** Record the LinkedIn URN on every post of this journal session (best-effort). */
export function markLinkedInBySession(sessionId: string, urn: string): void {
  const conn = db();
  conn
    .prepare(
      "UPDATE posts SET linkedin_urn = ?, linkedin_posted_at = ? WHERE session_id = ?",
    )
    .run(urn, new Date().toISOString(), sessionId);
}

/** Remove one post from the tracker (per-row delete). */
export function deletePost(id: string): void {
  const conn = db();
  conn.prepare("DELETE FROM posts WHERE id = ?").run(id);
}

/**
 * Remove duplicate posts, keeping the newest per journal session.
 * Rows without a session id are left untouched.
 * Returns how many were deleted and how many remain.
 */
export function deleteDuplicatePosts(): { deleted: number; kept: number } {
  const conn = db();
  const dups = conn
    .prepare(
      `SELECT p1.id FROM posts p1
       WHERE p1.session_id IS NOT NULL
       AND p1.created_at < (
         SELECT MAX(p2.created_at) FROM posts p2
         WHERE p2.session_id = p1.session_id
       )`,
    )
    .all() as Array<{ id: string }>;
  for (const row of dups) {
    conn.prepare("DELETE FROM posts WHERE id = ?").run(row.id);
  }
  const kept = conn
    .prepare("SELECT COUNT(*) AS c FROM posts")
    .get() as { c: number };
  return { deleted: dups.length, kept: kept.c };
}

/** Increment the view counter for a post (thread opened / cover fetched). */
export function incrementViews(id: string): void {
  const conn = db();
  conn.prepare("UPDATE posts SET views = views + 1 WHERE id = ?").run(id);
}

/** Count a cover-photo fetch as a view for the post that owns it (best-effort). */
export function incrementViewsForPhoto(photoId: string): void {
  const conn = db();
  const row = conn
    .prepare("SELECT id FROM posts WHERE photo_id = ?")
    .get(photoId) as { id: string } | undefined;
  if (row) incrementViews(row.id);
}

function mapRow(row: {
  id: string;
  session_id: string | null;
  title: string;
  body: string;
  linkedin_text: string;
  tags: string;
  photo_id: string;
  linkedin_urn: string | null;
  linkedin_posted_at: string | null;
  views: number;
  created_at: string;
}): PostRow {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.tags);
    if (Array.isArray(parsed)) {
      tags = parsed.filter((tag): tag is string => typeof tag === "string");
    }
  } catch {
    /* corrupt tags row — degrade to empty list */
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    body: row.body,
    linkedinText: row.linkedin_text,
    tags,
    photoId: row.photo_id,
    linkedInUrn: row.linkedin_urn,
    linkedinPostedAt: row.linkedin_posted_at,
    views: row.views,
    createdAt: row.created_at,
  };
}

export function listPosts(): PostRow[] {
  const rows = db()
    .prepare(
      `SELECT id, session_id, title, body, linkedin_text, tags, photo_id, linkedin_urn, linkedin_posted_at, views, created_at
       FROM posts ORDER BY created_at DESC`,
    )
    .all() as Array<{
    id: string;
    session_id: string | null;
    title: string;
    body: string;
    linkedin_text: string;
    tags: string;
    photo_id: string;
    linkedin_urn: string | null;
    linkedin_posted_at: string | null;
    views: number;
    created_at: string;
  }>;
  return rows.map(mapRow);
}

/** Fetch one post by id for the tracker thread/detail view. */
export function getPost(id: string): PostRow | null {
  const row = db()
    .prepare(
      `SELECT id, session_id, title, body, linkedin_text, tags, photo_id, linkedin_urn, linkedin_posted_at, views, created_at
       FROM posts WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        session_id: string | null;
        title: string;
        body: string;
        linkedin_text: string;
        tags: string;
        photo_id: string;
        linkedin_urn: string | null;
        linkedin_posted_at: string | null;
        views: number;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return mapRow(row);
}
