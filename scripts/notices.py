#!/usr/bin/env python3
import json,pathlib
base=pathlib.Path('node_modules');out=[];seen=set()
for pkg in sorted(base.rglob('package.json')):
 try:x=json.loads(pkg.read_text())
 except Exception:continue
 key=(x.get('name'),x.get('version'))
 if key in seen:continue
 seen.add(key)
 out.append('\n=== '+x.get('name','?')+' '+x.get('version','?')+' | '+str(x.get('license','unspecified'))+' ===\n')
 for f in pkg.parent.iterdir():
  if f.is_file() and f.name.lower().startswith(('license','copying','notice')):
   try:out.append(f.read_text())
   except:pass
pathlib.Path('docs/THIRD_PARTY_NOTICES.txt').write_text('\n'.join(out))
