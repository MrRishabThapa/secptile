#!/usr/bin/env bash
# Secptile desktop assistant installer (Phase 6).
#
# Sets up:
#   1. daemon venv (python -m venv) + livekit-wakeword runtime deps
#   2. ~/.secptile/assistant.toml  +  ~/.secptile/assistant/chime.wav
#   3. secptile-mute in ~/.local/bin
#   4. systemd --user units (app, whisper, wake check, echo cancel, daemon)
#   5. the speech detection and wake check models
#   6. Piper and its voice in local-tts/ (Secptile's local voice)
#
# The daemon itself is NOT started: it opens your mic, so that stays your call.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECPTILE_DIR="$HOME/.secptile/assistant"
CONFIG_PATH="$HOME/.secptile/assistant.toml"
WHISPER_MODEL_DIR="$HOME/.secptile/models"

# Pinned downloads: the checksums below are verified before anything is used.
SILERO_VERSION="6.2.3"
SILERO_WHEEL_SHA256="7b7f5436cfcb02fae583a05b512ea96467fd449fe54cb49a5e4f06c51a1e43b8"
WAKE_MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
WAKE_MODEL_SHA1="137c40403d78fd54d454da0f9bd998f78703390c"
PIPER_VERSION="1.8.0"
PIPER_VOICE="en_US-lessac-medium"
PIPER_VOICE_SHA256="5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f"

echo "== Secptile assistant install =="

# --- 1. venv -----------------------------------------------------------------
if [[ ! -d "$REPO_DIR/daemon/.venv" ]]; then
    echo "Creating daemon venv…"
    python3 -m venv "$REPO_DIR/daemon/.venv"
fi
"$REPO_DIR/daemon/.venv/bin/pip" install --quiet --upgrade pip
"$REPO_DIR/daemon/.venv/bin/pip" install --quiet "$REPO_DIR/daemon"
echo "venv ready: $REPO_DIR/daemon/.venv"

# --- 2. runtime files --------------------------------------------------------
mkdir -p "$SECPTILE_DIR/models"
if [[ ! -f "$CONFIG_PATH" ]]; then
    cp "$REPO_DIR/daemon/assistant.toml.example" "$CONFIG_PATH"
    echo "Wrote $CONFIG_PATH — EDIT IT (secret, launch command, match strings)."
fi
cp "$REPO_DIR/daemon/assets/chime.wav" "$SECPTILE_DIR/chime.wav"
cp "$REPO_DIR/daemon/pipewire/secptile-echo-cancel.conf" "$SECPTILE_DIR/secptile-echo-cancel.conf"

# Speech detection model: only the .onnx file is taken from the Silero wheel.
VAD_MODEL="$SECPTILE_DIR/models/silero_vad.onnx"
if [[ ! -f "$VAD_MODEL" ]]; then
    echo "Fetching the Silero speech detection model…"
    VAD_TMP="$(mktemp -d)"
    "$REPO_DIR/daemon/.venv/bin/pip" download --quiet --no-deps --dest "$VAD_TMP" "silero-vad==$SILERO_VERSION"
    echo "$SILERO_WHEEL_SHA256  $VAD_TMP/silero_vad-$SILERO_VERSION-py3-none-any.whl" | sha256sum --check --quiet
    "$REPO_DIR/daemon/.venv/bin/python" -I -c '
import sys, zipfile
wheel, target = sys.argv[1:]
with open(target, "wb") as out:
    out.write(zipfile.ZipFile(wheel).read("silero_vad/data/silero_vad.onnx"))
' "$VAD_TMP/silero_vad-$SILERO_VERSION-py3-none-any.whl" "$VAD_MODEL"
    rm -rf "$VAD_TMP"
fi

# Wake check model (about 148 MB).
mkdir -p "$WHISPER_MODEL_DIR"
WAKE_MODEL="$WHISPER_MODEL_DIR/ggml-base.en.bin"
if [[ ! -f "$WAKE_MODEL" ]]; then
    echo "Fetching the wake check model…"
    curl -fL --progress-bar -o "$WAKE_MODEL.part" "$WAKE_MODEL_URL"
    echo "$WAKE_MODEL_SHA1  $WAKE_MODEL.part" | sha1sum --check --quiet
    mv "$WAKE_MODEL.part" "$WAKE_MODEL"
fi

# Secptile's voice: Piper in its own venv, separate from the daemon's.
TTS_DIR="$REPO_DIR/local-tts"
if [[ ! -d "$TTS_DIR/.venv" ]]; then
    python3 -m venv "$TTS_DIR/.venv"
