# Secptile — Claude Code Briefing

You are working on **Secptile**, a personal, local-first voice journaling system for a
founder/UX designer (Rishab). Read `AGENTS.md` in the repo root — it already contains the
authoritative spec (project goal, tech stack, phases, hard rules, commit discipline).
This file tells you **where the project actually is today** and what to do next.

## What the project is (one paragraph)

Every evening the owner speaks a summary of their day (voice, not typing). The app
transcribes it locally, sends the transcript to **OpenCode** (headless on the same
machine) to shape a blog-style story, asks voice/text clarifying questions until the
story is complete, then shows a draft with a LinkedIn preview. Only after **explicit
approval in the UI** does it save to a local SQLite blog DB (mandatory cover photo) and,
optionally, publish to LinkedIn via the official API. Nothing is ever published
without approval. A later phase adds an always-on desktop voice assistant
(wake word "hey secptile" / "hey secp").

## Tech stack (do not drift from this)

- Next.js (App Router) + React + TypeScript (strict), Tailwind, zod for all API bodies and model contracts
- OpenCode as the brain (invoked from route handlers; JSON-only model output validated with zod)
- Local whisper.cpp for speech-to-text (mic recording via MediaRecorder in the browser)
- **Voice output works via Qwen3-TTS-Flash** (Alibaba DashScope, `DASHSCOPE_API_KEY` in `.env.local`):
  `/api/tts` proxies speech, `src/lib/voice/speaker.ts` plays it in the browser,
  voice text comes from the Qwen voice `Cherry` (`TTS_VOICE` env to change)
- Blog storage: local SQLite (`node:sqlite`) at `~/.secptile/blog/blog.db` — never a repo
- No secrets in the repo; `.env.local` only. No browser automation for LinkedIn.

## Parts already built (do not redo)

- `/` Chat page — voice/text journal entry → OpenCode loop → clarifying questions → draft
- Wake flow: transcript containing "hey secptile i am here" triggers the greeting
  **"welcome boss, how was your day?"** (spoken aloud via Qwen TTS + shown as a banner)
- `/tea` — draft editor + LinkedIn preview + approve-flow (publishes only after approval,
  cover photo mandatory, optional photo attached to the LinkedIn post)
- `/clock`, `/tracker` (posts + views analytics), `/feedback` (pending blog-comment review),
  `/mail` (e-mail phase 7a), `/updates`
- `/api/*` route handlers: transcribe (whisper proxy), tts (Qwen TTS proxy),
  journal, history, photos, posts, publish, linkedin auth/post, mail (google/zoho),
  assistant/transcript, system, updates, feedback

## Current state — IMPORTANT

- Actively maintained branch: `feat/voice-responses` (5 commits ahead of
  `refactor/folder-structure`; **not yet pushed** — SSH auth was unavailable when commits
  were made; owner pushes manually). It adds spoken responses via Qwen3-TTS-Flash:
  greeting, clarifying questions, and errors are spoken on the Chat page, with a
  mute/speaking toggle (`VoiceToggle`, no emoji — lucide icons only).
- **This branch is untested against the real DashScope API** (no `DASHSCOPE_API_KEY`
  configured in `~/.secptile` envs when built; typecheck, eslint, and `pnpm build` all pass).
- Not yet started: Phase 6 (always-on wake-word daemon), Phase 8 (polish,
  streaming, accessibility). Assistant-bar/daemon plumbing exists but is partial.

## What to do next (in this order)

1. Branch policy: work on feature branches (`feat/…`, `fix/…`), never on `main`.
2. **First task — verify the commit/branch state and push parity.**
3. Full pending backlog, in value order:
   - Speak a confirmation when the draft is ready (currently navigates away silently)
   - Voice the "ready" hand-off via OpenCode streaming before LinkedIn share
   - Phase 6: local VAD + wake-word daemon ("hey secptile"), exclusive mic ownership
   - End-to-end test of `/tracker` counts and `/feedback`

## Hard rules (paraphrased from AGENTS.md — treat as strict)

1. Never publish anything anywhere without explicit user approval in the UI.
2. No secrets in the repo; never log tokens; server-side code only reads `.env.local`.
3. Do not invent API/SDK endpoints — verify against current docs (OpenCode, DashScope,
   LinkedIn Posts API `202610`, Images API) or ask the owner.
4. One commit per change, explicit file staging, Conventional Commits messages.
5. If something is ambiguous, ask the owner — don't guess.

New builds will be based on `refactor/folder-structure`, which currently maps to all
the surfaces listed in the "already built" section. Keep `CLAUDE.md` and `AGENTS.md`
consistent as work progresses.
