# Roadmap and phase gates

The normative destination is [`PRODUCT_SPECIFICATION.md`](PRODUCT_SPECIFICATION.md); the evidence-based current state is [`PRODUCT_STATUS.md`](PRODUCT_STATUS.md). Phases define implementation order only. They never remove later scope or turn a partial module into a completed capability.

## Status policy

A phase is complete only when its production behavior, broken fixtures, correct controls, deterministic replay where applicable, documentation, changelog, package surface, and hosted gates all pass. Each completed phase is committed and pushed independently. A version tag and GitHub release are created only after hosted cross-platform CI is green.

## Released foundation (`v0.1.0`–`v1.1.0`)

These releases established browser scanning, evidence reports, replay and cleanup, semantic recording/contracts, baseline/CI, PostgreSQL read-back, coding-agent adapters, multi-role/provider contracts, multi-browser execution, plugin isolation, and performance budgets. They remain supported, but some are `PARTIAL` against the expanded full-product specification. Historical release completion is not the same as §32 full-product completion.

## Active release — real-world correctness (`v1.2.0`)

Mapped specification: §8.2, §16, §25–29.

Gate:

- General standalone Enter-submit discovery and execution; no TodoMVC-specific selector.
- Cross-origin navigation fail-closed unless explicitly allowed.
- Verdict priority prevents persistence findings from hiding duplicate/runtime failures.
- Benchmark gates 100% fixture expectation coverage, verdict/detector correctness, precision/recall, zero false positives, and replay.
- Pinned external TodoMVC scan plus finding replay is published with before/after limitations.
- Typecheck, unit, browser smoke, audit, pack/import, YAML/Bash validation, and hosted OS/Node/browser matrix pass.

## Phase A — environment validity and managed runtime (release candidate)

Mapped specification: §6–7, §15, §18 group K, §29.

Gate:

- `realdone init` discovers framework, package manager, commands, port, routes, database/auth hints and test environment.
- Runtime Manager starts, health-checks, logs, restarts and reliably cleans up the target process.
- Asset, bootstrap, static-root and auth/test-data health checks produce `ENVIRONMENT_INVALID` or `BLOCKED`.
- Environment findings are excluded from application-defect precision/recall.
- Broken-environment fixtures and correct application-defect controls pass on all supported OS families.

Complete. The implementation, local acceptance, package surface and hosted Ubuntu/Windows/macOS matrix are green.

## Phase B — complete action and execution coverage (release candidate)

Mapped specification: §8–11, detector group A.

Gate:

- Keyboard, implicit submit, hover/context, dynamic/lazy/virtualized, scroll, popup/tab and policy-allowed iframe actions are discoverable.
- Upload, download, drag/drop, rich text and multi-step actions are either safely executed or explicitly routed to recording.
- Test data honors constraints and relationships while retaining unique cleanup-safe canaries.
- Executor handles pending requests, dialogs, stale pages/locators and retry idempotency without duplicate effects.
- RD004–RD008 have broken fixtures, correct controls and deterministic evidence.

Complete. Implementation/local acceptance, external Actual/TodoMVC regression scans and the hosted Ubuntu/Windows/macOS matrix are green.

## Phase C — complete evidence, snapshot and persistence semantics

Mapped specification: §12–17, detector groups B–D.

Gate:

- Snapshot schema covers redacted DOM, cookies, storage, IndexedDB, network, console, WebSocket, downloads and optional adapter evidence.
- Hard reload, new tab, clean context, logout/login, app restart, API read-back, database/provider and cross-user strategies are orchestrated consistently.
- Every persistence scope and verdict has an executable fixture/control and stable report schema.
- Verdict priority and Levels 0–7 are uniform across scan, contract, replay, baseline and report engines.
- Remaining persistence/CRUD/success-integrity detectors in groups B–D are gated.

Complete. Browser evidence covers semantic DOM/cookie/IndexedDB/WebSocket capture, every runtime persistence scope, API and managed-restart read-back, contract hard-reload/new-tab/clean-context/logout-login strategies, and RD103–RD105/RD204–RD205/RD304–RD305. Actual Budget and the intentional TodoMVC defect copy show no Phase C regression, and the hosted Ubuntu/Windows/macOS matrix is green.

