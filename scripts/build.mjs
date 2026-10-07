import { spawnSync } from "node:child_process";
import { copyFile } from "node:fs/promises";
import path from "node:path";
for (const [command, args] of [
  [process.execPath, ["scripts/filemanager-assets.mjs"]],
  ["python3", ["scripts/notices.py"]],
  [process.execPath, [path.resolve("node_modules/vite/bin/vite.js"), "build"]],
]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
await copyFile("docs/THIRD_PARTY_NOTICES.txt", "dist/THIRD_PARTY_NOTICES.txt");
