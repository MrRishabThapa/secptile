import { spawn } from "node:child_process";
import { mkdir, stat, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

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
  tags: z.array(z.string().min(1)).min(1).max(10),
  /**
   * The client must literally send `approved: true` — the publisher writes
   * into the owner's portfolio repo both on disk and in git history. Serves
   * as an explicit, recorded confirmation (AGENTS.md hard rule 1).
   */
  approved: z.literal(true),
  /** Optional ISO date (YYYY-MM-DD); defaults to today, owner-local. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Links the publish to this day's history record, when known. */
  sessionId: z.string().min(1).optional(),
});

export type PublishInput = z.infer<typeof publishInputSchema>;

export type PublishResult = {
  file: string;
  slug: string;
  commitHash: string | null;
  pushed: boolean;
  pushError: string | null;
};

function repoConfig(): { repo: string; postsDir: string } {
  const repo = process.env.PORTFOLIO_REPO_PATH?.trim();
  if (!repo) {
    throw new PublishError(
      "PORTFOLIO_REPO_PATH is not configured (see .env.example).",
      500,
    );
  }
  const postsDir = process.env.PORTFOLIO_POSTS_DIR?.trim() || "content/posts";
  return { repo, postsDir };
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!slug) throw new PublishError("Title cannot be turned into a filename.", 400);
  return slug;
}

/** First meaningful non-heading paragraph, clipped — the post's description. */
function firstParagraph(body: string): string {
  const paragraph = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith("!["));
  return (paragraph ?? "").slice(0, 160);
}

function run(
  bin: string,
  args: string[],
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code: number | null) => resolve({ code, stdout, stderr }));
  });
}

async function git(args: string[], cwd: string, failure: string): Promise<string> {
  const result = await run("git", args, cwd);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).split("\n")[0]?.trim();
    throw new PublishError(`${failure}${detail ? `: ${detail}` : ""}`, 502);
  }
  return result.stdout.trim();
}

/** "content/posts" relative paths turned absolute — with traversal guard. */
function postsPath(repo: string, postsDir: string): string {
  const abs = path.resolve(repo, postsDir);
  if (abs !== repo && !abs.startsWith(repo + path.sep)) {
    throw new PublishError("PORTFOLIO_POSTS_DIR escapes the portfolio repo.", 500);
  }
  return abs;
}

/** YYYY-MM-DD in the owner's local timezone (ISO string would be UTC). */
function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Write the approved post as MDX into the portfolio repo, commit, and try
 * to push. Publishes exactly the approved text — edits win over the model.
 */
export async function publishPost(input: PublishInput): Promise<PublishResult> {
  if (input.approved !== true) {
    // zod already enforces this; belt-and-braces for the hard rule.
    throw new PublishError("Not approved — refusing to publish.", 403);
  }
  const { repo, postsDir } = repoConfig();
  const date = input.date ?? todayLocal();
  const slug = slugify(input.title);
  const fileName = `${date}-${slug}.mdx`;
  const relPath = `${postsDir}/${fileName}`;
  const absFile = path.join(postsPath(repo, postsDir), fileName);

  // Refuse duplicates: same-day same title would overwrite history.
  if (await stat(absFile).then(() => true, () => false)) {
    throw new PublishError(
      `A post already exists at ${relPath} — tweak the title or publish on another day.`,
      409,
    );
  }

  const frontmatter = [
    "---",
    `title: ${JSON.stringify(input.title)}`,
    `date: "${date}"`,
    "draft: false",
    `tags: [${input.tags.map((tag) => JSON.stringify(tag)).join(", ")}]`,
    `description: ${JSON.stringify(firstParagraph(input.body))}`,
    "---",
    "",
  ].join("\n");

  await git(["rev-parse", "--is-inside-work-tree"], repo, "PORTFOLIO_REPO_PATH is not a git repo");

  let written = false;
  try {
    await mkdir(path.dirname(absFile), { recursive: true });
    await writeFile(absFile, `${frontmatter}${input.body.trimEnd()}\n`, {
      flag: "wx", // refuses to overwrite, even on a race
    });
    written = true;

    await git(["add", relPath], repo, "Could not stage the post file");
    await git(["commit", "-m", `posts: ${slug}`], repo, "Could not commit the post");
  } catch (error) {
    // Don't leave debris in the owner's repo on failure.
    await run("git", ["reset", "-q", "HEAD", "--", relPath], repo);
    if (written) await rm(absFile, { force: true });
    throw error;
  }

  // Push is best-effort: failure here never undoes the commit.
  const push = await run("git", ["push", "origin", "HEAD"], repo);
  const pushed = push.code === 0;

  const rev = await run("git", ["rev-parse", "--short", "HEAD"], repo);
  return {
    file: relPath,
    slug,
    commitHash: rev.code === 0 ? rev.stdout.trim() : null,
    pushed,
    pushError: pushed ? null : (push.stderr.split("\n")[0]?.trim() || "push failed"),
  };
}
