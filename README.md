# Secptile

<img src="src/assets/logo.png" alt="Secptile logo" width="96" height="96" align="right" />

A personal voice journal that turns "here's how my day went" into a polished blog post — drafted by [OpenCode](https://opencode.ai) running on the same machine, reviewed and approved by you, then saved and shared only after explicit approval.

## How it works

1. Speak a summary of your day (voice or text) in Chat with Secptile.
2. The transcript is sent to OpenCode (`opencode run`, JSON-only prompt, strict zod gate).
3. OpenCode asks clarifying questions until the day's story is complete.
4. The finished draft lands on Today's Tea — editor, mandatory cover photo, LinkedIn preview with hook-first post text.
5. You attach a photo, edit or regenerate with a note, and approve.
6. Only after explicit approval: the post is saved (with its cover photo) into the local SQLite blog DB (`node:sqlite`, `~/.secptile/blog/blog.db` — no repos, no commits), and a LinkedIn post goes out via the official Posts API (`POST https://api.linkedin.com/rest/posts`, `Linkedin-Version: 202610`, `X-Restli-Protocol-Version: 2.0.0`), optionally carrying the same cover photo (Images API upload).

LinkedIn routes (source of truth — do not rename): OAuth starts at `GET /api/auth/linkedin/start`, LinkedIn returns to `GET /api/auth/linkedin/callback`, and posting is `POST /api/linkedin/post`. The registered redirect URL must match the callback exactly.

## Versions by branch

| Branch                      | Scope                                                                                                     | Status   |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | -------- |
| `phase-8-polish`            | Streaming responses, history, error states, accessibility                                                 | planned  |
| `phase-7-email`             | Gmail + Zoho OAuth, read-only unified inbox, message view, attachments, draft/reply/send with AI drafting | complete |
| `phase-6-desktop-assistant` | Local wake-word daemon ("hey secptile"), voice commands, systemd user services                            | complete |
| `phase-5-linkedin`          | OAuth flow, token storage and refresh, LinkedIn Posts API publishing with optional cover photo            | complete |
| `phase-4-blog-publishing`   | Approved posts saved to local SQLite blog DB, mandatory cover photo upload                                | complete |
| `phase-3-draft-editor`      | Editable draft, LinkedIn-style preview, Approve / Edit / Regenerate with note                             | complete |
| `phase-2-voice-input`       | Mic button, recording, local Whisper transcription, editable transcript before sending                    | complete |
| `phase-1-text-loop`         | Textbox to API route to OpenCode to zod-validated response to clarifying-questions UI to draft view       | complete |
| `phase-0-scaffold`          | Next.js + TypeScript + Tailwind setup, folder structure, env example, gitignore, README                   | complete |

`main` holds reviewed milestones. One feature branch per phase; one file per commit.

## E-mail (Phase 7a/7b/7d) — unified inbox, draft, send

Gmail and Zoho Mail connect via their official OAuth APIs and merge into one inbox (`/mail`): account switcher (All / Gmail / Zoho), search, unread badges, pagination, and a message view with sanitized HTML, attachment downloads streamed through the server, and Gmail thread view.

Phases 7a/7b are read-only: nothing is sent, modified, or deleted there.

Phase 7d adds Draft / Reply / Send (plain text in v1):

- New mail — button in the inbox header, choose a connected account.
- Reply — button inside any opened message; quotes the original and sets `In-Reply-To`/`References` (Gmail) or Zoho's reply action so threads stay coherent.
- Draft with AI — the same local OpenCode pipeline that generates the daily blog drafts a professional reply/new mail from your brief plus the quoted incoming mail. Incoming mail is treated strictly as untrusted data: instructions embedded in it cannot steer the draft. Output is plain text, no emojis (mechanically stripped as a second line of defense).
- Every send happens on your explicit Send click only — there is no autosend — and lands in a metadata-only local log (`~/.secptile/mail-sent.json`, mode 0600; bodies never written).

Sending needs one more scope per provider than the read-only inbox: `gmail.send` for Gmail and `ZohoMail.messages.CREATE` for Zoho — reconnect each account once to add them. Until then the inbox works as before and the UI offers no send surface for that account.

Tokens live at `~/.secptile/mail.json` (mode 0600, outside the repo) with access/refresh tokens AES-256-GCM-encrypted at rest (key: `MAIL_ENCRYPTION_KEY`). Bad/expired refreshes fail closed — the UI shows a Reconnect pill and you re-run the provider's connect flow. Rotating `MAIL_ENCRYPTION_KEY` logs both accounts out (honest fail-closed, no data damage — just reconnect).

### Google (Gmail) setup — console.cloud.google.com

1. Enable Gmail API (APIs & Services → Library) on the project.
2. OAuth consent screen: External → publish to production (Testing status expires refresh tokens every 7 days; production shows a one-time unverified app screen you accept — personal, single-user app).
3. Credentials → Create client → Web application, authorized redirect: `http://localhost:3100/api/mail/google/callback`.
4. `.env.local`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (`GOOGLE_REDIRECT_URI` only to override the default above).

### Zoho Mail setup — api-console.zoho.com

1. GET STARTED → Server-based Application → Create (name, homepage, redirect): `http://localhost:3100/api/mail/zoho/callback`.
2. Data center (must match where your Zoho account lives — check any `accounts.zoho.<domain>` login URL): set `ZOHO_ACCOUNTS_DOMAIN` and `ZOHO_MAIL_API_DOMAIN` to the same region (US → `accounts.zoho.com` / `mail.zoho.com`, IN → `.in`, EU → `.eu`, … — see `.env.example` table). The callback cross-checks Zoho's `accounts-server` echo and refuses a cross-data-center token early.
3. `.env.local`: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`; optional `ZOHO_MAILBOX` to pin a send-as identity. (`ZOHO_REDIRECT_URI` only to override the default above.)

Shared: `MAIL_ENCRYPTION_KEY` — generate once with `openssl rand -hex 32`.

Mail API routes are served on port **3100** (`PORT`-driven, see `SECPTILE_PORT`/`PORT` in `.env.example`) and are guarded by the API proxy (`src/proxy.ts`): localhost-only hosts, same-origin browser calls, OAuth login/callback routes exempt (they carry their own CSRF state cookie).

## Tech stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript (strict)
- Tailwind CSS v4
- zod validation on every structured model response and API body
- OpenCode via the `opencode` CLI (`opencode run --format json`), session continued with `--session <id>` for the clarifying loop
- whisper.cpp / faster-whisper locally for speech-to-text (Phase 2)
- pnpm for package management

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

Open [http://localhost:3100](http://localhost:3100).

Useful scripts:

```bash
pnpm dev     # start dev server
pnpm build   # production build
pnpm start   # run the production build
pnpm lint    # eslint (next/core-web-vitals + ts)
```

OpenCode environment (in `.env.local`):

- `OPENCODE_MODEL` — provider/model used for drafting (e.g. `opencode/big-pickle`)
- `OPENCODE_WORKSPACE_DIR` — isolated dir for journal sessions (not your repos; OpenCode agents have tool access inside it). Defaults to `~/.secptile/workspace`.
- `OPENCODE_SERVER_URL` — optional: attach runs to a headless server instead of the default background service
- `OPENCODE_BIN`, `OPENCODE_TIMEOUT_MS` — optional overrides

Publishing environment (in `.env.local`):

- `SECPTILE_BLOG_DIR` — optional directory for the SQLite blog DB (default `~/.secptile/blog`; file `blog.db`; cover photos stored as rows inside it)

Feedback environment (in `.env.local`) — Secptile reviews the pending comments of the portfolio blog, whose database is a Supabase project (URL + service_role key from the Supabase dashboard → Settings → API; the service_role key bypasses RLS and must stay server-side in `.env.local` only):

- `SUPABASE_URL` — the portfolio blog's Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — data API service_role key (never commit, never expose)

LinkedIn environment (in `.env.local`) — create the app at [linkedin.com/developers](https://www.linkedin.com/developers), request both "Sign In with LinkedIn using OpenID Connect" (`openid`, `profile` — the member's `sub`) and "Share on LinkedIn" (`w_member_social`), and register the redirect URL `http://localhost:3000/api/auth/linkedin/callback` under the Auth tab (localhost http redirect only works for this exact URI):

- `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` — app credentials
- `LINKEDIN_REDIRECT_URI` — must match the app's registered redirect URL exactly
- `LINKEDIN_API_VERSION` — optional `Linkedin-Version` header override (default `202610`)
- `LINKEDIN_TOKEN_FILE` — optional token store path (default `~/.secptile/linkedin.json`, mode 0600, outside any repo)
- `SECPTILE_HISTORY_DIR` — optional journal-day history location (default `~/.secptile/history`)

OAuth notes (verified against the current docs): the app authenticates via scopes `openid profile w_member_social`; the member URN comes from `GET https://api.linkedin.com/v2/userinfo` → `sub` → `urn:li:person:{sub}`. Access tokens expire every 60 days; programmatic refresh tokens are only granted to approved Marketing Platform partners, so Secptile re-runs the OAuth flow when the token dies (LinkedIn bypasses the consent screen while you are logged in and the token is still valid), then falls back to the consent screen after that. Everything (expiry date, Reconnect button) shows on the share panel. Note: requesting a different scope set than before revokes previously issued tokens — one reconnect after the OIDC switch is expected.

Testing (disposable post): save the post to Today's Tea (SQLite only — just delete the rows from `~/.secptile/blog/blog.db` afterwards, or the whole file when no real posts exist), then post from the share panel (the two-click confirm guards double-posts) and delete the test post on LinkedIn. The post button only enables after the blog is saved, and retries after a LinkedIn failure do not resave the blog post.

## Phase 6 — desktop voice assistant

The app and a local Python daemon (`daemon/`) run as systemd `--user` services. The daemon wakes on your trained wake phrase, records with an energy VAD until you stop talking, transcribes through this app's existing whisper route (`/api/transcribe`, no second model loaded), and either:

- `open system` / `open secptile` → focuses an existing Hyprland window that matches the config, or launches it (`hyprctl`, never duplicate);
- `close system` / `hide` → closes the matched window;
- anything else → straight into the journal as spoken text (only on the idle home screen).

### Setup (single command)

```bash
./daemon/install.sh            # venv + config + chime + mute + systemd units
```

Then follow "Train the wake words" and finish with `systemctl --user enable --now secptile-daemon.service`. Uninstall:

```bash
./daemon/uninstall.sh
```

### Train the wake words (offline, livekit-wakeword)

Verified source: [livekit/livekit-wakeword](https://github.com/livekit/livekit-wakeword) (Apache-2.0; custom-phrase training uses the same one-command CLI as their README — do not invent flags, copy from the repo's own Install/Training a Custom Wake Word section). The pipeline is:

```bash
pip install "livekit-wakeword[train,eval,export]"   # per the repo docs
# train and export for "hey secptile" and "hey secp"
# put the .onnx files in ~/.secptile/assistant/models/
```

Only two openWakeWord-family phrases, per `wake.models` in the config. The ONNX files are yours — never committed.

### Privacy (in the design, not just documented)

- While waiting for the wake phrase, frames go straight to the ONNX model in RAM: nothing on disk, nothing anywhere else.
- The mic stream is `InputStream`-based; the mute (`secptile-mute`) fully closes the stream (no capture at all) until unmuted.
- Everything (audio, transcript, chime) stays on your machine; the app and daemon both bind to localhost.
- The live status (`listening / transcribing / sent / muted / stopped`) is shown in the app UI and in `journalctl --user -u secptile-daemon`.
- Voice can never publish: the transcript lands in the normal journal flow, whose publish actions stay clicks-only.

Known limitations: deterministic energy VAD may unwrap a long pause early (set `silence_hangover_seconds` up); "open system" only fires when starting a sentence; if the utterance contains the exact wake phrase it is a false hit — thresholds and negatives tuning help; piper TTS is off by default; whisper must be reachable at the URL the whisper service sets.

## Security notes

- No secrets are committed to this repository. `.env.local`, `.env*.local`, and `.env` are all gitignored.
- Token files (`mail.json`, `mail-sent.json`, `linkedin.json`) live outside the repo at `~/.secptile/` with mode 0600.
- Never publish anything without explicit user approval in the UI. No auto-posting, no exceptions.
- Browser automation, scraping, or unofficial APIs are never used for LinkedIn; only the official Posts API via server-side OAuth.

See [AGENTS.md](./AGENTS.md) for the project rules, phase plan, and conventions.
22

## Repo conventions

- One file per commit — every commit contains exactly one changed file.
- One feature branch per phase; `main` holds reviewed milestones.
- Secrets live in `.env.local` only (see `.env.example`); never commit real values.
- Nothing is ever published without explicit approval in the UI.
