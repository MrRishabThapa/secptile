#!/usr/bin/env bash
# Secptile desktop assistant uninstaller (Phase 6).
# Stops and disables both user services, removes the installed copies
# (~/.local/bin/secptile-mute + units), and deletes the daemon venv.
# Your data stays: ~/.secptile (config, models, chime, history) is untouched.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

systemctl --user disable --now secptile-daemon.service 2>/dev/null || true
systemctl --user disable --now secptile-tts.service 2>/dev/null || true
systemctl --user disable --now secptile-echo-cancel.service 2>/dev/null || true
systemctl --user disable --now secptile-whisper-wake.service 2>/dev/null || true
systemctl --user disable --now secptile-app.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/secptile-daemon.service" "$HOME/.config/systemd/user/secptile-app.service" \
    "$HOME/.config/systemd/user/secptile-tts.service" \
    "$HOME/.config/systemd/user/secptile-echo-cancel.service" "$HOME/.config/systemd/user/secptile-whisper-wake.service"
systemctl --user daemon-reload

rm -f "$HOME/.local/bin/secptile-mute"
rm -rf "$REPO_DIR/daemon/.venv"

echo "Secptile assistant removed (runtime files remain in ~/.secptile — delete"
echo "$HOME/.secptile/assistant yourself if you want them gone)." >&2
