import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
export const run = async (cmd, args = [], options = {}) => {
  const { combineOutput = false, ...execOptions } = options;
  if (cmd === "tmux") {
    if (process.env.HDC_TMUX_SOCKET)
      args = ["-L", process.env.HDC_TMUX_SOCKET, ...args];
    // tmux sanitizes tab-delimited formats under the C locale. Keep UTF-8 output
    // deterministic even when the service starts with an otherwise empty locale.
    execOptions.env = { ...process.env, ...execOptions.env, LC_ALL: "C.UTF-8" };
  }
  const r = await promisify(execFile)(cmd, args, {
    timeout: 8000,
    maxBuffer: 2 * 1024 * 1024,
    ...execOptions,
  });
  return combineOutput
    ? [r.stdout, r.stderr].filter(Boolean).join("\n").trim()
    : r.stdout.trim();
};
export const home = os.homedir(),
  configDir =
    process.env.HDC_CONFIG_DIR ||
    path.join(
      process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
      "home-dev-control",
    ),
  dataDir =
    process.env.HDC_DATA_DIR ||
    path.join(
      process.env.XDG_DATA_HOME || path.join(home, ".local/share"),
      "home-dev-control",
    );
await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
await fs.mkdir(path.join(dataDir, "logs"), { recursive: true, mode: 0o700 });
const defaults = {
  port: 4310,
  origin: "https://machine.example.ts.net",
  allowedUsers: [],
  roots: [home],
  projectRoots: [home],
  accessKey: crypto.randomBytes(32).toString("base64url"),
  thresholds: {
    cpu: 90,
    ram: 85,
    disk: 85,
    temperature: 80,
    criticalTemperature: 95,
    swap: 50,
  },
  shortcuts: [
    "Ctrl",
    "Esc",
    "Tab",
    "↑",
    "↓",
    "←",
    "→",
    "|",
    "/",
    "~",
    "●",
    "_ ",
    ":",
    ";",
  ],
  projectCommands: {},
  favorites: ["git-status", "ports", "disk"],
};
export let config;
try {
  config = {
    ...defaults,
    ...JSON.parse(
      await fs.readFile(path.join(configDir, "config.json"), "utf8"),
    ),
  };
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  config = defaults;
  await saveConfig();
}
if (
  !Number.isInteger(config.port) ||
  config.port < 1024 ||
  config.port > 65535 ||
  new URL(config.origin).protocol !== "https:" ||
  new URL(config.origin).origin !== config.origin ||
  !Array.isArray(config.allowedUsers) ||
  config.allowedUsers.some((x) => typeof x !== "string" || !x) ||
  typeof config.accessKey !== "string" ||
  config.accessKey.length < 20 ||
  !Array.isArray(config.roots) ||
  !config.roots.length ||
  config.roots.some((x) => !path.isAbsolute(x)) ||
  !Array.isArray(config.projectRoots) ||
  config.projectRoots.some((x) => !path.isAbsolute(x))
)
  throw new Error(
    "Invalid configuration; run bootstrap.py and configure private HTTPS access",
  );
export async function saveConfig() {
  await fs.writeFile(
    path.join(configDir, "config.json"),
    JSON.stringify(config, null, 2),
    { mode: 0o600 },
  );
}
export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
export async function audit(user, action, details = {}) {
  await fs.appendFile(
    path.join(dataDir, "audit.jsonl"),
    JSON.stringify({ time: new Date().toISOString(), user, action, details }) +
      "\n",
    { mode: 0o600 },
  );
  const s = await fs.stat(path.join(dataDir, "audit.jsonl"));
  if (s.size > 10 * 1024 * 1024)
    await fs.rename(
      path.join(dataDir, "audit.jsonl"),
      path.join(dataDir, "audit.previous.jsonl"),
    );
}
export const ignored = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".git",
]);
export async function safePath(input, { create = false } = {}) {
  if (
    typeof input !== "string" ||
    input.includes("\0") ||
    !path.isAbsolute(input) ||
    input.split("/").includes("..")
  )
    fail("Invalid absolute path");
  const p = path.resolve(input);
  if (
    !config.roots.some(
      (r) => p === path.resolve(r) || p.startsWith(path.resolve(r) + "/"),
    )
  )
    fail("Outside configured roots", 403);
  const components = p.split("/").filter(Boolean);
  let current = "/";
  for (let i = 0; i < components.length; i++) {
    if (components[i].startsWith("."))
      fail("Hidden directories/files are protected", 403);
    current = path.join(current, components[i]);
    try {
      const s = await fs.lstat(current);
      if (s.isSymbolicLink()) fail("Symlinks are not accessible", 403);
      if (i < components.length - 1 && !s.isDirectory())
        fail("Not a directory");
      if (i === components.length - 1 && !s.isDirectory() && !s.isFile())
        fail("Special files are protected", 403);
    } catch (e) {
      if (e.code === "ENOENT" && create && i === components.length - 1)
        return p;
      throw e;
    }
  }
  return p;
}
export async function directory(p) {
  p = await safePath(p);
  if (!(await fs.stat(p)).isDirectory()) fail("Directory required");
  return p;
}
export async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, file), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
export async function writeJSON(file, value) {
  const dest = path.join(dataDir, file);
  await fs.writeFile(dest + ".tmp", JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
  await fs.rename(dest + ".tmp", dest);
}
export const uid = process.getuid();
export function publicConfig() {
  const { accessKey, ...rest } = config;
  return { ...rest, uid };
}
