#!/usr/bin/env python3
"""Render a user unit using this user's paths; template contains no host data."""
import os, pathlib, sys
from bootstrap import locations

def quote(value):
    if any(c in value for c in '\n\r\0'): raise ValueError('Invalid service path')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'

def main():
    source, node, output = sys.argv[1:]
    if any(c in source for c in '\n\r\0'): raise ValueError('Invalid checkout path')
    config, data = locations()
    template = (pathlib.Path(__file__).resolve().parent.parent / 'packaging/home-dev-control.service.in').read_text()
    env_path = str(pathlib.Path(node).parent) + ':' + str(pathlib.Path.home() / '.local/bin') + ':' + str(pathlib.Path.home() / 'bin') + ':/usr/local/bin:/usr/bin:/bin'
    values = {'SOURCE': source.replace('%', '%%'), 'NODE': quote(node), 'ENTRY': quote(str(pathlib.Path(source) / 'server/index.js')), 'CONFIG': quote('HDC_CONFIG_DIR=' + str(config)), 'DATA': quote('HDC_DATA_DIR=' + str(data)), 'PATH': quote('PATH=' + env_path)}
    for key, value in values.items(): template = template.replace('@' + key + '@', value)
    pathlib.Path(output).write_text(template)

if __name__ == '__main__': main()
