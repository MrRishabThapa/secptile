#!/usr/bin/env bash
# Secptile desktop assistant installer (Phase 6).
#
# Sets up:
#   1. daemon venv (python -m venv) + livekit-wakeword runtime deps
#   2. ~/.secptile/assistant.toml  +  ~/.secptile/assistant/chime.wav
#   3. secptile-mute in ~/.local/bin
#   4. two systemd --user units (app + daemon), enabled at login
#
# Your wake models must be trained before this daemon starts — see README
# "Phase 6: train the wake words". install.sh only CONFIGURES; it never trains.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECPTILE_DIR="$HOME/.secptile/assistant"
CONFIG_PATH="$HOME/.secptile/assistant.toml"

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
APP_UNIT="$UNIT_DIR/secptile-app.service"
APP_UNIT_SRC="$REPO_DIR/daemon/systemd/secptile-app.service"

# Rewrite ExecStart to the real pnpm location, keep everything else.
sed "s|%h/.local/share/pnpm/pnpm|$PNPM_PATH|; s|WorkingDirectory=%h/Projects/secptile|WorkingDirectory=$REPO_DIR|" \
    "$APP_UNIT_SRC" > "$APP_UNIT"
DAEMON_UNIT="$UNIT_DIR/secptile-daemon.service"
DAEMON_UNIT_SRC="$REPO_DIR/daemon/systemd/secptile-daemon.service"
sed "s|WorkingDirectory=%h/Projects/secptile/daemon|WorkingDirectory=$REPO_DIR/daemon|; s|ExecStart=%h/Projects/secptile/daemon/.venv/bin/python|ExecStart=$REPO_DIR/daemon/.venv/bin/python|" \
    "$DAEMON_UNIT_SRC" > "$DAEMON_UNIT"

systemctl --user daemon-reload

# --- 5. secrets --------------------------------------------------------------
if ! grep -q "SECPTILE_ASSISTANT_SECRET" "$REPO_DIR/.env.local" 2>/dev/null; then
    echo "" >> "$REPO_DIR/.env.local"
    echo "# Desktop assistant shared secret (Phase 6). Generate with: openssl rand -hex 32" >> "$REPO_DIR/.env.local"
    echo "SECPTILE_ASSISTANT_SECRET=\"$(openssl rand -hex 32 2>/dev/null || true)\"" >> "$REPO_DIR/.env.local"
    echo "Generated SECPTILE_ASSISTANT_SECRET into .env.local"
    echo "-- copy the SAME value into $CONFIG_PATH under [app] secret (or export it to the daemon unit)!"
fi

systemctl --user enable --now secptile-app.service
echo "App unit enabled — the daemon is NOT started until its models exist."
echo "After training the wake models, run:"
echo "  systemctl --user enable --now secptile-daemon.service"
echo "Watch logs: journalctl --user -u secptile-daemon -f"
echo "Mute hotkey (Hyprland ~/.config/hypr/hyprland.conf):"
echo "  bind = SUPER SHIFT, M, exec, secptile-mute"
