# Architecture

## Frontend

React with Vite production bundles, dark responsive CSS and touch navigation.
SVAR supplies the file manager; CodeMirror supplies bounded code editing.
xterm.js plus addon-fit connects to real node-pty WebSockets. Icons are Lucide;
SVAR icon masks are generated locally, without external fonts or CDN calls.

## Backend modules

- `core.js`: private directories, configuration, fixed-argv subprocess wrapper,
  safe-path policy, JSON persistence and audit rotation.
- `machine.js`: Linux counters/sensors, PID identities, socket discovery, Git/
  project discovery and optional Docker CLI snapshots.
- `sessions.js`: tmux sessions, literal send-keys, per-session logging and external
  process restart/capture. `logger.js` caps and appends retained output.
- `gateway.js`: loopback HTTP/WebSocket forwarding for tailnet development apps,
  identity/Host gates, header stripping and stale-PID rejection.
- `index.js`: routes, session authentication, origin/CSRF/rate checks, SSE, PTYs,
  file operations, container controls and narrow privileged actions.

Snapshot refresh is approximately every three seconds; project metadata discovery
is cached for thirty seconds. Bounded history and backpressure avoid unlimited
browser/server buffering. Backend restart loses web sessions but retains data and
normal tmux sessions. Machine reboot loses running sessions; there is no automatic
execution of saved terminals or arbitrary presets at boot.

## Installation boundary

The user service uses the installer's resolved Node executable, checkout path and
private directories. Privileged setup installs a separate root-owned helper and
validated sudoers rule. Only the helper is passwordless; web operations cannot
replace it. Serve configuration is stored by tailscaled independently of the
Node process and persists through daemon/machine restarts. The installer refuses
an existing installation and conflicting root HTTPS routes by default.

## State

Configuration is user-private JSON outside source. Presets, tmux metadata,
exposures, process log metadata, retained log-source index and audit records live
in the separate data directory. No database/server account is required.
Atomic rename is used for most JSON state writes; simultaneous requests are not
transactional database writes. The design targets one trusted developer, not
multi-tenant administration. Back up before updates and major configuration edits.