## Phase D — auth, authorization, file, provider and regression detectors

Mapped specification: §18 groups E–J, §24.

Gate:

- RD401–RD905 are implemented only with observable evidence, broken fixtures and correct controls.
- Multi-role verification covers UI, API, direct routes, cross-tenant access, revocation and session invalidation.
- File/export/payment/provider findings require content or provider proof rather than UI claims.
- Expected changes and regressions are first-class verdict/report outcomes.

Complete. The browser detector lab gates RD401–RD505 and RD701–RD805 with correct controls, upload/download content evidence and zero false positives; contract verification gates the RD601–RD605 Level 7 authorization matrix; behavioral diff emits RD901–RD905 and first-class expected/regression outcomes. Actual Budget and the intentional TodoMVC defect copy show no Phase D regression, and the hosted Ubuntu/Windows/macOS matrix is green.

## Phase E — behavior contracts, replay and report completeness

Mapped specification: §19–21, §26.

Gate:

- Recorder and semantic resolver cover complex flows without coordinate-only or fragile-selector contracts.
- Replay returns every normative reproduction outcome and separates environment change from product change.
- Report artifact layout and timelines cover every evidence type and finding class.
- Benchmark exposes and gates truncation, expectation coverage, cleanup success and environment validity in addition to correctness metrics.

Phase E is complete. A real-browser complex flow records and verifies upload, rich text, keypress, popup, non-empty download and semantic drag/drop; fresh browser executions produce all five normative replay outcomes; reports write and link every Phase E artifact class; benchmark cleanup is executed and gated. Chromium/Firefox/WebKit pass, Actual Budget and the intentional TodoMVC defect copy show no regression, and a fresh Conduit SQLite login records 5 semantic steps/20 masked rrweb events, verifies with trace, and passes its generated Playwright spec. Hosted run `29914326977` passed PostgreSQL 17, package/audit gates, Node 20/22, all three engines, and Ubuntu/Windows/macOS for Phase E head `aa5d673`.

## Phase F — source-of-truth and provider ecosystem

Mapped specification: §22–25.

Gate:

- PostgreSQL remains the production-like reference adapter; zero-setup SQLite plus Prisma, Supabase, Firebase, MongoDB and custom adapter contracts pass integration fixtures.
- Stripe test mode, email test inboxes, S3/Supabase Storage, OAuth and custom providers have maintained sandboxed adapters.
- Read-only defaults, TLS, parameterization, secret redaction, production guards and cleanup ledgers pass security tests.
- Plugin SDK compatibility and isolation are versioned and documented with real example plugins.

Implementation and local acceptance are complete. SQLite, Supabase, Firebase, MongoDB, PostgreSQL and Prisma/custom source contracts cover verification, schema/primary-key/soft-delete discovery, value-free snapshots/diff and confirmed cleanup; all seven maintained provider adapters and production guards pass integration tests. The full browser workflow passed in Chromium and the Chromium/Firefox/WebKit matrix with source/provider Level 6, plugin and built-in adapters, multi-role Level 7, trace/video, baseline/CI, replay and agent verification. A pinned Conduit run performed a real login, confirmed the user in its live SQLite `Users` table at Level 6, wrote a trace, found no password in artifacts, and removed the disposable user by primary key. Installed-tarball smoke and dependency audit pass; Phase completion remains contingent on PostgreSQL 17, MongoDB 8 and the hosted Ubuntu/Windows/macOS matrix for the pushed Phase F head.

## Phase G — coding-agent and full-product qualification

Mapped specification: §4.6, §27–32.

Gate:

- Codex, Claude and generic adapters are validated on real baseline → change → rebuild → affected-flow → follow-up cycles.
- External case studies cover backend CRUD, PostgreSQL, Supabase, auth, upload, export, multi-role, AI-generated apps and multi-step flows.
- Incremental selection, snapshot deduplication, trace-on-failure, bounded workers and timeout behavior meet published budgets.
- All 15 release gates in §29 are executable and green on Windows, macOS and Linux.
- Every row in `PRODUCT_STATUS.md` is `IMPLEMENTED`; only then may RealDone be called a completed full product.
