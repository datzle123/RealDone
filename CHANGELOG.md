# Changelog

All notable changes are documented here. RealDone follows semantic versioning while the public contract stabilizes.

## [Unreleased]

### Added

- Reproducible 10-project Chromium qualification across Flatnotes, Linkding, Flame, TakeNote, Grimoire, Dashy, JSPaint, 2048, Flowy, and Quiver, with pinned MIT licenses, minimal fault patches, clean controls, run IDs, and SHA-256-bound reports.
- Deterministic browser controls for late bootstrap reads and onboarding work that completes after modal dismissal.

### Fixed

- Initial page reads and socket handshakes no longer become evidence for the first clicked action.
- WebSockets opened only during persistence reloads and unrelated background GET polling no longer make a no-op mutation look effective.
- Discovery/actionability false positives found by the real-project batch, including nested, covered, selected, script-anchor, visual-state, local-search, clipboard, session-order, and cross-origin cases.

## [1.3.2] - 2026-07-23

### Added

- Added zero-config managed runtime discovery for static HTML and conventional Django, FastAPI, Flask, Laravel, Rails, ASP.NET Core, Spring Boot, Deno, Go, Rust and Composer-based PHP projects.
- Added a packaged static server and real installed-tarball first-scan gates for both metadata-free static HTML and npm projects without lockfile/package-manager metadata; each gate starts, scans and cleans up the target through the installed CLI.

### Changed

- External-case fingerprints now cover browser-verification behavior rather than project discovery, managed runtime startup, release plumbing, or version metadata. Those distribution paths are independently gated by installed-package smoke and hosted Windows/macOS/Linux runs, so startup improvements do not invalidate unchanged browser evidence.

### Fixed

- Node projects with `dev` or `start` scripts now fall back to npm when neither a lockfile nor `packageManager` field exists.
- Unsupported custom runtimes now receive an actionable URL/Docker/discovery message instead of an unexplained missing-command failure.
- Managed runtimes now reject occupied ports instead of accidentally scanning an unrelated app, while the packaged static runtime selects a free fallback port and prevents symlink escapes outside the project root.

## [1.3.1] - 2026-07-23

### Changed

- Published the one-command npm experience, promoted `npx realdone scan` to the primary quick start, and added a clean external-consumer registry smoke check.
- Reworked the GitHub opening so the problem, verification model, safety boundary, and first command are understandable within 30 seconds.

## [1.3.0] - 2026-07-23

### Added

- Provider-aware finding replay with value-free provider name/kind/resource/operation/state requirements across CLI and MCP; missing, mismatched, failed, or non-causal confirmation now returns `REPLAY_UNCERTAIN`.
- Pre-execution browser safety reclassification from live form action/method, cross-origin and non-HTTP targets, upload fields, provider/endpoint hints, downloads, authentication popups, and destructive endpoints.
- Schema-validated, path-safe replay that never inherits historical external, destructive, or staging-host authority; CLI replay requires fresh explicit grants and MCP replay remains side-effect-disabled.
- CSP-compatible rrweb recording through a pre-document browser init script, gated by a strict `script-src 'self'` browser control.
- Fail-closed affected-flow selection: a non-empty change set that maps to zero contracts now verifies the full manifest instead of reporting a zero-flow pass.
- Managed-runtime health failures now surface bounded, secret-redacted startup logs, and the hosted smoke allowance covers cold Windows package startup without weakening the finite production timeout.
- GitHub-hosted 15-gate evidence is now cryptographically attested on successful `main` runs and can be verified with `gh attestation verify`.
- Engine fingerprints ignore release-only modules and version metadata, so a package version bump cannot invalidate unchanged browser-behavior evidence.
- External-case release qualification now requires semantic observable proof for all nine normative §27 capability classes, SHA-256-bound supporting artifacts, and an executable Codex baseline → observed RD901 regression → unchanged-contract repair proof instead of trusting assertion labels or a case-count claim.
- The hosted release merge secret-scans committed external-case evidence and folds that result into RG14 before GitHub can attest the aggregate.
- Release aggregation rejects duplicate external cases/evidence files and platform attestations from mixed source revisions.
- Same-document anchors now use their keyboard activation path, so focus-revealed skip links are exercised without false `BROKEN` click timeouts when CSS keeps them offscreen until focus.
- Configured source snapshots with an error-free added/removed/changed/soft-delete diff now outrank browser-session absence and produce `SOURCE_OF_TRUTH_CONFIRMED` Level 6 evidence; runtime/write failures retain verdict priority.
- Raw external-project `scan.json` verification: committed source artifacts must remain repository-confined, SHA-256 intact, and exactly consistent with their release-evidence summaries.
- One-question project action consent for every autonomously browser-operating interactive CLI command, explicit `--yes` for non-interactive CLI/CI runs, and user-owned `--allow-project-actions` authorization for MCP project sessions.
- Authenticated Codex CLI qualification of the RealDone MCP scan path against the pinned Conduit project, with the resulting browser report retained as evidence rather than trusting the agent response.

