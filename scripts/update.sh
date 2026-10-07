#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/backup.sh
npm ci
npm rebuild node-pty esbuild
npm test
npm run test:install
npm audit --audit-level=low
npm run build
systemctl --user restart home-dev-control.service
systemctl --user is-active home-dev-control.service
