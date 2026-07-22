import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { runScan } from "../dist/scan.js";

async function startFixture() {
  const child = spawn(process.execPath, [path.resolve("benchmarks/fixture-app/server.mjs")], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  const url = await new Promise((resolve, reject) => {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/READY (http:\/\/[^\s]+)/);
      if (match?.[1]) resolve(match[1]);
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Fixture exited before ready (${code})`)));
  });
  return {
    url,
    stop: async () => {
      child.kill();
      await once(child, "exit").catch(() => undefined);
    },
  };
}

const fixture = await startFixture();
try {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "realdone-smoke-"));
  const result = await runScan({
    targetUrl: fixture.url,
    outputRoot,
    headed: false,
    allowHosts: [],
    allowDestructive: true,
    allowExternal: false,
    mutationAllowed: true,
    maxPages: 8,
    maxActions: 20,
    timeoutMs: 8_000,
    settleMs: 250,
    ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
  });
  assert.ok(result.report.summary.pagesDiscovered >= 6);
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD201")));
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD302")));
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD003")));
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD203")));
  assert.ok(result.report.findings.some((finding) => finding.verdict === "VERIFIED"));
  process.stdout.write(`Smoke scan passed: ${path.join(result.reportDirectory, "report.html")}\n`);
} finally {
  await fixture.stop();
}
