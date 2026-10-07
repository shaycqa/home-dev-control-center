#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
if [ "$(id -u)" = 0 ]; then echo 'Run as your development user, not root.' >&2; exit 1; fi
if [ "$#" -lt 1 ]; then echo 'Usage: scripts/install.sh TAILSCALE_LOGIN [bootstrap options: --port PORT --root DIRECTORY]' >&2; exit 1; fi
for tool in node npm python3 git tmux ss tailscale systemctl sudo; do command -v "$tool" >/dev/null || { echo "Missing requirement: $tool" >&2; exit 1; }; done
HDC_SOURCE_DIR="$PWD"
HDC_NODE="$(command -v node)"
HDC_USER="$(id -un)"
HDC_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
# A second installation must not replace an existing service or privileged helper.
if [ -e "$HDC_UNIT_DIR/home-dev-control.service" ] || [ -e /etc/sudoers.d/home-dev-control ]; then
  echo 'Existing installation detected. Use update.sh in its checkout, or uninstall it first.' >&2; exit 1
fi
npm ci
npm rebuild node-pty esbuild
npm run build
python3 scripts/bootstrap.py --user "$@"
python3 scripts/configure-private-access.py --no-restart
sudo install -D -o root -g root -m 0755 scripts/privileged-helper.py /usr/local/libexec/home-dev-control-helper
HDC_SUDOERS="$(mktemp)"
trap 'rm -f "$HDC_SUDOERS"' EXIT
printf '%s ALL=(root) NOPASSWD: /usr/local/libexec/home-dev-control-helper\n' "$HDC_USER" > "$HDC_SUDOERS"
sudo visudo -cf "$HDC_SUDOERS"
sudo install -o root -g root -m 0440 "$HDC_SUDOERS" /etc/sudoers.d/home-dev-control
mkdir -p "$HDC_UNIT_DIR"
python3 scripts/service.py "$HDC_SOURCE_DIR" "$HDC_NODE" "$HDC_UNIT_DIR/home-dev-control.service"
sudo loginctl enable-linger "$HDC_USER"
systemctl --user daemon-reload
systemctl --user enable --now home-dev-control.service
systemctl --user is-active home-dev-control.service
printf 'Installed. Read the accessKey in your private config.json to unlock the dashboard.\n'
