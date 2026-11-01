# AGENTS.md: Voice Daily Journal → Blog Post System

Read this file fully before doing anything. These instructions apply to every task in this repo.

## 1. Project goal

A personal web app for a founder/entrepreneur (who is also a UX designer and React/Next developer) to:

1. Speak a summary of their whole day by voice.
2. Have the transcript rephrased and sent to **OpenCode** (running headless on the same machine), without the user ever opening OpenCode's TUI.
3. Show OpenCode's responses through a clean custom UI.
4. Run a **clarifying-question loop**: if anything is unclear or missing, the app asks follow-up questions (answerable by voice or text) until the story is complete.
5. Generate a blog-style post of the day (what was done, what else, lessons).
6. Show it in an editor with a LinkedIn preview. After **explicit user approval**, publish to the user's portfolio site and LinkedIn.

## 2. Environment

- OS: Arch Linux (Omarchy). Use Linux-compatible commands only.
- Package manager: `pnpm` (fall back to `npm` only if pnpm is unavailable; ask first).
- Node: current LTS.

## 3. Tech stack

- **Framework:** Next.js (App Router) + React + TypeScript (strict mode)
- **Styling:** Tailwind CSS. The UI should be clean, minimal, and well-designed; the owner is a UX designer and will review it closely.
- **Validation:** `zod` for every structured model response and every API route body
- **AI brain:** OpenCode in headless server mode (`opencode serve`), called from Next.js route handlers through the OpenCode SDK. Check the current OpenCode docs for exact endpoints before writing code; do not guess APIs. Fallback: `opencode run "<prompt>"` from a route handler.
- **Speech-to-text:** local `whisper.cpp` or `faster-whisper`, exposed over a small local HTTP endpoint. Audio captured in the browser with `MediaRecorder`.
- **Portfolio publishing:** write an MDX/Markdown post file into the portfolio repo (path configurable by env var), then commit and push.
- **LinkedIn publishing:** official LinkedIn Posts API with OAuth 2.0 and the `w_member_social` scope. **Never** use browser automation, scraping, or unofficial APIs for LinkedIn.
- **Config/secrets:** `.env.local` only, plus a committed `.env.example` with placeholder values. Never commit real secrets.

## 4. Structured model contract

OpenCode must be prompted to return JSON only, validated with zod:

```ts
{
  status: "needs_info" | "ready",
  questions: string[],      // only when needs_info
  draft?: {                 // only when ready
    title: string,
    body: string,           // markdown
    tags: string[]
  }
}
```

Prompt rules for the model: use only facts the user stated, never invent details, flag anything uncertain, and ask about gaps (what happened, why it mattered, outcome, lesson). Keep a "private notes" option so private items are excluded from the public post.

## 5. Phases

Work **one phase at a time**. At the end of each phase, stop, summarize what was done, and wait for the owner's go-ahead before starting the next. Do not build ahead.

- **Phase 0: Scaffold.** Next.js + TypeScript + Tailwind setup, folder structure, `.env.example`, `.gitignore`, README with run instructions.
- **Phase 1: Text-only loop.** Textbox → API route → OpenCode → zod-validated response → clarifying-questions UI → draft view. No voice yet.
- **Phase 2: Voice input.** Mic button, recording, local Whisper transcription, transcript editable before sending.
- **Phase 3: Draft editor + approval.** Editable draft, LinkedIn-style preview, Approve / Edit / "Regenerate with note" actions. Nothing is published yet.
- **Phase 4: Portfolio publishing.** MDX file generation and commit/push to the portfolio repo, only after approval.
- **Phase 5: LinkedIn publishing.** OAuth flow, token storage and refresh handling (tokens expire roughly every 60 days), post creation, only after approval.
- **Phase 6: Polish.** Streaming responses, history of past days, error states, accessibility.

## 6. Hard rules

1. **Never publish anything without explicit user approval in the UI.** No auto-posting, no exceptions.
2. No secrets in the repo. No tokens in client-side code.
3. Do not invent API endpoints or SDK methods. Verify against current docs, or ask.
4. Keep changes small and reviewable. Prefer simple code over clever code.
5. If a requirement is unclear, ask the owner instead of guessing.

## 7. GIT RULE (most important): ONE FILE PER COMMIT

**Never make a bundled commit. Every commit contains exactly one file.**

- Do **not** use `git add .`, `git add -A`, `git add -u`, `git add <directory>`, or `git commit -a`.
- Stage exactly one explicit file path: `git add path/to/file.ext`.
- Before every commit, run `git diff --cached --name-only` and confirm it lists **exactly one file**. If it lists more, run `git restore --staged <extra files>` until only one remains.
- Then commit with a clear message: `git commit -m "type(scope): short description"` (Conventional Commits: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`).
- Deleting or renaming a file also counts as its own single-file commit.
- This applies to generated scaffolding too. If a tool (e.g. `create-next-app`) creates many files, commit them **one by one**, each in its own commit.
- Push after each commit or small group of commits, but never squash or amend multiple files into one commit.
- Never force-push. Never rewrite history unless the owner asks.
- Work on a feature branch per phase (e.g. `phase-1-text-loop`), not directly on `main`.

## 8. How to report

After each phase: list the files created (in commit order), how to run and test it, and what the next phase will be. Then stop and wait.

## 9. Project specifics

- Project name: **Secptile**.
- Initialization (wake) voice command: **"hey secptile i am here"** (implemented with voice in Phase 2; detectable in transcript text from then on).
- App's voice response to the wake command: **"welcome boss, how was your day?"**

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
