import express from "express";
import multer from "multer";
import { WebSocketServer } from "ws";
import pty from "node-pty";
import fs from "node:fs/promises";
import { constants, createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import {
  config,
  saveConfig,
  publicConfig,
  run,
  safePath,
  directory,
  fail,
  audit,
  dataDir,
  readJSON,
  writeJSON,
  ignored,
} from "./core.js";
import {
  processes,
  ports,
  metrics,
  projects,
  controllable,
  stopProcess,
  processInfo,
  docker,
} from "./machine.js";
import {
  sessions,
  newSession,
  sendCommand,
  sessionID,
  sessionLog,
  metadata,
  tail,
  restartExternal,
  managedChildren,
  publicLogSources,
  retainedLog,
} from "./sessions.js";
import { updateGateway, restoreGateways } from "./gateway.js";
const app = express();
app.disable("x-powered-by");
const auth = new Map(),
  rates = new Map();
let snapshot = { loading: true },
  exposures = await readJSON("exposures.json", {}),
  presets = await readJSON("presets.json", [
    {
      id: "git-status",
      label: "Git Status",
      group: "Git",
      command: "git status",
      confirm: false,
    },
    {
      id: "git-pull",
      label: "Git Pull",
      group: "Git",
      command: "git pull --ff-only",
      confirm: true,
    },
    {
      id: "git-log",
      label: "Git Log",
      group: "Git",
      command: "git log --oneline -20",
    },
    {
      id: "ports",
      label: "Listening ports",
      group: "System",
      command: "ss -lntp",
    },
    { id: "disk", label: "Disk usage", group: "System", command: "df -h" },
    { id: "memory", label: "Memory", group: "System", command: "free -h" },
    {
      id: "temperature",
      label: "Temperature",
      group: "System",
      command:
        'for f in /sys/class/hwmon/hwmon*/temp*_input; do printf "%s " "$f"; cat "$f"; done',
    },
    {
      id: "docker",
      label: "Docker ps",
      group: "Docker",
      command: "docker ps -a",
    },
    { id: "pytest", label: "pytest", group: "Tests", command: "pytest" },
    {
      id: "npm-install",
      label: "npm install",
      group: "Development",
      command: "npm install",
      confirm: true,
    },
    {
      id: "pnpm-install",
      label: "pnpm install",
      group: "Development",
      command: "pnpm install",
      confirm: true,
    },
    {
      id: "node",
      label: "Node processes",
      group: "System",
      command: "pgrep -a node",
    },
  ]);
function token() {
  return crypto.randomBytes(32).toString("base64url");
}
function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function identity(req) {
  const user = req.headers["tailscale-user-login"];
  if (!config.allowedUsers.includes(user))
    fail("Authorized Tailscale identity required", 401);
  return user;
}
function checkHost(req) {
  if (req.headers.host !== new URL(config.origin).host)
    fail("Invalid host", 403);
}
function session(req) {
  const user = identity(req),
    cookie = req.headers.cookie?.match(/(?:^|;\s*)hdc_session=([^;]+)/)?.[1],
    s = auth.get(cookie);
  if (!s || s.user !== user || s.expires < Date.now())
    fail("Unlock required", 401);
  return s;
}
function origin(req) {
  if (req.headers.origin !== config.origin) fail("Invalid origin", 403);
}
function limit(key, max = 30) {
  const now = Date.now(),
    r = rates.get(key) || { n: 0, time: now };
  if (now - r.time > 60000) {
    r.n = 0;
    r.time = now;
  }
  if (++r.n > max) fail("Rate limit; retry in one minute", 429);
  rates.set(key, r);
}
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  try {
    checkHost(req);
    next();
  } catch (e) {
    next(e);
  }
});
app.use(express.json({ limit: "3mb" }));
app.post("/api/login", async (req, res) => {
  origin(req);
  const user = identity(req);
  limit("login:" + user, 10);
  if (!equal(req.body.key, config.accessKey)) fail("Invalid access key", 401);
  const id = token(),
    csrf = token();
  auth.set(id, { user, csrf, expires: Date.now() + 12 * 60 * 60 * 1000 });
  res.setHeader(
    "Set-Cookie",
    `hdc_session=${id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`,
  );
  await audit(user, "login");
  res.json({ csrf, user });
});
app.use("/api", (req, res, next) => {
  try {
    req.session = session(req);
    req.user = req.session.user;
    if (!["GET", "HEAD"].includes(req.method)) {
      origin(req);
      if (!equal(req.headers["x-csrf-token"], req.session.csrf))
        fail("CSRF token required", 403);
      limit(req.user, 60);
    }
    next();
  } catch (e) {
    next(e);
  }
});
app.get("/api/session", (req, res) =>
  res.json({ csrf: req.session.csrf, user: req.user }),
);
app.post("/api/logout", (req, res) => {
  auth.delete(req.headers.cookie?.match(/hdc_session=([^;]+)/)?.[1]);
  res.setHeader(
    "Set-Cookie",
    "hdc_session=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
  );
  res.json({ ok: true });
});
app.get("/api/state", (req, res) =>
  res.json({
    ...snapshot,
    presets,
    config: publicConfig(),
    exposures,
    logSources: publicLogSources(),
  }),
);
const subscribers = new Set();
app.get("/api/events", (req, res) => {
  if (subscribers.size >= 16) fail("Live connection limit reached", 429);
  res.set({ "Content-Type": "text/event-stream", Connection: "keep-alive" });
  res.flushHeaders();
  res.auth = req.session;
  subscribers.add(res);
  res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  req.on("close", () => subscribers.delete(res));
});
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const p = await processes(),
      s = await ports(p);
    const [m, pr, se, ts, dk] = await Promise.all([
      metrics(),
      projects(p, s),
      sessions(),
      run("tailscale", ["status", "--json"])
        .then(JSON.parse)
        .catch(() => null),
      docker(),
    ]);
    const alerts = [];
    const t = config.thresholds,
      ram = (m.memory.used / m.memory.total) * 100,
      disk = (m.disk.used / m.disk.total) * 100,
      swap = m.memory.swapTotal
        ? (m.memory.swapUsed / m.memory.swapTotal) * 100
        : 0;
    for (const [key, value, threshold] of [
      ["RAM", ram, t.ram],
      ["Disk", disk, t.disk],
      ["Swap", swap, t.swap],
    ])
      if (value >= threshold)
        alerts.push({
          level: value >= 95 ? "critical" : "warning",
          message: `${key} ${value.toFixed(0)}%`,
        });
    const cpuTemp = m.sensors
      .filter((x) => /coretemp|k10temp|cpu/i.test(x.name))
      .map((x) => x.celsius);
    if (cpuTemp.length && Math.max(...cpuTemp) >= t.temperature)
      alerts.push({
        level:
          Math.max(...cpuTemp) >= t.criticalTemperature
            ? "critical"
            : "warning",
        message: `CPU temperature ${Math.max(...cpuTemp)}°C`,
      });
    refresh.highCpu = m.cpu >= t.cpu ? (refresh.highCpu || 0) + 1 : 0;
    if (refresh.highCpu >= 10)
      alerts.push({ level: "warning", message: "Sustained high CPU usage" });
    for (const warning of ts?.Health || [])
      alerts.push({ level: "warning", message: "Tailscale: " + warning });
    snapshot = {
      time: Date.now(),
      metrics: m,
      processes: p,
      servers: s,
      projects: pr,
      sessions: se,
      agents: p
        .filter(
          (x) => x.uid === process.getuid() && /claude|codex/.test(x.name),
        )
        .map((agent) => {
          let pid = agent.pid,
            found;
          for (let i = 0; i < 40 && pid > 1; i++) {
            found = se.find((s) => s.pid === pid);
            if (found) break;
            pid = p.find((x) => x.pid === pid)?.ppid || 1;
          }
          return { ...agent, session: found?.id || null };
        }),
      tailscale: ts
        ? {
            state: ts.BackendState,
            ip: ts.TailscaleIPs,
            hostname: ts.Self?.DNSName,
            health: ts.Health,
          }
        : null,
      docker: dk,
      alerts,
      exposures,
      logSources: publicLogSources(),
    };
    for (const res of subscribers) {
      if (res.writableLength > 2 * 1024 * 1024) {
        res.destroy();
        subscribers.delete(res);
        continue;
      }
      if (res.auth.expires < Date.now()) {
        res.end();
        subscribers.delete(res);
      }
    }
    for (const res of subscribers)
      if (!res.destroyed) res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  } catch (e) {
    console.error("Snapshot:", e.message);
  } finally {
    refreshing = false;
  }
}
setInterval(refresh, 3000).unref();
refresh();
app.post("/api/process/:pid/:action", async (req, res) => {
  const { pid, action } = req.params;
  if (!["stop", "kill", "restart", "expose"].includes(action))
    fail("Invalid process action");
  const p = await controllable(Number(pid), req.body.start);
  if ((action === "kill" || action === "restart") && req.body.confirm !== true)
    fail("Confirmation required");
  if (action === "expose") {
    const port = Number(req.body.port);
    if (
      !snapshot.servers?.some(
        (s) => s.pid === p.pid && s.start === p.start && s.port === port,
      )
    )
      fail("Port no longer belongs to this server");
    let slot =
      exposures[port]?.httpsPort || 11000 + Object.keys(exposures).length;
    if (slot > 11999) fail("Exposure limit");
    const record = {
      httpsPort: slot,
      url: `https://${new URL(config.origin).hostname}:${slot}`,
      pid: p.pid,
      start: p.start,
      address: snapshot.servers.find((s) => s.pid === p.pid && s.port === port)
        .address,
    };
    const proxyPort = await updateGateway(port, record);
    await run("sudo", [
      "-n",
      "/usr/local/libexec/home-dev-control-helper",
      "expose",
      String(slot),
      String(proxyPort),
    ]);
    exposures[port] = record;
    await writeJSON("exposures.json", exposures);
    await audit(req.user, "server.exposed", { pid: p.pid, port, slot });
    return res.json(exposures[port]);
  }
  let restartEnv;
  if (action === "restart") {
    const raw = await fs.readFile(`/proc/${p.pid}/environ`);
    restartEnv = Object.fromEntries(
      raw
        .toString()
        .split("\0")
        .filter(Boolean)
        .map((v) => {
          const i = v.indexOf("=");
          return [v.slice(0, i), v.slice(i + 1)];
        }),
    );
  }
  await stopProcess(p.pid, p.start, action === "kill");
  let newPid;
  if (action === "restart") {
    for (let i = 0; i < 20; i++) {
      const current = await processInfo(p.pid).catch(() => null);
      if (!current || ["Z", "X"].includes(current.state)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const remaining = await processInfo(p.pid).catch(() => null);
    if (remaining && !["Z", "X"].includes(remaining.state))
      fail(
        "Process did not stop; use confirmed Force Kill before restart",
        409,
      );
    newPid = await restartExternal(p, restartEnv);
  }
  await audit(req.user, "process." + action, {
    pid: p.pid,
    start: p.start,
    newPid,
  });
  res.json({ ok: true, newPid });
});
app.post("/api/sessions", async (req, res) => {
  const s = await newSession(req.body);
  await audit(req.user, "session.created", { id: s.id, cwd: s.cwd });
  res.json(s);
});
app.post("/api/sessions/:id/:action", async (req, res) => {
  const id = sessionID(req.params.id);
  if (req.params.action === "rename") {
    if (!/^[a-zA-Z0-9 _-]{1,60}$/.test(req.body.name)) fail("Invalid name");
    await run("tmux", ["rename-session", "-t", id, req.body.name]);
  } else if (req.params.action === "terminate") {
    if (req.body.confirm !== true) fail("Confirmation required");
    await run("tmux", ["kill-session", "-t", id]);
  } else if (req.params.action === "detach") {
    await run("tmux", ["detach-client", "-s", id]);
  } else fail("Invalid action");
  await audit(req.user, "session." + req.params.action, { id });
  res.json({ ok: true });
});
app.post("/api/projects/action", async (req, res) => {
  const { project, action, confirm } = req.body;
  if (
    ![
      "dev",
      "start",
      "test",
      "build",
      "lint",
      "typecheck",
      "stop",
      "restart",
    ].includes(action)
  )
    fail("Invalid project action");
  const pr = snapshot.projects?.find((p) => p.path === project);
  if (!pr) fail("Discovered project required");
  if (["stop", "restart"].includes(action)) {
    if (confirm !== true) fail("Confirmation required");
    for (const s of await sessions())
      if (s.project === project && s.managed && s.kind === "command")
        await run("tmux", ["kill-session", "-t", s.id]);
    for (const p of [...new Map(pr.servers.map((p) => [p.pid, p])).values()]) {
      const alive = await processInfo(p.pid).catch(() => null);
      if (alive?.start === p.start)
        await stopProcess(p.pid, p.start).catch((e) => {
          if (e.status !== 404 && e.code !== "ESRCH") throw e;
        });
    }
  }
  let s;
  if (action !== "stop") {
    const cmd = pr.commands[action === "restart" ? "dev" : action];
    if (!cmd) fail("Configure this project command first");
    s = await newSession({ cwd: project, project, command: cmd });
  }
  await audit(req.user, "project." + action, { project, session: s?.id });
  res.json(s || { ok: true });
});
app.post("/api/presets", async (req, res) => {
  const p = req.body;
  if (
    !p.label ||
    typeof p.command !== "string" ||
    !p.command.trim() ||
    p.command.length > 8192 ||
    p.command.includes("\0")
  )
    fail("Label and valid command required");
  if (
    p.icon !== undefined &&
    (typeof p.icon !== "string" || p.icon.length > 20)
  )
    fail("Invalid icon");
  const preset = {
    id: token().slice(0, 12),
    label: String(p.label).slice(0, 80),
    command: p.command,
    group: String(p.group || "Custom").slice(0, 40),
    cwd: p.cwd ? await directory(p.cwd) : null,
    project: p.project ? await directory(p.project) : null,
    confirm: !!p.confirm,
    icon: p.icon || "terminal",
    target: p.target === "current" ? "current" : "new",
  };
  presets.push(preset);
  await writeJSON("presets.json", presets);
  await audit(req.user, "preset.created", {
    id: preset.id,
    label: preset.label,
  });
  res.json(preset);
});
app.post("/api/presets/:id/delete", async (req, res) => {
  if (req.body.confirm !== true) fail("Confirmation required");
  const p = presets.find((p) => p.id === req.params.id);
  if (!p) fail("Preset missing", 404);
  presets = presets.filter((p) => p.id !== req.params.id);
  config.favorites = config.favorites.filter((id) => id !== req.params.id);
  await writeJSON("presets.json", presets);
  await saveConfig();
  await audit(req.user, "preset.deleted", { id: req.params.id });
  res.json({ ok: true });
});
app.post("/api/presets/:id/run", async (req, res) => {
  const p = presets.find((x) => x.id === req.params.id);
  if (!p) fail("Preset missing", 404);
  if (p.confirm && req.body.confirm !== true) fail("Confirmation required");
  let s;
  if (req.body.session) {
    sessionID(req.body.session);
    s = (await sessions()).find((x) => x.id === req.body.session);
    if (!s) fail("Session unavailable");
    if (p.cwd && p.cwd !== s.cwd)
      fail("Preset directory differs; open in new terminal");
    await sendCommand(s.id, p.command);
  } else
    s = await newSession({
      cwd: p.cwd || req.body.cwd || config.roots[0],
      project: p.project,
      command: p.command,
    });
  await audit(req.user, "preset.executed", { id: p.id, session: s.id });
  res.json(s);
});
app.get("/api/logs", async (req, res) => {
  if (req.query.source) return res.json(await retainedLog(req.query.source));
  if (req.query.session) return res.json(await sessionLog(req.query.session));
  if (req.query.container) {
    const id = containerID(req.query.container);
    return res.json({
      source: "Docker logs",
      text: await run(
        "docker",
        ["logs", "--timestamps", "--tail", "1500", id],
        { combineOutput: true },
      ).catch((e) => e.stdout || e.stderr || e.message),
    });
  }
  let child = managedChildren.get(Number(req.query.pid));
  if (child) {
    const current = await processInfo(Number(req.query.pid)).catch(() => null);
    if (current && child.start !== current.start) child = null;
  }
  res.json(
    child
      ? { source: "Captured process output", text: await tail(child.file) }
      : {
          source:
            "Unavailable: stdout/stderr of externally started processes cannot be recovered. Attach its tmux session if available.",
          text: "",
        },
  );
});
function containerID(id) {
  if (
    typeof id !== "string" ||
    !/^([a-f0-9]{12,64})$/.test(id) ||
    !snapshot.docker?.containers.some((c) => c.ID === id || c.ID.startsWith(id))
  )
    fail("Known container ID required");
  return id;
}
app.post("/api/docker/:id/:action", async (req, res) => {
  const id = containerID(req.params.id),
    action = req.params.action;
  if (!["start", "stop", "restart", "terminal", "open"].includes(action))
    fail("Invalid container action");
  if (action === "terminal") {
    const s = await newSession({
      cwd: config.roots[0],
      command: `docker exec -it ${id} /bin/sh`,
    });
    return res.json(s);
  }
  if (action === "open") {
    const info = JSON.parse(await run("docker", ["inspect", id]))[0];
    const binding = Object.values(info.NetworkSettings.Ports || {})
      .flat()
      .filter(Boolean)
      .find((x) => ["127.0.0.1", "0.0.0.0", "::"].includes(x.HostIp));
    if (!binding) fail("No local exposed TCP port");
    const port = Number(binding.HostPort);
    let slot =
      exposures[port]?.httpsPort || 11000 + Object.keys(exposures).length;
    const record = {
      httpsPort: slot,
      url: `https://${new URL(config.origin).hostname}:${slot}`,
      container: id,
    };
    const proxyPort = await updateGateway(port, record);
    await run("sudo", [
      "-n",
      "/usr/local/libexec/home-dev-control-helper",
      "expose",
      String(slot),
      String(proxyPort),
    ]);
    exposures[port] = record;
    await writeJSON("exposures.json", exposures);
    return res.json(exposures[port]);
  }
  if (action !== "start" && req.body.confirm !== true)
    fail("Confirmation required");
  await run("docker", [action, id], { timeout: 25000 });
  await audit(req.user, "docker." + action, { id });
  res.json({ ok: true });
});
app.post("/api/power/:action", async (req, res) => {
  if (
    !["reboot", "poweroff"].includes(req.params.action) ||
    req.body.confirm !== req.params.action
  )
    fail("Type the exact action to confirm");
  limit("power:" + req.user, 2);
  await audit(req.user, "system." + req.params.action + ".requested");
  await run("sudo", [
    "-n",
    "/usr/local/libexec/home-dev-control-helper",
    req.params.action,
  ]);
  res.json({ ok: true });
});
app.get("/api/audit", async (req, res) => {
  const output = await tail(path.join(dataDir, "audit.jsonl"));
  res.json(
    output
      .split("\n")
      .filter(Boolean)
      .flatMap((x) => {
        try {
          return [JSON.parse(x)];
        } catch {
          return [];
        }
      })
      .slice(-500)
      .reverse(),
  );
});
app.post("/api/settings", async (req, res) => {
  const { thresholds, shortcuts, favorites, projectCommands } = req.body;
  if (thresholds) {
    for (const [k, v] of Object.entries(thresholds)) {
      if (!(k in config.thresholds) || !Number.isFinite(v) || v < 1 || v > 120)
        fail("Invalid threshold");
    }
    config.thresholds = { ...config.thresholds, ...thresholds };
  }
  if (shortcuts) {
    if (
      !Array.isArray(shortcuts) ||
      shortcuts.length > 30 ||
      shortcuts.some((x) => typeof x !== "string" || x.length > 20)
    )
      fail("Invalid shortcuts");
    config.shortcuts = shortcuts;
  }
  if (favorites) {
    if (
      !Array.isArray(favorites) ||
      favorites.some((x) => !presets.some((p) => p.id === x))
    )
      fail("Invalid favorites");
    config.favorites = favorites;
  }
  if (projectCommands) {
    for (const [p, cmd] of Object.entries(projectCommands)) {
      await directory(p);
      for (const [k, v] of Object.entries(cmd))
        if (
          !["dev", "start", "test", "build", "lint", "typecheck"].includes(k) ||
          typeof v !== "string" ||
          v.length > 8192 ||
          v.includes("\0")
        )
          fail("Invalid project command");
    }
    config.projectCommands = { ...config.projectCommands, ...projectCommands };
  }
  await saveConfig();
  await audit(req.user, "settings.updated");
  res.json(publicConfig());
});
app.get("/api/files", async (req, res) => {
  const dir = await directory(req.query.path || config.roots[0]);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries.slice(0, 10000)) {
    if (e.name.startsWith(".") || e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name),
      s = await fs.lstat(p).catch(() => null);
    if (s && (s.isDirectory() || s.isFile()))
      files.push({
        id: p,
        type: s.isDirectory() ? "folder" : "file",
        lazy: s.isDirectory(),
        size: s.size,
        date: s.mtime.toISOString(),
        permissions: (s.mode & 0o777).toString(8),
      });
  }
  res.json({ path: dir, files });
});
app.get("/api/files/content", async (req, res) => {
  const p = await safePath(req.query.path),
    s = await fs.stat(p);
  if (!s.isFile()) fail("Regular file required");
  if (s.size > 1024 * 1024)
    fail("File exceeds 1 MiB editing limit; download instead", 413);
  const h = await fs.open(p, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buf = await h.readFile();
    if (buf.includes(0)) fail("Binary file; download instead");
    res.json({
      text: buf.toString(),
      etag: crypto.createHash("sha256").update(buf).digest("hex"),
      size: s.size,
      permissions: (s.mode & 0o777).toString(8),
      modified: s.mtime,
    });
  } finally {
    await h.close();
  }
});
app.get("/api/files/download", async (req, res) => {
  const p = await safePath(req.query.path),
    h = await fs.open(p, constants.O_RDONLY | constants.O_NOFOLLOW),
    s = await h.stat();
  if (!s.isFile()) {
    await h.close();
    fail("Regular file required");
  }
  res.set({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(p))}`,
    "Content-Length": s.size,
  });
  const stream = h.createReadStream();
  res.on("close", () => stream.destroy());
  stream.on("error", () => res.destroy()).pipe(res);
});
app.get("/api/files/image", async (req, res) => {
  const p = await safePath(req.query.path);
  const mime = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  }[path.extname(p).toLowerCase()];
  if (!mime) fail("Unsupported image format");
  const h = await fs.open(p, constants.O_RDONLY | constants.O_NOFOLLOW),
    s = await h.stat();
  if (!s.isFile() || s.size > 20 * 1024 * 1024) {
    await h.close();
    fail("Image preview limited to 20 MiB");
  }
  res.type(mime);
  const stream = h.createReadStream();
  res.on("close", () => stream.destroy());
  stream.on("error", () => res.destroy()).pipe(res);
});
app.post("/api/files/edit", async (req, res) => {
  const p = await safePath(req.body.path);
  if (
    typeof req.body.text !== "string" ||
    Buffer.byteLength(req.body.text) > 1024 * 1024
  )
    fail("Editor limit exceeded");
  const h = await fs.open(p, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    const current = await h.readFile();
    const etag = crypto.createHash("sha256").update(current).digest("hex");
    if (req.body.etag !== etag)
      fail("File changed on disk; reload before saving", 409);
    await h.truncate(0);
    await h.write(req.body.text, 0, "utf8");
    await h.sync();
  } finally {
    await h.close();
  }
  await audit(req.user, "file.edited", { path: p });
  res.json({ ok: true });
});
async function inspectTree(p) {
  let size = 0,
    count = 0;
  async function walk(p) {
    if (++count > 10000) fail("Operation exceeds 10,000 entries");
    const s = await fs.lstat(p);
    if (s.isSymbolicLink() || (!s.isFile() && !s.isDirectory()))
      fail("Copy cannot include symlinks or special files");
    size += s.isFile() ? s.size : 0;
    if (size > 100 * 1024 * 1024) fail("Copy exceeds 100 MiB; use terminal");
    if (s.isDirectory())
      for (const n of await fs.readdir(p)) await walk(path.join(p, n));
  }
  await walk(p);
}
app.post("/api/files/action", async (req, res) => {
  const { action } = req.body;
  const source = await safePath(req.body.path, {
    create: ["create-file", "create-folder"].includes(action),
  });
  if (
    ["delete", "rename", "move"].includes(action) &&
    req.body.confirm !== true
  )
    fail("Confirmation required");
  if (
    config.roots.some((r) => path.resolve(r) === source) ||
    source === os.homedir()
  )
    fail("Root directory is protected", 403);
  if (action === "create-file") {
    const h = await fs.open(
      source,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await h.close();
  } else if (action === "create-folder")
    await fs.mkdir(source, { mode: 0o700 });
  else if (action === "delete") await fs.rm(source, { recursive: true });
  else if (["rename", "move", "copy", "duplicate"].includes(action)) {
    const target = await safePath(req.body.target, { create: true });
    if (target === source || target.startsWith(source + "/"))
      fail("Cannot place directory inside itself");
    if (await fs.lstat(target).catch(() => null))
      fail("Destination already exists", 409);
    if (["copy", "duplicate"].includes(action)) {
      await inspectTree(source);
      await fs.cp(source, target, {
        recursive: true,
        errorOnExist: true,
        force: false,
        dereference: false,
      });
    } else await fs.rename(source, target);
  } else fail("Invalid file action");
  await audit(req.user, "file." + action, {
    path: source,
    target: req.body.target,
  });
  res.json({ ok: true });
});
const upload = multer({
  dest: path.join(dataDir, "uploads"),
  limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 1 },
});
app.post("/api/files/upload", (req, res, next) => {
  upload.single("file")(req, res, async (err) => {
    try {
      if (err) throw err;
      if (!req.file) fail("File required");
      const dest = await safePath(
        path.join(
          await directory(req.query.path),
          path.basename(req.file.originalname),
        ),
        { create: true },
      );
      await fs.copyFile(req.file.path, dest, constants.COPYFILE_EXCL);
      await audit(req.user, "file.uploaded", {
        path: dest,
        size: req.file.size,
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    } finally {
      if (req.file) await fs.rm(req.file.path, { force: true });
    }
  });
});
app.get("/api/files/git", async (req, res) => {
  const dir = await directory(req.query.path);
  res.json({
    text: await run("git", ["-C", dir, "status", "--short"]).catch(
      () => "Not a Git repository",
    ),
  });
});
app.use(express.static(path.resolve("dist"), { index: false }));
app.get("/{*path}", (req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
app.use((e, req, res, next) => {
  if (res.headersSent) return next(e);
  console.error(req.method, req.path, e.message);
  res
    .status(
      e.status ||
        (["ENOENT", "ESRCH"].includes(e.code)
          ? 404
          : e.code === "EACCES"
            ? 403
            : 400),
    )
    .json({ error: e.message });
});
await restoreGateways(exposures);
const server = app.listen(config.port, "127.0.0.1", () =>
  console.log(`Home Dev Control Center listening on 127.0.0.1:${config.port}`),
);
const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
let activePTYs = 0;
server.on("upgrade", async (req, socket, head) => {
  try {
    checkHost(req);
    origin(req);
    const s = session(req),
      url = new URL(req.url, config.origin);
    if (
      url.pathname !== "/terminal" ||
      !equal(url.searchParams.get("csrf"), s.csrf)
    )
      fail("Invalid terminal handshake", 403);
    const id = sessionID(url.searchParams.get("session")),
      existing = (await sessions()).find((x) => x.id === id);
    if (!existing) fail("Session not found");
    if (activePTYs >= 16) fail("Too many terminal connections", 429);
    req.terminal = { id, s };
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  } catch (e) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  }
});
wss.on("connection", (ws, req) => {
  let term;
  try {
    term = pty.spawn(
      "tmux",
      [
        ...(process.env.HDC_TMUX_SOCKET
          ? ["-L", process.env.HDC_TMUX_SOCKET]
          : []),
        "attach-session",
        "-t",
        req.terminal.id,
      ],
      {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: os.homedir(),
        env: { ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color" },
      },
    );
  } catch {
    ws.close(1011, "PTY unavailable");
    return;
  }
  activePTYs++;
  const data = term.onData((text) => {
    if (ws.readyState === 1) {
      if (ws.bufferedAmount > 1024 * 1024) {
        ws.close(1013, "Client too slow; reconnect");
        return;
      }
      ws.send(JSON.stringify({ type: "output", data: text }));
    }
  });
  term.onExit(() => ws.close());
  let last = Date.now(),
    budget = 0;
  ws.on("message", (message) => {
    try {
      if (Date.now() - last > 1000) {
        last = Date.now();
        budget = 0;
      }
      if ((budget += message.length) > 128 * 1024) fail("Input rate exceeded");
      const m = JSON.parse(message);
      if (
        m.type === "input" &&
        typeof m.data === "string" &&
        m.data.length <= 32768
      )
        term.write(m.data);
      else if (
        m.type === "resize" &&
        Number.isInteger(m.cols) &&
        Number.isInteger(m.rows) &&
        m.cols >= 2 &&
        m.cols <= 500 &&
        m.rows >= 2 &&
        m.rows <= 300
      )
        term.resize(m.cols, m.rows);
    } catch {
      ws.close(1008, "Invalid terminal message");
    }
  });
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  ws.on("close", () => {
    activePTYs--;
    data.dispose();
    try {
      term.kill();
    } catch {}
  });
  ws.auth = req.terminal.s;
});
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive || ws.auth.expires < Date.now()) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  for (const [id, s] of auth) if (s.expires < Date.now()) auth.delete(id);
  for (const [key, r] of rates)
    if (Date.now() - r.time > 120000) rates.delete(key);
}, 30000).unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    for (const ws of wss.clients) ws.close(1001, "Service restarting");
    for (const res of subscribers) res.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
