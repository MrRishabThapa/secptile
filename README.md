# Secptile 🦎

A personal voice journal that turns "here's how my day went" into a polished blog post — drafted by [OpenCode](https://opencode.ai) running headless on the same machine, reviewed and approved by you, then published to your portfolio and LinkedIn **only after explicit approval**.

## How it works

1. 🎙️ Speak a summary of your day (voice or text).
2. 🧠 The transcript is rephrased and sent to a local headless OpenCode server.
3. ❓ OpenCode asks clarifying questions until the day's story is complete.
4. 📝 It drafts a blog-style post (what was done, what else, lessons).
5. 👀 You review it in an editor with a LinkedIn preview, edit or regenerate, and approve.
6. 🚀 Only after approval: MDX post → portfolio repo → commit & push, and a LinkedIn post via the official API.

## Tech stack

- **Next.js** (App Router) + React + TypeScript (strict)
- **Tailwind CSS** v4
- **zod** validation on every structured model response and API body
- **OpenCode** in headless server mode (`opencode serve`) via its SDK
- **whisper.cpp / faster-whisper** locally for speech-to-text
- **pnpm** for package management

## Getting started

Prerequisites: Node LTS, [pnpm](https://pnpm.io), and a local OpenCode server.

```bash
# install dependencies
pnpm install

# configure environment (then edit the values)
cp .env.example .env.local

# start the local OpenCode headless server (default port 4096)
opencode serve --port 4096

# run the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful scripts:

```bash
pnpm dev     # start dev server
pnpm build   # production build
pnpm start   # run the production build
pnpm lint    # eslint (next/core-web-vitals + typescript)
```

## Project status

| Phase | Scope                        | Status            |
| ----- | ---------------------------- | ----------------- |
| 0     | Scaffold                     | ✅ current        |
| 1     | Text-only journal loop       | ⬜ next           |
| 2     | Voice input (local Whisper)  | ⬜                |
| 3     | Draft editor + approval      | ⬜                |
| 4     | Portfolio publishing (MDX)   | ⬜                |
| 5     | LinkedIn publishing (OAuth)  | ⬜                |
| 6     | Polish & streaming           | ⬜                |

See [AGENTS.md](./AGENTS.md) for the project rules, phase plan, and conventions.

## Repo conventions

- **One file per commit** — every commit contains exactly one changed file.
- One feature branch per phase; `main` holds reviewed milestones.
- Secrets live in `.env.local` only (see `.env.example`); never commit real values.
- Nothing is ever published without explicit approval in the UI.
