# Gitleaks failure review — 2026-10-07

Actions run 37648374419 failed on commit `646e248` during the filesystem
scan, after the frontend build. It reported one finding and stopped before
running the history scan. Rebuilding that commit with the locked dependencies
reproduces the finding:

- Rule: `generic-api-key`
- Generated file: `dist/assets/terminal-B50g1vPv.js`, line 7
- Match: a chained initialization of the `FourKeyMap` and `TwoKeyMap` exports
- Reported secret: the minified `TwoKeyMap` export followed by the `void` operator
- Entropy: 3.875

This is a false positive: xterm's bundled module initializes the exported
`FourKeyMap` and `TwoKeyMap` classes to `undefined`. The source is
`node_modules/@xterm/xterm/src/common/MultiKeyMap.ts`; its consumers are the
terminal renderer's glyph caches. It is executable JavaScript, not a credential.
Neither `dist` nor `node_modules` is tracked in any published commit.

Commit `a969241` already fixed the scan boundary: filesystem scans exclude only
reproducible `dist` and `node_modules` output. Source uses the default detection
rules. A separate tracked-file check rejects generated and private runtime files,
including force-added files. Git-history scans and all-object scans retain the
unaltered default Gitleaks rules. Actions run 37648932395 passed with this fix.

Review repeated the source scan, all-ref/full-history scan, and all-object scan
(including unreachable blobs and commit metadata). All passed with zero findings.
The remote has one published branch, `main`, and no tags. Both published commits
are clean. No real secret or sensitive value was identified for removal, so no
history rewrite or credential rotation is needed.

Reproduce the supported checks with `npm run scan:secrets`. Scanning generated
bundles with unconfigured `gitleaks dir .` reproduces this false positive; it does
not indicate that a credential was added to source or Git history.
