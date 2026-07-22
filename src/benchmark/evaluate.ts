import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runReplay } from "../replay.js";
import { runScan, type ScanProgress, type ScanResult } from "../scan.js";
import type { Finding, ScanOptions, ScanReport, Verdict } from "../types.js";
import { renderBenchmarkDashboard, renderBenchmarkMarkdown } from "./dashboard.js";

const expectationSchema = z.object({
  schemaVersion: z.literal("1.0"),
  expectations: z.array(
    z.object({
      id: z.string(),
      match: z.object({ pagePath: z.string(), label: z.string() }),
      shouldFlag: z.boolean(),
      expectedVerdict: z
        .enum(["VERIFIED", "CONTRADICTORY", "EPHEMERAL", "BROWSER_LOCAL", "BROKEN", "NO_EFFECT", "UNCERTAIN", "SKIPPED"])
        .optional(),
      expectedCodes: z.array(z.string()).default([]),
    }),
  ),
});

export interface BenchmarkExpectation {
  id: string;
  match: { pagePath: string; label: string };
  shouldFlag: boolean;
  expectedVerdict?: Verdict;
  expectedCodes: string[];
}

export interface BenchmarkEvaluation {
  expectationId: string;
  findingId?: string;
  discovered: boolean;
  flagged: boolean;
  verdictCorrect: boolean;
  detectorCodesCorrect: boolean;
  actualVerdict?: Verdict;
  actualCodes: string[];
}

export interface BenchmarkMetrics {
  schemaVersion: "1.0";
  scanId: string;
  expectations: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  falsePositiveRate: number;
  actionDiscoveryRate: number;
  verdictAccuracy: number;
  detectorAccuracy: number;
  expectationCoverage: number;
  benchmarkTruncated: boolean;
  environmentValidity: number;
  cleanupSuccess: number | null;
  reproductionSuccessRate: number | null;
  reproductionsAttempted: number;
  scanTimeMs: number;
  memoryDeltaMb: number;
  evaluations: BenchmarkEvaluation[];
}

