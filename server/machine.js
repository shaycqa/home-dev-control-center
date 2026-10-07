import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run, config, uid, directory, fail, ignored } from "./core.js";
const clockTicks = Number(await run("getconf", ["CLK_TCK"])) || 100;
let prevCpu,
  prevNet,
  prevTime,
  prevProc = new Map();
export async function processInfo(pid) {
  const base = `/proc/${Number(pid)}`;
  const [stat, status, cmd, cwd, exe] = await Promise.all([
    fs.readFile(base + "/stat", "utf8"),
    fs.readFile(base + "/status", "utf8"),
    fs.readFile(base + "/cmdline"),
    fs.readlink(base + "/cwd").catch(() => null),
    fs.readlink(base + "/exe").catch(() => null),
  ]);
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" "),
    argv = cmd.toString().split("\0").filter(Boolean),
    owner = Number(status.match(/^Uid:\s+(\d+)/m)?.[1]);
  const ticks = Number(fields[11]) + Number(fields[12]),
    start = Number(fields[19]),
    now = Date.now(),
    old = prevProc.get(Number(pid));
  const cpu =
    old && old.start === start
      ? ((ticks - old.ticks) / clockTicks / ((now - old.time) / 1000)) * 100
      : 0;
  prevProc.set(Number(pid), { ticks, time: now, start });
  return {
    pid: Number(pid),
    state: fields[0],
    ppid: Number(fields[1]),
    name: stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")")),
    argv,
    command: argv.join(" "),
    cwd,
    exe,
    uid: owner,
    user: owner === uid ? os.userInfo().username : String(owner),
    cpu: Math.max(0, cpu),
    memory: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024,
    start,
    runtime: os.uptime() - start / clockTicks,
    ports: [],
    development:
      owner === uid &&
      /(?:^|\/)(?:node|nodejs|python[0-9.]*|claude|codex|npm|pnpm|yarn|bun|uvicorn|flask|django-admin|http-server|vite|next|docker)$/.test(
        argv[0] || "",
      ),
  };
}
export async function processes() {
  const dirs = await fs.readdir("/proc");
  const result = await Promise.all(
    dirs
      .filter((x) => /^\d+$/.test(x))
      .map((x) => processInfo(x).catch(() => null)),
  );
  return result.filter(Boolean);
}
export async function ports(procs) {
  const output = await run("ss", ["-lntpH"]);
  const listeners = [];
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/),
      address = parts[3],
      port = Number(address?.split(":").at(-1));
    for (const m of line.matchAll(/pid=(\d+)/g)) {
      const p = procs.find((p) => p.pid === Number(m[1]));
      if (!p) continue;
      p.ports.push(port);
      if (
        p.pid !== process.pid &&
        p.development &&
        port !== config.port &&
        !/codex/.test(p.name)
      )
        listeners.push({
          ...p,
          port,
          address,
          framework: /next/.test(p.command)
            ? "Next.js"
            : /vite/.test(p.command)
              ? "Vite"
              : /uvicorn|fastapi/.test(p.command)
                ? "FastAPI"
                : /django|manage.py/.test(p.command)
                  ? "Django"
                  : /flask/.test(p.command)
                    ? "Flask"
                    : /python/.test(p.command)
                      ? "Python"
                      : "Node",
          id: `${p.pid}:${p.start}:${port}`,
        });
    }
  }
  return listeners;
}
export async function temperatures() {
  const values = [];
  for (const d of await fs.readdir("/sys/class/hwmon").catch(() => [])) {
    const base = "/sys/class/hwmon/" + d;
    const name = (
      await fs.readFile(base + "/name", "utf8").catch(() => d)
    ).trim();
    for (const f of await fs.readdir(base)) {
      if (!/^temp\d+_input$/.test(f)) continue;
      const temp = Number(await fs.readFile(base + "/" + f, "utf8")) / 1000;
      const label = (
        await fs
          .readFile(base + "/" + f.replace("_input", "_label"), "utf8")
          .catch(() => f)
      ).trim();
      if (Number.isFinite(temp)) values.push({ name, label, celsius: temp });
    }
  }
  return values;
}
export async function metrics() {
  const stat = await fs.readFile("/proc/stat", "utf8"),
    mem = await fs.readFile("/proc/meminfo", "utf8"),
    net = await fs.readFile("/proc/net/dev", "utf8");
  const c = stat.split("\n")[0].trim().split(/\s+/).slice(1).map(Number),
    total = c.slice(0, 8).reduce((a, b) => a + b, 0),
    idle = c[3] + c[4];
  const cpu = prevCpu
    ? 100 * (1 - (idle - prevCpu.idle) / (total - prevCpu.total))
    : null;
  prevCpu = { idle, total };
  const m = Object.fromEntries(
    [...mem.matchAll(/^(\w+):\s+(\d+)/gm)].map((x) => [
      x[1],
      Number(x[2]) * 1024,
    ]),
  );
  const n = {};
  for (const line of net.split("\n").slice(2)) {
    const [name, rest] = line.split(":");
    if (!rest) continue;
    const f = rest.trim().split(/\s+/).map(Number);
    n[name.trim()] = { rx: f[0], tx: f[8] };
  }
  const now = Date.now(),
    network = Object.entries(n).map(([name, v]) => ({
      name,
      ...v,
      rxRate: prevNet?.[name]
        ? (v.rx - prevNet[name].rx) / ((now - prevTime) / 1000)
        : null,
      txRate: prevNet?.[name]
        ? (v.tx - prevNet[name].tx) / ((now - prevTime) / 1000)
        : null,
    }));
  prevNet = n;
  prevTime = now;
  const disk = await fs.statfs("/");
  const sensors = await temperatures();
  return {
    hostname: os.hostname(),
    cpu,
    load: os.loadavg(),
    cores: os.cpus().length,
    memory: {
      total: m.MemTotal,
      used: m.MemTotal - m.MemAvailable,
      swapTotal: m.SwapTotal,
      swapUsed: m.SwapTotal - m.SwapFree,
    },
    disk: {
      total: disk.blocks * disk.bsize,
      used: (disk.blocks - disk.bfree) * disk.bsize,
      available: disk.bavail * disk.bsize,
    },
    uptime: os.uptime(),
    sensors,
    network,
  };
}
let projectCache = { time: 0, data: [] };
export async function projects(procs = [], servers = []) {
  if (Date.now() - projectCache.time > 30000) {
    const candidates = [];
    async function scan(root, depth) {
      for (const ent of await fs
        .readdir(root, { withFileTypes: true })
        .catch(() => [])) {
        if (
          !ent.isDirectory() ||
          ent.name.startsWith(".") ||
          ignored.has(ent.name)
        )
          continue;
        const p = path.join(root, ent.name);
        if (
          (await fs.stat(p + "/package.json").catch(() => null)) ||
          (await fs.stat(p + "/pyproject.toml").catch(() => null)) ||
          (await fs.stat(p + "/.git").catch(() => null)) ||
          (await fs.stat(p + "/requirements.txt").catch(() => null))
        ) {
          candidates.push(p);
        } else if (depth > 0) await scan(p, depth - 1);
      }
    }
    for (const r of config.projectRoots) await scan(r, 1);
    const data = [];
    for (const p of candidates.slice(0, 120)) {
      let pkg = {};
      try {
        pkg = JSON.parse(await fs.readFile(p + "/package.json", "utf8"));
      } catch {}
      const git = async (args) =>
        run("git", ["-C", p, ...args], { timeout: 2000 }).catch(() => null);
      const [branch, status, lastCommit, remote] = await Promise.all([
        git(["branch", "--show-current"]),
        git(["status", "--porcelain"]),
        git(["log", "-1", "--format=%h %s (%cr)"]),
        git(["remote", "get-url", "origin"]),
      ]);
      const manager = (await fs.stat(p + "/pnpm-lock.yaml").catch(() => null))
        ? "pnpm"
        : (await fs.stat(p + "/yarn.lock").catch(() => null))
          ? "yarn"
          : (await fs.stat(p + "/bun.lockb").catch(() => null))
            ? "bun"
            : "npm";
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      data.push({
        name: pkg.name || path.basename(p),
        path: p,
        branch,
        dirty: status !== null && !!status,
        git: status !== null,
        lastCommit,
        remote: remote?.replace(/(https?:\/\/)[^/@]+@/, "$1"),
        framework: deps.next
          ? "Next.js"
          : deps.vite
            ? "Vite"
            : deps.react
              ? "React"
              : Object.keys(pkg).length
                ? "Node"
                : "Python",
        manager,
        commands: {
          ...Object.fromEntries(
            Object.keys(pkg.scripts || {})
              .filter((k) =>
                ["dev", "start", "test", "build", "lint", "typecheck"].includes(
                  k,
                ),
              )
              .map((k) => [
                k,
                `${manager} ${manager === "npm" ? "run " : ""}${k}`,
              ]),
          ),
          ...(config.projectCommands[p] || {}),
        },
      });
    }
    projectCache = { time: Date.now(), data };
  }
  return projectCache.data.map((p) => ({
    ...p,
    processes: procs.filter(
      (x) => x.cwd === p.path || x.cwd?.startsWith(p.path + "/"),
    ),
    servers: servers.filter(
      (x) => x.cwd === p.path || x.cwd?.startsWith(p.path + "/"),
    ),
  }));
}
export async function controllable(pid, start) {
  const p = await processInfo(pid).catch(() =>
    fail("Process no longer exists", 404),
  );
  if (["Z", "X"].includes(p.state)) fail("Process has exited", 404);
  if (p.start !== Number(start))
    fail("Process changed; refresh before acting", 409);
  if (p.uid !== uid || !p.development || !p.cwd)
    fail("Only user development processes can be controlled", 403);
  await directory(p.cwd);
  let ancestor = process.pid;
  for (let i = 0; i < 30 && ancestor > 1; i++) {
    if (p.pid === ancestor)
      fail("Dashboard and its ancestors are protected", 403);
    ancestor = (await processInfo(ancestor).catch(() => ({ ppid: 1 }))).ppid;
  }
  if (/systemd|sshd|tmux|dbus|tailscale/.test(p.name) || p.pid <= 1)
    fail("Protected process", 403);
  return p;
}
export async function stopProcess(pid, start, force = false) {
  const p = await controllable(pid, start);
  if (force) {
    process.kill(p.pid, "SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    const current = await processInfo(pid).catch(() => null);
    if (current?.start === p.start) process.kill(p.pid, "SIGKILL");
  } else process.kill(p.pid, "SIGTERM");
  return p;
}
export async function docker() {
  try {
    const output = await run("docker", [
      "ps",
      "-a",
      "--no-trunc",
      "--format",
      "{{json .}}",
    ]);
    const containers = output
      ? output.split("\n").map((x) => JSON.parse(x))
      : [];
    const stats = containers.some((c) => c.State === "running")
      ? await run(
          "docker",
          ["stats", "--no-stream", "--format", "{{json .}}"],
          { timeout: 6000 },
        ).catch(() => "")
      : "";
    const s = stats ? stats.split("\n").map((x) => JSON.parse(x)) : [];
    return {
      available: true,
      containers: containers.map((c) => ({
        ...c,
        stats: s.find((x) => x.ID === c.ID || c.ID.startsWith(x.ID)),
      })),
    };
  } catch (e) {
    return { available: false, error: e.message, containers: [] };
  }
}
