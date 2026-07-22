#!/usr/bin/env node
import path from "node:path";
import { Command, Option } from "commander";
import { loadTask, runAgentVerification } from "./agent/pipeline.js";
import { parseAgentPreset } from "./agent/presets.js";
import { runBenchmark } from "./benchmark/evaluate.js";
import { runBrowserMatrix } from "./browser/matrix.js";
import type { BrowserName } from "./browser/runtime.js";
import { captureBaseline, loadBehaviorManifest } from "./baseline/manifest.js";
import { selectAffectedContracts } from "./baseline/affected.js";
import { runRegressionGate } from "./baseline/regression.js";
import { runCleanup } from "./cleanup/ledger.js";
import { loadActionPolicy } from "./core/policy.js";
import { runReplay } from "./replay.js";
import { recordFlow } from "./record/recorder.js";
import { runScan, type ScanProgress } from "./scan.js";
import { verifyContract } from "./contracts/verifier.js";
import { exportPlaywrightTest } from "./export/playwright.js";
import { discoverProject, writeProjectProfile } from "./project/discovery.js";
import { runManagedScan, type RuntimeMode } from "./application/managed-scan.js";
import type { ScanOptions } from "./types.js";
import { REALDONE_VERSION } from "./version.js";
import { createSourceAdapterFromFile } from "./adapters/registry.js";
import { SqliteSourceAdapter } from "./adapters/sqlite/index.js";
import type { DiscoverableSourceAdapter } from "./adapters/types.js";
import { BuiltinProviderHost } from "./providers/builtin.js";
import { requireProjectActionConsent } from "./core/consent.js";

function positiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received: ${value}`);
  return parsed;
}

function nonNegativeInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Expected a non-negative integer, received: ${value}`);
  return parsed;
}

function boundedWorkers(value: string): number {
  const parsed = positiveInteger(value);
  if (parsed > 16) throw new Error(`Worker count must be between 1 and 16; received: ${value}`);
  return parsed;
}

