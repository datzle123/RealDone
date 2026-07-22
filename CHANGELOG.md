# Changelog

All notable changes are documented here. RealDone follows semantic versioning while the public contract stabilizes.

## [Unreleased]

## [0.6.0] - 2026-07-22

### Added

- `run` pipeline that captures a green baseline, invokes a coding agent, rebuilds, selects affected flows, and independently verifies behavior.
- Shell-free generic command runner with cross-platform executable resolution, timeouts, bounded output, secret redaction, and local logs.
- Current non-interactive presets for Codex CLI and Claude Code plus a structured generic adapter.
- Git HEAD/worktree change attribution with a clean-worktree gate and committed/uncommitted file detection.
- Evidence-based follow-up prompts generated only from build and RealDone regression results; agent output is explicitly excluded as verification evidence.
- End-to-end browser smoke coverage for baseline → no-op agent → rebuild → affected-flow verification.

## [0.5.0] - 2026-07-22

### Added

- Optional node-postgres adapter for Level 6 source-of-truth assertions in behavior contracts.
- Read-only verification transactions, parameterized filter values, and allowlisted schema/table/column mappings.
- Exact present/absent and maximum-match checks with value-free source evidence in JSON/HTML reports.
- TLS modes, environment-only credentials and CA material, bounded connection/statement timeouts, and database-error redaction.
- PostgreSQL cleanup targets in verification ledgers with explicit CLI, config, and key-field gates.
- PostgreSQL 17 Docker fixture plus unit, injection, failure-mode, cleanup, and CI integration coverage.

## [0.4.0] - 2026-07-22

### Added

- Versioned behavior manifests with canonical contract hashes, routes, endpoints, tags, and compact baseline outcomes.
- `baseline` and `ci` commands with jsondiffpatch-backed structured deltas.
- Regression classification for pass-to-fail, missing flows, expected contract changes, improvements, and baseline failures.
- Affected-flow selection from explicit source globs, route/endpoint tokens, changed files, and critical tags.
- GitHub Step Summary output and reusable composite `action.yml`.
- `export-playwright` command preserving semantic locators, secrets, network/status, URL, text, and persistence assertions.
- Browser smoke coverage proving a green baseline and an intentional POST-500 regression.

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
