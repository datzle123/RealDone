import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { RuntimeManager } from "../src/runtime/manager.js";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a local port.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

test("managed runtime health-checks, redacts logs, and stops its target process", { timeout: 20_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "realdone-runtime-"));
  const port = await availablePort();
  const secret = "RD_RUNTIME_SECRET_123456";
  const script = `const http=require('node:http');const port=Number(process.argv[1]);console.log('token='+process.env.REALDONE_TEST_TOKEN);http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/plain'});res.end('healthy')}).listen(port,'127.0.0.1')`;
  const manager = new RuntimeManager({
    cwd: root,
    command: { executable: process.execPath, args: ["-e", script, String(port)], source: "runtime test" },
    healthUrl: `http://127.0.0.1:${port}/health`,
    healthTimeoutMs: 8_000,
    restartLimit: 1,
    environment: { REALDONE_TEST_TOKEN: secret },
    logFile: path.join(root, ".realdone", "runtime.log"),
  });
  try {
    const started = await manager.start();
    assert.equal(started.state, "healthy");
    assert.ok(started.pid);
    assert.equal(await fetch(`http://127.0.0.1:${port}`).then((response) => response.text()), "healthy");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(manager.snapshot().logs.join("\n").includes(secret), false);
    assert.match(manager.snapshot().logs.join("\n"), /REDACTED_REALDONE_TEST_TOKEN/);
  } finally {
    const stopped = await manager.stop();
    assert.equal(stopped.state, "stopped");
    await assert.rejects(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) }));
    await rm(root, { recursive: true, force: true });
  }
});

test("managed runtime performs only the configured number of crash restarts", { timeout: 20_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "realdone-runtime-restart-"));
  const port = await availablePort();
  const marker = path.join(root, "first-crash.marker");
  const script = `const fs=require('node:fs');const http=require('node:http');const port=Number(process.argv[1]);const marker=process.argv[2];if(!fs.existsSync(marker)){fs.writeFileSync(marker,'crashed');process.exit(17)}http.createServer((req,res)=>{res.writeHead(200);res.end('restarted')}).listen(port,'127.0.0.1')`;
  const manager = new RuntimeManager({
    cwd: root,
    command: { executable: process.execPath, args: ["-e", script, String(port), marker], source: "restart test" },
    healthUrl: `http://127.0.0.1:${port}`,
    healthTimeoutMs: 8_000,
    restartLimit: 1,
  });
  try {
    const started = await manager.start();
    assert.equal(started.state, "healthy");
    assert.equal(started.restarts, 1);
    assert.equal(await fetch(`http://127.0.0.1:${port}`).then((response) => response.text()), "restarted");
  } finally {
    await manager.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("managed runtime health failures include bounded redacted startup diagnostics", { timeout: 10_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "realdone-runtime-diagnostic-"));
  const port = await availablePort();
  const secret = "RD_RUNTIME_DIAGNOSTIC_SECRET_123456";
  const script = "console.error('startup token='+process.env.REALDONE_TEST_TOKEN);process.exit(17)";
  const manager = new RuntimeManager({
    cwd: root,
    command: { executable: process.execPath, args: ["-e", script], source: "runtime diagnostic test" },
    healthUrl: `http://127.0.0.1:${port}/health`,
    healthTimeoutMs: 2_000,
    restartLimit: 0,
    environment: { REALDONE_TEST_TOKEN: secret },
  });
  try {
    await assert.rejects(
      () => manager.start(),
      (error: Error) => {
        assert.match(error.message, /Recent runtime logs:/);
        assert.match(error.message, /startup token=\[REDACTED_REALDONE_TEST_TOKEN\]/);
        assert.equal(error.message.includes(secret), false);
        return true;
      },
    );
  } finally {
    await manager.stop();
    await rm(root, { recursive: true, force: true });
  }
});
