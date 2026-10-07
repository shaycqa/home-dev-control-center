import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import httpProxy from "http-proxy";
const run = promisify(execFile);
export async function waitFor(fn, message = "Fixture readiness") {
  for (let i = 0; i < 80; i++) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error(message + " timed out");
}
export async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
export async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hdc-fixture-"));
  const configDir = path.join(root, "config"),
    dataDir = path.join(root, "data"),
    bin = path.join(root, "bin"),
    projects = path.join(root, "projects");
  for (const dir of [configDir, dataDir, bin, projects]) await fs.mkdir(dir);
  const port = await freePort(),
    httpsPort = await freePort();
  const origin = "https://localhost:" + httpsPort,
    key = "isolated-fixture-access-key",
    user = "developer@example.test",
    socket = "hdc-fixture-" + process.pid + "-" + port;
  await fs.mkdir(projects + "/demo-project");
  await fs.writeFile(
    projects + "/demo-project/package.json",
    JSON.stringify({
      name: "demo-project",
      scripts: { dev: "node server.cjs" },
    }),
  );
  await fs.writeFile(
    projects + "/demo-project/readme.txt",
    "Controlled file preview\n",
  );
  await fs.writeFile(
    projects + "/demo-project/server.cjs",
    "console.log('fixture project');",
  );
  await fs.writeFile(
    configDir + "/config.json",
    JSON.stringify({
      port,
      origin,
      accessKey: key,
      allowedUsers: [user],
      roots: [projects],
      projectRoots: [projects],
    }),
    { mode: 0o600 },
  );
  await fs.writeFile(
    bin + "/tailscale",
    '#!/bin/sh\nprintf \'%s\\n\' \'{"BackendState":"Running","Self":{"DNSName":"machine.example.ts.net"},"TailscaleIPs":[]}\'\n',
    { mode: 0o755 },
  );
  await fs.writeFile(
    bin + "/docker",
    '#!/bin/sh\necho "Docker disabled in isolated test fixture" >&2\nexit 1\n',
    { mode: 0o755 },
  );
  await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-keyout",
    root + "/key.pem",
    "-out",
    root + "/cert.pem",
  ]);
  const env = {
    ...process.env,
    HOME: root,
    HDC_CONFIG_DIR: configDir,
    HDC_DATA_DIR: dataDir,
    HDC_TMUX_SOCKET: socket,
    SHELL: "/bin/bash",
    PATH: bin + ":" + process.env.PATH,
  };
  delete env.TMUX;
  delete env.TMUX_PANE;
  let child;
  function start() {
    child = spawn(process.execPath, ["server/index.js"], {
      env,
      stdio: "ignore",
    });
    return child;
  }
  const proxy = httpProxy.createProxyServer({
    target: "http://127.0.0.1:" + port,
    ws: true,
    changeOrigin: false,
  });
  proxy.on("error", (_e, _req, res) => res.end());
  function identity(req) {
    req.headers["tailscale-user-login"] = user;
  }
  const server = https.createServer(
    {
      key: await fs.readFile(root + "/key.pem"),
      cert: await fs.readFile(root + "/cert.pem"),
    },
    (req, res) => {
      identity(req);
      proxy.web(req, res);
    },
  );
  server.on("upgrade", (req, socket, head) => {
    identity(req);
    proxy.ws(req, socket, head);
  });
  await new Promise((r) => server.listen(httpsPort, "127.0.0.1", r));
  start();
  let cookie, csrf;
  async function api(route, body) {
    return new Promise((resolve, reject) => {
      const req = https.request(
        origin + "/api" + route,
        {
          rejectUnauthorized: false,
          method: body === undefined ? "GET" : "POST",
          headers: {
            ...(cookie ? { Cookie: cookie } : {}),
            ...(body === undefined
              ? {}
              : {
                  Origin: origin,
                  "Content-Type": "application/json",
                  "X-CSRF-Token": csrf || "",
                }),
          },
        },
        (res) => {
          let text = "";
          res.on("data", (b) => (text += b));
          res.on("end", () => {
            try {
              const data = JSON.parse(text);
              if (route === "/login" && res.statusCode === 200) {
                cookie = res.headers["set-cookie"][0].split(";")[0];
                csrf = data.csrf;
              }
              resolve({ status: res.statusCode, data });
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  await waitFor(async () => {
    try {
      return (await api("/session")).status === 401;
    } catch {
      return false;
    }
  });
  await api("/login", { key });
  async function stopChild() {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((r) => child.once("exit", r));
    }
  }
  return {
    root,
    projects,
    origin,
    key,
    api,
    env,
    port,
    socket,
    async restart() {
      await stopChild();
      start();
      cookie = undefined;
      csrf = undefined;
      await waitFor(async () => {
        try {
          return (await api("/session")).status === 401;
        } catch {
          return false;
        }
      });
      await api("/login", { key });
    },
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      proxy.close();
      await stopChild();
      await run("tmux", ["-L", socket, "kill-server"]).catch(() => {});
      await fs.rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    },
  };
}