- A local stdio MCP server with shared-core `scan`, `record`, `verify`, `baseline`, `verify_change`, `replay`, and redacted `get_report` tools for Codex, Claude Code, and generic MCP clients.
- MCP workspace confinement, bounded inputs, server instructions, and fail-closed destructive/external policies; the full CLI remains independent of AI.
- A no-URL managed scan path that discovers, starts, scans, and stops the current web project.
- `scan --full` for large bounded safe-audit budgets and deep persistence without enabling destructive or external effects.
- Machine-readable artifact secret/ZIP scanning, backward-compatible artifact schema checks, cross-platform release attestations, and an evaluator for all 15 normative release gates.
- Maintainer-pinned TodoMVC, Actual Budget, and Conduit evidence with current-source fingerprint gating, repository-confined raw-scan SHA-256/counter/verdict validation, and a CI aggregation job that requires all 15 normative gates across Linux, macOS, and Windows.
- Trace-on-failure for scans and contract verification, a deterministic 1–16 worker pool for contract suites/browser matrices, and content-addressed snapshot indexes with shared SHA-256 blobs.
- `realdone init` project discovery for framework, package manager, lifecycle commands, port, conventional routes, SQLite/PostgreSQL/provider hints, auth/test tooling and environment filenames, including bounded monorepo workspaces.
- `scan --manage-runtime` lifecycle ownership with development/production/Docker modes, HTTP health checks, bounded crash restarts, secret-redacted logs and cross-platform process cleanup.
- A first-class environment health gate and portable `environment.json` evidence for RD1001–RD1005, covering main-document/static-root, script/stylesheet status and content type, bootstrap/render readiness, test-data health endpoints and invalid auth states.
- Broken-environment and healthy controls plus a managed-app fixture exercised through the real CLI/browser path.
- Dynamic action preparation for hover-revealed and lazy scroll content, native checkbox/select actions, context menus, popups, downloads, and opt-in same-origin iframe execution.
- RD004 stuck loading, RD005 broken navigation, RD006 disabled-after-click failure, RD007 keyboard-action missed, and RD008 recorded-flow discovery boundary with broken fixtures and correct controls.
- Constraint-aware test values for min/max/step, min/max length and common deterministic pattern forms.
- Redacted cookie digests, bounded IndexedDB metadata, semantic DOM digests, WebSocket frame evidence, hard reload, new-tab, API read-back and managed app-restart persistence observations.
- Explicit `MEMORY_ONLY`, `TAB_PERSISTENT`, `SESSION_PERSISTENT`, `BROWSER_LOCAL`, `BACKEND_PERSISTENT`, `SOURCE_OF_TRUTH_CONFIRMED` and `CROSS_USER_CONFIRMED` scope evidence across scans and contracts.
- RD103–RD105, RD204–RD205 and RD304–RD305 with intentionally broken fixtures, correct controls and browser benchmark expectations.
- Versioned contract persistence strategies for reload, hard reload, new tab, clean context and logout/login rehydration.
- Browser-observable RD401–RD405 mock/demo detectors, RD501–RD505 authentication detectors, RD701–RD705 upload/export detectors and RD801–RD805 payment/provider-integrity detectors with broken/control fixtures.
- Level 7 authorization contract probes for UI-only permissions, cross-tenant read/write, revoked roles and exposed admin routes (RD601–RD605).
- First-class behavioral-diff outcomes and evidence-specific RD901–RD905 regression codes for removed actions, persistence/API regressions and performance-budget failures.
- Bounded upload canary evidence and downloaded-content filename/type/size/hash/completeness evidence without storing raw file bodies.
- Semantic recorder/verifier steps for keypress, environment-referenced upload, rich text and drag/drop, plus popup-path and non-empty-download expectations.
- Explicit fresh-execution replay outcomes and portable `replay.json` evidence for reproduced, changed, environment-changed, target-missing and uncertain results.
- Dedicated per-finding snapshot, console, WebSocket, upload, download and replay-contract artifact directories linked from the HTML report.
- Zero-config SQLite Level 6 verification with read-only/query-only access, live schema/primary-key/soft-delete discovery, value-free hash snapshots, row diff, parameterized filters, and separately confirmed primary-key cleanup.
- Maintained Supabase/PostgREST, Firebase Firestore REST, and MongoDB source adapters with mapped resources, remote/TLS guards, bounded snapshots, and cleanup ledgers; PostgreSQL now also exposes live schema discovery and row snapshots.
- Versioned Prisma/custom source-plugin operations for verification, schema discovery, snapshots, and exact-primary-key cleanup.
- Maintained read-only provider adapters for Stripe test mode, Resend, SendGrid, Mailgun, S3, Supabase Storage, and OAuth introspection, plus repeated `--database-config` and `--provider-config` CLI inputs.
- GitHub Action inputs for SQLite, repeated database configs, repeated provider configs, and provider/source plugins.
- Plugin manifest environment/network permissions with fresh worker execution, restricted worker environment, allowlisted global `fetch`, and tested source/provider redaction boundaries.
- Explicit automatic provider rules for CLI/MCP scans, with action/request matching and response-ID, upload, download, or environment references; passing checks attach redacted Level 6 evidence and provider artifacts.

