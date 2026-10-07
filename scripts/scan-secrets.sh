#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/check-repository.py
gitleaks dir --config=.gitleaks-working-tree.toml --redact --no-banner .
gitleaks git --redact --no-banner --log-opts='--all --full-history' .
# Include every Git blob and commit, even lockfiles, metadata and unreachable
# objects that a filename-based scanner might otherwise skip.
git cat-file --batch-all-objects --batch | gitleaks stdin --redact --no-banner
