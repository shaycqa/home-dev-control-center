import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
let child,
  fixture,
  root,
  configDir,
  dataDir,
  cookie,
  csrf,
  session,
  fixturePid,
  fixtureStart;
let projectRoot, projectSession;
const port = 14310,
  origin = "https://control.test",
  base = "http://127.0.0.1:" + port,
  key = "test-only-independent-key",
  user = "owner@example.test";
async function rawRequest(route, body, overrides = {}) {
  const headers = {
    Host: "control.test",
    "Tailscale-User-Login": user,
    ...(cookie ? { Cookie: cookie } : {}),
    ...(body === undefined
      ? {}
      : {
          Origin: origin,
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf || "",
        }),
    ...overrides,
  };
  return new Promise((resolve, reject) => {
    const req = http.request(
      base + "/api" + route,
      { method: body === undefined ? "GET" : "POST", headers },
      (res) => {
        let text = "";
        res.on("data", (b) => (text += b));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            text,
            headers: {
              get: (k) => {
                const v = res.headers[k.toLowerCase()];
                return Array.isArray(v) ? v.join(";") : v;
              },
            },
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function request(route, body, overrides = {}) {
  const r = await rawRequest(route, body, overrides);
  return { ...r, data: JSON.parse(r.text) };
}
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hdc-test-"));
  configDir = path.join(root, "config");
  dataDir = path.join(root, "data");
  await fs.mkdir(configDir);
  await fs.writeFile(
    path.join(configDir, "config.json"),
    JSON.stringify({
      port,
      origin,
      accessKey: key,
      allowedUsers: [user],
      roots: [root],
      projectRoots: [root],
    }),
  );
  projectRoot = path.join(root, "fixture-project");
  await fs.mkdir(projectRoot);
  await fs.writeFile(
    projectRoot + "/package.json",
    JSON.stringify({
      name: "hdc-controlled-project",
      scripts: { dev: "node server.cjs", build: "printf controlled-build-ok" },
    }),
  );
  await fs.writeFile(
    projectRoot + "/server.cjs",
    "require('http').createServer((q,s)=>s.end('project fixture')).listen(14312,'127.0.0.1');console.log('controlled-project-started');",
  );
  await promisify(execFile)("git", [
    "init",
    "--initial-branch=main",
    projectRoot,
  ]);
  await promisify(execFile)("git", [
    "-C",
    projectRoot,
    "add",
    "package.json",
    "server.cjs",
  ]);
  await promisify(execFile)("git", [
    "-C",
    projectRoot,
    "-c",
    "user.name=HDC Test",
    "-c",
    "user.email=hdc@example.test",
    "commit",
    "-m",
    "Controlled fixture",
  ]);
  child = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      HOME: root,
      HDC_TMUX_SOCKET: "hdc-test-" + process.pid,
      SHELL: "/bin/bash",
      HDC_CONFIG_DIR: configDir,
      HDC_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (b) => process.stderr.write(b));
  for (let i = 0; i < 100; i++) {
    try {
      const r = await request("/state");
      if (r.status === 401) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
});
after(async () => {
  if (projectSession)
    await request(
      "/sessions/" + encodeURIComponent(projectSession.id) + "/terminate",
      { confirm: true },
    ).catch(() => {});
  if (session)
    await request(
      "/sessions/" + encodeURIComponent(session.id) + "/terminate",
      { confirm: true },
    ).catch(() => {});
  fixture?.kill();
  child?.kill();
  await promisify(execFile)("tmux", [
    "-L",
    "hdc-test-" + process.pid,
    "kill-server",
  ]).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});
test("identity, independent key, host, exact origin and CSRF", async () => {
  assert.equal((await request("/state")).status, 401);
  assert.equal(
    (
      await request(
        "/login",
        { key },
        { "Tailscale-User-Login": "intruder@example.test" },
      )
    ).status,
    401,
  );
  assert.equal((await request("/login", { key: "bad" })).status, 401);
  assert.equal(
    (await request("/login", { key }, { Origin: "https://evil.test" })).status,
    403,
  );
  assert.equal(
    (await request("/login", { key }, { Host: "evil.test" })).status,
    403,
  );
  const login = await request("/login", { key });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  csrf = login.data.csrf;
  assert.match(
    login.headers.get("set-cookie"),
    /HttpOnly; Secure; SameSite=Strict/,
  );
  assert.equal(
    (
      await request(
        "/settings",
        { thresholds: { cpu: 80 } },
        { "X-CSRF-Token": "bad" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/settings",
        { thresholds: { cpu: 80 } },
        { Origin: "https://evil.test" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/session", undefined, {
        "Tailscale-User-Login": "intruder@example.test",
      })
    ).status,
    401,
  );
});
test("file lifecycle, stale edits, streamed download, traversal and symlink blocking", async () => {
  const file = path.join(root, "example.txt"),
    renamed = path.join(root, "renamed.txt"),
    duplicate = path.join(root, "copy.txt");
  assert.equal(
    (await request("/files/action", { action: "create-file", path: file }))
      .status,
    200,
  );
  let r = await request("/files/content?path=" + encodeURIComponent(file));
  assert.equal(r.status, 200);
  assert.equal(
    (
      await request("/files/edit", {
        path: file,
        text: "Hello development\n",
        etag: r.data.etag,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/files/edit", {
        path: file,
        text: "Stale",
        etag: r.data.etag,
      })
    ).status,
    409,
  );
  r = await request("/files/content?path=" + encodeURIComponent(file));
  assert.equal(r.data.text, "Hello development\n");
  assert.equal(
    (
      await request("/files/action", {
        action: "rename",
        path: file,
        target: renamed,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/files/action", {
        action: "rename",
        path: file,
        target: renamed,
        confirm: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/files/action", {
        action: "copy",
        path: renamed,
        target: duplicate,
      })
    ).status,
    200,
  );
  assert.equal(await fs.readFile(duplicate, "utf8"), "Hello development\n");
  await fs.symlink("/etc", path.join(root, "escape"));
  assert.equal(
    (
      await request(
        "/files?path=" + encodeURIComponent(path.join(root, "escape")),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/files/content?path=" + encodeURIComponent(root + "/../.ssh/id_rsa"),
      )
    ).status,
    400,
  );
  assert.equal(
    (await request("/files/content?path=" + encodeURIComponent("/etc/passwd")))
      .status,
    403,
  );
  await fs.writeFile(path.join(root, ".secret"), "secret");
  assert.equal(
    (
      await request(
        "/files/content?path=" + encodeURIComponent(root + "/.secret"),
      )
    ).status,
    403,
  );
  const download = await rawRequest(
    "/files/download?path=" + encodeURIComponent(duplicate),
  );
  assert.equal(download.text, "Hello development\n");
  assert.equal(
    (
      await request("/files/action", {
        action: "delete",
        path: renamed,
        confirm: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/files/action", {
        action: "delete",
        path: duplicate,
        confirm: true,
      })
    ).status,
    200,
  );
});
test("real PTY tmux session survives browser detach and reconnect", async () => {
  const r = await request("/sessions", {
    cwd: root,
    name: "hdc-test-" + Date.now(),
  });
  assert.equal(r.status, 200);
  session = r.data;
  async function attach(command, expected) {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/terminal?session=${encodeURIComponent(session.id)}&csrf=${csrf}`,
      {
        headers: {
          Host: "control.test",
          Origin: origin,
          "Tailscale-User-Login": user,
          Cookie: cookie,
        },
      },
    );
    await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => {
        ws.close();
        reject(Error("PTY output timeout"));
      }, 10000);
      ws.on("error", reject);
      ws.on("open", () =>
        setTimeout(
          () =>
            ws.send(JSON.stringify({ type: "input", data: command + "\r" })),
          300,
        ),
      );
      ws.on("message", (raw) => {
        output += JSON.parse(raw).data || "";
        if (output.includes(expected)) {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      });
    });
  }
  await attach(
    "export HDC_RECONNECT=alive; cd /tmp; printf 'first-pty-%s\\n' OK",
    "first-pty-OK",
  );
  await new Promise((r) => setTimeout(r, 500));
  await attach(
    "printf 'reconnect-%s\\n' \"$HDC_RECONNECT\"",
    "reconnect-alive",
  );
  await new Promise((r) => setTimeout(r, 300));
  const hasZsh = await promisify(execFile)("zsh", ["--version"]).then(
    () => true,
    () => false,
  );
  if (hasZsh)
    await attach(
      'zsh -f\nprint "interactive-zsh-$ZSH_VERSION"\nexit',
      "interactive-zsh-",
    );
  const logs = await request("/logs?session=" + encodeURIComponent(session.id));
  assert.equal(logs.status, 200);
  assert.match(logs.data.text, /first-pty/);
  // Capture more than the old 1500-line log limit and retain early output.
  await attach(
    "for i in $(seq 1 1800); do printf 'history-row-%s\\n' \"$i\"; done",
    "history-row-1800",
  );
  const text = await request(
    `/sessions/${encodeURIComponent(session.id)}/text`,
  );
  assert.equal(text.status, 200);
  assert.match(text.data.text, /history-row-1\n/);
  assert.match(text.data.text, /history-row-1800/);
  assert.doesNotMatch(text.data.text, /\x1b\[/);
  assert.equal((await request("/sessions/invalid/text")).status, 400);
  assert.equal(
    (
      await request(
        `/sessions/${encodeURIComponent(session.id)}/text`,
        undefined,
        { Cookie: "" },
      )
    ).status,
    401,
  );
});
test("real development server discovery, PID identity protection and graceful stop", async () => {
  const script = path.join(root, "dev-server.cjs");
  await fs.writeFile(
    script,
    "require('http').createServer((q,s)=>s.end('controlled fixture')).listen(14311,'127.0.0.1');",
  );
  fixture = spawn(process.execPath, [script], { cwd: root, stdio: "ignore" });
  fixturePid = fixture.pid;
  let found;
  for (let i = 0; i < 30; i++) {
    const r = await request("/state");
    found = r.data.servers?.find((s) => s.pid === fixturePid);
    if (found) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(found, "Fixture server discovered");
  fixtureStart = found.start;
  assert.equal(found.port, 14311);
  assert.equal((await request("/process/1/stop", { start: 0 })).status, 409);
  assert.equal(
    (await request(`/process/${fixturePid}/stop`, { start: fixtureStart + 1 }))
      .status,
    409,
  );
  assert.equal(
    (await request(`/process/${fixturePid}/stop`, { start: fixtureStart }))
      .status,
    200,
  );
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fixture.signalCode, "SIGTERM");
});
test("real project Git discovery, package commands, Start and Stop", async () => {
  const state = await request("/state"),
    project = state.data.projects.find((p) => p.path === projectRoot);
  assert.ok(project);
  assert.equal(project.branch, "main");
  assert.equal(project.dirty, false);
  assert.match(project.commands.dev, /npm run dev/);
  assert.equal(
    (
      await request("/projects/action", {
        project: projectRoot,
        action: "install",
      })
    ).status,
    400,
  );
  const started = await request("/projects/action", {
    project: projectRoot,
    action: "dev",
  });
  assert.equal(started.status, 200);
  projectSession = started.data;
  assert.equal(projectSession.cwd, projectRoot);
  let server;
  for (let i = 0; i < 30; i++) {
    server = (await request("/state")).data.servers.find(
      (s) => s.port === 14312,
    );
    if (server) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(server);
  assert.equal(server.cwd, projectRoot);
  assert.match(
    (await request("/logs?session=" + encodeURIComponent(projectSession.id)))
      .data.text,
    /controlled-project-started/,
  );
  assert.equal(
    (
      await request("/projects/action", {
        project: projectRoot,
        action: "stop",
        confirm: true,
      })
    ).status,
    200,
  );
  const retained = await request(
    "/logs?session=" + encodeURIComponent(projectSession.id),
  );
  assert.equal(retained.status, 200);
  assert.match(retained.data.text, /controlled-project-started/);
  const history = (await request("/state")).data.logSources.find(
    (x) => x.project === projectRoot,
  );
  assert.ok(history);
  assert.match(
    (await request("/logs?source=" + history.id)).data.text,
    /controlled-project-started/,
  );
  projectSession = null;
});
test("power helper exact command allowlist without executing power operations", async () => {
  const proc = spawn(
    "python3",
    [
      "-c",
      `import importlib.util,unittest.mock as m\nspec=importlib.util.spec_from_file_location('helper','scripts/privileged-helper.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)\nwith m.patch.object(h.os,'geteuid',return_value=0),m.patch.object(h.subprocess,'run') as run:\n h.main(['reboot']);assert run.call_args.args[0]==['/usr/bin/systemctl','reboot']\n h.main(['poweroff']);assert run.call_args.args[0]==['/usr/bin/systemctl','poweroff']\n h.main(['expose','11000','45000']);assert run.call_args.args[0]==['/usr/bin/tailscale','serve','--bg','--https=11000','http://127.0.0.1:45000']\n for args in [['shell','id'],['expose','11000','22'],['expose','11000','4310'],['expose','11000;id','3000']]:\n  try:h.main(args);raise AssertionError('accepted unsafe args')\n  except SystemExit:pass\n print('allowlist passed')`,
    ],
    { stdio: "pipe" },
  );
  let output = "";
  proc.stdout.on("data", (b) => (output += b));
  const code = await new Promise((r) => proc.on("exit", r));
  assert.equal(code, 0);
  assert.match(output, /allowlist passed/);
});