### Changed

- Hosted run `29958126604` qualified fingerprint `1f88dd858…` across Windows, macOS, Linux, Node 20/22, PostgreSQL 17, MongoDB 8, the browser matrix, package smoke and all 15 normative release gates; GitHub-signed provenance was independently verified.
- Product status is now 22/22 `IMPLEMENTED`; `v1.3.0` is the first release qualified against the complete normative specification.
- Coding-agent verification now attributes changes and selects affected flows from the final post-build Git state, so generated product files cannot escape independent verification.
- Production-like targets require an explicit host allowlist for mutation, destructive, and external-effect execution even when the corresponding action opt-in is present.
- Runtime DOM changes that increase action risk are reported as `SKIPPED`/RD008 before fields are filled or controls are activated; same-origin opt-in canary uploads remain supported.
- Text inputs whose placeholder is an HTTP(S) URL retain external-target classification for Connect/sync actions, preventing generated canaries from becoming unintended DNS/network targets on real applications.

- Discovered routes with JavaScript/CSS served as HTML are excluded from application-defect execution and their incoming navigation actions are `SKIPPED` with environment evidence.
- Benchmark output now gates explicit expectation coverage, truncation and environment validity in addition to precision, recall, verdict, detector and replay accuracy.
- Executor evidence separates field preparation from the user action, scopes network observations before persistence reloads, waits for bounded network idle, and avoids stale post-navigation locator waits.
- Complex upload, canvas, rich-text and drag/drop actions are surfaced as recorded-flow requirements instead of guessed automatic interactions.
- Multi-field mutations use independent canary values, and successful POST/PUT/PATCH requests are read back through a bounded same-context API request before verdict resolution.
- Password-bearing forms are classified as authentication before generic email/external heuristics, and successful sessions are verified from persisted auth artifacts rather than requiring credentials to reappear in the UI.
- Fake-login detection now requires a transition into private state (or an explicit success claim), so a rejected login on a public page containing “Need an account?” remains `UNCERTAIN` instead of becoming a false RD501 finding.
- MCP `scan` now owns the discovered project runtime when no URL is supplied, while an explicit URL remains caller-managed.
- Missing Playwright browsers are downloaded automatically on first use with a bounded, stdout-safe installer; `REALDONE_SKIP_BROWSER_INSTALL=1` keeps manual control.
- Automatic CLI/MCP scans can attach bounded, value-free SQLite or configured database snapshots before and after mutations, persist row-hash diffs in snapshot artifacts, and fail to `UNCERTAIN` when requested source evidence is unavailable.
- Provider-aware scans suppress RD804 only after every matched check passes with causal payment-provider linkage; no-op, wrong-kind, mixed, missing-reference and unavailable-provider controls remain fail-closed while duplicate-payment defects keep their higher-priority verdict.
- Automatic provider checks are capped across repeated configs, execute with bounded concurrency under the global scan deadline, reject oversized JSON, and redact bounded metadata against references and configured secrets.
- Browser-matrix failures now include the failing step/assertion in JSON, Markdown, HTML, and smoke logs instead of reporting only a nonzero exit code.
- Benchmark release gates now run and require successful cleanup; recorder interaction and navigation waits inherit the configured finite timeout.
- Published packages include the complete linked documentation set and report preview instead of leaving installed README links unresolved.
- Published packages now include every database/provider example and both provider/source plugin examples; optional SQLite and MongoDB dependencies are license-noticed alongside PostgreSQL.

