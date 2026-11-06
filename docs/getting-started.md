# Getting started with Secptile

This guide is for a developer who has never seen this project before: it walks
through installing everything, running your first build, and starting the app.

If you get stuck, check the troubleshooting section at the bottom, and read
[AGENTS.md](../AGENTS.md) for the project's rules and phase plan.

## Prerequisites

| Tool | Notes |
|------|-------|
| Node.js (current LTS) | https://nodejs.org — check with `node --version` |
| pnpm | Package manager. Install: `corepack enable pnpm` or https://pnpm.io/installation |
| `opencode` ≥ 2.0 | The AI brain. Install: `mise use -g opencode`, then `opencode --version` |

## 1. Clone and install dependencies

```bash
git clone <your-fork-or-repo-url> secptile
cd secptile
pnpm install
```

## 2. Configure the environment

Secptile needs no credentials to *boot*, but each feature checks one or more
environment variables at runtime:

```bash
cp .env.example .env.local
```

Then edit `.env.local`. Start with these before the more advanced sections:

```ini
# Model used for drafting and clarifying questions
OPENCODE_MODEL="opencode/big-pickle"

# Local speech-to-text endpoint (Phase 2: voice input)
WHISPER_API_URL="http://localhost:8080"
```

Optional extra set (Uncomment only what you actually need + then set those values to real ones):

- **LinkedIn publishing** — `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` (Step 5, as per the instructions in [.env.example](../.env.example))
- **Gmail and/or Zoho Mail** — `GOOGLE_*` / `ZOHO_*` (+ `MAIL_ENCRYPTION_KEY`, generate with `openssl rand -hex 32`)
- **Desktop voice daemon** — `SECPTILE_ASSISTANT_SECRET` (`openssl rand -hex 32`)

> Rule: never commit `.env.local` or any real secret. It is already gitignored.

## 3. Run a development build for the first time

```bash
pnpm build
pnpm lint        # non-blocking housekeeping; currently reports errors. Do not rely on this in your workflow for now.
```

## 4. Start the app

```bash
pnpm dev
```

Open [http://localhost:3100](http://localhost:3100). You start on **Chat**:

| Page | Purpose |
|-----------|---------|
| Chat (`/`) | Speak or type your day → clarifying questions → draft |
| Today's Tea (`/tea`) | Edit the draft, mandatory cover photo, LinkedIn preview |
| Tracker (`/tracker`) | Published posts + views analytics |
| Mail (`/mail`) | Unified Gmail + Zoho inbox (needs provider env) |
| Feedback (`/feedback`) | Portfolio blog comment review (needs Supabase env) |

Useful scripts:

```bash
pnpm dev     # dev server (http://localhost:3100)
pnpm build   # production build
pnpm start   # run the production build
pnpm lint    # eslint
```

## Optional extras

- **Local Whisper server** (via `whisper.cpp` or `faster-whisper`) — listens on
  `WHISPER_API_URL` (default `http://localhost:8080`). Voice recording needs it.
- **Desktop wake-word daemon** (`daemon/`) — covers "hey secptile" wake-ups and
  voice journaling without opening the app. One-command setup:

  ```bash
  ./daemon/install.sh
  ```

- **OpenCode workspace** — journal sessions run in an isolated directory
  (`~/.secptile/workspace` by default). Keep it away from your own repos;
  see `OPENCODE_WORKSPACE_DIR` in `.env.example`.

## Troubleshooting

**Build fails about a missing module?** Run `pnpm install` again. If you switched
branches mid-way, delete `.next/` and retry.

**"opencode: command not found"?** Add it to your PATH: `mise use -g opencode`.

**Browser can't connect to the app?** Confirm the dev server's PORT in the
output (the routes default to 3100, per `PORT` in `.env.example`).

**Voice button does nothing?** Recordings need `WHISPER_API_URL` to be a live
endpoint; check with `curl $WHISPER_API_URL`.

Still stuck? [Open an issue](https://github.com/MrRishabThapa/secptile/issues/new/choose)
with your OS, Node version, and what you tried — followed the instructions in
[the bug report template](../.github/ISSUE_TEMPLATE/bug_report.yml).
