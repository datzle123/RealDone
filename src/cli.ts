#!/usr/bin/env node
import path from "node:path";
import { Command, Option } from "commander";
import { runReplay } from "./replay.js";
import { runScan, type ScanProgress } from "./scan.js";
import type { ScanOptions } from "./types.js";

function positiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received: ${value}`);
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
  .version("0.1.0")
  .showHelpAfterError();

program
  .command("scan")
  .description("Discover safe visible actions, execute them, and verify their effects")
  .argument("<url>", "application URL")
  .option("--max-pages <number>", "maximum pages to discover", positiveInteger, 8)
  .option("--max-actions <number>", "maximum actions to execute", positiveInteger, 24)
  .option("--timeout <milliseconds>", "navigation and action timeout", positiveInteger, 10_000)
  .option("--settle <milliseconds>", "settle time after actions", positiveInteger, 800)
  .option("--output <directory>", "report root", ".realdone/reports")
  .option("--headed", "show Chromium while scanning", false)
  .option("--allow-destructive", "allow destructive actions", false)
  .option("--allow-external", "allow external-effect actions", false)
  .option("--allow-host <hostname>", "allow mutations on an explicit staging host", collect, [])
  .option("--storage-state <file>", "Playwright storage state for authenticated pages")
  .option("--browser-path <file>", "use an existing Chromium/Chrome executable")
  .option("--json", "print the machine-readable summary", false)
  .action(async (url: string, values: Record<string, unknown>) => {
    const options: ScanOptions = {
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
      ...(values.storageState ? { storageStatePath: path.resolve(String(values.storageState)) } : {}),
      ...(values.browserPath ? { executablePath: path.resolve(String(values.browserPath)) } : {}),
    };
    const result = await runScan(options, progressLine);
    if (values.json) process.stdout.write(`${JSON.stringify(result.report.summary, null, 2)}\n`);
    else printSummary(result.reportDirectory, result.report);
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
