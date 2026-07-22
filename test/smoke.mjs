import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
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
import { runScan } from "../dist/scan.js";
import { runReplay } from "../dist/replay.js";

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
    allowExternal: true,
    mutationAllowed: true,
    maxPages: 48,
    maxActions: 180,
    timeoutMs: 8_000,
    settleMs: 250,
    maxDurationMs: 480_000,
    maxRetries: 2,
    deep: true,
    allowIframes: true,
    ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
  };
  const result = await runBenchmark({
    scan,
    expectationFile: path.resolve("benchmarks/fixture-app/expected.json"),
    verifyReplays: true,
    maxReplays: 2,
  });
  assert.ok(result.report.summary.pagesDiscovered >= 11);
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD201")));
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD302")));
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD003")));
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD203")));
  for (const code of ["RD004", "RD005", "RD006", "RD007", "RD008"]) {
    assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === code)), `${code} was not observed`);
  }
  for (const code of ["RD103", "RD104", "RD204", "RD205", "RD304", "RD305"]) {
    assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === code)), `${code} was not observed`);
  }
  for (const code of ["RD401", "RD402", "RD403", "RD404", "RD405", "RD501", "RD502", "RD503", "RD504", "RD505", "RD701", "RD702", "RD703", "RD704", "RD705", "RD801", "RD802", "RD803", "RD804", "RD805"]) {
    assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === code)), `${code} was not observed`);
  }
  assert.ok(result.report.findings.some((finding) => finding.verdict === "VERIFIED"));
  assert.ok(result.report.findings.some((finding) => finding.verdict === "BROWSER_LOCAL" && finding.detectorMatches.some((item) => item.code === "RD102")));
  assert.ok(result.report.findings.some((finding) => finding.action.activation === "enter" && finding.detectorMatches.some((item) => item.code === "RD201")));
  assert.ok(result.report.findings.some((finding) => finding.detectorMatches.some((item) => item.code === "RD104") && finding.evidence.persistenceScope === "MEMORY_ONLY"));
  assert.ok(result.report.findings.some((finding) => finding.action.label === "Back" && finding.verdict === "UNCERTAIN" && finding.evidence.targetNotFound && !finding.evidence.locatorResolution?.chosenStrategy));
  assert.ok(result.report.findings.some((finding) => finding.action.label === "Use current domain" && finding.verdict === "VERIFIED"));
  assert.ok(result.report.findings.some((finding) => finding.action.label === "Do nothing nearby" && finding.verdict === "NO_EFFECT" && finding.evidence.filledFields.length === 0));
  assert.ok(result.report.findings.some((finding) => finding.action.label === "Open popup" && finding.verdict === "VERIFIED" && (finding.evidence.popupUrls?.length ?? 0) === 1));
  assert.ok(result.report.findings.some((finding) => finding.action.label === "Enable alerts" && finding.verdict === "VERIFIED"));
  assert.ok(result.report.findings.some((finding) => finding.action.label === "Theme" && finding.verdict === "VERIFIED"));
  assert.ok(result.report.findings.some((finding) => finding.action.label === "Download report" && finding.verdict === "VERIFIED" && finding.evidence.downloads.includes("realdone-export.csv")));
  assert.ok(result.report.findings.some((finding) => finding.action.label === "Open row menu" && finding.verdict === "VERIFIED" && finding.action.activation === "contextmenu"));
  assert.ok(result.report.findings.some((finding) => finding.action.label === "Enable embedded setting" && finding.verdict === "VERIFIED" && finding.action.fingerprint.frameUrl));
  const snapshotFinding = result.report.findings.find((finding) => finding.action.label.includes("Save snapshot locally"));
  assert.equal(snapshotFinding?.verdict, "BROWSER_LOCAL");
  assert.equal(snapshotFinding?.evidence.persistenceScope, "BROWSER_LOCAL");
  assert.ok((snapshotFinding?.evidence.after?.storage.cookies?.length ?? 0) > 0);
  assert.ok((snapshotFinding?.evidence.after?.storage.indexedDb?.some((database) => database.stores.some((store) => store.count > 0)) ?? false));
  assert.equal(snapshotFinding?.evidence.afterHardRefresh?.canaryPresent, true);
  assert.equal(snapshotFinding?.evidence.afterNewTab?.canaryPresent, true);
  assert.ok((snapshotFinding?.evidence.after?.semanticDom?.controls.length ?? 0) > 0);
  const sessionFinding = result.report.findings.find((finding) => finding.action.pageUrl.endsWith("/session-control") && finding.action.label.includes("Save for this session"));
  assert.equal(sessionFinding?.verdict, "BROWSER_LOCAL");
  assert.equal(sessionFinding?.evidence.persistenceScope, "SESSION_PERSISTENT");
  const backendFinding = result.report.findings.find((finding) => finding.action.label.includes("Create customer") && finding.action.pageUrl.endsWith("/real-create"));
  assert.equal(backendFinding?.evidence.apiReadBack?.canaryPresent, true);
  assert.equal(backendFinding?.evidence.persistenceScope, "BACKEND_PERSISTENT");
  const webSocketFinding = result.report.findings.find((finding) => finding.action.label === "Open live channel");
  assert.equal(webSocketFinding?.verdict, "VERIFIED");
  assert.ok(webSocketFinding?.evidence.webSockets?.some((socket) => socket.receivedFrames > 0));
  assert.ok(result.report.findings.some((finding) => finding.action.label.includes("Upload persisted receipt") && finding.evidence.uploads?.some((upload) => upload.containsCanary)));
  assert.ok(result.report.findings.some((finding) => finding.action.label.includes("Export complete customers") && finding.evidence.downloadEvidence?.some((download) => (download.size ?? 0) > 0 && download.matchedFieldValues === download.expectedFieldValues)));
  assert.equal(result.metrics.precision, 1);
  assert.equal(result.metrics.recall, 1);
  assert.equal(result.metrics.falsePositiveRate, 0);
  assert.equal(result.metrics.actionDiscoveryRate, 1);
  assert.equal(result.metrics.verdictAccuracy, 1);
  assert.equal(result.metrics.detectorAccuracy, 1);
  assert.equal(result.metrics.expectationCoverage, 1);
  assert.equal(result.metrics.benchmarkTruncated, false);
  assert.equal(result.metrics.environmentValidity, 1);
  assert.equal(result.metrics.reproductionSuccessRate, 1);
  assert.equal(result.metrics.cleanupSuccess, 1);
  assert.equal(result.report.environment?.status, "VALID");
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
  for (const directory of ["snapshots", "console", "websockets", "uploads", "downloads", "contracts"]) {
    assert.ok((await readdir(path.join(result.reportDirectory, directory))).length > 0, `${directory} artifacts were not written`);
  }
  await access(path.join(result.reportDirectory, "environment.json"));
  const staticSearchFinding = result.report.findings.find((finding) => finding.detectorMatches.some((match) => match.code === "RD403"));
  assert.ok(staticSearchFinding);
  const reproducedReplay = await runReplay(staticSearchFinding.id, {
    reportDirectory: result.reportDirectory,
    outputRoot: path.join(outputRoot, "explicit-replays"),
    headed: false,
    ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
  });
  assert.equal(reproducedReplay.replay.outcome, "FINDING_REPRODUCED");
  assert.equal(reproducedReplay.exitCode, 0);
  await access(path.join(reproducedReplay.reportDirectory, "replay.json"));
  const sourceReproduction = JSON.parse(
    await readFile(path.join(result.reportDirectory, "reproductions", `${staticSearchFinding.id}.json`), "utf8"),
  );
  const writeReplayScenario = async (name, reproduction) => {
    const directory = path.join(outputRoot, "replay-scenarios", name);
    await mkdir(path.join(directory, "reproductions"), { recursive: true });
    await writeFile(
      path.join(directory, "reproductions", `${staticSearchFinding.id}.json`),
      `${JSON.stringify(reproduction, null, 2)}\n`,
    );
    return directory;
  };
  const replayOptions = {
    outputRoot: path.join(outputRoot, "scenario-replays"),
    headed: false,
    ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
  };
  const environmentScenario = await writeReplayScenario("environment-changed", {
    ...sourceReproduction,
    targetUrl: `${fixture.url}/environment-invalid`,
  });
  const environmentReplay = await runReplay(staticSearchFinding.id, {
    ...replayOptions,
    reportDirectory: environmentScenario,
  });
  assert.equal(environmentReplay.replay.outcome, "ENVIRONMENT_CHANGED");
  assert.equal(environmentReplay.exitCode, 2);
  const missingTargetScenario = await writeReplayScenario("target-not-found", {
    ...sourceReproduction,
    action: {
      ...sourceReproduction.action,
      fingerprint: {
        selector: "#realdone-missing-target",
        tag: "button",
        ordinal: 0,
        candidates: [{ strategy: "css", weight: 100, selector: "#realdone-missing-target" }],
      },
    },
  });
  const missingTargetReplay = await runReplay(staticSearchFinding.id, {
    ...replayOptions,
    reportDirectory: missingTargetScenario,
  });
  assert.equal(missingTargetReplay.replay.outcome, "TARGET_ACTION_NOT_FOUND");
  assert.equal(missingTargetReplay.exitCode, 2);
  const uncertainReproduction = structuredClone(sourceReproduction);
  delete uncertainReproduction.sourceVerdict;
  delete uncertainReproduction.sourceDetectorCodes;
  const uncertainScenario = await writeReplayScenario("uncertain", uncertainReproduction);
  const uncertainReplay = await runReplay(staticSearchFinding.id, {
    ...replayOptions,
    reportDirectory: uncertainScenario,
  });
  assert.equal(uncertainReplay.replay.outcome, "REPLAY_UNCERTAIN");
  assert.equal(uncertainReplay.exitCode, 2);

  const environmentControl = await runScan({
    ...scan,
    targetUrl: `${fixture.url}/environment-control`,
    outputRoot: path.join(outputRoot, "environment-control"),
    maxPages: 1,
    maxActions: 0,
    environmentTimeoutMs: 3_000,
  });
  assert.equal(environmentControl.exitCode, 0);
  assert.equal(environmentControl.report.environment?.status, "VALID");
  assert.equal(environmentControl.report.environment?.assets.failed, 0);

  const environmentInvalid = await runScan({
    ...scan,
    targetUrl: `${fixture.url}/environment-invalid`,
    outputRoot: path.join(outputRoot, "environment-invalid"),
    maxPages: 1,
    maxActions: 0,
    environmentTimeoutMs: 3_000,
  });
  assert.equal(environmentInvalid.exitCode, 2);
  assert.equal(environmentInvalid.report.environment?.status, "ENVIRONMENT_INVALID");
  assert.equal(environmentInvalid.report.findings.length, 0);
  assert.ok(environmentInvalid.report.environment?.findings.some((finding) => finding.code === "RD1001"));
  await access(path.join(environmentInvalid.reportDirectory, "environment.json"));

  const delayedBootstrap = await runScan({
    ...scan,
    targetUrl: `${fixture.url}/delayed-bootstrap`,
    outputRoot: path.join(outputRoot, "delayed-bootstrap"),
    maxPages: 1,
    maxActions: 1,
    environmentTimeoutMs: 3_000,
  });
  assert.equal(delayedBootstrap.exitCode, 0);
  assert.equal(delayedBootstrap.report.environment?.status, "VALID");
  assert.equal(delayedBootstrap.report.summary.verdicts.VERIFIED, 1);

  const managedScan = await runCommand({
    executable: process.execPath,
    args: [
      "dist/cli.js",
      "scan",
      "--manage-runtime",
      "--project", path.resolve("benchmarks/managed-app"),
      "--health-endpoint", "/health",
      "--max-pages", "1",
      "--max-actions", "1",
      "--deep",
      "--environment-timeout", "8000",
      "--output", path.join(outputRoot, "managed-scan"),
      "--json",
      ...(process.env.REALDONE_BROWSER_PATH ? ["--browser-path", process.env.REALDONE_BROWSER_PATH] : []),
    ],
    cwd: process.cwd(),
    timeoutMs: 30_000,
  });
  assert.equal(commandPassed(managedScan), true, managedScan.stderr);
  const managedSummary = JSON.parse(managedScan.stdout);
  assert.equal(managedSummary.environmentStatus, "VALID");
  assert.equal(managedSummary.verdicts.VERIFIED, 1);
  const managedReportNames = await readdir(path.join(outputRoot, "managed-scan"), { withFileTypes: true });
  const managedReportDirectory = path.join(outputRoot, "managed-scan", managedReportNames.find((entry) => entry.isDirectory()).name);
  const managedReport = JSON.parse(await readFile(path.join(managedReportDirectory, "scan.json"), "utf8"));
  assert.equal(managedReport.findings[0]?.evidence.afterAppRestart?.canaryPresent, true);
  assert.equal(managedReport.findings[0]?.evidence.apiReadBack?.canaryPresent, true);
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
  assert.equal(cleanupDryRun.pending, 0);
  assert.ok(cleanupDryRun.cleaned >= 1);
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
  const recorderSecret = "RD-RECORDER-SECRET-42";
  const secretRecording = await recordFlow(
    {
      targetUrl: `${fixture.url}/recorder-secret`,
      name: "Recorder secret safety",
      outputFile: path.join(flowDirectory, "recorder-secret.json"),
      headed: false,
      timeoutMs: 8_000,
      settleMs: 300,
      ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
    },
    async (page) => {
      await page.getByPlaceholder("Email").fill("rd-recorder@example.test");
      await page.getByPlaceholder("Password").fill(recorderSecret);
      await page.getByRole("button", { name: "Login" }).click();
    },
  );
  const secretContractText = JSON.stringify(secretRecording.contract);
  const secretRrwebText = await readFile(secretRecording.rrwebFile, "utf8");
  assert.equal(secretContractText.includes(recorderSecret), false);
  assert.equal(secretRrwebText.includes(recorderSecret), false);
  const passwordStep = secretRecording.contract.steps.find((step) => step.type === "fill" && step.secretEnv);
  assert.equal(passwordStep?.secretEnv, "REALDONE_PASSWORD");
  assert.equal(passwordStep?.fingerprint?.accessibleName, "Password");
  const complexUploadFile = path.join(outputRoot, "complex-upload.txt");
  await writeFile(complexUploadFile, "RD_COMPLEX_UPLOAD_CONTENT\n");
  const complexRecording = await recordFlow(
    {
      targetUrl: `${fixture.url}/recorder-complex`,
      name: "Complex semantic recorder",
      outputFile: path.join(flowDirectory, "complex-recorder.json"),
      headed: false,
      timeoutMs: 8_000,
      settleMs: 300,
      ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
    },
    async (page) => {
      await page.locator("#complex-upload").setInputFiles(complexUploadFile);
      await page.locator("#rich-editor").fill("Recorded rich description");
      await page.locator("#command").fill("run");
      await page.locator("#command").press("Enter");
      const popupPromise = page.waitForEvent("popup");
      await page.locator("#open-popup").click();
      const popup = await popupPromise;
      await popup.waitForLoadState("domcontentloaded");
      await popup.close();
      const downloadPromise = page.waitForEvent("download");
      await page.locator("#complex-download").click();
      await downloadPromise;
      await page.locator("#drag-source").dragTo(page.locator("#drag-target"));
    },
  );
  for (const type of ["upload", "richtext", "press", "drag"]) {
    assert.ok(complexRecording.contract.steps.some((step) => step.type === type), `Complex recorder missed ${type}`);
  }
  assert.ok(complexRecording.contract.steps.some((step) => step.expected.some((expectation) => expectation.type === "popup")));
  assert.ok(complexRecording.contract.steps.some((step) => step.expected.some((expectation) => expectation.type === "download")));
  process.env.REALDONE_UPLOAD_RECEIPT_FILE = complexUploadFile;
  const complexVerification = await verifyContract(complexRecording.contractFile, {
    outputRoot: path.join(outputRoot, "complex-verifications"),
    headed: false,
    timeoutMs: 8_000,
    settleMs: 300,
    maxRetries: 2,
    continueOnFailure: false,
    allowDestructive: false,
    allowExternal: false,
    allowHosts: [],
    ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
  });
  delete process.env.REALDONE_UPLOAD_RECEIPT_FILE;
  assert.equal(complexVerification.verification.passed, true);
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
      },
      verifySource(expectation) {
        return { matchedRows: expectation.resource === 'customer' ? 1 : 0, matchedFields: expectation.filters.map(filter => filter.field), detail: 'fixture Prisma bridge queried' };
      },
      discoverSource(input) {
        return [{ adapter: 'prisma', resource: input.resource ?? 'customer', fields: [{ name: 'id', type: 'string', nullable: false }, { name: 'name', type: 'string', nullable: false }], primaryKey: ['id'], softDeleteFields: [], schemaHash: 'fixture' }];
      },
      snapshotSource() {
        return { rows: [{ id: 'customer-1', name: 'RECORDED_CUSTOMER' }], truncated: false };
      },
      cleanupSource(target) {
        if (target.filters.length !== 1 || target.filters[0].field !== 'id') throw new Error('fixture Prisma cleanup requires id');
        return { deletedRows: 1, detail: 'fixture Prisma bridge cleaned one row' };
      }
    };
  `);
  await writeFile(pluginManifest, JSON.stringify({
    apiVersion: "1.0",
    name: "fixture-storage",
    version: "1.0.0",
    entry: "./index.mjs",
    providers: [{ name: "fixture-storage-provider", kind: "storage" }],
    sources: [{ name: "fixture-prisma-source", kind: "prisma" }],
  }));
  process.env.RD_FIXTURE_SUPABASE_KEY = "fixture-supabase-key";
  const supabaseConfig = path.join(outputRoot, "supabase.json");
  const firebaseConfig = path.join(outputRoot, "firebase.json");
  const providerConfig = path.join(outputRoot, "providers.json");
  await writeFile(supabaseConfig, JSON.stringify({
    schemaVersion: "1.0",
    adapter: "supabase",
    url: fixture.url,
    keyEnv: "RD_FIXTURE_SUPABASE_KEY",
    resources: {
      customers: {
        target: "customer_rows",
        fields: { id: { target: "customer_id", type: "integer", nullable: false }, name: { target: "customer_name", type: "text" }, deletedAt: { target: "deleted_at", type: "timestamp" } },
        primaryKey: ["id"],
        softDeleteFields: ["deletedAt"],
      },
    },
  }));
  await writeFile(firebaseConfig, JSON.stringify({
    schemaVersion: "1.0",
    adapter: "firebase",
    projectId: "demo",
    baseUrl: fixture.url,
    resources: {
      customers: {
        target: "customers",
        fields: { id: { target: "__name__", type: "string", nullable: false }, name: { target: "name", type: "string" }, deletedAt: { target: "deletedAt", type: "timestamp" } },
        primaryKey: ["id"],
        softDeleteFields: ["deletedAt"],
      },
    },
  }));
  process.env.RD_FIXTURE_STRIPE_KEY = "sk_test_fixture";
  process.env.RD_FIXTURE_AWS_ACCESS_KEY = "AKIATEST";
  process.env.RD_FIXTURE_AWS_SECRET_KEY = "fixture-aws-secret";
  await writeFile(providerConfig, JSON.stringify({ schemaVersion: "1.0", providers: {
    "stripe-fixture": { adapter: "stripe", secretEnv: "RD_FIXTURE_STRIPE_KEY", baseUrl: fixture.url },
    "s3-fixture": { adapter: "s3", accessKeyEnv: "RD_FIXTURE_AWS_ACCESS_KEY", secretKeyEnv: "RD_FIXTURE_AWS_SECRET_KEY", region: "us-test-1", bucket: "realdone-test", endpoint: fixture.url },
  } }));
  const sqliteFile = path.join(outputRoot, "phase-f.sqlite");
  const { default: SqliteDatabase } = await import("better-sqlite3");
  const sqliteSetup = new SqliteDatabase(sqliteFile);
  sqliteSetup.exec("CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, deleted_at TEXT)");
  sqliteSetup.prepare("INSERT INTO customers (id, name) VALUES (?, ?)").run(1, "RECORDED_CUSTOMER");
  sqliteSetup.close();
  const recordedClick = recording.contract.steps.find((step) => step.type === "click");
  assert.ok(recordedClick);
  recordedClick.expected.push({
    type: "source",
    adapter: "sqlite",
    resource: "customers",
    filters: [{ field: "name", value: "RECORDED_CUSTOMER" }],
    state: "present",
    maxMatches: 1,
  });
  recordedClick.expected.push({ type: "source", adapter: "supabase", resource: "customers", filters: [{ field: "name", value: "RECORDED_CUSTOMER" }], state: "present", maxMatches: 1 });
  recordedClick.expected.push({ type: "source", adapter: "firebase", resource: "customers", filters: [{ field: "name", value: "RECORDED_CUSTOMER" }], state: "present", maxMatches: 1 });
  recordedClick.expected.push({ type: "source", adapter: "prisma", connector: "fixture-prisma-source", resource: "customer", filters: [{ field: "name", value: "RECORDED_CUSTOMER" }], state: "present", maxMatches: 1 });
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
  recordedClick.expected.push({ type: "provider", provider: "stripe-fixture", kind: "payment", operation: "succeeded", resource: "payment-intent", reference: { value: "pi_fixture" }, state: "confirmed" });
  recordedClick.expected.push({ type: "provider", provider: "s3-fixture", kind: "storage", operation: "exists", resource: "object", reference: { value: "customer.txt" }, state: "confirmed" });
  recordedClick.expected.push({
    type: "persistence",
    value: "RECORDED_CUSTOMER",
    strategies: ["reload", "hard-reload", "new-tab", "clean-context", "logout-login"],
  });
  recording.contract.cleanup.push({ adapter: "sqlite", resource: "customers", filters: [{ field: "id", value: 1 }] });
  recording.contract.cleanup.push({ adapter: "prisma", connector: "fixture-prisma-source", resource: "customer", filters: [{ field: "id", value: "customer-1" }] });
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
    sqlitePath: sqliteFile,
    databaseConfigPaths: [supabaseConfig, firebaseConfig],
    providerConfigPaths: [providerConfig],
    performanceBudgetFile: path.resolve("examples/realdone.performance.json"),
    deep: true,
    trace: true,
    video: true,
    ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
  });
  assert.equal(verification.verification.passed, true);
  assert.ok(verification.verification.steps.some((step) => step.assertions.some((assertion) => assertion.evidenceLevel === 7 && assertion.passed)));
  assert.ok(verification.verification.steps.some((step) => step.assertions.some((assertion) => assertion.persistenceScope === "CROSS_USER_CONFIRMED" && assertion.passed)));
  assert.deepEqual(
    [...new Set(verification.verification.steps.flatMap((step) => step.assertions.flatMap((assertion) => assertion.providerEvidence?.passed ? [assertion.providerEvidence.provider] : [])))].sort(),
    ["fixture-storage-provider", "s3-fixture", "stripe-fixture"],
  );
  assert.deepEqual(
    [...new Set(verification.verification.steps.flatMap((step) => step.assertions.flatMap((assertion) => assertion.sourceEvidence?.passed ? [assertion.sourceEvidence.adapter] : [])))].sort(),
    ["firebase", "prisma", "sqlite", "supabase"],
  );
  assert.ok(verification.verification.steps.some((step) => step.assertions.some((assertion) => assertion.persistenceScope === "SOURCE_OF_TRUTH_CONFIRMED" && assertion.passed)));
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
  const authorizationContract = (allowed) => ({
    schemaVersion: "1.0",
    id: allowed ? "authorization-broken" : "authorization-control",
    name: allowed ? "Intentional authorization failures" : "Authorization denied controls",
    baseUrl: fixture.url,
    createdAt: new Date().toISOString(),
    tags: ["authorization", allowed ? "broken" : "control"],
    roles: { observer: { description: "Unprivileged observer", authState: { path: "auth.json" } } },
    steps: [{
      id: "authorization-matrix",
      type: "navigate",
      role: "observer",
      pageUrl: `${fixture.url}/phase-d`,
      url: `${fixture.url}/phase-d`,
      atMs: 0,
      expected: [
        { type: "authorization", check: "ui-only-permission", role: "observer", ui: { pageUrl: `${fixture.url}/phase-d`, text: "Delete tenant", state: "absent" }, request: { method: "DELETE", url: `${fixture.url}/api/authz/${allowed ? "allowed" : "denied"}/ui-only` } },
        { type: "authorization", check: "cross-tenant-read", role: "observer", request: { method: "GET", url: `${fixture.url}/api/authz/${allowed ? "allowed" : "denied"}/cross-read` } },
        { type: "authorization", check: "cross-tenant-write", role: "observer", request: { method: "PATCH", url: `${fixture.url}/api/authz/${allowed ? "allowed" : "denied"}/cross-write` } },
        { type: "authorization", check: "revoked-role", role: "observer", request: { method: "POST", url: `${fixture.url}/api/authz/${allowed ? "allowed" : "denied"}/revoked-role` } },
        { type: "authorization", check: "admin-route", role: "observer", route: { url: `${fixture.url}/${allowed ? "admin-exposed" : "admin-denied"}` } },
      ],
    }],
    cleanup: [],
    source: { browser: "Chromium", recordedBy: "realdone" },
  });
  const brokenAuthorizationFile = path.join(flowDirectory, "authorization-broken.json");
  const controlAuthorizationFile = path.join(flowDirectory, "authorization-control.json");
  await writeBehaviorContract(brokenAuthorizationFile, authorizationContract(true));
  await writeBehaviorContract(controlAuthorizationFile, authorizationContract(false));
  const authorizationOptions = {
    outputRoot: path.join(outputRoot, "authorization-verifications"),
    headed: false,
    timeoutMs: 8_000,
    settleMs: 200,
    maxRetries: 1,
    continueOnFailure: true,
    allowDestructive: false,
    allowExternal: false,
    allowHosts: [],
    ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
  };
  const brokenAuthorization = await verifyContract(brokenAuthorizationFile, authorizationOptions);
  assert.equal(brokenAuthorization.verification.passed, false);
  assert.deepEqual(
    brokenAuthorization.verification.steps.flatMap((step) => step.assertions.map((assertion) => assertion.detectorCode)).filter(Boolean).sort(),
    ["RD601", "RD602", "RD603", "RD604", "RD605"],
  );
  const controlAuthorization = await verifyContract(controlAuthorizationFile, authorizationOptions);
  assert.equal(controlAuthorization.verification.passed, true);
  assert.equal(controlAuthorization.verification.steps.some((step) => step.assertions.some((assertion) => assertion.detectorCode)), false);
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
    sqlitePath: sqliteFile,
    databaseConfigPaths: [supabaseConfig, firebaseConfig],
    providerConfigPaths: [providerConfig],
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
  const realCreateFinding = result.report.findings.find((finding) => finding.action.pageUrl.endsWith("/real-create") && finding.action.label.includes("Create customer"));
  assert.ok(realCreateFinding);
  const changedReplay = await runReplay(realCreateFinding.id, {
    reportDirectory: result.reportDirectory,
    outputRoot: path.join(outputRoot, "changed-replays"),
    headed: false,
    ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
  });
  assert.equal(changedReplay.replay.outcome, "FINDING_NO_LONGER_REPRODUCED");
  assert.equal(changedReplay.exitCode, 1);
  const redGate = await runRegressionGate({
    baselineFile,
    contractInputs: [],
    changedFiles: [],
    outputRoot: path.join(outputRoot, "ci"),
    verifyOptions,
  });
  assert.equal(redGate.exitCode, 1);
  assert.equal(redGate.report.regressions, 1);
  assert.equal(redGate.report.changes[0]?.outcome, "REGRESSION");
  assert.ok(redGate.report.changes[0]?.detectorCodes.includes("RD904"));
  const sqliteCleanup = await runCleanup(verification.outputDirectory, {
    confirm: true,
    confirmDatabase: true,
    sqlitePath: sqliteFile,
    pluginManifests: [pluginManifest],
    allowHosts: [],
    retries: 1,
  });
  assert.equal(sqliteCleanup.failed, 0);
  assert.equal(sqliteCleanup.cleaned, 2);
  const sqliteCheck = new SqliteDatabase(sqliteFile, { readonly: true });
  assert.equal(sqliteCheck.prepare("SELECT COUNT(*) AS count FROM customers WHERE id = ?").get(1).count, 0);
  sqliteCheck.close();
  delete process.env.RD_FIXTURE_SUPABASE_KEY;
  delete process.env.RD_FIXTURE_STRIPE_KEY;
  delete process.env.RD_FIXTURE_AWS_ACCESS_KEY;
  delete process.env.RD_FIXTURE_AWS_SECRET_KEY;
  process.stdout.write(`Smoke scan passed: ${path.join(result.reportDirectory, "report.html")}\n`);
} finally {
  await fixture.stop();
}
