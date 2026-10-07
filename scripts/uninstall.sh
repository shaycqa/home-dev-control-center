#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
systemctl --user disable --now home-dev-control.service
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/home-dev-control.service"
systemctl --user daemon-reload
python3 scripts/remove-private-access.py
sudo rm -f /etc/sudoers.d/home-dev-control /usr/local/libexec/home-dev-control-helper
printf 'Service and owned routes removed. Config, data, backups, checkout and tmux sessions preserved. Linger remains enabled.\n'
