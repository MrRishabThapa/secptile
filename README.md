# Secptile 🦎

A personal voice journal that turns "here's how my day went" into a polished blog post — drafted by [OpenCode](https://opencode.ai) running on the same machine, reviewed and approved by you, then saved and shared **only after explicit approval**.

## How it works

1. 🎙️ Speak a summary of your day (voice or text) in **Chat with Secptile**.
2. 🧠 The transcript is sent to OpenCode (`opencode run`, JSON-only prompt, strict zod gate).
3. ❓ OpenCode asks clarifying questions until the day's story is complete.
4. 📝 The finished draft lands on **Today's Tea** — editor, mandatory cover photo, LinkedIn preview with the hook-first post text.
5. 👀 You attach a photo, edit or regenerate with a note, and **approve**.
6. 🚀 Only after explicit approval: the post is saved (with its cover photo) into the local SQLite blog DB (`node:sqlite`, `~/.secptile/blog/blog.db` — no repos, no commits), and a LinkedIn post goes out via the official Posts API (`POST https://api.linkedin.com/rest/posts`, `Linkedin-Version: 202610`, `X-Restli-Protocol-Version: 2.0.0`), optionally carrying the same cover photo (Images API upload).

**LinkedIn routes (source of truth — do not rename):** OAuth starts at
`GET /api/auth/linkedin/start`, LinkedIn returns to
`GET /api/auth/linkedin/callback`, and posting is `POST /api/linkedin/post`.
The registered redirect URL must match the callback exactly.

## Tech stack

- **Next.js 16** (App Router, Turbopack) + React 19 + TypeScript (strict)
- **Tailwind CSS** v4
- **zod** validation on every structured model response and API body
- **OpenCode** via the `opencode` CLI (`opencode run --format json`), session continued with `--session <id>` for the clarifying loop. Intended path is the official SDK once its v2 client matches `opencode serve` v2; verified mismatch in Nov 2026 and went with the CLI (see git history).
- **whisper.cpp / faster-whisper** locally for speech-to-text (Phase 2 — live-verified Nov 2026)
- **pnpm** for package management

## Polish highlights (Phase 6)

- **Streaming turns** — `/api/journal/stream` (NDJSON) pings "Talking to OpenCode… / session started" while the model works; the JSON contract is still gated by the same zod schemas
- **History of past days** — every finished day is one JSON record in `~/.secptile/history/`; "Past days" lists them with publish/LinkedIn badges and the original transcript kept local
- **STT-tolerant wake phrase** — span-alignment fuzzy matcher handles "sep tile", "i'm", and misheard filler words
- **Error states** — publishing/social failures surface exact LinkedIn errors, push failures explain themselves, history never 500s the page

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

- `SECPTILE_BLOG_DIR` — optional directory for the SQLite blog DB (default `~/.secptile/blog`; file `blog.db`; cover photos stored as rows inside it)

LinkedIn environment (in `.env.local`) — create the app at
[linkedin.com/developers](https://www.linkedin.com/developers), request both
**"Sign In with LinkedIn using OpenID Connect"** (`openid`, `profile` — the
member's `sub`) and **"Share on LinkedIn"** (`w_member_social`), and register
the redirect URL `http://localhost:3000/api/auth/linkedin/callback` under the
Auth tab (localhost http redirect only works for this exact URI):

- `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` — app credentials
- `LINKEDIN_REDIRECT_URI` — must match the app's registered redirect URL exactly
- `LINKEDIN_API_VERSION` — optional `Linkedin-Version` header override (default `202610`)
- `LINKEDIN_TOKEN_FILE` — optional token store path (default `~/.secptile/linkedin.json`, mode 0600, outside any repo)
- `SECPTILE_HISTORY_DIR` — optional journal-day history location (default `~/.secptile/history`)

OAuth notes (verified against the current docs): the app authenticates via
 scopes `openid profile w_member_social`; the member URN comes from
`GET https://api.linkedin.com/v2/userinfo` → `sub` → `urn:li:person:{sub}`.
Access tokens expire every 60 days; programmatic refresh tokens are only
granted to approved Marketing Platform partners, so Secptile re-runs the
OAuth flow when the token dies (LinkedIn bypasses the consent screen while
you're logged in and the token is still valid), then falls back to the
consent screen after that. Everything (expiry date, Reconnect button) shows
on the share panel. **Note:** requesting a different scope set than before
revokes previously issued tokens — one reconnect after the OIDC switch is
expected.

Testing (disposable post): save the post to Today's Tea (SQLite only — just
delete the rows from `~/.secptile/blog/blog.db` afterwards, or the whole file
when no real posts exist), then post from the share panel (the two-click
confirm guards double-posts) and delete the test post on LinkedIn. The post
button only enables after the blog is saved, and retries after a LinkedIn
failure don't resave the blog post.

## Project status

| Phase                                  | Scope                        | Status                                |
| -------------------------------------- | ---------------------------- | ------------------------------------- |
| 0                                      | Scaffold                     | ✅                                    |
| 1                                      | Text-only journal loop       | ✅                                    |
| 2                                      | Voice input (local Whisper)  | ✅ code · ⏳ STT live verify pending   |
| 3                                      | Draft editor + approval      | ✅                                    |
| 4                                      | Blog publishing (SQLite + photo) | ✅                               |
| 5                                      | LinkedIn publishing          | ✅ (route contract, OIDC scopes)      |
| 6                                      | Desktop voice assistant      | ✅ code · ⏳ wake models to train      |
| 7                                      | Polish & streaming           | ✅                                    |

## Phase 6 — desktop voice assistant

The app and a local Python daemon (`daemon/`) run as systemd `--user`
services. The daemon wakes on your trained wake phrase, records with an
energy VAD until you stop talking, transcribes through this app's existing
whisper route (`/api/transcribe`, no second model loaded), and either:

- `open system` / `open secptile` → focuses an existing Hyprland window that
  matches the config, or launches it (`hyprctl`, never duplicate);
- `close system` / `hide` → closes the matched window;
- anything else → straight into the journal as spoken text (only on the idle
  home screen).

### Setup (single command)

```bash
./daemon/install.sh            # venv + config + chime + mute + systemd units
```

Then follow "Train the wake words" and finish with
`systemctl --user enable --now secptile-daemon.service`. Uninstall:

```bash
./daemon/uninstall.sh
```

### Train the wake words (offline, livekit-wakeword)

Verified source: [livekit/livekit-wakeword](https://github.com/livekit/livekit-wakeword)
(Apache-2.0; custom-phrase training uses the same one-command CLI as their
README — do **not** invent flags, copy from the repo's own `Install`/
`Training a Custom Wake Word` section). The pipeline is:

```bash
pip install "livekit-wakeword[train,eval,export]"   # per the repo docs
# TODO(prompt in CLI): train and export for "hey secptile" and "hey secp"
# put the .onnx files in ~/.secptile/assistant/models/
```

Only two openWakeWord-family phrases, per `wake.models` in the config. The
ONNX files are yours — never committed.

### Privacy (in the design, not just documented)

- While **waiting** for the wake phrase, frames go straight to the ONNX
  model in RAM: **nothing on disk, nothing anywhere else**.
- The mic stream is `InputStream`-based; the mute (`secptile-mute`) *fully
  closes the stream* (no capture at all) until unmuted.
- Everything (audio, transcript, chime) stays on your machine; the app and
  daemon both bind to localhost.
- The live status (`listening / transcribing / sent / muted / stopped`) is
  shown in the app UI and in `journalctl --user -u secptile-daemon`.
- Voice can **never** publish: the transcript lands in the normal journal
  flow, whose publish actions stay clicks-only.

Known limitations: deterministic energy VAD may unwrap a long pause early
(set `silence_hangover_seconds` up); "open system" only fires when starting
a sentence; if the utterance contains the exact wake phrase it is a false
hit — thresholds and negatives tuning help; piper TTS is off by default;
whisper must be reachable at the URL the whisper service sets.

See [AGENTS.md](./AGENTS.md) for the project rules, phase plan, and conventions.

## Repo conventions

- **One file per commit** — every commit contains exactly one changed file.
- One feature branch per phase; `main` holds reviewed milestones.
- Secrets live in `.env.local` only (see `.env.example`); never commit real values.
- Nothing is ever published without explicit approval in the UI.
