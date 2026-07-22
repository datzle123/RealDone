# Performance budgets

Quick scan remains intentionally light: one Chromium worker, no provider/database adapter, no extra role, and no trace or video unless explicitly requested.

`--deep` opens one additional browser context per executed mutation to confirm persistence scope. Keep it opt-in for important flows or scheduled audits rather than paying that cost in every quick scan.

`--trace` records Playwright snapshots/screenshots and `--video` records the browser viewport. Both add I/O, storage, and post-processing work; use them for diagnosis or release evidence rather than routine scans. `--trace-on-failure` starts bounded tracing but deletes passing traces, retaining portable ZIP evidence only for findings or failed contract verification.

`scan --full` raises the default safe budgets to 100 pages, 500 actions, and 30 minutes, enables deep persistence and trace-on-failure, but never enables destructive or external effects. Explicit budget flags or policy values still win, and exhausted budgets set `truncated`.

Baseline, regression, browser-matrix, and post-agent contract verification accept `--workers 1..16`. Results preserve deterministic input order; quick scan remains one worker because concurrent mutations against the same application can create misleading evidence. Content-addressed snapshot indexes use SHA-256 blobs so repeated states share one portable artifact while legacy per-finding snapshot JSON remains available.

Recorded verification can enforce an explicit budget:

```json
{
  "schemaVersion": "1.0",
  "maxVerificationMs": 30000,
  "maxStepMs": 10000,
  "maxMemoryDeltaMb": 256
}
```

```bash
realdone verify flow.json --performance-budget examples/realdone.performance.json
realdone matrix flow.json --performance-budget examples/realdone.performance.json
```

Budget violations appear in JSON/HTML evidence and make verification fail. Choose values from repeated runs on the same CI class; browser startup, network distance, and cold caches can dominate short flows.

## Benchmark dashboard

`realdone benchmark` now writes:

- `benchmark.json` for automation;
- `benchmark.md` for pull requests and release notes;
- `benchmark.html` for a local visual dashboard.

The dashboard exposes precision, recall, false-positive rate, action discovery, expectation coverage, verdict/detector accuracy, environment validity, confirmed cleanup success, reproduction success, scan time, memory delta, the confusion matrix, and every fixture outcome. Release gates continue to favor fewer evidence-backed findings over more speculative detectors.

## Release budgets

The public fixture gate expects 100% precision, recall, discovery, expectation coverage, verdict/detector accuracy, environment validity, cleanup success, and reproduction success with a 0% false-positive rate and no truncation. Operational time and memory are recorded on every run; project-specific limits should be enforced through checked-in budget JSON because hardware classes differ.
