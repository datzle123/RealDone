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
| §6 Project Discovery/Runtime Manager | PLANNED | browser runtime can connect to a supplied URL | `init`, framework/package-manager/port/auth/database discovery, app lifecycle and health management |
| §7 Environment Health Gate | PLANNED | individual browser/runtime errors are observed | first-class `ENVIRONMENT_INVALID`/`BLOCKED`, asset/bootstrap/static-root validation, exclusion from app-defect metrics |
| §8–11 Discovery, classification, data, executor | PARTIAL | forms, buttons, links, standalone Enter-submit inputs, canaries, policy and safety | dynamic/hover/virtualized/iframe/keyboard/complex actions, richer constraint-aware data, stability/cleanup guarantees |
| §12–13 Evidence and snapshots | PARTIAL | URL, DOM, request/response, console/page error, storage metadata, screenshots, trace/video, timeline | full cookies/IndexedDB/WebSocket/download/upload/provider/database linkage and complete snapshot contract |
| §14 Persistence | PARTIAL | immediate, reload, clean context, optional PostgreSQL/plugin/cross-role confirmation | every named persistence scope and strategy, including app restart and general API read-back |
| §15–17 Verdicts and evidence hierarchy | PARTIAL | `VERIFIED`, `CONTRADICTORY`, `EPHEMERAL`, `BROWSER_LOCAL`, `BROKEN`, `NO_EFFECT`, `UNCERTAIN`, `SKIPPED`; Levels 0–7 in selected paths | first-class `EXPECTED_CHANGE`, `REGRESSION`, `ENVIRONMENT_INVALID` and consistent hierarchy across all engines |
| §18 Detector system | PARTIAL | RD001–RD003, RD101–RD102, RD201–RD203, RD301–RD303 (11 of 58 catalogued detectors) | remaining visible-action, persistence, CRUD, success, mock, auth, authorization, file, provider, regression, and environment detectors |
| §19–20 Contracts and replay | PARTIAL | versioned schemas, semantic locators, assertions, cleanup, replay with fresh evidence | all complex step types and every normative replay outcome/environment distinction |
| §21 Report | PARTIAL | HTML/JSON, evidence artifacts, findings and timelines | complete normative directory/artifact model and explicit app/environment/skipped/unverified/expected/regression separation |
| §22 Database adapters | PARTIAL | PostgreSQL adapter with allowlisting, redaction, TLS and integration test | SQLite, Prisma, Supabase, Firebase, MongoDB and documented custom adapter behavior |
| §23 Provider adapters | PARTIAL | bounded plugin-host contract and storage fixture | maintained Stripe/email/S3/Supabase Storage/OAuth adapters and production-mode guards per provider |
| §24 Multi-role | PARTIAL | role storage states and Level 7 cross-role observation | API authorization, direct route, cross-tenant write/read, revocation and invalidation matrix |
| §25 Safety | PARTIAL | local/staging host policy, destructive/external opt-ins, redaction, cleanup ledger, cross-origin block | full external provider/database mutation classification and cleanup coverage |
| §26 Benchmark | PARTIAL | precision, recall, FPR, discovery, verdict/detector accuracy, replay and operational metrics | explicit truncation, expectation coverage, cleanup success and environment validity as first-class gated metrics |
| §27 Real-world cases | PARTIAL | reproducible TodoMVC scan/replay at a pinned MIT commit | backend CRUD, PostgreSQL, Supabase, auth, upload, export, multi-role, AI-generated and multi-step case studies |
| §28–31 Engineering/release/performance/UX | PARTIAL | CI, semantic releases, license notices, dependency audit, budgets, one-command scan, Windows/macOS/Linux matrix | all 15 gates are not yet executable, especially environment, artifact secret, schema, cleanup and external-case gates |
| §32 Full-product definition | PLANNED | several foundations are shipped and useful | every listed condition must be `IMPLEMENTED`; no release currently meets this definition |

## Truthful release wording

Existing releases are real, tested increments of RealDone. They are not proof that the full specification is complete. Release notes must name the shipped subset and link this status page whenever describing overall completeness.
