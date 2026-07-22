#!/usr/bin/env node
import path from "node:path";
import { Command, Option } from "commander";
import { runBenchmark } from "./benchmark/evaluate.js";
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
import type { ScanOptions } from "./types.js";

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

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
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
  .version("0.4.0")
  .showHelpAfterError();

program
  .command("scan")
  .description("Discover safe visible actions, execute them, and verify their effects")
  .argument("<url>", "application URL")
  .option("--max-pages <number>", "maximum pages to discover", positiveInteger)
  .option("--max-actions <number>", "maximum actions to execute", positiveInteger)
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
  .option("--policy <file>", "JSON action policy and budget file")
  .option("--json", "print the machine-readable summary", false)
  .action(async (url: string, values: Record<string, unknown>) => {
    const policy = values.policy ? await loadActionPolicy(path.resolve(String(values.policy))) : undefined;
    const options: ScanOptions = {
      targetUrl: url,
      outputRoot: path.resolve(String(values.output)),
      headed: Boolean(values.headed),
      allowHosts: [...new Set([...(values.allowHost as string[]), ...(policy?.allowHosts ?? [])])],
      allowDestructive: Boolean(values.allowDestructive),
      allowExternal: Boolean(values.allowExternal),
      mutationAllowed: false,
      maxPages: Number(values.maxPages ?? policy?.budgets?.maxPages ?? 8),
      maxActions: Number(values.maxActions ?? policy?.budgets?.maxActions ?? 24),
      timeoutMs: Number(values.timeout),
      settleMs: Number(values.settle),
      maxDurationMs: Number(values.maxDuration ?? policy?.budgets?.maxDurationMs ?? 120_000),
      maxRetries: Number(values.retries ?? policy?.budgets?.maxRetries ?? 2),
      ...(policy ? { policy } : {}),
      ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
      ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
    };
    const result = await runScan(options, progressLine);
    if (values.json) process.stdout.write(`${JSON.stringify(result.report.summary, null, 2)}\n`);
    else printSummary(result.reportDirectory, result.report);
    process.exitCode = result.exitCode;
  });

program
  .command("cleanup")
  .description("Inspect or execute the idempotent cleanup ledger for a scan")
  .requiredOption("--report-dir <directory>", "scan report directory")
  .option("--confirm", "perform cleanup; without this flag the command is a dry run", false)
  .option("--allow-host <hostname>", "explicitly allow cleanup on a staging host", collect, [])
  .option("--retries <number>", "retries for transient cleanup failures", nonNegativeInteger, 2)
  .option("--storage-state <file>", "Playwright storage state for authenticated DELETE requests")
  .action(async (values: Record<string, unknown>) => {
    const result = await runCleanup(path.resolve(String(values.reportDir)), {
      confirm: Boolean(values.confirm),
      allowHosts: values.allowHost as string[],
      retries: Number(values.retries),
      ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
    });
    process.stdout.write(`Cleanup ledger\n\ncleaned: ${result.cleaned}\nfailed: ${result.failed}\nmanual: ${result.manual}\npending: ${result.pending}\n`);
    if (!values.confirm && result.pending > 0) process.stdout.write("\nDry run only. Re-run with --confirm to execute safe cleanup URLs.\n");
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
  .action(async (contract: string, values: Record<string, unknown>) => {
    const result = await verifyContract(path.resolve(contract), {
      outputRoot: path.resolve(String(values.output)),
      headed: Boolean(values.headed),
      timeoutMs: Number(values.timeout),
      settleMs: Number(values.settle),
      maxRetries: Number(values.retries),
      continueOnFailure: Boolean(values.continue),
      allowDestructive: Boolean(values.allowDestructive),
      allowExternal: Boolean(values.allowExternal),
      allowHosts: values.allowHost as string[],
      ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
      ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
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
  .action(async (url: string, values: Record<string, unknown>) => {
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
          ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
          ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
        },
      },
      progressLine,
    );
    const metric = (value: number): string => `${(value * 100).toFixed(1)}%`;
    process.stdout.write(
      `\nREALDONE BENCHMARK\n\nprecision: ${metric(result.metrics.precision)}\nrecall: ${metric(result.metrics.recall)}\nfalse-positive rate: ${metric(result.metrics.falsePositiveRate)}\ndiscovery: ${metric(result.metrics.actionDiscoveryRate)}\nverdict accuracy: ${metric(result.metrics.verdictAccuracy)}\ndetector accuracy: ${metric(result.metrics.detectorAccuracy)}\nreproduction success: ${result.metrics.reproductionSuccessRate === null ? "not run" : metric(result.metrics.reproductionSuccessRate)}\nscan time: ${result.metrics.scanTimeMs}ms\nmemory delta: ${result.metrics.memoryDeltaMb}MB\n\nReport: ${path.join(result.reportDirectory, "benchmark.json")}\n`,
    );
    const passed =
      result.metrics.precision === 1 &&
      result.metrics.recall === 1 &&
      result.metrics.actionDiscoveryRate === 1 &&
      result.metrics.detectorAccuracy === 1 &&
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
  .option("--allow-destructive", "allow recorded destructive actions", false)
  .option("--allow-external", "allow recorded external effects", false)
  .option("--allow-host <hostname>", "allow recorded mutations on staging", collect, [])
  .option("--storage-state <file>", "override contract auth state")
  .option("--browser-path <file>", "existing Chromium/Chrome executable")
  .action(async (contracts: string[], values: Record<string, unknown>) => {
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
        continueOnFailure: false,
        allowDestructive: Boolean(values.allowDestructive),
        allowExternal: Boolean(values.allowExternal),
        allowHosts: values.allowHost as string[],
        ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
        ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
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
  .option("--allow-destructive", "allow recorded destructive actions", false)
  .option("--allow-external", "allow recorded external effects", false)
  .option("--allow-host <hostname>", "allow recorded mutations on staging", collect, [])
  .option("--storage-state <file>", "override contract auth state")
  .option("--browser-path <file>", "existing Chromium/Chrome executable")
  .action(async (values: Record<string, unknown>) => {
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
        continueOnFailure: false,
        allowDestructive: Boolean(values.allowDestructive),
        allowExternal: Boolean(values.allowExternal),
        allowHosts: values.allowHost as string[],
        ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
        ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
      },
    });
    process.stdout.write(`\nREALDONE CI\n\nselected: ${result.report.selectedContracts}\nregressions: ${result.report.regressions}\nexpected changes: ${result.report.expectedChanges}\nReport: ${path.join(result.outputDirectory, "summary.md")}\n`);
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
  .command("replay")
  .description("Replay one evidence-backed finding")
  .argument("<finding-id>", "finding such as RD-003")
  .option("--report-dir <directory>", "source scan directory")
  .option("--output <directory>", "new report root", ".realdone/reports")
  .option("--headed", "show Chromium during replay", false)
  .option("--storage-state <file>", "Playwright storage state")
  .option("--browser-path <file>", "use an existing Chromium/Chrome executable")
  .action(async (findingId: string, values: Record<string, unknown>) => {
    const result = await runReplay(
      findingId,
      {
        outputRoot: path.resolve(String(values.output)),
        headed: Boolean(values.headed),
        ...(values.reportDir ? { reportDirectory: path.resolve(String(values.reportDir)) } : {}),
        ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
        ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
      },
      progressLine,
    );
    printSummary(result.reportDirectory, result.report);
    process.exitCode = result.exitCode;
  });

program.addOption(new Option("--no-color", "reserved for stable CI output").hideHelp());

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`realdone error  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
