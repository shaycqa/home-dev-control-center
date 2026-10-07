#!/usr/bin/env python3
"""Persist HTTPS Serve while preserving unrelated routes and private backups."""
import argparse, json, os, pathlib, subprocess
from bootstrap import locations

def run(*args):
    return subprocess.check_output(list(args), text=True, timeout=30)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--replace-existing', action='store_true', help='Explicitly replace an existing root HTTPS handler')
    parser.add_argument('--no-restart', action='store_true', help='Configure before initial service startup')
    args = parser.parse_args()
    config_dir, data_dir = locations()
    config_file = config_dir / 'config.json'
    config = json.loads(config_file.read_text())
    status = json.loads(run('tailscale', 'status', '--json'))
    hostname = status.get('Self', {}).get('DNSName', '').rstrip('.')
    if not hostname or status.get('BackendState') != 'Running':
        raise SystemExit('Connect Tailscale and enable MagicDNS/HTTPS before configuring Serve')
    previous = json.loads(run('tailscale', 'serve', 'status', '--json'))
    target = 'http://127.0.0.1:' + str(int(config['port']))
    existing = previous.get('Web', {}).get(hostname + ':443', {}).get('Handlers', {}).get('/')
    if existing and existing != {'Proxy': target} and not args.replace_existing:
        raise SystemExit('HTTPS / already serves another application. Review it before using --replace-existing.')
    data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = data_dir / 'tailscale-serve.before.json'
    if not backup.exists():
        fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream: json.dump(previous, stream, indent=2)
    # Serve only; never enable Funnel, reset unrelated routes or read auth keys.
    subprocess.run(['sudo', 'tailscale', 'serve', '--bg', '--yes', '--https=443', '--set-path=/', target], check=True, timeout=120)
    config['origin'] = 'https://' + hostname
    temporary = config_file.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(config, stream, indent=2); stream.write('\n')
    os.replace(temporary, config_file)
    if not args.no_restart:
        subprocess.run(['systemctl', '--user', 'restart', 'home-dev-control.service'], check=True)
    print('Private dashboard URL: ' + config['origin'] + '/')

if __name__ == '__main__': main()
