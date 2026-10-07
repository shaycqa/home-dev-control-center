#!/usr/bin/env python3
"""Create private user configuration; never overwrite an existing installation."""
import argparse, json, os, pathlib, secrets

def locations():
    home = pathlib.Path.home()
    return (pathlib.Path(os.environ.get('HDC_CONFIG_DIR', str(pathlib.Path(os.environ.get('XDG_CONFIG_HOME', home / '.config')) / 'home-dev-control'))),
            pathlib.Path(os.environ.get('HDC_DATA_DIR', str(pathlib.Path(os.environ.get('XDG_DATA_HOME', home / '.local/share')) / 'home-dev-control'))))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--user', required=True, help='Authorized Tailscale login (usually your email)')
    parser.add_argument('--port', type=int, default=4310)
    parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path.home() / 'projects')
    args = parser.parse_args()
    if not args.user or not 1024 <= args.port <= 65535:
        parser.error('A login and unprivileged TCP port are required')
    config_dir, data_dir = locations()
    for directory in (config_dir, data_dir):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.chmod(0o700)
    dest = config_dir / 'config.json'
    if dest.exists():
        print('Existing configuration preserved.'); return
    project_root = args.root.expanduser().resolve()
    project_root.mkdir(parents=True, exist_ok=True)
    config = json.loads((pathlib.Path(__file__).resolve().parent.parent / 'config.example.json').read_text())
    config.update(port=args.port, allowedUsers=[args.user], roots=[str(project_root)], projectRoots=[str(project_root)], accessKey=secrets.token_urlsafe(32))
    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(config, stream, indent=2); stream.write('\n')
    print('Private configuration created. HTTPS setup will set its origin.')

if __name__ == '__main__': main()
