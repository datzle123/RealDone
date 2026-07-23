import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a local port.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

test("packaged static runtime serves web files but confines resolved symlinks to the project root", { timeout: 15_000 }, async () => {
  const container = await mkdtemp(path.join(tmpdir(), "realdone-static-runtime-"));
  const root = path.join(container, "project");
  const outside = path.join(container, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(path.join(root, "index.html"), "<!doctype html><h1>RealDone control</h1>");
  await writeFile(path.join(root, "app.js"), "globalThis.REALDONE_CONTROL = true;");
  await writeFile(path.join(outside, "secret.txt"), "must-not-be-served");
  await symlink(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
  const port = await availablePort();
  const child = spawn(process.execPath, [
    "--import", "tsx",
    path.resolve("src/runtime/static-server.ts"),
    "--root", root,
    "--port", String(port),
  ], { cwd: process.cwd(), shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  try {
    let readinessTimer: NodeJS.Timeout | undefined;
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        child.stdout.on("data", (chunk) => {
          if (String(chunk).includes("RealDone static runtime ready")) resolve();
        });
        child.once("error", reject);
        child.once("exit", (code, signal) => reject(new Error(`Static runtime exited before ready (${signal ?? code ?? "unknown"}): ${stderr}`)));
      }),
      new Promise<never>((_resolve, reject) => {
        readinessTimer = setTimeout(() => reject(new Error(`Static runtime readiness timed out: ${stderr}`)), 8_000);
      }),
    ]).finally(() => {
      if (readinessTimer) clearTimeout(readinessTimer);
    });
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(await page.text(), /RealDone control/);
    const script = await fetch(`http://127.0.0.1:${port}/app.js`);
    assert.match(script.headers.get("content-type") ?? "", /^text\/javascript/);
    const escaped = await fetch(`http://127.0.0.1:${port}/escape/secret.txt`);
    assert.equal(escaped.status, 403);
    assert.equal((await escaped.text()).includes("must-not-be-served"), false);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
    await rm(container, { recursive: true, force: true });
  }
});
