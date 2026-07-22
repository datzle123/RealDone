# Changelog

All notable changes are documented here. RealDone follows semantic versioning while the public contract stabilizes.

## [Unreleased]

## [0.3.0] - 2026-07-22

### Added

- Headed `record` workflow for navigation, click, fill, check, and select interactions.
- Masked rrweb session evidence batched locally instead of streamed event-by-event.
- Versioned, Zod-validated behavior contract schema with weighted semantic fingerprints.
- Automatic write-request, response-status, URL, and visible-status expectations.
- Password/secret redaction through explicit environment-variable references.
- Optional Playwright auth-state capture and deterministic `verify` command.
- Per-step verification JSON/HTML report with fail-closed execution and locator diagnostics.
- Recorded-flow safety enforcement for production-like, destructive, and external actions.

## [0.2.0] - 2026-07-22

### Added

- Weighted semantic locator candidates with visible-match diagnostics and selector-survival coverage.
- Bounded retry policy limited to idempotent navigation, locator resolution, and cleanup.
- Zod-validated action policy files with classification overrides, deny rules, host allowlists, and budgets.
- Global scan time budget and retry budget.
- Cleanup ledger with derived resource IDs/URLs, reverse-order idempotent DELETE, dry run, auth state, and host safety.
- Benchmark expectation schema and precision, recall, false-positive, discovery, verdict, detector, time, memory, and replay metrics.
- Fake-update and selector-shift controls plus real cleanup endpoints in the public fixture.

## [0.1.0] - 2026-07-22

### Added

- Local-first `scan` and `replay` CLI commands.
- Chromium route/action discovery with safe-host policy.
- Semantic field input and unique canary generation.
- Network, console, page, DOM, URL, storage, dialog, download, and UI-claim evidence.
- Refresh persistence checks and core RD001–RD303 detectors.
- HTML/JSON reports, screenshots, network logs, and reproduction contracts.
- Public broken fixtures, correct persistence control, unit tests, and browser smoke test.
