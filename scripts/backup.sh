#!/usr/bin/env bash
set -euo pipefail
umask 077
python3 - <<'PYBACKUP'
import datetime, os, pathlib, tarfile
home = pathlib.Path.home()
config = pathlib.Path(os.environ.get('HDC_CONFIG_DIR', str(pathlib.Path(os.environ.get('XDG_CONFIG_HOME', home / '.config')) / 'home-dev-control')))
data = pathlib.Path(os.environ.get('HDC_DATA_DIR', str(pathlib.Path(os.environ.get('XDG_DATA_HOME', home / '.local/share')) / 'home-dev-control')))
backup = pathlib.Path(os.environ.get('HDC_BACKUP_DIR', str(data.parent / 'home-dev-control-backups')))
backup.mkdir(parents=True, exist_ok=True, mode=0o700)
backup.chmod(0o700)
file = backup / (datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.tar.gz')
with tarfile.open(file, 'x:gz') as archive:
 for source, name in [(config, 'config'), (data, 'data')]:
  if source.exists(): archive.add(source, arcname=name)
file.chmod(0o600)
print('Private backup: ' + str(file))
PYBACKUP
