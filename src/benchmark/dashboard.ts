import type { BenchmarkMetrics } from "./evaluate.js";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderBenchmarkMarkdown(metrics: BenchmarkMetrics): string {
  const replay = metrics.reproductionSuccessRate === null ? "not run" : percent(metrics.reproductionSuccessRate);
  return `# RealDone benchmark dashboard

Scan: \`${metrics.scanId}\`

| Metric | Result |
| --- | ---: |
| Precision | ${percent(metrics.precision)} |
| Recall | ${percent(metrics.recall)} |
| False-positive rate | ${percent(metrics.falsePositiveRate)} |
| Action discovery | ${percent(metrics.actionDiscoveryRate)} |
| Expectation coverage | ${percent(metrics.expectationCoverage)} |
| Verdict accuracy | ${percent(metrics.verdictAccuracy)} |
| Detector accuracy | ${percent(metrics.detectorAccuracy)} |
| Environment validity | ${percent(metrics.environmentValidity)} |
| Benchmark truncated | ${metrics.benchmarkTruncated ? "yes" : "no"} |
| Reproduction success | ${replay} |
| Scan time | ${metrics.scanTimeMs}ms |
| Memory delta | ${metrics.memoryDeltaMb}MB |

Confusion matrix: ${metrics.truePositives} TP · ${metrics.falsePositives} FP · ${metrics.trueNegatives} TN · ${metrics.falseNegatives} FN.
`;
}

export function renderBenchmarkDashboard(metrics: BenchmarkMetrics): string {
  const values = [
    ["Precision", percent(metrics.precision), metrics.precision],
    ["Recall", percent(metrics.recall), metrics.recall],
    ["False-positive rate", percent(metrics.falsePositiveRate), 1 - metrics.falsePositiveRate],
    ["Discovery", percent(metrics.actionDiscoveryRate), metrics.actionDiscoveryRate],
    ["Expectation coverage", percent(metrics.expectationCoverage), metrics.expectationCoverage],
    ["Verdict accuracy", percent(metrics.verdictAccuracy), metrics.verdictAccuracy],
    ["Detector accuracy", percent(metrics.detectorAccuracy), metrics.detectorAccuracy],
    ["Environment validity", percent(metrics.environmentValidity), metrics.environmentValidity],
    [
      "Reproduction success",
      metrics.reproductionSuccessRate === null ? "not run" : percent(metrics.reproductionSuccessRate),
      metrics.reproductionSuccessRate ?? 0,
    ],
  ] as const;
  const cards = values.map(([label, result, score]) => `<article><span>${escapeHtml(label)}</span><strong>${result}</strong><div><i style="width:${Math.max(0, Math.min(100, score * 100))}%"></i></div></article>`).join("");
  const evaluations = metrics.evaluations.map((item) => `<tr><td>${escapeHtml(item.expectationId)}</td><td>${item.discovered ? "yes" : "no"}</td><td>${escapeHtml(item.actualVerdict ?? "—")}</td><td>${escapeHtml(item.actualCodes.join(", ") || "—")}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RealDone benchmark</title><style>body{margin:0;background:#0a0e12;color:#eef3f6;font:15px/1.5 system-ui}.wrap{width:min(1080px,calc(100% - 32px));margin:auto;padding:48px 0}h1{font-size:42px;margin:.2em 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:28px 0}article{background:#11171e;border:1px solid #27313c;border-radius:12px;padding:16px}article span{color:#96a4b2}article strong{display:block;font-size:28px;margin:6px 0}article div{height:5px;background:#27313c;border-radius:9px}article i{display:block;height:100%;background:#39d98a;border-radius:9px}table{width:100%;border-collapse:collapse;background:#11171e}th,td{border:1px solid #27313c;padding:10px;text-align:left}.meta{color:#96a4b2}.confusion{background:#11171e;border:1px solid #27313c;border-radius:12px;padding:14px 16px}</style></head><body><main class="wrap"><div class="meta">REALDONE / BENCHMARK</div><h1>Evidence quality dashboard</h1><p>${escapeHtml(metrics.scanId)} · ${metrics.scanTimeMs}ms · ${metrics.memoryDeltaMb}MB</p><section class="grid">${cards}</section><p class="confusion"><strong>Confusion matrix:</strong> ${metrics.truePositives} TP · ${metrics.falsePositives} FP · ${metrics.trueNegatives} TN · ${metrics.falseNegatives} FN</p><h2>Fixture evaluation</h2><table><thead><tr><th>Expectation</th><th>Discovered</th><th>Verdict</th><th>Detectors</th></tr></thead><tbody>${evaluations}</tbody></table></main></body></html>`;
}
