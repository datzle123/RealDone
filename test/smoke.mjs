import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { runBenchmark } from "../dist/benchmark/evaluate.js";
import { runCleanup } from "../dist/cleanup/ledger.js";

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
  const scan = {
    targetUrl: fixture.url,
    outputRoot,
    headed: false,
    allowHosts: [],
    allowDestructive: true,
    allowExternal: false,
    mutationAllowed: true,
    maxPages: 10,
    maxActions: 30,
    timeoutMs: 8_000,
    settleMs: 250,
    maxDurationMs: 90_000,
    maxRetries: 2,
    ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
  };
  const result = await runBenchmark({
    scan,
    expectationFile: path.resolve("benchmarks/fixture-app/expected.json"),
    verifyReplays: true,
    maxReplays: 2,
  });
  assert.ok(result.report.summary.pagesDiscovered >= 9);
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD201")));
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD302")));
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD003")));
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD203")));
  assert.ok(result.report.findings.some((finding) => finding.verdict === "VERIFIED"));
  assert.equal(result.metrics.precision, 1);
  assert.equal(result.metrics.recall, 1);
  assert.equal(result.metrics.falsePositiveRate, 0);
  assert.equal(result.metrics.actionDiscoveryRate, 1);
  assert.equal(result.metrics.detectorAccuracy, 1);
  assert.equal(result.metrics.reproductionSuccessRate, 1);
  const selectorFinding = result.report.findings.find((finding) => finding.action.label.includes("Toggle resilient"));
  assert.equal(selectorFinding?.evidence.locatorResolution?.chosenStrategy, "role");
  const cleanup = await runCleanup(result.reportDirectory, { confirm: true, allowHosts: [], retries: 1 });
  assert.equal(cleanup.failed, 0);
  assert.ok(cleanup.cleaned >= 1);
  process.stdout.write(`Smoke scan passed: ${path.join(result.reportDirectory, "report.html")}\n`);
} finally {
  await fixture.stop();
}
