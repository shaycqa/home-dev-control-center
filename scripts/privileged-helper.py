#!/usr/bin/python3
"""Root-owned, argument-restricted helper. Never accepts shell text."""
import os,sys,subprocess

def main(argv):
    if os.geteuid()!=0: raise SystemExit('Must run through the installed sudoers rule')
    if argv in (['reboot'],['poweroff']):
        subprocess.run(['/usr/bin/systemctl',argv[0]],check=True)
        return
    if len(argv)==3 and argv[0]=='expose' and all(x.isascii() and x.isdigit() for x in argv[1:]):
        https,target=map(int,argv[1:])
        if not 11000<=https<=11999 or target!=https+34000:
            raise SystemExit('Invalid exposure ports')
        subprocess.run(['/usr/bin/tailscale','serve','--bg','--https='+str(https),'http://127.0.0.1:'+str(target)],check=True,timeout=30)
        return
    raise SystemExit('Only reboot, poweroff, or bounded development-port exposure is permitted')

if __name__=='__main__': main(sys.argv[1:])
