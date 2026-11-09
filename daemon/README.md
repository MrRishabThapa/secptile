# Secptile daemon (desktop voice assistant)

Standalone Python service for Phase 6 ("Desktop voice assistant"). It is a
separate service from the Next.js app and lives at `daemon/` on purpose:
it must not be bundled into the web app and it has its own runtime.

The daemon imports **nothing** from `src/` and `src/` imports nothing from
`daemon/`. They only talk over **HTTP on localhost**, sharing the
`SECPTILE_ASSISTANT_SECRET` env var (see `.env.example`):

## How a conversation works

1. Say **"secptile"**. Silero detects speech, a small local whisper server
   (`127.0.0.1:8081`) transcribes it, and `wake.py` looks for the word at the
   start. You hear a chime. "Hey secptile" works too.
2. Secptile greets you in its Piper voice and stays **awake**. While awake,
   everything you say goes to the Chat page with no wake word, including side
   conversations. If you said more after the wake word, it skips the greeting.
3. Short turns use the fast whisper server, and longer ones go through
   `/api/transcribe`. The Chat page answers. The app window opens if needed.
4. The Chat page sends its questions to `/api/assistant/speech`, and the daemon
   speaks them. Answer out loud with no wake phrase.
5. **Talk over Secptile to interrupt it.** Playback stops and your words become
   your turn.
6. Say **"kudos"** to put it to sleep. It also stops listening freely after
   `awake_seconds` of quiet (3 minutes by default).

| Say | What happens |
| --- | --- |
| "secptile" | Wakes it. Works in one breath too: "secptile, mega evolve" |
| "kudos" | Puts it to sleep and returns OpenCode to medium |
| "mega evolve" | Runs OpenCode in high mode until "kudos", or until the app restarts |
| "open system" / "close system" | Opens or closes the app window |

Commands must be your whole turn, so "kudos to my team for shipping" stays part
of your day. While asleep, only the wake word is acted on.

OpenCode effort comes from `OPENCODE_MODEL` plus `#medium` or `#high`. Not every
model has these levels: the header shows "No effort levels" if yours doesn't,
and runs continue on the plain model. High mode can also be toggled from the
button in the chat header.

Nothing here can publish. Approval stays a button click in the UI.

When the daemon is off or muted, the Chat page speaks through the browser.

The Chat page must be open on `/` for the journal to run. Spoken turns wait
there for up to 10 minutes if another page is showing.

Voice commands ("secptile, open system" / "secptile, close system") control the app
window through `windowctl.py`. The window is matched by class, never by title.

## Desktop widget

`widget/` pins your Braille art above the wallpaper and below your windows, and
follows the assistant's status. It is grey until "mega evolve", then in colour
until "kudos". Clicks pass through it.

Your art is not in this repo. It lives in `~/.secptile/widget/`:

- `base.txt` is the normal form. The face positions in `build_frames.py` are
  tuned to this exact drawing, so different art needs those numbers changed.
- `mega.txt` is optional and replaces the drawn-on mega form. Use the same grid.

After changing either, run `python3 daemon/widget/build_frames.py` and
`systemctl --user restart secptile-widget`. To resize it, change `dotPitch` and
`dotSize` in `shell.qml`, then copy it to `~/.secptile/widget/`.

## Layout

| Path | Purpose |
| --- | --- |
| `assistant.py` | Main loop: wake phrase → conversation → journal |
| `wake.py` | Fuzzy wake phrase matching, plus the optional trained-model engine |
| `vad.py` | Silero speech detection (local ONNX) |
| `capture.py` | Microphone through `pw-record`, and end-of-speech detection |
| `speaker.py` | Gets local Piper speech from `/api/tts`, sentence by sentence, and plays it with `pw-cat` |
| `transcribe.py` | Spoken turns through the app, and fast wake checks |
| `intents.py` | Wake-phrase stripping + open/close system intents |
| `feedback.py` | Wake chime (`assets/chime.wav`) |
| `config.py` | Loads `~/.secptile/assistant.toml` (never committed) |
| `windowctl.py` | Opens/closes the app window (Hyprland 0.56 Lua dispatchers) |
| `tests/` | `python -m unittest discover -s daemon/tests` |
| `pipewire/` | Echo cancellation config, run as its own process |
| `assistant.toml.example` | Copy to `~/.secptile/assistant.toml` and edit there |
| `install.sh` / `uninstall.sh` | venv, config, models, mute helper, systemd units |
| `systemd/` | App, daemon, whisper, wake check, voice and echo cancellation units |
| `../local-tts/` | Piper venv and voice files (not tracked by git) |

`build/`, `.venv/`, `secptile_assistant.egg-info/` and `__pycache__/` are local
build artifacts (not tracked).

## Run

```sh
./daemon/install.sh          # one-time setup; does not open your mic
systemctl --user enable --now secptile-daemon.service   # opens your mic

journalctl --user -u secptile-daemon -f   # live status
```

Run manually instead: `cd daemon && .venv/bin/python assistant.py` (config from
`~/.secptile/assistant.toml`).

## Tuning

All of this is in `~/.secptile/assistant.toml`:

- **Secptile interrupts itself on speakers:** raise `barge_threshold` or
  `barge_min_seconds` under `[conversation]`.
- **It cuts you off mid-thought:** raise `end_of_turn_seconds` under `[capture]`.
- **Changing the voice:** run `.venv/bin/python -m piper.download_voices <voice>
  --data-dir voices` in `local-tts/`, then change `-m` in `secptile-tts.service`.
- **Using a trained wake model:** set `engine = "model"` under `[wake]`.
  Training with `livekit-wakeword` needs a CUDA GPU or Apple silicon.

## Privacy

- While waiting for the wake phrase, audio stays in memory. Only detected speech
  goes to the local whisper server, and nothing is written to disk.
- Your voice and transcripts stay on this machine, apart from the transcript
  text the journal sends through OpenCode.
- Secptile's voice is generated locally by Piper.
- The app, whisper and Piper servers bind to localhost only.
- Mute with `secptile-mute`: it ends the mic process, and unmuting reopens it.
