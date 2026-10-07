import fs from "node:fs/promises";

// Prefer the project's explicit choice, then lockfiles. Never infer scripts
// that the project does not define, or execute package metadata as shell code.
export async function projectCommands(dir, pkg = {}) {
  const declared = /^(npm|pnpm|yarn|bun)(?:@|$)/.exec(
    pkg.packageManager || "",
  )?.[1];
  const files = new Set(await fs.readdir(dir));
  const manager =
    declared ||
    (files.has("pnpm-lock.yaml")
      ? "pnpm"
      : files.has("yarn.lock")
        ? "yarn"
        : files.has("bun.lock") || files.has("bun.lockb")
          ? "bun"
          : "npm");
  const commands = {};
  if (files.has("package.json")) {
    commands.install = `${manager} install`;
    for (const key of [
      "dev",
      "start",
      "build",
      "test",
      "lint",
      "typecheck",
      "preview",
    ])
      if (typeof pkg.scripts?.[key] === "string" && pkg.scripts[key])
        commands[key] = `${manager} run ${key}`;
  }
  return { manager, commands };
}