## [1.2.0] - 2026-07-22

### Added

- Discovery and execution for standalone text/search inputs activated with Enter, including TodoMVC-style `.new-todo` controls.
- Public enter-submit regression fixture and real-world validation against the 28k-star MIT TodoMVC repository.
- Default safety block for cross-origin navigation links unless `--allow-external` is explicit.
- Normative full-product specification, evidence-based product-status snapshot, phase roadmap, and coding-agent governance enforced by an automated documentation/package gate.
- Installed-tarball smoke coverage for public SDK exports, CLI version, declarations, normative docs, examples, licenses, and notices.

### Changed

- Benchmark release gates now require 100% verdict accuracy and a 0% false-positive rate in addition to discovery, precision, recall, detector, and replay metrics.
- Duplicate submissions remain `BROKEN` even when the resulting UI state is also non-persistent.
- Missing semantic targets no longer fall back to a different element at the same DOM ordinal; they remain unexecuted and produce an evidence-backed `UNCERTAIN` result.
- State snapshots include redacted live form-control values/states, and buttons with nearby URL targets are classified as external effects instead of producing misleading no-effect findings.
- Same-origin hash-router paths are crawled as routes, and navigation links such as `Sign up` are no longer mistaken for direct mutation actions.
- Current-route self-links are skipped as idempotent navigation, and 4xx rejection of generated login credentials yields `UNCERTAIN` instead of false broken/persistence findings.
- Recorder fingerprints never derive accessible names from live input values; secret fields use stable environment references, and outcome capture no longer waits the default 30 seconds when no status element appears.
- Playwright export preserves hash-router navigation and evaluates contract URL patterns against the pathname, matching deterministic verifier semantics.
- The development/release environment installs `@playwright/test` directly so generated specs are executed rather than syntax-inspected only.
- Nearby-field discovery is limited to direct fields in a single-action container, preventing unrelated inputs from making a no-effect button look successful.
- Cleanup ledgers track every successful resource ID from duplicate POST submissions instead of leaking all but the first created resource.

## [1.1.0] - 2026-07-22

### Added

- `--deep` scan and recorded-verification mode that confirms persistence in a fresh browser context.
- Runtime `RD102` detection and `BROWSER_LOCAL` verdict for state that survives reload but disappears in a clean context.
- Browser-local public fixture and end-to-end CLI smoke coverage for deep persistence scope.
- Opt-in Playwright trace and browser-video artifacts for automatic scans and recorded verification.
- Cross-platform CLI surface tests covering every release command and advanced verification option.

### Changed

- Reproduction contracts preserve deep-mode semantics so an `RD102` result can be replayed deterministically.
- GitHub Action exposes deep verification as an explicit opt-in input.
- HTML/JSON reports link portable trace and video evidence when capture is enabled.

## [1.0.0] - 2026-07-22

### Added

- Named-role behavior contracts with separate authenticated browser contexts and Level 7 cross-role confirmation.
- Chromium, Firefox, and WebKit verification plus the `matrix` command and JSON/Markdown/HTML matrix evidence.
- Stable Plugin SDK v1 for trusted payment-sandbox, test-inbox, and object-storage provider checks.
- Worker-per-call plugin execution with manifest validation, deadlines, memory limits, evidence validation, and secret redaction.
- Explicit verification performance budgets covering total duration, slowest step, and memory growth.
- Benchmark Markdown and HTML dashboards alongside the machine-readable metrics.
- Threat model, advanced verification, plugin, performance, and release compatibility documentation.

### Changed

- Release CI now gates PostgreSQL 17, all three browser engines, dependency audit, package creation, and Node 20/22 builds on Ubuntu, Windows, and macOS.
- GitHub Action inputs expose browser, role-state, provider-plugin, and performance-budget verification controls.

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
