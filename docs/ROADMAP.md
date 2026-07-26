# Roadmap and phase gates

The normative destination is [`PRODUCT_SPECIFICATION.md`](PRODUCT_SPECIFICATION.md); the **only area-completeness ledger** is [`PRODUCT_STATUS.md`](PRODUCT_STATUS.md). Phases define implementation order and operational release gates. The words “phase gate complete” below apply only to that phase's listed gate; they never mean that every specification area the phase contributes to is `IMPLEMENTED`.

## Status policy

A phase gate is complete only when its production behavior, broken fixtures, correct controls, deterministic replay where applicable, documentation, changelog, package surface, and hosted gates all pass. Each completed phase gate is committed and pushed independently. A version tag and GitHub release are created only after hosted cross-platform CI is green. Product completion still requires every row in `PRODUCT_STATUS.md` to be `IMPLEMENTED`.

## Released `v1.3.3` qualification

The 2026-07-23 local regression batch ran ten pinned MIT web projects, retained clean controls, injected one reproducible no-op Create action per project, and observed 10/10 `NO_EFFECT / RD002` results in valid Chromium environments. The five normative external cases, PostgreSQL CRUD cleanup, Supabase Data API, Level 7 role contract, and Codex MCP RD901 regression/repair cycle were then rerun and validator-bound to fingerprint `68d4a8cb…`. Release `v1.3.3` passed all 15 gates across Windows/macOS/Linux in signed hosted run [`30189340006`](https://github.com/datzle123/RealDone/actions/runs/30189340006), passed the registry-installed `npx` smoke, and is published on npm and GitHub.

## Released foundation (`v0.1.0`–`v1.1.0`)

These releases established browser scanning, evidence reports, replay and cleanup, semantic recording/contracts, baseline/CI, PostgreSQL read-back, coding-agent adapters, multi-role/provider contracts, multi-browser execution, plugin isolation, and performance budgets. They remain supported, but some are `PARTIAL` against the expanded full-product specification. Historical release completion is not the same as §32 full-product completion.

## Released real-world correctness (`v1.2.0`)

The completed `v1.3.0` full-product qualification is Phase G below.

Contributes evidence to: §8.2, §16, §25–29.

Gate:

- General standalone Enter-submit discovery and execution; no TodoMVC-specific selector.
- Cross-origin navigation fail-closed unless explicitly allowed.
- Verdict priority prevents persistence findings from hiding duplicate/runtime failures.
- Benchmark gates 100% fixture expectation coverage, verdict/detector correctness, precision/recall, zero false positives, and replay.
- Pinned external TodoMVC scan plus finding replay is published with before/after limitations.
- Typecheck, unit, browser smoke, audit, pack/import, YAML/Bash validation, and hosted OS/Node/browser matrix pass.

## Phase A — environment validity and managed runtime (release candidate)

Contributes evidence to: §6–7, §15, §18 group K, §29.

Gate:

- `realdone init` discovers framework, package manager, commands, port, routes, database/auth hints and test environment.
- Runtime Manager starts, health-checks, logs, restarts and reliably cleans up the target process.
- Asset, bootstrap, static-root and auth/test-data health checks produce `ENVIRONMENT_INVALID` or `BLOCKED`.
- Environment findings are excluded from application-defect precision/recall.
- Broken-environment fixtures and correct application-defect controls pass on all supported OS families.

Phase A gate is complete. The implementation, local acceptance, package surface and hosted Ubuntu/Windows/macOS matrix are green.

## Phase B — complete action and execution coverage (release candidate)

Contributes evidence to: §8–11, detector group A.

Gate:

- Keyboard, implicit submit, hover/context, dynamic/lazy/virtualized, scroll, popup/tab and policy-allowed iframe actions are discoverable.
- Upload, download, drag/drop, rich text and multi-step actions are either safely executed or explicitly routed to recording.
- Test data honors constraints and relationships while retaining unique cleanup-safe canaries.
- Executor handles pending requests, dialogs, stale pages/locators and retry idempotency without duplicate effects.
- RD004–RD008 have broken fixtures, correct controls and deterministic evidence.

Phase B gate is complete. Implementation/local acceptance, external Actual/TodoMVC regression scans and the hosted Ubuntu/Windows/macOS matrix are green.

## Phase C — evidence, snapshot and persistence semantics

Contributes evidence to: §12–17, detector groups B–D. `PRODUCT_STATUS.md` remains authoritative; automatic provider linkage and value-free, exact provider-aware replay requirements now share the same evidence contract.

Gate:

- Snapshot schema covers redacted DOM, cookies, storage, IndexedDB, network, console, WebSocket, downloads and optional adapter evidence.
- Hard reload, new tab, clean context, logout/login, app restart, API read-back, database/provider and cross-user strategies are orchestrated consistently.
- Every persistence scope and verdict has an executable fixture/control and stable report schema.
- Verdict priority and Levels 0–7 are uniform across scan, contract, replay, baseline and report engines.
- Remaining persistence/CRUD/success-integrity detectors in groups B–D are gated.

Phase C gate is complete. Browser evidence covers semantic DOM/cookie/IndexedDB/WebSocket capture, every runtime persistence scope, API and managed-restart read-back, contract hard-reload/new-tab/clean-context/logout-login strategies, and RD103–RD105/RD204–RD205/RD304–RD305. Actual Budget and the intentional TodoMVC defect copy show no Phase C regression, and the hosted Ubuntu/Windows/macOS matrix is green.

## Phase D — auth, authorization, file, provider and regression detectors

Contributes evidence to: §18 groups E–J, §24.

Gate:

- RD401–RD905 are implemented only with observable evidence, broken fixtures and correct controls.
- Multi-role verification covers UI, API, direct routes, cross-tenant access, revocation and session invalidation.
- File/export/payment/provider findings require content or provider proof rather than UI claims.
- Expected changes and regressions are first-class verdict/report outcomes.

Phase D gate is complete. The browser detector lab gates RD401–RD505 and RD701–RD805 with correct controls, upload/download content evidence and zero false positives; contract verification gates the RD601–RD605 Level 7 authorization matrix; behavioral diff emits RD901–RD905 and first-class expected/regression outcomes. Actual Budget and the intentional TodoMVC defect copy show no Phase D regression, and the hosted Ubuntu/Windows/macOS matrix is green.

## Phase E — behavior contracts, replay and report completeness

Contributes evidence to: §19–21, §26.

Gate:

- Recorder and semantic resolver cover complex flows without coordinate-only or fragile-selector contracts.
- Replay returns every normative reproduction outcome and separates environment change from product change.
- Report artifact layout and timelines cover every evidence type and finding class.
- Benchmark exposes and gates truncation, expectation coverage, cleanup success and environment validity in addition to correctness metrics.

Phase E gate is complete. A real-browser complex flow records and verifies upload, rich text, keypress, popup, non-empty download and semantic drag/drop; fresh browser executions produce all five normative replay outcomes; reports write and link every Phase E artifact class; benchmark cleanup is executed and gated. Chromium/Firefox/WebKit pass, Actual Budget and the intentional TodoMVC defect copy show no regression, and a fresh Conduit SQLite login records 5 semantic steps/20 masked rrweb events, verifies with trace, and passes its generated Playwright spec. Hosted run `29914326977` passed PostgreSQL 17, package/audit gates, Node 20/22, all three engines, and Ubuntu/Windows/macOS for Phase E head `aa5d673`.

## Phase F — source-of-truth and provider ecosystem

Contributes evidence to: §22–23 and the adapter-related safety requirements in §25. Multi-role §24 evidence belongs to Phase D; overall area status remains governed only by `PRODUCT_STATUS.md`.

Gate:

- PostgreSQL remains the production-like reference adapter; zero-setup SQLite plus Prisma, Supabase, Firebase, MongoDB and custom adapter contracts pass integration fixtures.
- Stripe test mode, email test inboxes, S3/Supabase Storage, OAuth and custom providers have maintained sandboxed adapters.
- Read-only defaults, TLS, parameterization, secret redaction, production guards and cleanup ledgers pass security tests.
- Plugin SDK compatibility and isolation are versioned and documented with real example plugins.

Phase F gate is complete. SQLite, Supabase, Firebase, MongoDB, PostgreSQL and Prisma/custom source contracts cover verification, schema/primary-key/soft-delete discovery, value-free snapshots/diff and confirmed cleanup; all seven maintained provider adapters and production guards pass integration tests. The full browser workflow passed in Chromium and the Chromium/Firefox/WebKit matrix with source/provider Level 6, plugin and built-in adapters, multi-role Level 7, trace/video, baseline/CI, replay and agent verification. A pinned Conduit run performed a real login, confirmed the user in its live SQLite `Users` table at Level 6, wrote a trace, found no password in artifacts, and removed the disposable user by primary key. Hosted run `29920539004` passed PostgreSQL 17, MongoDB 8, package/audit gates, Node 20/22, all three engines, and Ubuntu/Windows/macOS for Phase F head `aee3330`.

## Phase G — coding-agent and full-product qualification (complete)

Contributes evidence to: §4.6, §27–32. This is the only phase gate allowed to close §32, and only after every `PRODUCT_STATUS.md` row is `IMPLEMENTED`.

Gate:

- MCP tools are validated from at least one authenticated coding agent on a real project; the released qualification uses Codex, while Claude/generic clients remain optional protocol-compatible integrations and orchestration fallbacks.
- External case studies cover backend CRUD, PostgreSQL, Supabase, auth, upload, export, multi-role, AI-generated apps and multi-step flows.
- Incremental selection, snapshot deduplication, trace-on-failure, bounded workers and timeout behavior meet published budgets.
- All 15 release gates in §29 are executable and green on Windows, macOS and Linux.
- Every row in `PRODUCT_STATUS.md` is `IMPLEMENTED`; only then may RealDone be called a completed full product.

Phase G is complete. The authenticated Codex baseline → selected RD901 regression → unchanged-contract repair cycle is validator-parsed, and fingerprint `1f88dd858…` binds current raw evidence across TodoMVC, Actual Budget, Conduit/SQLite, Conduit/PostgreSQL 17 + Supabase Data API, and Codex-generated Pocket Ledger. Hosted run [`29958126604`](https://github.com/datzle123/RealDone/actions/runs/29958126604) passed the Windows/macOS/Linux, Node 20/22, PostgreSQL 17, MongoDB 8, browser, package and all 15 normative gates; `gh attestation verify` confirmed GitHub-signed provenance for the aggregate.

## Phase H — universal first-run runtime discovery (release candidate)

Contributes evidence to: §4.1, §6, §31–32.

Gate:

- Node `dev`/`start` projects work without a lockfile or explicit package-manager metadata.
- Metadata-free static HTML is served by a confined packaged runtime and scanned with one command.
- Conventional Python, PHP, Ruby, .NET, Spring Boot, Deno, Go and Rust projects receive deterministic managed-runtime commands and ports without evaluating guessed source fragments.
- The packed npm artifact starts, scans and cleans up a project through its installed CLI, not through repository source.
- Custom runtimes fail with an actionable URL/Docker path; the public claim remains that every HTTP web app can use the verifier, not that every private build command can be guessed.

Phase H is complete. The final local batch passed 129/129 executed tests, audit, browser smoke, packing, and installed-tarball scans of both a metadata-free static project and an npm project without lockfile/package-manager metadata; both managed runtimes were confirmed stopped. Hosted run [`29977292441`](https://github.com/datzle123/RealDone/actions/runs/29977292441) then passed Linux, Windows and macOS on Node 20/22, the package scan/cleanup gate, and all 15 normative release gates. `gh attestation verify` confirmed GitHub-signed provenance for source commit `ab902acdfb95463c82a7c842f5b497a68d8c325a`.

## Phase I — coverage-balanced quick-scan scheduling (complete)

Contributes evidence to: §4.1, §8–11, §29–31.

Gate:

- A finite action budget cannot be consumed solely by discovery/DOM order on one control-heavy route.
- Selection deterministically maximizes route, action-kind, intent and activation-path coverage while preserving destructive/session-ending ordering.
- Actions already denied by policy or environment checks do not starve runnable actions.
- JSON/HTML reports expose eligible, selected, omitted, represented-route, semantic coverage, denial counts and strategy version without breaking schema `1.0` consumers.
- Broken/control unit coverage and a real-browser three-route budget fixture pass with typecheck, audit, browser smoke and package gates.

Phase I is complete for fingerprint `f3f65840…`: typecheck/unit/build passed 140 tests with 2 expected service-dependent skips, dependency audit reported no known vulnerabilities, full Chromium smoke passed the real three-route budget control, and pack plus installed-tarball package smoke passed. Fresh SHA-256-bound runs cover TodoMVC, Actual Budget, Conduit/SQLite, Conduit/PostgreSQL 17 + Supabase Data API, PostgreSQL CRUD cleanup, Level 7 roles, and a Codex MCP baseline → RD901 regression → repair cycle. Hosted main run [`30195945498`](https://github.com/datzle123/RealDone/actions/runs/30195945498) passed all 15 gates across Linux, macOS and Windows, Node 20/22, PostgreSQL 17, MongoDB 8 and installed-package smoke. GitHub signed the aggregate evidence and gate report, and `gh attestation verify` accepted both artifacts.

## Phase J — secret-safe trace retention (complete)

Contributes evidence to: §12–13, §21, §25, §29–30.

Gate:

- Every automatic-scan and contract/MCP trace is inspected immediately after Playwright closes the ZIP and before any report links it.
- Exact sensitive values already known to the browser/contract—including opaque Playwright auth-state cookies/tokens—and generic private-key/token/sensitive-field patterns are checked without persisting or reporting those values.
- Secret-bearing, invalid, oversized, or over-expanded trace ZIPs are deleted fail-closed; reports contain only additive value-free suppression metadata.
- A real-browser sensitive-field broken case loses its trace, a non-sensitive trace control remains available, invalid/limit unit controls fail closed, and the final aggregate artifact secret scan remains green.
- Typecheck, unit, browser, audit, package, schema, cleanup and hosted cross-platform release gates pass without weakening RG14.

Fingerprint `0b39d542…` passed the local type/unit/build, audit, full Chromium and installed-tarball gates. Fresh pinned runs cover TodoMVC, Actual Budget, Conduit SQLite, Conduit PostgreSQL 17 + Supabase Data API, PostgreSQL create/update/delete cleanup, Pocket Ledger Level 7 and a new Codex MCP baseline → RD901 → repair cycle. Hosted PR run `30199694271` passed all 15 gates after one transient Windows runner startup retry. Main run [`30200299159`](https://github.com/datzle123/RealDone/actions/runs/30200299159) repeated 15/15 across Linux, macOS and Windows for merge `6d736d5`; GitHub signed the aggregate evidence and gate report, and `gh attestation verify` accepted both artifacts.

## Phase K — private visual retention (complete)

Contributes evidence to: §12–13, §21, §25, §29–30.

Gate:

- Automatic actions with known sensitive fields never create standalone/trace screenshots or video files; auth-state scans suppress the same binary artifacts before capture.
- Contract contexts with `secretEnv` or configured auth state never start trace screenshot or video recording, including role, matrix, baseline, CI and MCP entry points that share the verifier.
- JSON/HTML reports expose only additive artifact/reason suppression metadata with no values, fingerprints, selectors or rejected paths.
- Unauthenticated non-sensitive automatic and contract controls still retain screenshot/video evidence.
- Typecheck, unit, real-browser, audit, package, schema, cleanup, fresh real-project and hosted 15/15 gates pass without weakening RG14.

Fingerprint `4625a9cc…` has fresh repository-bound TodoMVC, Actual Budget, Conduit SQLite, Conduit PostgreSQL 17 + Supabase Data API, PostgreSQL CRUD and Pocket Ledger runs. Pocket Ledger verified 6/6 visible actions, Level 7 roles, authenticated visual suppression and a real Codex MCP baseline → RD901 regression → repair cycle. Local check (142 pass, 2 expected service-dependent skips), audit, full Chromium smoke, pack and installed-tarball smoke passed. PR run `30202575079` and main run [`30203185815`](https://github.com/datzle123/RealDone/actions/runs/30203185815) passed 15/15 across Linux, macOS and Windows; Windows Node 22 required one managed-runtime startup retry in both runs. GitHub signed the main aggregate for merge `ca9e9db`, and `gh attestation verify` accepted both artifacts.
