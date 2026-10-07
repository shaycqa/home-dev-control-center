import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixture, waitFor } from "./fixture.mjs";

test("Docker API CLI fixture: discovery, stats, validation, actions, logs and terminal", async () => {
  const f = await fixture(),
    id = "a".repeat(64);
  try {
    const container = {
      ID: id,
      Names: "controlled-container",
      Image: "example-image:test",
      State: "running",
      Status: "Up 1 minute",
      Ports: "",
    };
    const script = `#!/usr/bin/env python3\nimport json,sys,pathlib\na=sys.argv[1:]\nwith pathlib.Path(${JSON.stringify(f.root + "/docker-calls.jsonl")}).open('a') as out: out.write(json.dumps(a)+'\\n')\nif a[0]=='ps': print(${JSON.stringify(JSON.stringify(container))})\nelif a[0]=='stats': print(json.dumps({'ID':${JSON.stringify(id)},'CPUPerc':'1%','MemUsage':'1MiB / 1GiB'}))\nelif a[0]=='logs': print('controlled-docker-log')\nelif a[0]=='exec': print('controlled-container-shell')\nelif a[0] in ['start','stop','restart']: print(a[1])\nelse: sys.exit(1)\n`;
    await fs.writeFile(f.root + "/bin/docker", script, { mode: 0o755 });
    await waitFor(async () =>
      (await f.api("/state")).data.docker?.containers?.some((c) => c.ID === id),
    );
    const c = (await f.api("/state")).data.docker.containers[0];
    assert.equal(c.stats.CPUPerc, "1%");
    assert.equal((await f.api("/docker/" + id + "/start", {})).status, 200);
    assert.equal((await f.api("/docker/" + id + "/stop", {})).status, 400);
    assert.equal(
      (await f.api("/docker/" + id + "/stop", { confirm: true })).status,
      200,
    );
    assert.equal(
      (await f.api("/docker/" + id + "/restart", { confirm: true })).status,
      200,
    );
    assert.equal((await f.api("/docker/123456789abc/start", {})).status, 400);
    assert.equal(
      (await f.api("/docker/" + encodeURIComponent(id + ";id") + "/start", {}))
        .status,
      400,
    );
    assert.match(
      (await f.api("/logs?container=" + id)).data.text,
      /controlled-docker-log/,
    );
    const terminal = await f.api("/docker/" + id + "/terminal", {});
    assert.equal(terminal.status, 200);
    await waitFor(async () =>
      /controlled-container-shell/.test(
        (await f.api("/logs?session=" + encodeURIComponent(terminal.data.id)))
          .data.text,
      ),
    );
    const calls = (await fs.readFile(f.root + "/docker-calls.jsonl", "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.ok(calls.some((c) => c[0] === "restart" && c[1] === id));
    assert.ok(calls.some((c) => c[0] === "exec" && c[2] === id));
    assert.ok(
      (await f.api("/audit")).data.some((a) => a.action === "docker.restart"),
    );
  } finally {
    await f.close();
  }
});
