import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { WebSocket, WebSocketServer } from "ws";
import { freePort } from "./fixture.mjs";

test("real gateway HTTP/WS, identity, cookie stripping and stale process guard", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hdc-gateway-"));
  const app = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        cookie: req.headers.cookie,
        identity: req.headers["tailscale-user-login"],
        csrf: req.headers["x-csrf-token"],
      }),
    );
  });
  const wsServer = new WebSocketServer({ server: app });
  wsServer.on("connection", (ws) => ws.on("message", (data) => ws.send(data)));
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const port = app.address().port;
  let child;
  try {
    await fs.mkdir(root + "/config");
    await fs.writeFile(
      root + "/config/config.json",
      JSON.stringify({
        port: 18444,
        origin: "https://machine.example.ts.net",
        allowedUsers: ["developer@example.test"],
        accessKey: "isolated-gateway-access-key",
        roots: [root],
        projectRoots: [root],
      }),
    );
    // Pick a vacant documented gateway slot without modifying any Serve route.
    let localPort;
    for (let candidate = 45000; candidate <= 45999; candidate++) {
      try {
        const probe = http.createServer();
        await new Promise((resolve, reject) => {
          probe.once("error", reject);
          probe.listen(candidate, "127.0.0.1", resolve);
        });
        await new Promise((r) => probe.close(r));
        localPort = candidate;
        break;
      } catch {}
    }
    assert.ok(localPort);
    const httpsPort = localPort - 34000;
    child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const {gateway}=await import('./server/gateway.js');await gateway(${port},{httpsPort:${httpsPort},pid:process.pid,start:-1});process.send('ready');`,
      ],
      {
        env: {
          ...process.env,
          HOME: root,
          HDC_CONFIG_DIR: root + "/config",
          HDC_DATA_DIR: root + "/data",
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    // Start-time mismatch is intentionally stale; start another child for ordinary forwarding.
    await new Promise((r, j) => {
      child.once("message", r);
      child.once("error", j);
      child.once("exit", () => j(Error("Gateway startup failed")));
    });
    async function request(headers = {}) {
      return new Promise((resolve, reject) => {
        http
          .get(
            "http://127.0.0.1:" + localPort,
            {
              headers: {
                Host: "machine.example.ts.net:" + httpsPort,
                "Tailscale-User-Login": "developer@example.test",
                ...headers,
              },
            },
            (res) => {
              let text = "";
              res.on("data", (b) => (text += b));
              res.on("end", () => resolve({ status: res.statusCode, text }));
            },
          )
          .on("error", reject);
      });
    }
    assert.equal((await request()).status, 410);
    assert.equal(
      (await request({ "Tailscale-User-Login": "intruder@example.test" }))
        .status,
      403,
    );
    child.kill();
    await new Promise((r) => child.once("exit", r));
    child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const {gateway}=await import('./server/gateway.js');await gateway(${port},{httpsPort:${httpsPort}});process.send('ready');`,
      ],
      {
        env: {
          ...process.env,
          HOME: root,
          HDC_CONFIG_DIR: root + "/config",
          HDC_DATA_DIR: root + "/data",
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    await new Promise((r, j) => {
      child.once("message", r);
      child.once("error", j);
      child.once("exit", () => j(Error("Gateway startup failed")));
    });
    const response = await request({
      Cookie: "hdc_session=fixture; development_cookie=okay",
      "X-CSRF-Token": "fixture",
    });
    assert.equal(response.status, 200);
    const data = JSON.parse(response.text);
    assert.equal(data.cookie.trim(), "development_cookie=okay");
    assert.equal(data.identity, undefined);
    assert.equal(data.csrf, undefined);
    assert.equal((await request({ Host: "wrong.example.test" })).status, 403);
    const ws = new WebSocket("ws://127.0.0.1:" + localPort, {
      headers: {
        Host: "machine.example.ts.net:" + httpsPort,
        "Tailscale-User-Login": "developer@example.test",
      },
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("Gateway WebSocket timeout")),
        5000,
      );
      ws.once("error", reject);
      ws.once("open", () => ws.send("controlled-ws"));
      ws.once("message", (data) => {
        clearTimeout(timeout);
        assert.equal(data.toString(), "controlled-ws");
        ws.close();
        resolve();
      });
    });
  } finally {
    if (child?.exitCode === null) {
      child.kill();
      await new Promise((r) => child.once("exit", r));
    }
    for (const ws of wsServer.clients) ws.terminate();
    wsServer.close();
    app.closeAllConnections();
    await new Promise((r) => app.close(r));
    await fs.rm(root, { recursive: true, force: true });
  }
});
