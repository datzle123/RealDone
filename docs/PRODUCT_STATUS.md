# Product status against the normative specification

**Snapshot:** 2026-07-22
**Full product:** **CHƯA HOÀN THÀNH**

This file reports current evidence against the normative [`PRODUCT_SPECIFICATION.md`](PRODUCT_SPECIFICATION.md). It does not reduce that specification. `IMPLEMENTED` requires executable evidence; `PARTIAL` means useful code exists but the full normative behavior or release gate does not.

| Specification area | Status | Evidence currently in the repository | Remaining normative gap |
| --- | --- | --- | --- |
| §4 Quick scan | IMPLEMENTED | `scan`, browser execution, report, reload checks, fixture smoke | Broader action and environment coverage is tracked below |
| §4 Deep scan | PARTIAL | clean-context persistence, roles, PostgreSQL/provider contracts, trace/video | hard reload, new tab, logout/login, app restart, general API read-back orchestration |
| §4 Record and verify | PARTIAL | semantic contract recorder/verifier and rrweb evidence | full popup/tab/upload/download/complex-flow recording and all fingerprint fallbacks |
| §4 Baseline/regression | PARTIAL | baseline, affected-flow selection, CI diff, Playwright export | normative expected-change semantics and broader regression classes |
| §4 Coding-agent verification | PARTIAL | generic, Codex, and Claude command adapters; rebuild and affected-flow pipeline | stronger sandbox/integrity coverage and validation across real agent-driven projects |
| §6 Project Discovery/Runtime Manager | IMPLEMENTED | `init` profiles single-package/monorepo projects; managed development/production/Docker lifecycle health-checks, logs, bounded restarts and process cleanup | Framework-specific adapters may improve hints, but the normative lifecycle has executable unit and browser evidence |
| §7 Environment Health Gate | IMPLEMENTED | main/route document, critical asset/content-type, bootstrap/render, health-endpoint and auth-state checks; separate `environment.json`; broken/control fixtures and TodoMVC defect copy | Additional ecosystem-specific diagnostics may be added without changing the implemented fail-closed contract |
| §8–11 Discovery, classification, data, executor | PARTIAL | forms, buttons, links, standalone Enter-submit inputs, canaries, policy and safety | dynamic/hover/virtualized/iframe/keyboard/complex actions, richer constraint-aware data, stability/cleanup guarantees |
| §12–13 Evidence and snapshots | PARTIAL | URL, DOM, request/response, console/page error, storage metadata, screenshots, trace/video, timeline | full cookies/IndexedDB/WebSocket/download/upload/provider/database linkage and complete snapshot contract |
| §14 Persistence | PARTIAL | immediate, reload, clean context, optional PostgreSQL/plugin/cross-role confirmation | every named persistence scope and strategy, including app restart and general API read-back |
| §15–17 Verdicts and evidence hierarchy | PARTIAL | action verdicts plus first-class separate `ENVIRONMENT_INVALID`/`BLOCKED`; Levels 0–7 in selected paths | first-class `EXPECTED_CHANGE`, `REGRESSION` and consistent hierarchy across all engines |
| §18 Detector system | PARTIAL | RD001–RD003, RD101–RD102, RD201–RD203, RD301–RD303 and RD1001–RD1005 (16 of 58 catalogued detectors) | remaining visible-action, persistence, CRUD, success, mock, auth, authorization, file, provider, and regression detectors |
| §19–20 Contracts and replay | PARTIAL | versioned schemas, semantic locators, assertions, cleanup, replay with fresh evidence | all complex step types and every normative replay outcome/environment distinction |
| §21 Report | PARTIAL | HTML/JSON, evidence artifacts, findings/timelines and explicit application/environment separation | complete normative directory/artifact model plus unverified/expected/regression separation |
| §22 Database adapters | PARTIAL | PostgreSQL adapter with allowlisting, redaction, TLS and integration test | SQLite, Prisma, Supabase, Firebase, MongoDB and documented custom adapter behavior |
| §23 Provider adapters | PARTIAL | bounded plugin-host contract and storage fixture | maintained Stripe/email/S3/Supabase Storage/OAuth adapters and production-mode guards per provider |
| §24 Multi-role | PARTIAL | role storage states and Level 7 cross-role observation | API authorization, direct route, cross-tenant write/read, revocation and invalidation matrix |
| §25 Safety | PARTIAL | local/staging host policy, destructive/external opt-ins, redaction, cleanup ledger, cross-origin block | full external provider/database mutation classification and cleanup coverage |
| §26 Benchmark | PARTIAL | precision, recall, FPR, discovery, verdict/detector accuracy, replay, truncation, expectation coverage and environment validity are gated | cleanup success is not yet fed back into the benchmark artifact |
| §27 Real-world cases | PARTIAL | pinned TodoMVC, Actual Budget and SQLite-backed Conduit scans; real record/verify/replay/matrix/baseline/CI/export/agent workflow | PostgreSQL, Supabase, upload, export, deeper multi-role, AI-generated and intentional-defect case studies |
| §28–31 Engineering/release/performance/UX | PARTIAL | CI, semantic releases, license notices, dependency audit, budgets, one-command managed scan, environment gate and Windows/macOS/Linux matrix | all 15 gates are not yet executable, especially artifact-secret, schema, cleanup and external-case gates |
| §32 Full-product definition | PLANNED | several foundations are shipped and useful | every listed condition must be `IMPLEMENTED`; no release currently meets this definition |

## Truthful release wording

Existing releases are real, tested increments of RealDone. They are not proof that the full specification is complete. Release notes must name the shipped subset and link this status page whenever describing overall completeness.