function boundedSourceSnapshotLimit(value: string): number {
  const parsed = positiveInteger(value);
  if (parsed > 1_000) throw new Error(`Source snapshot limit must be between 1 and 1000; received: ${value}`);
  return parsed;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function browserName(value: string): BrowserName {
  if (value === "chromium" || value === "firefox" || value === "webkit") return value;
  throw new Error(`Expected chromium, firefox, or webkit; received: ${value}`);
}

function collectBrowser(value: string, previous: BrowserName[]): BrowserName[] {
  return [...previous, browserName(value)];
}

function runtimeMode(value: string): RuntimeMode {
  if (value === "development" || value === "production" || value === "docker") return value;
  throw new Error(`Expected development, production, or docker; received: ${value}`);
}

function roleStates(values: string[], baseDirectory = process.cwd()): Record<string, string> {
  return Object.fromEntries(values.map((value) => {
    const separator = value.indexOf("=");
    if (separator <= 0 || separator === value.length - 1) throw new Error(`Expected role=storage-state-file; received: ${value}`);
    return [value.slice(0, separator), path.resolve(baseDirectory, value.slice(separator + 1))];
  }));
}

function progressLine(progress: ScanProgress): void {
  const counter = progress.current && progress.total ? ` [${progress.current}/${progress.total}]` : "";
  process.stderr.write(`realdone ${progress.stage}${counter}  ${progress.message}\n`);
}

function recorderStopSignal(durationSeconds?: number): Promise<void> {
  if (durationSeconds) {
    return new Promise((resolve) => setTimeout(resolve, durationSeconds * 1_000));
  }
  return new Promise((resolve) => {
    const finish = (): void => {
      process.stdin.pause();
      resolve();
    };
    process.once("SIGINT", finish);
    process.stdin.resume();
    process.stdin.once("data", finish);
  });
}

function printSummary(reportDirectory: string, report: Awaited<ReturnType<typeof runScan>>["report"]): void {
  const { summary } = report;
  process.stdout.write(`\nREALDONE SCAN\n\n`);
  process.stdout.write(`Pages discovered:      ${summary.pagesDiscovered}\n`);
  process.stdout.write(`Visible actions:       ${summary.visibleActions}\n`);
  process.stdout.write(`Actions verified:      ${summary.actionsVerified}\n`);
  process.stdout.write(`Actions skipped:       ${summary.actionsSkipped}\n\n`);
  for (const [verdict, count] of Object.entries(summary.verdicts)) {
    if (count > 0) process.stdout.write(`${verdict.padEnd(20)} ${count}\n`);
  }
  process.stdout.write(`\nReport: ${path.join(reportDirectory, "report.html")}\n`);
}

const program = new Command();
program
  .name("realdone")
  .description("Behavioral verification for AI-built web applications")
  .version(REALDONE_VERSION)
  .showHelpAfterError();

program
  .command("mcp")
  .description("Run the local RealDone MCP server for coding agents")
  .option("--project <directory>", "project root exposed to the MCP server", ".")
  .option("--allow-project-actions", "user confirms this project is disposable local/staging and MCP may operate it", false)
  .action(async (values: Record<string, unknown>) => {
    const { runRealDoneMcpServer } = await import("./mcp/server.js");
    await runRealDoneMcpServer({
      projectRoot: path.resolve(String(values.project)),
      allowProjectActions: Boolean(values.allowProjectActions),
    });
  });

program
  .command("init")
  .description("Discover a web project and write a managed-runtime profile")
  .argument("[directory]", "project directory", ".")
  .option("--out <file>", "project profile path")
  .option("--json", "print the discovered profile as JSON", false)
  .action(async (directory: string, values: Record<string, unknown>) => {
    const projectRoot = path.resolve(directory);
    const profile = await discoverProject(projectRoot);
    const output = path.resolve(String(values.out ?? path.join(projectRoot, ".realdone", "project.json")));
    await writeProjectProfile(profile, output);
    if (values.json) process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
    else {
      process.stdout.write(`\nREALDONE PROJECT\n\nFramework:        ${profile.framework}\nPackage manager:  ${profile.packageManager}\nDevelopment:      ${profile.commands.development ? [profile.commands.development.executable, ...profile.commands.development.args].join(" ") : "not found"}\nBuild:            ${profile.commands.build ? [profile.commands.build.executable, ...profile.commands.build.args].join(" ") : "not found"}\nLocal URL:        ${profile.localUrl}\nHealth endpoint:  ${profile.healthEndpoint}\nDatabase:         ${profile.databases.join(", ") || "not detected"}\nAuth:             ${profile.authProviders.join(", ") || "not detected"}\nTests:            ${profile.testFrameworks.join(", ") || "not detected"}\nProfile:          ${output}\n`);
    }
  });

program
  .command("scan")
  .description("Discover safe visible actions, execute them, and verify their effects")
  .argument("[url]", "application URL; omit it to discover and run the current project")
  .option("--max-pages <number>", "maximum pages to discover", positiveInteger)
  .option("--max-actions <number>", "maximum actions to execute", positiveInteger)
  .option("--full", "use large safe-audit budgets and deep persistence checks", false)
  .option("--timeout <milliseconds>", "navigation and action timeout", positiveInteger, 10_000)
  .option("--settle <milliseconds>", "settle time after actions", positiveInteger, 800)
  .option("--max-duration <milliseconds>", "global scan time budget", positiveInteger)
  .option("--retries <number>", "bounded retries for transient navigation/locator failures", nonNegativeInteger)
  .option("--output <directory>", "report root", ".realdone/reports")
  .option("--headed", "show Chromium while scanning", false)
  .option("--allow-destructive", "allow destructive actions", false)
  .option("--allow-external", "allow external-effect actions", false)
  .option("--allow-host <hostname>", "allow mutations on an explicit staging host", collect, [])
  .option("--storage-state <file>", "Playwright storage state for authenticated pages")
  .option("--browser-path <file>", "use an existing Chromium/Chrome executable")
  .option("--project <directory>", "project root for discovery and managed runtime")
  .option("--manage-runtime", "start and stop the target project around the scan", false)
  .option("--runtime-mode <mode>", "managed runtime mode: development, production, or docker", runtimeMode, "development")
  .option("--runtime-restarts <number>", "restart target crashes up to this count", nonNegativeInteger, 1)
  .option("--health-endpoint <path>", "application health endpoint")
  .option("--environment-timeout <milliseconds>", "environment bootstrap and render timeout", positiveInteger, 10_000)
  .option("--accept-environment-risk", "continue after recording an invalid environment", false)
  .option("--allow-iframe", "discover and execute same-origin iframe actions", false)
  .option("--policy <file>", "JSON action policy and budget file")
  .option("--sqlite <file>", "attach value-free SQLite snapshots to mutation evidence")
  .option("--database-config <file>", "attach a configured source adapter; repeat for multiple adapters", collect, [])
  .option("--provider-config <file>", "attach automatic read-only provider confirmation; repeat for multiple files", collect, [])
  .option("--source-snapshot-limit <number>", "maximum hashed rows per source resource", boundedSourceSnapshotLimit, 100)
  .option("--deep", "confirm mutation persistence in a fresh browser context", false)
  .option("--trace", "capture a Playwright trace for every executed action", false)
  .option("--trace-on-failure", "retain Playwright traces only for non-passing findings", false)
  .option("--video", "capture browser video for every executed action", false)
  .option("--json", "print the machine-readable summary", false)
  .option("-y, --yes", "confirm once that this project is disposable local/staging and allow permitted actions", false)
  .action(async (url: string | undefined, values: Record<string, unknown>) => {
    const projectLabel = url ?? path.resolve(String(values.project ?? "."));
    await requireProjectActionConsent({
      project: projectLabel,
      confirmed: Boolean(values.yes),
      interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    });
    const policy = values.policy ? await loadActionPolicy(path.resolve(String(values.policy))) : undefined;
    const full = Boolean(values.full);
    const sourceAdapters: DiscoverableSourceAdapter[] = [];
    if (values.sqlite) sourceAdapters.push(new SqliteSourceAdapter(path.resolve(String(values.sqlite))));
    for (const file of values.databaseConfig as string[]) {
      sourceAdapters.push(await createSourceAdapterFromFile(path.resolve(file)));
    }
    const providerConfigPaths = (values.providerConfig as string[]).map((file) => path.resolve(file));
    const providerVerifier = providerConfigPaths.length > 0 ? await BuiltinProviderHost.load(providerConfigPaths) : undefined;
    const options: Omit<ScanOptions, "targetUrl" | "healthEndpoint" | "restartTarget"> = {
      outputRoot: path.resolve(String(values.output)),
      headed: Boolean(values.headed),
      allowHosts: [...new Set([...(values.allowHost as string[]), ...(policy?.allowHosts ?? [])])],
      allowDestructive: Boolean(values.allowDestructive),
      allowExternal: Boolean(values.allowExternal),
      mutationAllowed: false,
      maxPages: Number(values.maxPages ?? policy?.budgets?.maxPages ?? (full ? 100 : 8)),
      maxActions: Number(values.maxActions ?? policy?.budgets?.maxActions ?? (full ? 500 : 24)),
      timeoutMs: Number(values.timeout),
      settleMs: Number(values.settle),
      maxDurationMs: Number(values.maxDuration ?? policy?.budgets?.maxDurationMs ?? (full ? 1_800_000 : 120_000)),
      maxRetries: Number(values.retries ?? policy?.budgets?.maxRetries ?? 2),
      deep: Boolean(values.deep) || full,
      trace: Boolean(values.trace),
      traceOnFailure: Boolean(values.traceOnFailure) || full,
      video: Boolean(values.video),
      environmentTimeoutMs: Number(values.environmentTimeout),
      acceptEnvironmentRisk: Boolean(values.acceptEnvironmentRisk),
      allowIframes: Boolean(values.allowIframe),
      sourceAdapters,
      sourceSnapshotLimit: Number(values.sourceSnapshotLimit),
      ...(providerVerifier ? { providerVerifier } : {}),
      ...(policy ? { policy } : {}),
      ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
      ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
    };
    try {
      const result = await runManagedScan({
        ...(url ? { url } : {}),
        ...(values.project ? { projectDirectory: path.resolve(String(values.project)) } : {}),
        manageRuntime: Boolean(values.manageRuntime),
        runtimeMode: values.runtimeMode as RuntimeMode,
        runtimeRestarts: Number(values.runtimeRestarts),
        ...(values.healthEndpoint ? { healthEndpoint: String(values.healthEndpoint) } : {}),
        scanOptions: options,
      }, progressLine);
      if (values.json) process.stdout.write(`${JSON.stringify(result.report.summary, null, 2)}\n`);
      else printSummary(result.reportDirectory, result.report);
      process.exitCode = result.exitCode;
    } finally {
      await Promise.all(sourceAdapters.map((adapter) => adapter.close()));
    }
  });

program
  .command("cleanup")
  .description("Inspect or execute the idempotent cleanup ledger for a scan")
  .requiredOption("--report-dir <directory>", "scan report directory")
  .option("--confirm", "perform cleanup; without this flag the command is a dry run", false)
  .option("--allow-host <hostname>", "explicitly allow cleanup on a staging host", collect, [])
  .option("--retries <number>", "retries for transient cleanup failures", nonNegativeInteger, 2)
  .option("--storage-state <file>", "Playwright storage state for authenticated DELETE requests")
  .option("--postgres-config <file>", "PostgreSQL source adapter config")
  .option("--sqlite <file>", "SQLite database file for zero-config source checks")
  .option("--database-config <file>", "database adapter config; repeat for multiple adapters", collect, [])
  .option("--plugin <manifest>", "Prisma/custom source plugin manifest; repeat for multiple plugins", collect, [])
  .option("--plugin-timeout <milliseconds>", "per-plugin cleanup timeout", positiveInteger, 5_000)
  .option("--plugin-memory <megabytes>", "per-plugin worker memory limit", positiveInteger, 64)
  .option("--confirm-database", "allow transaction-protected database ledger cleanup", false)
  .action(async (values: Record<string, unknown>) => {
    const result = await runCleanup(path.resolve(String(values.reportDir)), {
      confirm: Boolean(values.confirm),
      allowHosts: values.allowHost as string[],
      retries: Number(values.retries),
      ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
      ...(values.postgresConfig ? { postgresConfigPath: path.resolve(String(values.postgresConfig)) } : {}),
      ...(values.sqlite ? { sqlitePath: path.resolve(String(values.sqlite)) } : {}),
      databaseConfigPaths: (values.databaseConfig as string[]).map((file) => path.resolve(file)),
      pluginManifests: (values.plugin as string[]).map((file) => path.resolve(file)),
      pluginTimeoutMs: Number(values.pluginTimeout),
      pluginMemoryLimitMb: Number(values.pluginMemory),
      confirmDatabase: Boolean(values.confirmDatabase),
    });
    process.stdout.write(`Cleanup ledger\n\ncleaned: ${result.cleaned}\nfailed: ${result.failed}\nmanual: ${result.manual}\npending: ${result.pending}\n`);
    if (!values.confirm && result.pending > 0) process.stdout.write("\nDry run only. Re-run with --confirm to execute safe cleanup targets.\n");
    if (values.confirm && !values.confirmDatabase && result.ledger.resources.some((resource) => resource.strategy !== "http" && resource.status === "pending")) {
      process.stdout.write("\nDatabase targets remain pending. Database cleanup also requires --confirm-database and the matching adapter option.\n");
    }
    if (result.failed > 0) process.exitCode = 1;
  });

program
  .command("record")
  .description("Record one human-driven flow as a deterministic behavior contract")
  .argument("<url>", "application URL")
  .requiredOption("--name <name>", "human-readable flow name")
  .option("--out <file>", "contract JSON path")
  .option("--headless", "record without showing Chromium (automation only)", false)
  .option("--duration <seconds>", "stop automatically after a duration", positiveInteger)
  .option("--timeout <milliseconds>", "initial navigation timeout", positiveInteger, 15_000)
  .option("--settle <milliseconds>", "outcome capture delay", positiveInteger, 500)
  .option("--storage-state <file>", "start from existing Playwright auth state")
  .option("--save-auth <file>", "save final auth state (contains sensitive cookies)")
  .option("--browser-path <file>", "existing Chromium/Chrome executable")
  .action(async (url: string, values: Record<string, unknown>) => {
    const name = String(values.name);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "flow";
    const outputFile = path.resolve(String(values.out ?? path.join(".realdone", "flows", `${slug}.json`)));
    if (!values.duration) process.stderr.write("realdone record  Use the browser, then press Enter or Ctrl+C here to save the flow.\n");
    const result = await recordFlow({
      targetUrl: url,
      name,
      outputFile,
      headed: !Boolean(values.headless),
      timeoutMs: Number(values.timeout),
      settleMs: Number(values.settle),
      stopSignal: recorderStopSignal(values.duration ? Number(values.duration) : undefined),
      ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
      ...(values.saveAuth ? { saveStorageStatePath: path.resolve(String(values.saveAuth)) } : {}),
      ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
    });
    process.stdout.write(`\nRecorded ${result.contract.steps.length} steps\nContract: ${result.contractFile}\nrrweb evidence: ${result.rrwebFile} (${result.contract.artifacts?.rrwebEventCount ?? 0} events)\n`);
    if (result.contract.steps.some((step) => step.secretEnv)) {
      process.stdout.write("Secret inputs were redacted. Set the referenced environment variables before verify.\n");
    }
  });

program
  .command("verify")
  .description("Replay a recorded behavior contract and check its expectations")
  .argument("<contract>", "behavior contract JSON")
  .option("--output <directory>", "verification report root", ".realdone/verifications")
  .option("--headed", "show Chromium", false)
  .option("--timeout <milliseconds>", "step timeout", positiveInteger, 10_000)
  .option("--settle <milliseconds>", "settle delay after each step", positiveInteger, 500)
  .option("--retries <number>", "semantic locator retries", nonNegativeInteger, 2)
  .option("--continue", "continue after a failed step", false)
  .option("--allow-destructive", "allow recorded destructive actions", false)
  .option("--allow-external", "allow recorded external effects", false)
  .option("--allow-host <hostname>", "allow recorded mutations on staging", collect, [])
  .option("--storage-state <file>", "override contract auth state")
  .option("--browser-path <file>", "existing Chromium/Chrome executable")
  .option("--browser <name>", "browser engine: chromium, firefox, or webkit", browserName, "chromium")
  .option("--role-state <role=file>", "override a named role's Playwright storage state", collect, [])
  .option("--postgres-config <file>", "PostgreSQL source adapter config for Level 6 assertions")
  .option("--sqlite <file>", "SQLite database file for zero-config Level 6 assertions")
  .option("--database-config <file>", "database adapter config; repeat for multiple adapters", collect, [])
  .option("--provider-config <file>", "maintained provider adapter config; repeat for multiple files", collect, [])
  .option("--plugin <manifest>", "provider plugin manifest; repeat for multiple plugins", collect, [])
  .option("--plugin-timeout <milliseconds>", "per-plugin verification timeout", positiveInteger, 5_000)
  .option("--plugin-memory <megabytes>", "per-plugin worker memory limit", positiveInteger, 64)
  .option("--performance-budget <file>", "verification performance budget JSON")
  .option("--deep", "require persistence expectations to pass in a fresh browser context", false)
  .option("--trace", "capture Playwright traces for verification contexts", false)
  .option("--trace-on-failure", "retain traces only when verification fails", false)
  .option("--video", "capture browser video for verification contexts", false)
  .option("-y, --yes", "confirm once that this project is disposable local/staging and allow permitted actions", false)
  .action(async (contract: string, values: Record<string, unknown>) => {
    await requireProjectActionConsent({
      project: path.resolve(contract),
      confirmed: Boolean(values.yes),
      interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    });
    const result = await verifyContract(path.resolve(contract), {
      outputRoot: path.resolve(String(values.output)),
      headed: Boolean(values.headed),
      timeoutMs: Number(values.timeout),
      settleMs: Number(values.settle),
      maxRetries: Number(values.retries),
      deep: Boolean(values.deep),
      trace: Boolean(values.trace),
      traceOnFailure: Boolean(values.traceOnFailure),
      video: Boolean(values.video),
      continueOnFailure: Boolean(values.continue),
      allowDestructive: Boolean(values.allowDestructive),
      allowExternal: Boolean(values.allowExternal),
      allowHosts: values.allowHost as string[],
      browserName: values.browser as BrowserName,
      roleStorageStates: roleStates(values.roleState as string[]),
      pluginManifests: (values.plugin as string[]).map((file) => path.resolve(file)),
      pluginTimeoutMs: Number(values.pluginTimeout),
      pluginMemoryLimitMb: Number(values.pluginMemory),
      ...(values.performanceBudget ? { performanceBudgetFile: path.resolve(String(values.performanceBudget)) } : {}),
      ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
      ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
      ...(values.postgresConfig ? { postgresConfigPath: path.resolve(String(values.postgresConfig)) } : {}),
      ...(values.sqlite ? { sqlitePath: path.resolve(String(values.sqlite)) } : {}),
      databaseConfigPaths: (values.databaseConfig as string[]).map((file) => path.resolve(file)),
      providerConfigPaths: (values.providerConfig as string[]).map((file) => path.resolve(file)),
    });
    process.stdout.write(`\n${result.verification.passed ? "VERIFIED" : "REGRESSION"}: ${result.verification.contractName}\nReport: ${path.join(result.outputDirectory, "report.html")}\n`);
    process.exitCode = result.exitCode;
  });

program
  .command("benchmark")
  .description("Measure precision, recall, discovery, detector accuracy, and reproduction success")
  .argument("<url>", "benchmark application URL")
  .requiredOption("--expected <file>", "benchmark expectation JSON")
  .option("--max-pages <number>", "maximum pages to discover", positiveInteger, 20)
  .option("--max-actions <number>", "maximum actions to execute", positiveInteger, 60)
  .option("--timeout <milliseconds>", "navigation and action timeout", positiveInteger, 10_000)
  .option("--settle <milliseconds>", "settle time after actions", positiveInteger, 800)
  .option("--max-duration <milliseconds>", "global scan time budget", positiveInteger, 180_000)
  .option("--retries <number>", "bounded transient retries", nonNegativeInteger, 2)
  .option("--output <directory>", "report root", ".realdone/reports")
  .option("--headed", "show Chromium", false)
  .option("--allow-destructive", "allow destructive fixture actions", false)
  .option("--allow-external", "allow external-effect fixture actions", false)
  .option("--allow-host <hostname>", "allow mutations on explicit staging", collect, [])
  .option("--storage-state <file>", "Playwright storage state")
  .option("--browser-path <file>", "existing Chromium/Chrome executable")
  .option("--verify-replays", "re-run a bounded sample of findings", false)
  .option("--max-replays <number>", "maximum reproductions to verify", positiveInteger, 3)
  .option("--deep", "confirm mutation persistence in a fresh browser context", false)
  .option("--trace", "capture a Playwright trace for every executed action", false)
  .option("--trace-on-failure", "retain traces only for non-passing findings", false)
  .option("--video", "capture browser video for every executed action", false)
  .option("-y, --yes", "confirm once that this project is disposable local/staging and allow permitted actions", false)
  .action(async (url: string, values: Record<string, unknown>) => {
    await requireProjectActionConsent({
      project: url,
      confirmed: Boolean(values.yes),
      interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    });
    const result = await runBenchmark(
      {
        expectationFile: path.resolve(String(values.expected)),
        verifyReplays: Boolean(values.verifyReplays),
        maxReplays: Number(values.maxReplays),
        scan: {
          targetUrl: url,
          outputRoot: path.resolve(String(values.output)),
          headed: Boolean(values.headed),
          allowHosts: values.allowHost as string[],
          allowDestructive: Boolean(values.allowDestructive),
          allowExternal: Boolean(values.allowExternal),
          mutationAllowed: false,
          maxPages: Number(values.maxPages),
          maxActions: Number(values.maxActions),
          timeoutMs: Number(values.timeout),
          settleMs: Number(values.settle),
          maxDurationMs: Number(values.maxDuration),
          maxRetries: Number(values.retries),
          deep: Boolean(values.deep),
          trace: Boolean(values.trace),
          traceOnFailure: Boolean(values.traceOnFailure),
          video: Boolean(values.video),
          ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
          ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
        },
      },
      progressLine,
    );
    const metric = (value: number): string => `${(value * 100).toFixed(1)}%`;
    process.stdout.write(
      `\nREALDONE BENCHMARK\n\nprecision: ${metric(result.metrics.precision)}\nrecall: ${metric(result.metrics.recall)}\nfalse-positive rate: ${metric(result.metrics.falsePositiveRate)}\ndiscovery: ${metric(result.metrics.actionDiscoveryRate)}\nexpectation coverage: ${metric(result.metrics.expectationCoverage)}\nverdict accuracy: ${metric(result.metrics.verdictAccuracy)}\ndetector accuracy: ${metric(result.metrics.detectorAccuracy)}\nenvironment validity: ${metric(result.metrics.environmentValidity)}\ncleanup success: ${result.metrics.cleanupSuccess === null ? "not run" : metric(result.metrics.cleanupSuccess)}\ntruncated: ${result.metrics.benchmarkTruncated ? "yes" : "no"}\nreproduction success: ${result.metrics.reproductionSuccessRate === null ? "not run" : metric(result.metrics.reproductionSuccessRate)}\nscan time: ${result.metrics.scanTimeMs}ms\nmemory delta: ${result.metrics.memoryDeltaMb}MB\n\nReport: ${path.join(result.reportDirectory, "benchmark.json")}\n`,
    );
    const passed =
      result.metrics.precision === 1 &&
      result.metrics.recall === 1 &&
      result.metrics.falsePositiveRate === 0 &&
      result.metrics.actionDiscoveryRate === 1 &&
      result.metrics.expectationCoverage === 1 &&
      result.metrics.verdictAccuracy === 1 &&
      result.metrics.detectorAccuracy === 1 &&
      result.metrics.environmentValidity === 1 &&
      result.metrics.cleanupSuccess === 1 &&
      !result.metrics.benchmarkTruncated &&
      (result.metrics.reproductionSuccessRate === null || result.metrics.reproductionSuccessRate === 1);
    process.exitCode = passed ? 0 : 1;
  });

program
  .command("baseline")
  .description("Capture a versioned behavior manifest and optional passing baseline")
  .argument("<contracts...>", "contract files or directories")
  .option("--out <file>", "behavior manifest path", ".realdone/baseline.json")
  .option("--no-verify", "capture contract metadata without running flows")
  .option("--headed", "show Chromium during baseline verification", false)
  .option("--timeout <milliseconds>", "step timeout", positiveInteger, 10_000)
  .option("--settle <milliseconds>", "settle delay", positiveInteger, 500)
  .option("--retries <number>", "semantic locator retries", nonNegativeInteger, 2)
  .option("--workers <number>", "bounded contract verification workers (1-16)", boundedWorkers, 1)
  .option("--allow-destructive", "allow recorded destructive actions", false)
  .option("--allow-external", "allow recorded external effects", false)
  .option("--allow-host <hostname>", "allow recorded mutations on staging", collect, [])
  .option("--storage-state <file>", "override contract auth state")
  .option("--browser-path <file>", "existing Chromium/Chrome executable")
  .option("--browser <name>", "browser engine: chromium, firefox, or webkit", browserName, "chromium")
  .option("--role-state <role=file>", "override a named role's Playwright storage state", collect, [])
  .option("--postgres-config <file>", "PostgreSQL source adapter config for Level 6 assertions")
  .option("--sqlite <file>", "SQLite database file for zero-config Level 6 assertions")
  .option("--database-config <file>", "database adapter config; repeat for multiple adapters", collect, [])
  .option("--provider-config <file>", "maintained provider adapter config; repeat for multiple files", collect, [])
  .option("--plugin <manifest>", "provider plugin manifest; repeat for multiple plugins", collect, [])
  .option("--plugin-timeout <milliseconds>", "per-plugin verification timeout", positiveInteger, 5_000)
  .option("--plugin-memory <megabytes>", "per-plugin worker memory limit", positiveInteger, 64)
  .option("--performance-budget <file>", "verification performance budget JSON")
  .option("--deep", "require persistence expectations to pass in a fresh browser context", false)
  .option("--trace", "capture Playwright traces for verification contexts", false)
  .option("--trace-on-failure", "retain traces only when baseline verification fails", false)
  .option("--video", "capture browser video for verification contexts", false)
  .option("-y, --yes", "confirm once that this project is disposable local/staging and allow permitted actions", false)
  .action(async (contracts: string[], values: Record<string, unknown>) => {
    if (Boolean(values.verify)) {
      await requireProjectActionConsent({
        project: contracts.map((contract) => path.resolve(contract)).join(", "),
        confirmed: Boolean(values.yes),
        interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
      });
    }
    const output = path.resolve(String(values.out));
    const manifest = await captureBaseline(
      contracts.map((contract) => path.resolve(contract)),
      output,
      {
        outputRoot: path.join(path.dirname(output), "baseline-runs"),
        headed: Boolean(values.headed),
        timeoutMs: Number(values.timeout),
        settleMs: Number(values.settle),
        maxRetries: Number(values.retries),
        workers: Number(values.workers),
        deep: Boolean(values.deep),
        trace: Boolean(values.trace),
        traceOnFailure: Boolean(values.traceOnFailure),
        video: Boolean(values.video),
        continueOnFailure: false,
        allowDestructive: Boolean(values.allowDestructive),
        allowExternal: Boolean(values.allowExternal),
        allowHosts: values.allowHost as string[],
        browserName: values.browser as BrowserName,
        roleStorageStates: roleStates(values.roleState as string[]),
        pluginManifests: (values.plugin as string[]).map((file) => path.resolve(file)),
        pluginTimeoutMs: Number(values.pluginTimeout),
        pluginMemoryLimitMb: Number(values.pluginMemory),
        ...(values.performanceBudget ? { performanceBudgetFile: path.resolve(String(values.performanceBudget)) } : {}),
        ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
        ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
        ...(values.postgresConfig ? { postgresConfigPath: path.resolve(String(values.postgresConfig)) } : {}),
        ...(values.sqlite ? { sqlitePath: path.resolve(String(values.sqlite)) } : {}),
        databaseConfigPaths: (values.databaseConfig as string[]).map((file) => path.resolve(file)),
        providerConfigPaths: (values.providerConfig as string[]).map((file) => path.resolve(file)),
      },
      Boolean(values.verify),
    );
    const failed = manifest.contracts.filter((contract) => contract.baseline && !contract.baseline.passed).length;
    process.stdout.write(`\nBehavior baseline: ${manifest.contracts.length} contracts, ${failed} failing\nManifest: ${output}\n`);
    if (failed > 0) process.exitCode = 1;
  });

program
  .command("ci")
  .description("Verify affected behavior contracts against a captured baseline")
  .requiredOption("--baseline <file>", "baseline manifest")
  .option("--contracts <path>", "current contract file or directory; defaults to baseline paths")
  .option("--changed-file <path>", "changed source file used for affected-flow selection", collect, [])
  .option("--output <directory>", "CI report root", ".realdone/ci")
  .option("--headed", "show Chromium", false)
  .option("--timeout <milliseconds>", "step timeout", positiveInteger, 10_000)
  .option("--settle <milliseconds>", "settle delay", positiveInteger, 500)
  .option("--retries <number>", "semantic locator retries", nonNegativeInteger, 2)
  .option("--workers <number>", "bounded affected-contract workers (1-16)", boundedWorkers, 1)
  .option("--allow-destructive", "allow recorded destructive actions", false)
  .option("--allow-external", "allow recorded external effects", false)
  .option("--allow-host <hostname>", "allow recorded mutations on staging", collect, [])
  .option("--storage-state <file>", "override contract auth state")
  .option("--browser-path <file>", "existing Chromium/Chrome executable")
  .option("--browser <name>", "browser engine: chromium, firefox, or webkit", browserName, "chromium")
  .option("--role-state <role=file>", "override a named role's Playwright storage state", collect, [])
  .option("--postgres-config <file>", "PostgreSQL source adapter config for Level 6 assertions")
  .option("--sqlite <file>", "SQLite database file for zero-config Level 6 assertions")
  .option("--database-config <file>", "database adapter config; repeat for multiple adapters", collect, [])
  .option("--provider-config <file>", "maintained provider adapter config; repeat for multiple files", collect, [])
  .option("--plugin <manifest>", "provider plugin manifest; repeat for multiple plugins", collect, [])
  .option("--plugin-timeout <milliseconds>", "per-plugin verification timeout", positiveInteger, 5_000)
  .option("--plugin-memory <megabytes>", "per-plugin worker memory limit", positiveInteger, 64)
  .option("--performance-budget <file>", "verification performance budget JSON")
  .option("--deep", "require persistence expectations to pass in a fresh browser context", false)
  .option("--trace", "capture Playwright traces for verification contexts", false)
  .option("--trace-on-failure", "retain traces only when regression verification fails", false)
  .option("--video", "capture browser video for verification contexts", false)
  .option("-y, --yes", "confirm once that this project is disposable local/staging and allow permitted actions", false)
  .action(async (values: Record<string, unknown>) => {
    await requireProjectActionConsent({
      project: path.resolve(String(values.contracts ?? values.baseline)),
      confirmed: Boolean(values.yes),
      interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    });
    const result = await runRegressionGate({
      baselineFile: path.resolve(String(values.baseline)),
      contractInputs: values.contracts ? [path.resolve(String(values.contracts))] : [],
      changedFiles: values.changedFile as string[],
      outputRoot: path.resolve(String(values.output)),
      verifyOptions: {
        outputRoot: path.resolve(String(values.output)),
        headed: Boolean(values.headed),
        timeoutMs: Number(values.timeout),
        settleMs: Number(values.settle),
        maxRetries: Number(values.retries),
        workers: Number(values.workers),
        deep: Boolean(values.deep),
        trace: Boolean(values.trace),
        traceOnFailure: Boolean(values.traceOnFailure),
        video: Boolean(values.video),
        continueOnFailure: false,
        allowDestructive: Boolean(values.allowDestructive),
        allowExternal: Boolean(values.allowExternal),
        allowHosts: values.allowHost as string[],
        browserName: values.browser as BrowserName,
        roleStorageStates: roleStates(values.roleState as string[]),
        pluginManifests: (values.plugin as string[]).map((file) => path.resolve(file)),
        pluginTimeoutMs: Number(values.pluginTimeout),
        pluginMemoryLimitMb: Number(values.pluginMemory),
        ...(values.performanceBudget ? { performanceBudgetFile: path.resolve(String(values.performanceBudget)) } : {}),
        ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
        ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
        ...(values.postgresConfig ? { postgresConfigPath: path.resolve(String(values.postgresConfig)) } : {}),
        ...(values.sqlite ? { sqlitePath: path.resolve(String(values.sqlite)) } : {}),
        databaseConfigPaths: (values.databaseConfig as string[]).map((file) => path.resolve(file)),
        providerConfigPaths: (values.providerConfig as string[]).map((file) => path.resolve(file)),
      },
    });
    process.stdout.write(`\nREALDONE CI\n\nselected: ${result.report.selectedContracts}\nregressions: ${result.report.regressions}\nexpected changes: ${result.report.expectedChanges}\nReport: ${path.join(result.outputDirectory, "summary.md")}\n`);
    process.exitCode = result.exitCode;
  });

program
  .command("matrix")
  .description("Verify one behavior contract across Chromium, Firefox, and WebKit")
  .argument("<contract>", "behavior contract JSON")
  .option("--browser <name>", "browser to include; repeat to select a subset", collectBrowser, [])
  .option("--output <directory>", "browser matrix report root", ".realdone/matrix")
  .option("--headed", "show browsers", false)
  .option("--timeout <milliseconds>", "step timeout", positiveInteger, 10_000)
  .option("--settle <milliseconds>", "settle delay", positiveInteger, 500)
  .option("--retries <number>", "semantic locator retries", nonNegativeInteger, 2)
  .option("--workers <number>", "bounded browser workers (1-16)", boundedWorkers, 1)
  .option("--continue", "continue after a failed step", false)
  .option("--allow-destructive", "allow recorded destructive actions", false)
  .option("--allow-external", "allow recorded external effects", false)
  .option("--allow-host <hostname>", "allow recorded mutations on staging", collect, [])
  .option("--storage-state <file>", "override default-role auth state")
  .option("--role-state <role=file>", "override a named role's Playwright storage state", collect, [])
  .option("--browser-path <file>", "existing Chromium/Chrome executable for the Chromium entry")
  .option("--postgres-config <file>", "PostgreSQL source adapter config")
  .option("--sqlite <file>", "SQLite database file for zero-config source checks")
  .option("--database-config <file>", "database adapter config; repeat for multiple adapters", collect, [])
  .option("--provider-config <file>", "maintained provider adapter config; repeat for multiple files", collect, [])
  .option("--plugin <manifest>", "provider plugin manifest; repeat for multiple plugins", collect, [])
  .option("--plugin-timeout <milliseconds>", "per-plugin verification timeout", positiveInteger, 5_000)
  .option("--plugin-memory <megabytes>", "per-plugin worker memory limit", positiveInteger, 64)
  .option("--performance-budget <file>", "verification performance budget JSON")
  .option("--deep", "require persistence expectations to pass in a fresh browser context", false)
  .option("--trace", "capture Playwright traces for verification contexts", false)
  .option("--trace-on-failure", "retain traces only when matrix verification fails", false)
  .option("--video", "capture browser video for verification contexts", false)
  .option("-y, --yes", "confirm once that this project is disposable local/staging and allow permitted actions", false)
  .action(async (contract: string, values: Record<string, unknown>) => {
    await requireProjectActionConsent({
      project: path.resolve(contract),
      confirmed: Boolean(values.yes),
      interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    });
    const browsers = values.browser as BrowserName[];
    const result = await runBrowserMatrix(
      path.resolve(contract),
      browsers.length > 0 ? browsers : ["chromium", "firefox", "webkit"],
      {
        outputRoot: path.resolve(String(values.output)),
        headed: Boolean(values.headed),
        timeoutMs: Number(values.timeout),
        settleMs: Number(values.settle),
        maxRetries: Number(values.retries),
        workers: Number(values.workers),
        deep: Boolean(values.deep),
        trace: Boolean(values.trace),
        traceOnFailure: Boolean(values.traceOnFailure),
        video: Boolean(values.video),
        continueOnFailure: Boolean(values.continue),
        allowDestructive: Boolean(values.allowDestructive),
        allowExternal: Boolean(values.allowExternal),
        allowHosts: values.allowHost as string[],
        browserName: "chromium",
        roleStorageStates: roleStates(values.roleState as string[]),
        pluginManifests: (values.plugin as string[]).map((file) => path.resolve(file)),
        pluginTimeoutMs: Number(values.pluginTimeout),
        pluginMemoryLimitMb: Number(values.pluginMemory),
        ...(values.performanceBudget ? { performanceBudgetFile: path.resolve(String(values.performanceBudget)) } : {}),
        ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
        ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
        ...(values.postgresConfig ? { postgresConfigPath: path.resolve(String(values.postgresConfig)) } : {}),
        ...(values.sqlite ? { sqlitePath: path.resolve(String(values.sqlite)) } : {}),
        databaseConfigPaths: (values.databaseConfig as string[]).map((file) => path.resolve(file)),
        providerConfigPaths: (values.providerConfig as string[]).map((file) => path.resolve(file)),
      },
    );
    process.stdout.write(`\nREALDONE BROWSER MATRIX\n\n${result.report.entries.map((entry) => `${entry.browser}: ${entry.passed ? "passed" : "failed"}`).join("\n")}\nReport: ${path.join(result.outputDirectory, "matrix.html")}\n`);
    process.exitCode = result.exitCode;
  });

program
  .command("affected")
  .description("Select behavior contracts affected by changed source files")
  .requiredOption("--manifest <file>", "behavior manifest")
  .requiredOption("--changed-file <path>", "changed source file", collect, [])
  .option("--json", "print JSON", false)
  .action(async (values: Record<string, unknown>) => {
    const manifest = await loadBehaviorManifest(path.resolve(String(values.manifest)));
    const selected = selectAffectedContracts(manifest, values.changedFile as string[]);
    if (values.json) process.stdout.write(`${JSON.stringify(selected, null, 2)}\n`);
    else process.stdout.write(`${selected.map((contract) => contract.file).join("\n")}\n`);
  });

program
  .command("export-playwright")
  .description("Export one RealDone behavior contract as a Playwright test")
  .argument("<contract>", "behavior contract JSON")
  .requiredOption("--out <file>", "output .spec.ts file")
  .action(async (contract: string, values: Record<string, unknown>) => {
    const output = await exportPlaywrightTest(path.resolve(contract), path.resolve(String(values.out)));
    process.stdout.write(`Playwright test: ${output}\n`);
  });

program
  .command("run")
  .description("Run a coding agent, rebuild, and independently verify affected behavior")
  .argument("[preset]", "codex, claude, or generic", "codex")
  .requiredOption("--contracts <path>", "behavior contract file or directory", collect, [])
  .option("--task <text>", "implementation task for the coding agent")
  .option("--task-file <file>", "read the implementation task from a file")
  .option("--working-directory <directory>", "Git worktree operated on by the agent", ".")
  .option("--output <directory>", "agent verification report root", ".realdone/agent-runs")
  .option("--agent-command <file>", "override preset executable; required for generic")
  .option("--agent-arg <value>", "extra agent CLI argument before the task", collect, [])
  .option("--agent-timeout <milliseconds>", "coding-agent timeout", positiveInteger, 1_800_000)
  .option("--agent-max-turns <number>", "Claude Code non-interactive turn limit", positiveInteger, 50)
  .option("--build-command <file>", "rebuild executable", "pnpm")
  .option("--build-arg <value>", "rebuild argument", collect, [])
  .option("--build-timeout <milliseconds>", "rebuild timeout", positiveInteger, 300_000)
  .option("--allow-dirty", "allow a pre-existing dirty worktree (change attribution is weaker)", false)
  .option("--allow-contract-changes", "permit the agent to change behavior contracts", false)
  .option("--headed", "show Chromium during baseline and affected verification", false)
  .option("--timeout <milliseconds>", "behavior step timeout", positiveInteger, 10_000)
  .option("--settle <milliseconds>", "behavior settle delay", positiveInteger, 500)
  .option("--retries <number>", "semantic locator retries", nonNegativeInteger, 2)
  .option("--workers <number>", "bounded post-agent verification workers (1-16)", boundedWorkers, 1)
  .option("--allow-destructive", "allow recorded destructive actions", false)
  .option("--allow-external", "allow recorded external effects", false)
  .option("--allow-host <hostname>", "allow recorded mutations on staging", collect, [])
  .option("--storage-state <file>", "override contract auth state")
  .option("--browser-path <file>", "existing Chromium/Chrome executable")
  .option("--browser <name>", "browser engine: chromium, firefox, or webkit", browserName, "chromium")
  .option("--role-state <role=file>", "override a named role's Playwright storage state", collect, [])
  .option("--postgres-config <file>", "PostgreSQL source adapter config")
  .option("--sqlite <file>", "SQLite database file for zero-config source checks")
  .option("--database-config <file>", "database adapter config; repeat for multiple adapters", collect, [])
  .option("--provider-config <file>", "maintained provider adapter config; repeat for multiple files", collect, [])
  .option("--plugin <manifest>", "provider plugin manifest; repeat for multiple plugins", collect, [])
  .option("--plugin-timeout <milliseconds>", "per-plugin verification timeout", positiveInteger, 5_000)
  .option("--plugin-memory <megabytes>", "per-plugin worker memory limit", positiveInteger, 64)
  .option("--performance-budget <file>", "verification performance budget JSON")
  .option("--deep", "require persistence expectations to pass in a fresh browser context", false)
  .option("--trace", "capture Playwright traces for verification contexts", false)
  .option("--trace-on-failure", "retain traces only when post-agent verification fails", false)
  .option("--video", "capture browser video for verification contexts", false)
  .option("-y, --yes", "confirm once that this project is disposable local/staging and allow permitted actions", false)
  .action(async (presetValue: string, values: Record<string, unknown>) => {
    const workingDirectory = path.resolve(String(values.workingDirectory));
    await requireProjectActionConsent({
      project: workingDirectory,
      confirmed: Boolean(values.yes),
      interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    });
    const task = await loadTask(
      values.task ? String(values.task) : undefined,
      values.taskFile ? path.resolve(workingDirectory, String(values.taskFile)) : undefined,
    );
    const buildArgs = values.buildArg as string[];
    const result = await runAgentVerification({
      task,
      preset: parseAgentPreset(presetValue),
      workingDirectory,
      contractInputs: values.contracts as string[],
      outputRoot: path.resolve(workingDirectory, String(values.output)),
      agentTimeoutMs: Number(values.agentTimeout),
      ...(values.agentCommand ? { agentExecutable: String(values.agentCommand) } : {}),
      agentArgs: values.agentArg as string[],
      agentMaxTurns: Number(values.agentMaxTurns),
      build: {
        executable: String(values.buildCommand),
        args: buildArgs.length > 0 ? buildArgs : ["build"],
        timeoutMs: Number(values.buildTimeout),
      },
      allowDirty: Boolean(values.allowDirty),
      allowContractChanges: Boolean(values.allowContractChanges),
      verifyOptions: {
        outputRoot: path.resolve(workingDirectory, String(values.output)),
        headed: Boolean(values.headed),
        timeoutMs: Number(values.timeout),
        settleMs: Number(values.settle),
        maxRetries: Number(values.retries),
        workers: Number(values.workers),
        deep: Boolean(values.deep),
        trace: Boolean(values.trace),
        traceOnFailure: Boolean(values.traceOnFailure),
        video: Boolean(values.video),
        continueOnFailure: false,
        allowDestructive: Boolean(values.allowDestructive),
        allowExternal: Boolean(values.allowExternal),
        allowHosts: values.allowHost as string[],
        browserName: values.browser as BrowserName,
        roleStorageStates: roleStates(values.roleState as string[], workingDirectory),
        pluginManifests: (values.plugin as string[]).map((file) => path.resolve(workingDirectory, file)),
        pluginTimeoutMs: Number(values.pluginTimeout),
        pluginMemoryLimitMb: Number(values.pluginMemory),
        ...(values.performanceBudget ? { performanceBudgetFile: path.resolve(workingDirectory, String(values.performanceBudget)) } : {}),
        ...(values.storageState ? { storageStatePath: path.resolve(workingDirectory, String(values.storageState)) } : {}),
        ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
        ...(values.postgresConfig ? { postgresConfigPath: path.resolve(workingDirectory, String(values.postgresConfig)) } : {}),
        ...(values.sqlite ? { sqlitePath: path.resolve(workingDirectory, String(values.sqlite)) } : {}),
        databaseConfigPaths: (values.databaseConfig as string[]).map((file) => path.resolve(workingDirectory, file)),
        providerConfigPaths: (values.providerConfig as string[]).map((file) => path.resolve(workingDirectory, file)),
      },
    });
    process.stdout.write(`\nREALDONE AGENT VERIFICATION\n\nbaseline: ${result.report.baselinePassed ? "passed" : "failed"}\nchanged files: ${result.report.changedFiles.length}\nbehavior: ${result.report.behaviorPassed ? "passed" : "failed"}\nresult: ${result.report.passed ? "VERIFIED" : "NOT COMPLETE"}\nReport: ${path.join(result.outputDirectory, "agent-verification.json")}\n`);
    if (result.report.followUpPrompt) process.stdout.write(`Follow-up: ${path.join(result.outputDirectory, result.report.followUpPrompt)}\n`);
    process.exitCode = result.exitCode;
  });

program
  .command("replay")
  .description("Replay one evidence-backed finding")
  .argument("<finding-id>", "finding such as RD-003")
  .option("--report-dir <directory>", "source scan directory")
  .option("--output <directory>", "new report root", ".realdone/reports")
  .option("--headed", "show Chromium during replay", false)
  .option("--storage-state <file>", "Playwright storage state")
  .option("--browser-path <file>", "use an existing Chromium/Chrome executable")
  .option("--provider-config <file>", "automatic read-only provider confirmation; repeat for multiple files", collect, [])
  .option("--allow-destructive", "allow a destructive replay action", false)
  .option("--allow-external", "allow an external-effect replay action", false)
  .option("--allow-host <hostname>", "allow replay mutations on explicit staging", collect, [])
  .option("-y, --yes", "confirm once that this project is disposable local/staging and allow permitted actions", false)
  .action(async (findingId: string, values: Record<string, unknown>) => {
    await requireProjectActionConsent({
      project: path.resolve(String(values.reportDir ?? values.output)),
      confirmed: Boolean(values.yes),
      interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    });
    const providerConfigPaths = (values.providerConfig as string[]).map((file) => path.resolve(file));
    const result = await runReplay(
      findingId,
      {
        outputRoot: path.resolve(String(values.output)),
        headed: Boolean(values.headed),
        ...(values.reportDir ? { reportDirectory: path.resolve(String(values.reportDir)) } : {}),
        ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
        ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
        providerConfigPaths,
        allowDestructive: Boolean(values.allowDestructive),
        allowExternal: Boolean(values.allowExternal),
        allowHosts: values.allowHost as string[],
      },
      progressLine,
    );
    printSummary(result.reportDirectory, result.report);
    process.stdout.write(`Replay outcome: ${result.replay.outcome}\n${result.replay.detail}\n`);
    process.exitCode = result.exitCode;
  });

program.addOption(new Option("--no-color", "reserved for stable CI output").hideHelp());

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`realdone error  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
