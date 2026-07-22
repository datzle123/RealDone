# Performance budgets

Quick scan remains intentionally light: one Chromium worker, no provider/database adapter, no extra role, and trace-heavy evidence only when needed.

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

The dashboard exposes precision, recall, false-positive rate, action discovery, verdict/detector accuracy, reproduction success, scan time, memory delta, the confusion matrix, and every fixture outcome. Release gates continue to favor fewer evidence-backed findings over more speculative detectors.

## Release budgets

The public fixture gate expects 100% precision, recall, discovery, detector accuracy, and reproduction success with a 0% false-positive rate. Operational time and memory are recorded on every run; project-specific limits should be enforced through checked-in budget JSON because hardware classes differ.
