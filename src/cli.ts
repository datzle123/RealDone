#!/usr/bin/env node
import path from "node:path";
import { Command, Option } from "commander";
import { runBenchmark } from "./benchmark/evaluate.js";
import { runCleanup } from "./cleanup/ledger.js";
import { loadActionPolicy } from "./core/policy.js";
import { runReplay } from "./replay.js";
import { runScan, type ScanProgress } from "./scan.js";
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
  .version("0.2.0")
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
