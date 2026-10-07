import { chromium, webkit, devices } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixture, waitFor } from "./fixture.mjs";
const f = await fixture();
try {
  for (const [engine, mobile] of [
    [chromium, false],
    [chromium, true],
    [webkit, true],
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        ...(mobile
          ? devices["iPhone 13"]
          : { viewport: { width: 1440, height: 1100 } }),
      });
      const page = await context.newPage(),
        errors = [],
        external = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (req) => {
        if (!req.url().startsWith(f.origin + "/"))
          external.push(new URL(req.url()).origin);
      });
      await page.goto(f.origin);
      await page.getByLabel("Access key").fill(f.key);
      await page.getByRole("button", { name: "Unlock control center" }).click();
      await page.getByRole("heading", { name: "Machine overview" }).waitFor();
      await page.getByText("CPU usage", { exact: true }).waitFor();
      async function nav(name) {
        if (
          mobile &&
          !["Dashboard", "Projects", "Files", "Terminal", "Sessions"].includes(
            name,
          )
        )
          await page
            .getByRole("button", { name: "Navigation", exact: true })
            .click();
        await page
          .getByRole("button", {
            name: mobile && name === "Dashboard" ? "Home" : name,
            exact: true,
          })
          .first()
          .click();
        await page
          .getByRole("heading", {
            name: name === "Dashboard" ? "Machine overview" : name,
            exact: true,
          })
          .waitFor();
      }
      await nav("Projects");
      await page.getByPlaceholder("Find a project…").fill("demo-project");
      await page
        .getByRole("heading", { name: "demo-project", exact: true })
        .waitFor();
      await nav("Files");
      await page.getByLabel("File root").fill(f.projects);
      await page.getByRole("button", { name: "Go", exact: true }).click();
      await page.getByText("demo-project", { exact: true }).last().waitFor();
      page.once("dialog", (d) => d.accept("fresh.txt"));
      await page.getByRole("button", { name: "New file", exact: true }).click();
      await page.getByText("fresh.txt", { exact: true }).waitFor();
      await waitFor(async () => {
        try {
          return await fs.stat(f.projects + "/fresh.txt");
        } catch {
          return false;
        }
      });
      assert.equal(await fs.readFile(f.projects + "/fresh.txt", "utf8"), "");
      await page.getByText("fresh.txt", { exact: true }).click();
      await page.locator(".file-selection").waitFor();
      const dialog = (d) =>
        d.accept(d.type() === "prompt" ? "renamed.txt" : undefined);
      page.on("dialog", dialog);
      await page
        .locator(".file-selection")
        .getByRole("button", { name: "Rename", exact: true })
        .click();
      await page.getByText("renamed.txt", { exact: true }).waitFor();
      page.off("dialog", dialog);
      await page.getByText("renamed.txt", { exact: true }).click();
      await page
        .locator(".file-selection")
        .getByRole("button", { name: "Duplicate", exact: true })
        .click();
      await page.getByText("renamed.txt-copy", { exact: true }).waitFor();
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "uploaded.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("controlled upload"),
        });
      await page.getByText("uploaded.txt", { exact: true }).waitFor();
      await page.getByText("uploaded.txt", { exact: true }).click();
      await page
        .locator(".file-selection")
        .getByRole("button", { name: "Preview / edit", exact: true })
        .click();
      await page.locator(".code-editor").waitFor();
      await page.locator(".cm-content").click();
      await page.keyboard.press("Control+End");
      await page.keyboard.type(" edited");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page.locator(".editor-modal").waitFor({ state: "hidden" });
      assert.equal(
        await fs.readFile(f.projects + "/uploaded.txt", "utf8"),
        "controlled upload edited",
      );
      await nav("Sessions");
      await page
        .getByRole("button", { name: "New terminal", exact: true })
        .first()
        .click();
      await page
        .getByText("Attached", { exact: true })
        .waitFor({ timeout: 20000 });
      await page.locator(".xterm-helper-textarea").focus();
      await page.keyboard.type("printf 'browser-terminal-%s\\n' OK");
      await page.keyboard.press("Enter");
      const sessionId = await page.evaluate(
        () => JSON.parse(localStorage.getItem("hdc-tabs")).at(-1).id,
      );
      await waitFor(
        async () =>
          /browser-terminal-OK/.test(
            (await f.api("/logs?session=" + encodeURIComponent(sessionId))).data
              .text,
          ),
        "Real browser PTY output",
      );
      // Category tabs show only one set of commands on desktop and iPhone.
      await page.getByRole("tab", { name: "Claude", exact: true }).click();
      await page
        .getByRole("button", { name: "Continue last", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Git Status", exact: true })
          .isVisible(),
        false,
      );
      await page.getByRole("tab", { name: "Codex", exact: true }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "All sessions", exact: true })
          .isVisible(),
        true,
      );
      await page.getByRole("tab", { name: "Dev", exact: true }).click();
      await page
        .getByLabel("Quick command project")
        .selectOption(f.projects + "/demo-project");
      assert.equal(
        await page
          .getByRole("button", { name: /Start dev server/ })
          .isVisible(),
        true,
      );
      assert.equal(
        await page
          .locator(".command-buttons")
          .getByText("npm run dev", { exact: true })
          .count(),
        1,
      );

      // Exercise direct paste under a Safari-compatible user gesture; no prompt.
      await page.evaluate(() => {
        window.hdcClipboard = "printf 'direct-paste-%s\\n' OK";
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            readText: async () => window.hdcClipboard,
            writeText: async (text) => {
              window.hdcClipboard = text;
            },
          },
        });
      });
      await page.getByRole("button", { name: "Paste", exact: true }).click();
      await page.keyboard.press("Enter");
      await waitFor(async () =>
        /direct-paste-OK/.test(
          (await f.api("/logs?session=" + encodeURIComponent(sessionId))).data
            .text,
        ),
      );
      await page.locator(".xterm-helper-textarea").focus();
      await page.keyboard.type(
        "for i in $(seq 1 1800); do printf 'copy-history-%s\\n' \"$i\"; done",
      );
      await page.keyboard.press("Enter");
      await waitFor(async () =>
        /copy-history-1800/.test(
          (await f.api("/sessions/" + encodeURIComponent(sessionId) + "/text"))
            .data.text,
        ),
      );
      await page
        .getByRole("button", { name: "Text / Copy", exact: true })
        .click();
      const copyAll = page.getByRole("button", {
        name: "Copy All",
        exact: true,
      });
      await copyAll.waitFor();
      await waitFor(() => copyAll.isEnabled());
      const plain = await page.locator(".terminal-plain-text").innerText();
      assert.match(plain, /copy-history-1\n/);
      assert.match(plain, /copy-history-1800/);
      assert.equal(
        await page
          .locator(".terminal-plain-text")
          .evaluate((el) => getComputedStyle(el).userSelect),
        "text",
      );
      await copyAll.click();
      assert.equal(await page.evaluate(() => window.hdcClipboard), plain);
      await page.getByRole("button", { name: "Close terminal text" }).click();
      await page.locator(".xterm-helper-textarea").focus();
      if (mobile) {
        await page.evaluate(() => {
          const viewport = window.visualViewport;
          window.hdcViewportHeight = viewport.height;
          Object.defineProperty(viewport, "height", {
            configurable: true,
            value: viewport.height - 300,
          });
          viewport.dispatchEvent(new Event("resize"));
        });
        await page.locator(".terminal-actions.keyboard-open").waitFor();
        const aligned = await page
          .locator(".terminal-actions")
          .evaluate((el) => {
            const rect = el.getBoundingClientRect(),
              v = visualViewport;
            return (
              Math.abs(rect.bottom - v.offsetTop - v.height) < 2 &&
              getComputedStyle(el).position === "fixed"
            );
          });
        assert.equal(
          aligned,
          true,
          "Terminal action row follows keyboard viewport",
        );
        await page.getByRole("button", { name: "Ctrl", exact: true }).click();
        await page
          .locator(".ctrl-keys")
          .getByRole("button", { name: "C", exact: true })
          .click();
        assert.equal(
          await page
            .locator(".xterm-helper-textarea")
            .evaluate((el) => document.activeElement === el),
          true,
        );
        await page.evaluate(() => {
          Object.defineProperty(visualViewport, "height", {
            configurable: true,
            value: window.hdcViewportHeight,
          });
          visualViewport.dispatchEvent(new Event("resize"));
        });
        await page
          .locator(".terminal-actions.keyboard-open")
          .waitFor({ state: "hidden" });
      }
      await page.getByRole("button", { name: /Start dev server/ }).click();
      const projectSessionId = await waitFor(async () => {
        const id = await page.evaluate(
          () => JSON.parse(localStorage.getItem("hdc-tabs")).at(-1).id,
        );
        return id !== sessionId && id;
      });
      await page.getByText("Attached", { exact: true }).waitFor();
      await waitFor(async () =>
        (await f.api("/state")).data.servers?.some(
          (s) => s.cwd === f.projects + "/demo-project",
        ),
      );
      await nav("Dashboard");
      const controlUrl = page.url();
      // The privileged tailnet exposure is covered by gateway/helper tests;
      // intercept it here so browser checks never call the installed helper.
      await page.route("**/api/process/*/expose", (route) =>
        route.fulfill({ json: { url: f.origin + "/server-preview" } }),
      );
      await context.route("**/server-preview", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<p>Controlled server preview</p>",
        }),
      );
      const openButton = page
        .locator(".server-card")
        .getByRole("button", { name: "Open", exact: true })
        .first();
      const [popup] = await Promise.all([
        context.waitForEvent("page", { timeout: 10000 }),
        mobile ? openButton.tap() : openButton.click(),
      ]);
      await popup.waitForURL((url) => url.pathname === "/server-preview");
      assert.equal(
        page.url(),
        controlUrl,
        "Opening a server preserves the Control Center page",
      );
      assert.equal(await popup.evaluate(() => window.opener === null), true);
      await popup.close();
      await f.api(
        "/sessions/" + encodeURIComponent(projectSessionId) + "/terminate",
        { confirm: true },
      );
      for (const name of ["Logs", "Processes", "Docker", "System", "Settings"])
        await nav(name);
      await page.locator(".filter-row select").count();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "No horizontal overflow",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, [], "No third-party frontend requests");
      await f.api("/sessions/" + encodeURIComponent(sessionId) + "/terminate", {
        confirm: true,
      });
      for (const name of [
        "fresh.txt",
        "renamed.txt",
        "renamed.txt-copy",
        "uploaded.txt",
      ])
        await fs.rm(f.projects + "/" + name, { force: true });
      console.log(
        `${engine.name()} ${mobile ? "iPhone" : "desktop"}: navigation, file CRUD/upload/editor and real PTY passed`,
      );
    } finally {
      await browser.close();
    }
  }
  const preset = (
    await f.api("/presets", {
      label: "Controlled preset",
      command: "printf 'preset-result-%s\\n' OK",
      cwd: f.projects,
      confirm: true,
    })
  ).data;
  assert.equal((await f.api(`/presets/${preset.id}/run`, {})).status, 400);
  const session = (await f.api(`/presets/${preset.id}/run`, { confirm: true }))
    .data;
  await waitFor(async () =>
    /preset-result-OK/.test(
      (await f.api("/logs?session=" + encodeURIComponent(session.id))).data
        .text,
    ),
  );
  await f.restart();
  await waitFor(async () =>
    (await f.api("/state")).data.sessions?.some((s) => s.id === session.id),
  );
  assert.match(
    (await f.api("/logs?session=" + encodeURIComponent(session.id))).data.text,
    /preset-result-OK/,
  );
  console.log(
    "Preset confirmation, retained logs and tmux persistence across isolated backend restart passed",
  );
} finally {
  await f.close();
}
