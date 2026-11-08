# Secptile daemon (desktop voice assistant)

Standalone Python service for Phase 6 ("Desktop voice assistant"). It is a
separate service from the Next.js app and lives at `daemon/` on purpose:
it must not be bundled into the web app and it has its own runtime.

The daemon imports **nothing** from `src/` and `src/` imports nothing from
`daemon/`. They only talk over **HTTP on localhost**, sharing the
`SECPTILE_ASSISTANT_SECRET` env var (see `.env.example`):

- The daemon records audio (energy VAD), transcribes it through the app's
  existing `/api/transcribe` route (local whisper server on `127.0.0.1:8080`),
  and posts the transcript to the app (`/api/assistant/transcript`,
  secret-guarded) so it shows up in the Chat page.
- The Chat page polls `/api/assistant/status` for the live daemon status
  (`listening / transcribing / sent / muted / stopped`), which the daemon also
  mirrors through a status file.
- Voice commands ("hey secptile / hey secp …, open system / close system")
  control the app window via `windowctl.py`.

## Layout

| Path | Purpose |
| --- | --- |
| `assistant.py` | Main entry point (event loop: wake word → capture → transcribe → forward) |
| `wake.py` | Wake-phrase detection training + inference ("hey secptile" / "hey secp") |
| `capture.py` | Microphone capture with energy VAD, mute/unmute handling |
| `transcribe.py` | Whisper server client (`/inference`) |
| `intents.py` | Wake-phrase stripping + open/close system intents |
| `feedback.py` | Spoken/chime feedback (`assets/chime.wav`) |
| `config.py` | Loads `~/.secptile/assistant.toml` (never committed) |
| `windowctl.py` | Opens/closes the app window (Hyprland) |
| `assets/chime.wav` | Activation sound |
| `assistant.toml.example` | Copy to `~/.secptile/assistant.toml` and edit there |
| `install.sh` / `uninstall.sh` | venv + config + chime + mute helper + systemd units |
| `systemd/` | `secptile-app.service` (Next.js app), `secptile-daemon.service` (this), `secptile-whisper.service` |

`build/`, `.venv/`, `secptile_assistant.egg-info/` and `__pycache__/` are local
build artifacts (not tracked).

## Run

```sh
./daemon/install.sh          # one-time setup: venv + config + systemd units
systemctl --user enable --now secptile-app.service   # Next.js app (port 3100)
systemctl --user enable --now secptile-whisper.service
systemctl --user enable --now secptile-daemon.service

journalctl --user -u secptile-daemon -f   # live status
```

Run manually instead: `daemon/.venv/bin/python assistant.py` (config from
`~/.secptile/assistant.toml`).

Privacy: everything (audio, transcript, chime) stays on your machine; both the
app and the daemon bind to localhost only. Mute via `daemon/bin/secptile-mute`.