export async function loadBenchmarkExpectations(file: string): Promise<BenchmarkExpectation[]> {
  const input = JSON.parse(await readFile(file, "utf8")) as unknown;
  const parsed = expectationSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid benchmark expectations: ${parsed.error.message}`);
  return parsed.data.expectations as BenchmarkExpectation[];
}

function findingMatches(finding: Finding, expectation: BenchmarkExpectation): boolean {
  let pathname = finding.action.pageUrl;
  try {
    pathname = new URL(finding.action.pageUrl).pathname;
  } catch {
    // Match the original value when it is not a URL.
  }
  return pathname === expectation.match.pagePath && new RegExp(expectation.match.label, "i").test(finding.action.label);
}

const flaggedVerdicts = new Set<Verdict>(["CONTRADICTORY", "EPHEMERAL", "BROKEN", "NO_EFFECT"]);

export function evaluateReport(
  report: ScanReport,
  expectations: BenchmarkExpectation[],
  scanTimeMs: number,
  memoryDeltaMb: number,
): BenchmarkMetrics {
  const evaluations = expectations.map((expectation): BenchmarkEvaluation => {
    const finding = report.findings.find((candidate) => findingMatches(candidate, expectation));
    const actualCodes: string[] = finding?.detectorMatches.map((item) => item.code) ?? [];
    return {
      expectationId: expectation.id,
      ...(finding ? { findingId: finding.id, actualVerdict: finding.verdict } : {}),
      discovered: Boolean(finding),
      flagged: finding ? flaggedVerdicts.has(finding.verdict) : false,
      verdictCorrect: Boolean(finding && (!expectation.expectedVerdict || finding.verdict === expectation.expectedVerdict)),
      detectorCodesCorrect: expectation.expectedCodes.every((code) => actualCodes.includes(code)),
      actualCodes,
    };
  });
  const truePositives = evaluations.filter((item, index) => expectations[index]?.shouldFlag && item.flagged).length;
  const falseNegatives = evaluations.filter((item, index) => expectations[index]?.shouldFlag && !item.flagged).length;
  const falsePositives = evaluations.filter((item, index) => !expectations[index]?.shouldFlag && item.flagged).length;
  const trueNegatives = evaluations.filter((item, index) => !expectations[index]?.shouldFlag && !item.flagged).length;
  const ratio = (numerator: number, denominator: number): number => (denominator === 0 ? 1 : numerator / denominator);
  return {
    schemaVersion: "1.0",
    scanId: report.scanId,
    expectations: expectations.length,
    truePositives,
    falsePositives,
    trueNegatives,
    falseNegatives,
    precision: ratio(truePositives, truePositives + falsePositives),
    recall: ratio(truePositives, truePositives + falseNegatives),
    falsePositiveRate: ratio(falsePositives, falsePositives + trueNegatives),
    actionDiscoveryRate: ratio(evaluations.filter((item) => item.discovered).length, expectations.length),
    verdictAccuracy: ratio(evaluations.filter((item) => item.verdictCorrect).length, expectations.length),
    detectorAccuracy: ratio(evaluations.filter((item) => item.detectorCodesCorrect).length, expectations.length),
    expectationCoverage: ratio(evaluations.filter((item) => item.discovered).length, expectations.length),
    benchmarkTruncated: Boolean(report.completeness?.truncated),
    environmentValidity: !report.environment || report.environment.status === "VALID" ? 1 : 0,
    cleanupSuccess: null,
    reproductionSuccessRate: null,
    reproductionsAttempted: 0,
    scanTimeMs,
    memoryDeltaMb,
    evaluations,
  };
}

export interface RunBenchmarkOptions {
  scan: ScanOptions;
  expectationFile: string;
  verifyReplays: boolean;
  maxReplays: number;
}

export interface BenchmarkResult extends ScanResult {
  metrics: BenchmarkMetrics;
}

export async function runBenchmark(
  options: RunBenchmarkOptions,
  onProgress: (progress: ScanProgress) => void = () => undefined,
): Promise<BenchmarkResult> {
  const expectations = await loadBenchmarkExpectations(options.expectationFile);
  const memoryBefore = process.memoryUsage().rss;
  const startedAt = Date.now();
  const scanResult = await runScan(options.scan, onProgress);
  const metrics = evaluateReport(
    scanResult.report,
    expectations,
    Date.now() - startedAt,
    Math.round(((process.memoryUsage().rss - memoryBefore) / 1024 / 1024) * 100) / 100,
  );

  if (options.verifyReplays) {
    const candidates = metrics.evaluations
      .filter((evaluation, index) => expectations[index]?.shouldFlag && evaluation.findingId)
      .slice(0, options.maxReplays);
    let successes = 0;
    for (const candidate of candidates) {
      const replay = await runReplay(
        candidate.findingId as string,
        {
          reportDirectory: scanResult.reportDirectory,
          outputRoot: options.scan.outputRoot,
          headed: options.scan.headed,
          ...(options.scan.executablePath ? { executablePath: options.scan.executablePath } : {}),
          ...(options.scan.storageStatePath ? { storageStatePath: options.scan.storageStatePath } : {}),
        },
        onProgress,
      );
      const reproduced = replay.report.findings[0];
      const expected = expectations.find((item) => item.id === candidate.expectationId);
      if (
        reproduced &&
        expected &&
        reproduced.verdict === candidate.actualVerdict &&
        expected.expectedCodes.every((code) => reproduced.detectorMatches.some((item) => item.code === code))
      ) {
        successes += 1;
      }
    }
    metrics.reproductionsAttempted = candidates.length;
    metrics.reproductionSuccessRate = candidates.length === 0 ? 1 : successes / candidates.length;
  }
  await Promise.all([
    writeFile(path.join(scanResult.reportDirectory, "benchmark.json"), `${JSON.stringify(metrics, null, 2)}\n`),
    writeFile(path.join(scanResult.reportDirectory, "benchmark.html"), renderBenchmarkDashboard(metrics)),
    writeFile(path.join(scanResult.reportDirectory, "benchmark.md"), renderBenchmarkMarkdown(metrics)),
  ]);
  return { ...scanResult, metrics };
}