fi
"$TTS_DIR/.venv/bin/pip" install --quiet "piper-tts[http]==$PIPER_VERSION"
PIPER_VOICE_FILE="$TTS_DIR/voices/$PIPER_VOICE.onnx"
if [[ ! -f "$PIPER_VOICE_FILE" ]]; then
    echo "Fetching the Piper voice…"
    mkdir -p "$TTS_DIR/voices"
    "$TTS_DIR/.venv/bin/python" -m piper.download_voices "$PIPER_VOICE" --data-dir "$TTS_DIR/voices"
    echo "$PIPER_VOICE_SHA256  $PIPER_VOICE_FILE" | sha256sum --check --quiet
fi

# --- 3. mute helper ----------------------------------------------------------
mkdir -p "$HOME/.local/bin"
install -m 755 "$REPO_DIR/daemon/bin/secptile-mute" "$HOME/.local/bin/secptile-mute"

# --- 4. systemd --user units -------------------------------------------------
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"

PNPM_PATH="$(command -v pnpm || true)"
if [[ -z "$PNPM_PATH" ]]; then
    echo "pnpm not found on PATH — the app unit will need ExecStart edited." >&2
    PNPM_PATH="$HOME/.local/share/pnpm/pnpm"
fi
NODE_BIN_DIR="$(dirname "$(command -v node)")"   # next(1) is a node script
CODE_BIN_DIR="$(dirname "$(command -v opencode)")"  # journal route spawns opencode
APP_UNIT="$UNIT_DIR/secptile-app.service"
APP_UNIT_SRC="$REPO_DIR/daemon/systemd/secptile-app.service"

sed "s|__NODE_BIN_DIR__|$NODE_BIN_DIR|; s|__OPENCODE_BIN_DIR__|$CODE_BIN_DIR|; s|WorkingDirectory=%h/Projects/secptile|WorkingDirectory=$REPO_DIR|; s|ExecStart=%h/Projects/secptile|ExecStart=$REPO_DIR|" \
    "$APP_UNIT_SRC" > "$APP_UNIT"
DAEMON_UNIT="$UNIT_DIR/secptile-daemon.service"
DAEMON_UNIT_SRC="$REPO_DIR/daemon/systemd/secptile-daemon.service"
sed "s|WorkingDirectory=%h/Projects/secptile/daemon|WorkingDirectory=$REPO_DIR/daemon|; s|ExecStart=%h/Projects/secptile/daemon/.venv/bin/python|ExecStart=$REPO_DIR/daemon/.venv/bin/python|" \
    "$DAEMON_UNIT_SRC" > "$DAEMON_UNIT"
WHISPER_UNIT="$UNIT_DIR/secptile-whisper.service"
WHISPER_UNIT_SRC="$REPO_DIR/daemon/systemd/secptile-whisper.service"
cp "$WHISPER_UNIT_SRC" "$WHISPER_UNIT"
sed "s|%h/Projects/secptile|$REPO_DIR|g" "$REPO_DIR/daemon/systemd/secptile-tts.service" > "$UNIT_DIR/secptile-tts.service"
cp "$REPO_DIR/daemon/systemd/secptile-whisper-wake.service" "$UNIT_DIR/secptile-whisper-wake.service"
cp "$REPO_DIR/daemon/systemd/secptile-echo-cancel.service" "$UNIT_DIR/secptile-echo-cancel.service"

systemctl --user daemon-reload
systemctl --user enable secptile-whisper.service   # transcribe ready at login
systemctl --user enable --now secptile-tts.service secptile-whisper-wake.service secptile-echo-cancel.service

# --- 5. secrets --------------------------------------------------------------
if ! grep -q "SECPTILE_ASSISTANT_SECRET" "$REPO_DIR/.env.local" 2>/dev/null; then
    echo "" >> "$REPO_DIR/.env.local"
    echo "# Desktop assistant shared secret (Phase 6). Generate with: openssl rand -hex 32" >> "$REPO_DIR/.env.local"
    echo "SECPTILE_ASSISTANT_SECRET=\"$(openssl rand -hex 32 2>/dev/null || true)\"" >> "$REPO_DIR/.env.local"
    echo "Generated SECPTILE_ASSISTANT_SECRET into .env.local"
    echo "-- copy the SAME value into $CONFIG_PATH under [app] secret (or export it to the daemon unit)!"
fi

systemctl --user enable --now secptile-app.service
echo "App unit enabled. The daemon opens your mic, so it does not start by itself."
echo "When you are ready, run:"
echo "  systemctl --user enable --now secptile-daemon.service"
echo "Watch logs: journalctl --user -u secptile-daemon -f"
echo "Mute hotkey (Hyprland 0.56 Lua config):"
echo '  hl.bind("SUPER + SHIFT + M", hl.dsp.exec_cmd("secptile-mute"))'
