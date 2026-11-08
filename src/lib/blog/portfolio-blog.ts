/**
 * Bridge to the portfolio site's Supabase (`public.posts` + Storage).
 * The local SQLite blog DB stays the source of truth; on publish we
 * best-effort mirror the approved post so rishabthapa.com.np/blog can
 * show it. Uses the service-role key server-side only — never ship this
 * module into client code.
 */
import { getPhoto } from "./blog-db";
import { stripMarkdown } from "../linkedin/linkedin-text";

const COVERS_BUCKET = "covers";
/** Postgres CHECK: excerpt 1..500, tags array_length <= 5. */
const EXCERPT_MAX = 480;
const PORTFOLIO_TAGS_MAX = 5;

type PortfolioResult = {
  synced: boolean;
  url: string | null;
  error: string | null;
};

function credentials(): { base: string; key: string } | null {
  const base = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base || !key) return null;
  return { base: base.replace(/\/+$/, ""), key };
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || `post-${Date.now().toString(36)}`;
}

/** Postgres CHECK: excerpt between 1 and 500 chars. */
function buildExcerpt(body: string, title: string): string {
  const flat = stripMarkdown(body).replace(/\s+/g, " ").trim();
  const source = flat || title || "A day worth writing down.";
  return source.length > EXCERPT_MAX
    ? `${source.slice(0, EXCERPT_MAX - 1)}…`
    : source;
}

async function ensureBucket(base: string, key: string): Promise<void> {
  const exists = await fetch(`${base}/storage/v1/bucket/${COVERS_BUCKET}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (exists.ok) return;
  // Bucket missing (5xx/404) — public bucket so the site can <img> the covers.
  const created = await fetch(`${base}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: COVERS_BUCKET, public: true }),
  });
  // 409 = raced into existence — fine.
  if (!created.ok && created.status !== 409) {
    throw new Error(
      `could not prepare the ${COVERS_BUCKET} storage bucket (${created.status})`,
    );
  }
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
};

/** Upload the cover photo, return its public URL for the post row. */
async function uploadCover(
  base: string,
  key: string,
  slug: string,
  photoId: string,
): Promise<string> {
  await ensureBucket(base, key);
  const photo = getPhoto(photoId);
  if (!photo) throw new Error("the cover photo is missing from the blog DB");
  const ext = MIME_EXT[photo.mime] ?? "bin";
  const path = `${slug}.${ext}`;
  const response = await fetch(
    `${base}/storage/v1/object/${COVERS_BUCKET}/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": photo.mime,
        "x-upsert": "true",
      },
      body: photo.bytes.slice().buffer,
    },
  );
  if (!response.ok) {
    throw new Error(`cover upload failed (${response.status})`);
  }
  return `${base}/storage/v1/object/public/${COVERS_BUCKET}/${path}`;
}

type PostRow = {
  slug: string;
  title: string;
};

/**
 * Find a free slug. Same title reuses its slug (republish = update);
 * a different post holding it gets suffixed instead of clobbered.
 */
async function resolveSlug(
  base: string,
  key: string,
  title: string,
): Promise<string> {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const wanted = title.toLowerCase();
  let candidate = slugify(title);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const listing = await fetch(
      `${base}/rest/v1/posts?slug=eq.${encodeURIComponent(candidate)}&select=slug,title`,
      { headers },
    );
    if (!listing.ok) {
      // Can't tell — safest is a day-unique slug to avoid clobbering.
      candidate = `${candidate}-${Date.now().toString(36)}`;
      continue;
    }
    const rows = (await listing.json()) as PostRow[];
    if (rows.length === 0) return candidate;
    if (rows[0].title.toLowerCase() === wanted) return candidate; // republish
    candidate = `${slugify(title)}-${attempt + 1}`;
    if (attempt === 5) candidate = `${slugify(title)}-${Date.now().toString(36)}`;
  }
  return candidate;
}

/**
 * Mirror one approved post to the portfolio. Never throws — the local blog
 * DB remains the source of truth, and the UI reports the sync outcome.
 */
export async function syncToPortfolio(input: {
  title: string;
  body: string;
  tags: string[];
  photoId: string;
}): Promise<PortfolioResult> {
  try {
    const creds = credentials();
    if (!creds) {
      return { synced: false, url: null, error: "portfolio sync is not configured" };
    }
    const { base, key } = creds;
    const slug = await resolveSlug(base, key, input.title);
    const coverUrl = await uploadCover(base, key, slug, input.photoId);

    const row = {
      slug,
      title: input.title,
      excerpt: buildExcerpt(input.body, input.title),
      content: input.body,
      cover_image: coverUrl,
      tags: input.tags.slice(0, PORTFOLIO_TAGS_MAX),
      published: true,
      published_at: new Date().toISOString(),
    };
    const response = await fetch(`${base}/rest/v1/posts`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=headers-only",
      },
      body: JSON.stringify([row]),
    });
    if (!response.ok) {
      throw new Error(`blog site rejected the post (${response.status})`);
    }
    return { synced: true, url: coverUrl, error: null };
  } catch (error) {
    console.error("[portfolio-blog] sync failed:", error);
    const message = error instanceof Error ? error.message : "unknown error";
    return { synced: false, url: null, error: message };
  }
}
