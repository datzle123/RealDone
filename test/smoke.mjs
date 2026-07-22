import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { runBenchmark } from "../dist/benchmark/evaluate.js";
import { runCleanup } from "../dist/cleanup/ledger.js";
import { recordFlow } from "../dist/record/recorder.js";
import { verifyContract } from "../dist/contracts/verifier.js";
import { writeBehaviorContract } from "../dist/contracts/schema.js";
import { runBrowserMatrix } from "../dist/browser/matrix.js";
import { captureBaseline } from "../dist/baseline/manifest.js";
import { runRegressionGate } from "../dist/baseline/regression.js";
import { commandPassed, runCommand } from "../dist/agent/command.js";
import { runAgentVerification } from "../dist/agent/pipeline.js";

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
    deep: true,
    ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
  };
  const result = await runBenchmark({
    scan,
    expectationFile: path.resolve("benchmarks/fixture-app/expected.json"),
    verifyReplays: true,
    maxReplays: 2,
  });
  assert.ok(result.report.summary.pagesDiscovered >= 10);
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD201")));
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD302")));
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD003")));
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD203")));
  assert.ok(result.report.findings.some((finding) => finding.verdict === "VERIFIED"));
  assert.ok(result.report.findings.some((finding) => finding.verdict === "BROWSER_LOCAL" && finding.detectorMatches.some((item) => item.code === "RD102")));
  assert.equal(result.metrics.precision, 1);
  assert.equal(result.metrics.recall, 1);
  assert.equal(result.metrics.falsePositiveRate, 0);
  assert.equal(result.metrics.actionDiscoveryRate, 1);
  assert.equal(result.metrics.detectorAccuracy, 1);
  assert.equal(result.metrics.reproductionSuccessRate, 1);
  for (const artifact of [
    "report.html",
    "summary.json",
    "findings.json",
    "scan.json",
    "cleanup-ledger.json",
    "benchmark.json",
    "benchmark.md",
    "benchmark.html",
  ]) {
    await access(path.join(result.reportDirectory, artifact));
  }
  assert.ok((await readdir(path.join(result.reportDirectory, "screenshots"))).length > 0);
  assert.ok((await readdir(path.join(result.reportDirectory, "network"))).length > 0);
  assert.ok((await readdir(path.join(result.reportDirectory, "reproductions"))).length > 0);
  const cliScan = await runCommand({
    executable: process.execPath,
    args: [
      "dist/cli.js",
      "scan",
      `${fixture.url}/browser-local`,
      "--deep",
      "--trace",
      "--video",
      "--max-pages", "1",
      "--max-actions", "2",
      "--settle", "100",
      "--output", path.join(outputRoot, "cli-scan"),
      "--json",
      ...(process.env.REALDONE_BROWSER_PATH ? ["--browser-path", process.env.REALDONE_BROWSER_PATH] : []),
    ],
    cwd: process.cwd(),
    timeoutMs: 30_000,
  });
  assert.equal(commandPassed(cliScan), true, cliScan.stderr);
  const cliSummary = JSON.parse(cliScan.stdout);
  assert.equal(cliSummary.verdicts.BROWSER_LOCAL, 1);
  const cliReportNames = await readdir(path.join(outputRoot, "cli-scan"), { withFileTypes: true });
  const cliReportDirectory = path.join(outputRoot, "cli-scan", cliReportNames.find((entry) => entry.isDirectory()).name);
  assert.ok((await readdir(path.join(cliReportDirectory, "traces"))).length > 0);
  assert.ok((await readdir(path.join(cliReportDirectory, "videos"))).length > 0);
  const selectorFinding = result.report.findings.find((finding) => finding.action.label.includes("Toggle resilient"));
  assert.equal(selectorFinding?.evidence.locatorResolution?.chosenStrategy, "role");
  const cleanupDryRun = await runCleanup(result.reportDirectory, { confirm: false, allowHosts: [], retries: 1 });
  assert.ok(cleanupDryRun.pending > 0);
  const cleanup = await runCleanup(result.reportDirectory, { confirm: true, allowHosts: [], retries: 1 });
  assert.equal(cleanup.failed, 0);
  assert.ok(cleanup.cleaned >= 1);
  const flowDirectory = path.join(outputRoot, "flows");
  const recording = await recordFlow(
    {
      targetUrl: `${fixture.url}/real-create`,
      name: "Create customer",
      outputFile: path.join(flowDirectory, "create-customer.json"),
      headed: false,
      timeoutMs: 8_000,
      settleMs: 300,
      saveStorageStatePath: path.join(flowDirectory, "auth.json"),
      ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
    },
    async (page) => {
      await page.getByLabel("Customer name").fill("RECORDED_CUSTOMER");
      await page.getByRole("button", { name: "Create customer" }).click();
      await page.waitForTimeout(500);
    },
  );
  assert.ok(recording.contract.steps.some((step) => step.type === "fill"));
  assert.ok(recording.contract.steps.some((step) => step.type === "click"));
  assert.ok((recording.contract.artifacts?.rrwebEventCount ?? 0) > 0);
  recording.contract.roles = {
    observer: { description: "Independent observer", authState: { path: "auth.json" } },
  };
  const pluginDirectory = path.join(outputRoot, "plugins", "fixture-storage");
  await mkdir(pluginDirectory, { recursive: true });
  const pluginManifest = path.join(pluginDirectory, "realdone.plugin.json");
  await writeFile(path.join(pluginDirectory, "index.mjs"), `
    export default {
      apiVersion: '1.0',
      name: 'fixture-storage',
      verifyProvider(expectation) {
        return { found: expectation.reference.value === 'RECORDED_CUSTOMER', detail: 'fixture object exists' };
      }
    };
  `);
  await writeFile(pluginManifest, JSON.stringify({
    apiVersion: "1.0",
    name: "fixture-storage",
    version: "1.0.0",
    entry: "./index.mjs",
    providers: [{ name: "fixture-storage-provider", kind: "storage" }],
  }));
  const recordedClick = recording.contract.steps.find((step) => step.type === "click");
  assert.ok(recordedClick);
  recordedClick.expected.push({
    type: "cross-role",
    role: "observer",
    pageUrl: `${fixture.url}/real-create`,
    assertion: { type: "text", value: "RECORDED_CUSTOMER", state: "visible" },
  });
  recordedClick.expected.push({
    type: "provider",
    provider: "fixture-storage-provider",
    kind: "storage",
    operation: "exists",
    resource: "customer-object",
    reference: { value: "RECORDED_CUSTOMER" },
    state: "confirmed",
  });
  recordedClick.expected.push({
    type: "persistence",
    value: "RECORDED_CUSTOMER",
  });
  await writeBehaviorContract(recording.contractFile, recording.contract);
  const verification = await verifyContract(recording.contractFile, {
    outputRoot: path.join(outputRoot, "verifications"),
    headed: false,
    timeoutMs: 8_000,
    settleMs: 300,
    maxRetries: 2,
    continueOnFailure: false,
    allowDestructive: false,
    allowExternal: false,
    allowHosts: [],
    pluginManifests: [pluginManifest],
    performanceBudgetFile: path.resolve("examples/realdone.performance.json"),
    deep: true,
    trace: true,
    video: true,
    ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
  });
  assert.equal(verification.verification.passed, true);
  assert.ok(verification.verification.steps.some((step) => step.assertions.some((assertion) => assertion.evidenceLevel === 7 && assertion.passed)));
  assert.ok(verification.verification.steps.some((step) => step.assertions.some((assertion) => assertion.providerEvidence?.passed)));
  assert.equal(verification.verification.performance?.passed, true);
  assert.equal(verification.verification.deep, true);
  assert.ok((verification.verification.artifacts?.traces.length ?? 0) > 0);
  assert.ok((verification.verification.artifacts?.videos.length ?? 0) > 0);
  for (const artifact of [
    ...(verification.verification.artifacts?.traces ?? []),
    ...(verification.verification.artifacts?.videos ?? []),
  ]) {
    await access(path.join(verification.outputDirectory, artifact));
  }
  const verifyOptions = {
    outputRoot: path.join(outputRoot, "baseline-runs"),
    headed: false,
    timeoutMs: 8_000,
    settleMs: 300,
    maxRetries: 2,
    continueOnFailure: false,
    allowDestructive: false,
    allowExternal: false,
    allowHosts: [],
    pluginManifests: [pluginManifest],
    performanceBudgetFile: path.resolve("examples/realdone.performance.json"),
    deep: true,
    ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
  };
  const baselineFile = path.join(outputRoot, "baseline.json");
  const baseline = await captureBaseline([recording.contractFile], baselineFile, verifyOptions, true);
  assert.equal(baseline.contracts[0]?.baseline?.passed, true);
  const greenGate = await runRegressionGate({
    baselineFile,
    contractInputs: [],
    changedFiles: [],
    outputRoot: path.join(outputRoot, "ci"),
    verifyOptions,
  });
  assert.equal(greenGate.exitCode, 0);
  const agentWorktree = path.join(outputRoot, "agent-worktree");
  await mkdir(agentWorktree, { recursive: true });
  await writeFile(path.join(agentWorktree, "README.md"), "# Agent fixture\n");
  for (const args of [
    ["init"],
    ["config", "user.email", "realdone@example.test"],
    ["config", "user.name", "RealDone Smoke"],
    ["add", "README.md"],
    ["commit", "-m", "fixture baseline"],
  ]) {
    const git = await runCommand({ executable: "git", args, cwd: agentWorktree, timeoutMs: 10_000 });
    assert.equal(commandPassed(git), true, git.stderr);
  }
  const agentGate = await runAgentVerification({
    task: "Keep the passing behavior unchanged.",
    preset: "generic",
    workingDirectory: agentWorktree,
    contractInputs: [recording.contractFile],
    outputRoot: path.join(outputRoot, "agent-runs"),
    agentTimeoutMs: 10_000,
    agentExecutable: process.execPath,
    agentArgs: ["-e", "process.exit(0)"],
    agentMaxTurns: 1,
    build: { executable: process.execPath, args: ["-e", "process.exit(0)"], timeoutMs: 10_000 },
    allowDirty: false,
    allowContractChanges: false,
    verifyOptions,
  });
  assert.equal(agentGate.exitCode, 0);
  assert.equal(agentGate.report.behaviorPassed, true);
  assert.equal(agentGate.report.changedFiles.length, 0);
  assert.equal(agentGate.report.evidencePolicy, "agent-output-is-not-verification-evidence");
  if (process.env.REALDONE_BROWSER_MATRIX === "1") {
    const matrix = await runBrowserMatrix(recording.contractFile, ["chromium", "firefox", "webkit"], {
      ...verifyOptions,
      outputRoot: path.join(outputRoot, "matrix"),
    });
    assert.equal(matrix.exitCode, 0);
    assert.deepEqual(matrix.report.entries.map((entry) => entry.browser), ["chromium", "firefox", "webkit"]);
  }
  await fetch(`${fixture.url}/__control__/break-create`, { method: "POST" });
  const redGate = await runRegressionGate({
    baselineFile,
    contractInputs: [],
    changedFiles: [],
    outputRoot: path.join(outputRoot, "ci"),
    verifyOptions,
  });
  assert.equal(redGate.exitCode, 1);
  assert.equal(redGate.report.regressions, 1);
  process.stdout.write(`Smoke scan passed: ${path.join(result.reportDirectory, "report.html")}\n`);
} finally {
  await fixture.stop();
}
