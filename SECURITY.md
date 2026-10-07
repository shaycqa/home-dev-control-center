# Security boundaries

This is a trusted single-development-account management interface. Treat an
unlocked dashboard like SSH access to that account.

## Network and authentication

The backend and development gateways bind only to IPv4 loopback. A trusted
Tailscale Serve proxy terminates TLS and injects the identity header. Do not
put this backend behind an untrusted proxy, expose its listener to a network,
or enable Funnel. Local processes can forge proxy headers; the independent
random key is an additional dashboard gate, not isolation from your own account.
The file containing that key must remain private. An empty identity allowlist
denies access. Tagged clients without a login identity are denied.

Dashboard APIs require a login session; mutations require the exact configured
Origin and CSRF token. WebSockets check Host, Origin, identity, cookie and CSRF.
SSE sessions expire and have connection/backpressure limits. Cookies are Secure,
HttpOnly, SameSite=Strict and expire after 12 hours. Sessions are in memory, so
backend restarts require unlocking again. Headers prevent framing and restrict
asset loading. No application assets require third-party CDN requests.

Development app gateways require the configured Tailscale identity and Host.
They strip dashboard cookies and identity/CSRF headers before forwarding, and
match original PID/start time. They do not require the independent dashboard
key and do not sandbox development app code. Tailnet ACLs still matter. Reusing
another app's reserved Serve slot is unsupported; keep the documented gateway
port ranges available.

## User and root authority

PTys and presets execute as the development account, with ordinary shell power.
A shell can access any file that account can read, including hidden files and
credentials. Presets and project package scripts are intentional code execution,
not a safe command language. Never authorize untrusted users or run unreviewed
project commands. Docker access and broad sudo can confer root authority.

Root operations go through a root-owned fixed-argument helper. It accepts only
reboot/poweroff or numeric exposure ports in a fixed narrow range pointing to
paired loopback gateway ports. It does not accept paths, arbitrary targets or
shell text. The sudoers rule grants only that helper, but it is callable directly
by the configured OS account; UI confirmation does not restrict an existing
local shell. Installation/setup use normal explicit sudo outside the web API.

## Files and process control

Files are restricted to configured absolute roots. Traversal, hidden components,
symlinks and special files are rejected; regular-file opens use O_NOFOLLOW.
Downloads stream; editing, previews, upload and recursive-copy sizes are capped.
Editor saves require a content hash to avoid stale overwrites. Destructive file
operations require confirmation and cannot remove configured roots.

Node's path APIs do not provide an atomic openat2/RESOLVE_BENEATH sandbox for all
recursive operations. Another process with write access to the same directories
could race path checks or mutate parent directories. These roots are intended
for trusted development files, not mutually hostile local users. Do not rely on
the file browser as isolation from untrusted writers. The full terminal already
has the account's broader filesystem rights.

Process actions require matching start ticks, UID, development classification
and an allowed cwd. The dashboard/ancestors and critical daemons are protected.
Force Kill first attempts SIGTERM. A small signal-time race remains between
/proc identity checks and kill(2); pidfd-based operations are not implemented.
Restart is best effort and may differ from a complex external supervisor.

## Privacy and operations

Runtime config/data are outside source, with private directory/file permissions.
Logs can contain secrets and are intentionally bounded, not secret-redacted.
Audit records can include private paths and identities. Backups include those
records and the access key; protect them like credentials. Rotate the key locally
and restart if compromised. Restrict ACLs, patch dependencies/Linux/Tailscale,
review project code and use a dedicated development account when appropriate.

`.gitignore` excludes secrets, runtime data, generated outputs and local state.
No ignore rule or secret scanner can guarantee detection of every possible
secret, especially when files are force-added. Run filesystem and all-history
scans before publishing, inspect diffs and avoid real-machine screenshots.

## Reporting

For a vulnerability, use GitHub private vulnerability reporting if enabled by
the repository owner. Otherwise request a private reporting channel without
posting credentials, exploit details or private machine data in a public issue.
This project has not received an independent security audit.
