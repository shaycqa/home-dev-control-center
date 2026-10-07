# Reused projects and licenses

Direct libraries were inspected through their installed package metadata and
LICENSE/NOTICE files. Their permissive licenses permit use and redistribution
with notices. The build generates a full installed-package notice collection,
including transitive packages, and ships it alongside application bundles.
There is no copied third-party application backend or vendored daemon.

| Package | Resolved version | Source | License | Why chosen |
| --- | --- | --- | --- | --- |
| `@codemirror/lang-javascript` | 6.2.5 | [@codemirror/lang-javascript](https://github.com/codemirror/lang-javascript) | MIT | JavaScript highlighting |
| `@codemirror/lang-python` | 6.2.1 | [@codemirror/lang-python](https://github.com/codemirror/lang-python) | MIT | Python highlighting |
| `@svar-ui/react-filemanager` | 2.6.0 | [@svar-ui/react-filemanager](https://github.com/svar-widgets/react-filemanager) | MIT | Mature tree/list, navigation and file UI |
| `@xterm/addon-fit` | 0.10.0 | [@xterm/addon-fit](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-fit) | MIT | Responsive terminal sizing |
| `@xterm/xterm` | 5.5.0 | [@xterm/xterm](https://github.com/xtermjs/xterm.js) | MIT | VT terminal emulation |
| `codemirror` | 6.0.2 | [codemirror](https://github.com/codemirror/basic-setup) | MIT | Code editor |
| `express` | 5.2.1 | [express](https://github.com/expressjs/express) | MIT | HTTP routing |
| `http-proxy` | 1.18.1 | [http-proxy](https://github.com/http-party/node-http-proxy) | MIT | Fixed-target HTTP/WebSocket app gateways |
| `lucide-react` | 0.468.0 | [lucide-react](https://github.com/lucide-icons/lucide) | ISC | Bundled interface icons |
| `multer` | 2.4.0 | [multer](https://github.com/expressjs/multer) | MIT | Bounded multipart streaming |
| `node-pty` | 1.1.0 | [node-pty](https://github.com/microsoft/node-pty) | MIT | Real Linux PTYs |
| `react` | 19.3.0 | [react](https://github.com/react/react) | MIT | Component UI |
| `react-dom` | 19.3.0 | [react-dom](https://github.com/react/react) | MIT | Browser rendering |
| `ws` | 8.22.0 | [ws](https://github.com/websockets/ws) | MIT | PTY WebSocket transport |
| `@playwright/test` | 1.63.0 | [@playwright/test](https://github.com/microsoft/playwright) | Apache-2.0 | Chromium/WebKit mobile validation |
| `prettier` | 3.9.9 | [prettier](https://github.com/prettier/prettier) | MIT | Source formatting |
| `vite` | 7.3.7 | [vite](https://github.com/vitejs/vite) | MIT | Production bundling |

## Validation workflow components

| Component | Source | License | Why chosen |
| --- | --- | --- | --- |
| actions/checkout | https://github.com/actions/checkout | MIT | Fetch complete history for CI scans; pinned commit |
| actions/setup-node | https://github.com/actions/setup-node | MIT | Supported Node runtime and npm cache; pinned commit |

These Actions execute in GitHub's runner and are not copied into application
bundles. Their source distributions retain their own license notices.

## Installed tools (not bundled)

| Project | Source | License | Why chosen |
| --- | --- | --- | --- |
| tmux | https://github.com/tmux/tmux | ISC | Proven persistent terminal multiplexer |
| Tailscale | https://github.com/tailscale/tailscale | BSD-3-Clause core | Private HTTPS proxy and network identity |
| Git | https://git-scm.com | GPL-2.0 | Project status and repository metadata |
| Docker CLI | https://github.com/docker/cli | Apache-2.0 | Optional container operations through fixed argv |
| systemd | https://github.com/systemd/systemd | LGPL-2.1-or-later, individual files vary | User service and narrow power actions |
| Bash | https://www.gnu.org/software/bash/ | GPL-3.0-or-later | Interactive user shell |
| zsh (optional) | https://www.zsh.org | Permissive zsh license; distribution files vary | Optional interactive shell |
| Gitleaks (validation only) | https://github.com/gitleaks/gitleaks | MIT | Filesystem and full-history secret detection |

OS tool licenses/notices remain supplied by their distributions. Docker daemon,
Tailscale hosted control plane and other independently installed products have
their own terms. They are not redistributed in the source repository.

The SVAR integration uses its public API and locally generated Lucide SVG masks.
CDN font imports are stripped at build time; no upstream font assets are copied.
The original application glue is MIT licensed. Preserve the generated notices
when redistributing compiled output, and review lockfile/license changes during
updates. License metadata is checked against actual local license files; package
metadata alone is not a substitute for reviewing a changed dependency license.
