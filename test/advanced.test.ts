import assert from "node:assert/strict";
import test from "node:test";
import { renderBenchmarkDashboard, renderBenchmarkMarkdown } from "../src/benchmark/dashboard.js";
import { launchBrowser } from "../src/browser/runtime.js";
import { evaluatePerformance, performanceBudgetSchema, type PerformanceBudget } from "../src/performance/budget.js";
import type { BenchmarkMetrics } from "../src/benchmark/evaluate.js";

test("performance budgets produce deterministic violations", () => {
  const budget = performanceBudgetSchema.parse({
    schemaVersion: "1.0",
    maxVerificationMs: 1_000,
    maxStepMs: 500,
    maxMemoryDeltaMb: 64,
  }) as PerformanceBudget;
  const evaluation = evaluatePerformance(budget, {
    verificationMs: 1_200,
    maxStepMs: 400,
    memoryDeltaMb: 80,
  });
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.violations.length, 2);
  assert.equal(performanceBudgetSchema.safeParse({ schemaVersion: "1.0" }).success, false);
});

test("benchmark dashboard renders quality metrics and escapes fixture labels", () => {
  const metrics: BenchmarkMetrics = {
    schemaVersion: "1.0",
    scanId: "scan-1",
    expectations: 1,
    truePositives: 1,
    falsePositives: 0,
    trueNegatives: 0,
    falseNegatives: 0,
    precision: 1,
    recall: 1,
    falsePositiveRate: 0,
    actionDiscoveryRate: 1,
    verdictAccuracy: 1,
    detectorAccuracy: 1,
    expectationCoverage: 1,
    benchmarkTruncated: false,
    environmentValidity: 1,
    cleanupSuccess: null,
    reproductionSuccessRate: 1,
    reproductionsAttempted: 1,
    scanTimeMs: 500,
    memoryDeltaMb: 12,
    evaluations: [{
      expectationId: "<fixture>",
      discovered: true,
      flagged: true,
      verdictCorrect: true,
      detectorCodesCorrect: true,
      actualVerdict: "BROKEN",
      actualCodes: ["RD001"],
    }],
  };
  assert.match(renderBenchmarkMarkdown(metrics), /Precision \| 100.0%/);
  const html = renderBenchmarkDashboard(metrics);
  assert.match(html, /Evidence quality dashboard/);
  assert.match(html, /False-positive rate/);
  assert.match(html, /Reproduction success/);
  assert.match(html, /Confusion matrix/);
  assert.equal(html.includes("<fixture>"), false);
  assert.match(html, /&lt;fixture&gt;/);
});

test("custom executable paths fail closed for non-Chromium engines", async () => {
  await assert.rejects(
    launchBrowser({ headed: false, browserName: "firefox", executablePath: "custom-browser" }),
    /only be used with Chromium/,
  );
});
