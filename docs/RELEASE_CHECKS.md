# Public release validation

The public release is prepared in a separate checkout; the deployed installation,
private config/data, Serve routes, existing tmux sessions and Docker containers
are not modified during publication.

Release gates:

1. Explicit source allowlist; private discovery/status docs and screenshots excluded.
2. Machine identifiers, project paths and identity defaults replaced with portable
   examples. No source Git history existed to migrate; public history begins clean.
3. Complete source filesystem and all Git objects/history scanned with Gitleaks
   and independent exact-value/privacy searches. Scan reports remain outside Git.
4. Backend auth/CSRF/Host/origin, files/traversal/symlinks, real process lifecycle,
   Git projects, PTY reconnect and helper argument tests.
5. Isolated HTTPS Chromium desktop/iPhone and WebKit iPhone navigation, file CRUD,
   upload/editor, real terminal, presets and persistence across backend restart.
6. Installer bootstrap/perms, systemd rendering, backup, Serve conflict refusal
   and owned-route removal tested with temporary directories and mocked sudo.
7. Dependency vulnerability audit, integrity signatures, dependency tree and
   license inventory review; generated notices preserve upstream attribution.
8. Tracked, ignored and staged files/diff plus all commit metadata reviewed.
9. Fresh clone with empty private application config/data: locked install,
   native rebuild, build and isolated validation pass without production files.
10. Public remote re-cloned and commit/tree/history scanned again after push.

Power operations are tested by mocking fixed subprocess calls, not rebooting the
machine. Browser identity and Serve setup tests use controlled fixtures; they do
not prove connectivity from a physical remote iPhone or a second Linux distro.
Docker operations use a disposable CLI fixture and do not modify real containers.
An independent external audit and cross-distribution installation testing remain
future work. See SECURITY.md for limitations; passing scanners is not a proof
that every possible secret or vulnerability is absent.
