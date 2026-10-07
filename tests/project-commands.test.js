import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { projectCommands } from "../server/project-commands.js";

test("project commands respect declarations, modern lockfiles and available scripts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hdc-commands-"));
  try {
    await fs.writeFile(path.join(dir, "package.json"), "{}");
    const scripts = {
      dev: "vite",
      build: "vite build",
      test: "vitest",
      preview: "vite preview",
    };
    for (const [file, manager] of [
      ["pnpm-lock.yaml", "pnpm"],
      ["yarn.lock", "yarn"],
      ["bun.lock", "bun"],
      ["bun.lockb", "bun"],
    ]) {
      await fs.writeFile(path.join(dir, file), "");
      const detected = await projectCommands(dir, { scripts });
      assert.equal(detected.manager, manager);
      assert.equal(detected.commands.test, `${manager} run test`);
      assert.equal(detected.commands.install, `${manager} install`);
      assert.equal(detected.commands.lint, undefined);
      const declared = await projectCommands(dir, {
        scripts,
        packageManager: "npm@10.0.0",
      });
      assert.equal(declared.commands.dev, "npm run dev");
      await fs.rm(path.join(dir, file));
    }
    assert.equal(
      (await projectCommands(dir, { scripts })).commands.build,
      "npm run build",
    );
    const malicious = await projectCommands(dir, {
      scripts,
      packageManager: "pnpm; echo injected",
    });
    assert.equal(malicious.manager, "npm");
    await fs.rm(path.join(dir, "package.json"));
    assert.deepEqual((await projectCommands(dir)).commands, {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
