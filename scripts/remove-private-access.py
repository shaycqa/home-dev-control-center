#!/usr/bin/env python3
"""Remove only routes that still point to this installation's loopback targets."""
import json, subprocess
from bootstrap import locations

def main():
    config_dir, data_dir = locations()
    config = json.loads((config_dir / 'config.json').read_text())
    current = json.loads(subprocess.check_output(['tailscale', 'serve', 'status', '--json'], text=True))
    targets = {443: 'http://127.0.0.1:' + str(config['port'])}
    exposure_file = data_dir / 'exposures.json'
    if exposure_file.exists():
        for record in json.loads(exposure_file.read_text()).values():
            port = record.get('httpsPort')
            if isinstance(port, int) and 11000 <= port <= 11999:
                targets[port] = 'http://127.0.0.1:' + str(port + 34000)
    for host, route in current.get('Web', {}).items():
        try: port = int(host.rsplit(':', 1)[1])
        except (ValueError, IndexError): continue
        if route.get('Handlers', {}).get('/') == {'Proxy': targets.get(port)}:
            subprocess.run(['sudo', 'tailscale', 'serve', '--https=' + str(port), '--set-path=/', 'off'], check=True, timeout=30)

if __name__ == '__main__': main()
