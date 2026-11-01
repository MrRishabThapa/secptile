# Secptile 🦎

A personal voice journal that turns "here's how my day went" into a polished blog post — drafted by [OpenCode](https://opencode.ai) running on the same machine, reviewed and approved by you, then published to your portfolio and LinkedIn **only after explicit approval**.

## How it works

1. 🎙️ Speak a summary of your day (voice or text).
2. 🧠 The transcript is sent to OpenCode (`opencode run`, JSON-only prompt, strict zod gate).
3. ❓ OpenCode asks clarifying questions until the day's story is complete.
4. 📝 It drafts a blog-style post (what was done, what else, lessons).
5. 👀 You review it in an editor beside a LinkedIn-style preview, edit or regenerate with a note, and **approve**.
6. 🚀 Only after explicit approval: MDX post → portfolio repo (`content/posts/YYYY-MM-DD-slug.mdx`, commit, best-effort push) → and a LinkedIn post via the official API (Phase 5).

## Tech stack

- **Next.js 16** (App Router, Turbopack) + React 19 + TypeScript (strict)
- **Tailwind CSS** v4
- **zod** validation on every structured model response and API body
- **OpenCode** via the `opencode` CLI (`opencode run --format json`), session continued with `--session <id>` for the clarifying loop. Intended path is the official SDK once its v2 client matches `opencode serve` v2; verified mismatch in Nov 2026 and went with the CLI (see git history).
- **whisper.cpp / faster-whisper** locally for speech-to-text (Phase 2)
- **pnpm** for package management

## Getting started

Prerequisites: Node LTS, [pnpm](https://pnpm.io), and `opencode` ≥ 2.0 on PATH (`mise use -g opencode`).

```bash
# install dependencies
pnpm install

# configure environment (then edit the values)
cp .env.example .env.local

# run the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful scripts:

```bash
pnpm dev     # start dev server
pnpm build   # production build
pnpm start   # run the production build
pnpm lint    # eslint (next/core-web-vitals + ts)
```

OpenCode environment (in `.env.local`):

- `OPENCODE_MODEL` — provider/model used for drafting (e.g. `opencode/big-pickle`)
- `OPENCODE_WORKSPACE_DIR` — isolated dir for journal sessions (**not** your repos; OpenCode agents have tool access inside it). Defaults to `~/.secptile/workspace`.
- `OPENCODE_SERVER_URL` — optional: attach runs to a headless server instead of the default background service
- `OPENCODE_BIN`, `OPENCODE_TIMEOUT_MS` — optional overrides

Publishing environment (in `.env.local`):

- `PORTFOLIO_REPO_PATH` — local clone of your portfolio repo (e.g. `/home/rishab/Projects/portfolio/next-portfolio`)
- `PORTFOLIO_POSTS_DIR` — optional, posts directory inside the repo (default `content/posts`)

## Project status

| Phase | Scope                        | Status                              |
| ----- | ---------------------------- | ----------------------------------- |
| 0     | Scaffold                     | ✅                                  |
| 1     | Text-only journal loop       | ✅                                  |
| 2     | Voice input (local Whisper)  | ✅ code · ⏳ STT live verify pending |
| 3     | Draft editor + approval      | ✅                                  |
| 4     | Portfolio publishing (MDX)   | ✅ current                          |
| 5     | LinkedIn publishing (OAuth)  | ⬜ next                             |
| 6     | Polish & streaming           | ⬜                                  |

See [AGENTS.md](./AGENTS.md) for the project rules, phase plan, and conventions.

## Repo conventions

- **One file per commit** — every commit contains exactly one changed file.
- One feature branch per phase; `main` holds reviewed milestones.
- Secrets live in `.env.local` only (see `.env.example`); never commit real values.
- Nothing is ever published without explicit approval in the UI.
