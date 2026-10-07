import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { processInfo } from "./machine.js";
import { run, directory, dataDir, readJSON, writeJSON, fail } from "./core.js";
export let metadata = await readJSON("sessions.json", {});
export let logSources = await readJSON("log-sources.json", []);
for (const [session, meta] of Object.entries(metadata))
  if (meta.log && !logSources.some((x) => x.id === meta.log))
    logSources.push({
      id: meta.log,
      file: meta.log + ".log",
      label: "Terminal " + session,
      session,
      project: meta.project,
      cwd: meta.initialCwd,
      created: meta.created,
    });
async function retainLog(source) {
  logSources = [source, ...logSources.filter((x) => x.id !== source.id)].slice(
    0,
    500,
  );
  await writeJSON("log-sources.json", logSources);
}
export function publicLogSources() {
  return logSources.map(({ file, ...source }) => source);
}
export async function retainedLog(id) {
  const source = logSources.find((x) => x.id === id);
  if (!source || !/^(?:process-)?[a-f0-9]{24}\.log$/.test(source.file))
    fail("Log source unavailable", 404);
  return {
    source: "Retained output · " + source.label,
    text: await tail(path.join(dataDir, "logs", source.file)),
  };
}

export function sessionID(id) {
  if (typeof id !== "string" || !/^\$\d+$/.test(id)) fail("Invalid session ID");
  return id;
}
export async function sessions() {
  const text = await run("tmux", [
    "list-sessions",
    "-F",
    "#{session_id}\t#{session_name}\t#{session_created}\t#{session_attached}",
  ]).catch(() => "");
  const data = [];
  for (const line of text.split("\n").filter(Boolean)) {
    const [id, name, created, attached] = line.split("\t");
    const pane = await run("tmux", [
      "display-message",
      "-p",
      "-t",
      id,
      "#{pane_current_path}\t#{pane_pid}\t#{pane_current_command}",
    ]).catch(() => "");
    const [cwd, pid, command] = pane.split("\t");
    data.push({
      id,
      name,
      created: Number(created) * 1000,
      attached: Number(attached),
      cwd,
      pid: Number(pid),
      command,
      status: attached === "0" ? "detached" : "attached",
      ...(metadata[id]?.created === Number(created) * 1000 ? metadata[id] : {}),
    });
  }
  return data;
}
export async function newSession({ cwd, name, project, command } = {}) {
  cwd = await directory(cwd);
  if (project) project = await directory(project);
  if ((await sessions()).length >= 100)
    fail("Persistent session limit reached", 429);
  if (name && !/^[a-zA-Z0-9 _-]{1,60}$/.test(name))
    fail("Session name must contain letters, numbers, spaces, - or _");
  const label = name || "hdc-" + crypto.randomBytes(4).toString("hex");
  const id = await run("tmux", [
    "new-session",
    "-d",
    "-P",
    "-F",
    "#{session_id}",
    "-s",
    label,
    "-c",
    cwd,
  ]);
  metadata[id] = {
    created:
      Number(
        await run("tmux", [
          "display-message",
          "-p",
          "-t",
          id,
          "#{session_created}",
        ]),
      ) * 1000,
    project: project || null,
    kind: command ? "command" : "terminal",
    managed: true,
    initialCwd: cwd,
    log: crypto.randomBytes(12).toString("hex"),
  };
  await writeJSON("sessions.json", metadata);
  await retainLog({
    id: metadata[id].log,
    file: metadata[id].log + ".log",
    label,
    session: id,
    project: project || null,
    cwd,
    created: metadata[id].created,
  });
  const logger = path.resolve("server/logger.js");
  const log = path.join(dataDir, "logs", metadata[id].log + ".log");
  await run("tmux", [
    "pipe-pane",
    "-o",
    "-t",
    id,
    [process.execPath, logger, log]
      .map((x) => "'" + x.replaceAll("'", "'\"'\"'") + "'")
      .join(" "),
  ]);
  if (command) await sendCommand(id, command);
  return (await sessions()).find((s) => s.id === id);
}
export async function sendCommand(id, command) {
  sessionID(id);
  if (
    typeof command !== "string" ||
    command.length > 8192 ||
    command.includes("\0")
  )
    fail("Invalid command");
  await run("tmux", ["send-keys", "-t", id, "-l", "--", command]);
  await run("tmux", ["send-keys", "-t", id, "Enter"]);
}
export async function sessionLog(id) {
  sessionID(id);
  const current = (await sessions()).find((s) => s.id === id);
  const meta = current?.managed ? metadata[id] : !current ? metadata[id] : null;
  if (!current && !meta?.log) fail("Session no longer exists", 404);
  if (meta?.log) {
    const file = path.join(dataDir, "logs", meta.log + ".log");
    return {
      source: "Captured terminal output (ANSI)",
      text: await tail(file),
    };
  }
  return {
    source:
      "Existing tmux scrollback (bounded; earlier output may be unavailable)",
    text: await run("tmux", [
      "capture-pane",
      "-p",
      "-e",
      "-t",
      id,
      "-S",
      "-1500",
    ]),
  };
}
export async function tail(file) {
  const h = await fs.open(file, "r").catch(() => null);
  if (!h) return "";
  try {
    const s = await h.stat(),
      b = Buffer.alloc(Math.min(s.size, 256 * 1024));
    await h.read(b, 0, b.length, Math.max(0, s.size - b.length));
    return b.toString();
  } finally {
    await h.close();
  }
}
export const managedChildren = new Map(
  Object.entries(await readJSON("processes.json", {})).map(([pid, value]) => [
    Number(pid),
    value,
  ]),
);
export async function restartExternal(p, environment) {
  await directory(p.cwd);
  if (!p.exe || !p.argv.length) fail("Executable unavailable");
  const logID = crypto.randomBytes(12).toString("hex"),
    file = path.join(dataDir, "logs", "process-" + logID + ".log");
  const logger = spawn(
    process.execPath,
    [path.resolve("server/logger.js"), file],
    { stdio: ["pipe", "ignore", "ignore"], detached: true },
  );
  logger.on("error", () => {});
  logger.unref();
  const child = spawn(p.exe, p.argv.slice(1), {
    cwd: p.cwd,
    env: environment || process.env,
    stdio: ["ignore", logger.stdin, logger.stdin],
    detached: true,
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  }).finally(() => logger.stdin.destroy());
  child.unref();
  const current = await processInfo(child.pid).catch(() => null);
  managedChildren.set(child.pid, { file, start: current?.start, cwd: p.cwd });
  await writeJSON("processes.json", Object.fromEntries(managedChildren));
  await retainLog({
    id: logID,
    file: path.basename(file),
    label: p.name + " · PID " + child.pid,
    pid: child.pid,
    cwd: p.cwd,
    created: Date.now(),
  });
  return child.pid;
}
