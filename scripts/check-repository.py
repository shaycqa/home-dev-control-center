#!/usr/bin/env python3
"""Fail when Git tracks runtime, credential or build files (including force-adds)."""
import pathlib, subprocess, sys

def main():
    files = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
    bad = []
    dirs = {'node_modules', 'dist', 'coverage', 'test-results', 'playwright-report', 'runtime', 'state', 'data', 'logs', 'backups', '__pycache__', '.config', '.local', '.ssh', '.aws', '.docker'}
    names = {'.npmrc', '.pypirc', '.git-credentials', '.bash_history', '.zsh_history', 'config.json', 'auth.json', 'presets.json', 'sessions.json', 'exposures.json', 'FINAL_STATUS.json', 'DISCOVERY.md'}
    extensions = {'.log', '.jsonl', '.db', '.sqlite', '.sqlite3', '.pem', '.key', '.p12', '.pfx', '.pyc', '.bak', '.backup', '.zip', '.tgz'}
    for name in filter(None, files):
        p = pathlib.PurePosixPath(name)
        if dirs.intersection(p.parts) or p.name in names or p.name.startswith('.env') or p.suffix in extensions or p.name.endswith('.tar.gz') or (p.name.startswith('config.') and p.suffix == '.json' and p.name != 'config.example.json') or name.startswith('docs/screenshots/'):
            bad.append(name)
    if bad:
        print('Forbidden tracked files:\n' + '\n'.join(bad), file=sys.stderr); return 1
    print('Tracked-file publication policy passed.'); return 0

if __name__ == '__main__': sys.exit(main())
