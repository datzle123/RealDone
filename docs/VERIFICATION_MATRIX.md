# Functional verification matrix

This matrix maps RealDone's public behavior to an executable release gate. A feature is not marked complete merely because an API or type exists; the gate must exercise its observable result or a fail-closed boundary.

This is the matrix for the currently shipped subset, not a product-status ledger. The normative complete scope and 15 full-product release gates live in [`PRODUCT_SPECIFICATION.md`](PRODUCT_SPECIFICATION.md); [`PRODUCT_STATUS.md`](PRODUCT_STATUS.md) is the only area-completeness ledger and records missing/partial work. Passing this matrix or a roadmap phase gate alone must not be described as completing specification §32.

| Capability | Runtime evidence | Automated gate |
| --- | --- | --- |
| Safe browser scan | Discovers routes/actions, fills fields, executes permitted actions | fixture browser smoke |
| Project discovery and managed runtime | Detects package/runtime hints, starts, health-checks, restarts, logs and stops a target process | project/runtime unit tests plus managed-app CLI smoke |
| Environment validity | HTML, critical assets/content types, bootstrap/render, health endpoint and auth state produce separate `VALID`/`ENVIRONMENT_INVALID`/`BLOCKED` evidence | broken/static-root, delayed-bootstrap and healthy browser controls plus TodoMVC defect copy |
| External-app behavior | Enter-submit, history-dependent targets, live control state, hash routes and auth contracts run without project-specific selectors; published counters must match committed raw scan artifacts | fixtures plus pinned TodoMVC, Actual Budget and Conduit workflows with SHA-256/source validation |
| Core verdicts and RD001–RD305 | Broken, no-effect, duplicate, stuck loading/navigation/disabled/keyboard/discovery boundaries, memory/session/restart persistence failures, fake/partial/wrong CRUD and false/silent/redirect success | detector unit tests plus broken/correct browser fixtures |
| Dynamic and complex actions | Hover/lazy scroll, native controls, context menu, popup, download and opt-in same-origin iframe execute; same-origin canary uploads require external opt-in while ambiguous/cross-origin upload, canvas, rich-text and drag route to recording | browser benchmark fixtures and deterministic RD008 boundaries |
| External-effect safety | CLI/MCP require one project-level action authorization; form action/method, endpoint/provider, upload/download/popup and destructive signals are classified before execution; the live target is re-read and higher risk becomes `SKIPPED`/RD008 | consent unit/MCP/CLI surface gates, classifier/policy controls, and runtime target-change browser broken/control |
| Browser-local scope | Canary survives reload but disappears in a fresh context, producing `BROWSER_LOCAL` + `RD102` | deep localStorage fixture and CLI smoke |
| Snapshot and persistence scopes | Redacted semantic controls/cookies, IndexedDB stores, WebSocket frames, hard reload, new tab, session, API read-back and managed restart are recorded without raw values | browser smoke plus deterministic seven-scope tests |
| Mock/auth/file/payment detectors | RD401–RD505 and RD701–RD805 use browser-visible state, auth metadata, upload canaries, bounded download digests and independent provider evidence | Phase D broken/control lab, Phase F provider fixtures, and automatic provider-linked Level 6 browser smoke |
| Authorization matrix | RD601–RD605 probe UI visibility, direct API/routes, cross-tenant read/write and revoked roles in isolated role contexts | broken and denied-control Level 7 contracts |
| Evidence reports | HTML, scan/summary/finding/environment JSON, screenshots, traces/videos, cleanup ledger, reproductions, and per-finding network/snapshot/console/WebSocket/upload/download/contract JSON | artifact existence and timeline checks in browser smoke |
| Trace and video | Portable Playwright trace ZIP and browser video linked from reports | opt-in CLI and contract smoke |
| Replay and cleanup | Fresh execution distinguishes reproduced, changed, environment-changed, target-missing, and uncertain outcomes; provider-backed reproductions require fresh exact causal provider proof; cleanup is idempotent and benchmark-gated | five-outcome browser smoke, provider broken/control replay, benchmark replay, and cleanup smoke |
| Flow recording | Human-driven navigation/click/fill/select/check/keypress/upload/rich-text/drag interactions become a schema-valid contract plus masked rrweb evidence | complex recorder browser smoke and real Conduit login recording |
| Recorded verification | Semantic source/target steps and request/status/text/persistence/popup/download assertions run deterministically | complex contract browser smoke and generated Playwright execution |
| Deep contract persistence | Versioned reload, hard-reload, new-tab, clean-context and logout/login rehydration strategies pass; provider/source and cross-role checks emit Level 6/7 scopes | deep contract smoke |
| Baseline and regression CI | Green baseline passes; intentional server regression fails | green/red regression smoke |
| Regression outcomes | Expected contract changes remain distinct from RD901–RD905 unexpected, removed, persistence, API and performance regressions | regression classifier unit tests plus browser baseline/red gate |
| Database Level 6 | SQLite, PostgreSQL, Supabase, Firebase, MongoDB and Prisma/custom connectors verify mapped source state; discover schema/PK/soft-delete fields; hash snapshots/diffs without persisting rows; and require confirmed key cleanup | SQLite/direct-adapter/plugin integration tests, real-browser Phase F flow, PostgreSQL 17 and MongoDB 8 hosted fixtures |
| Provider Level 6 | Maintained Stripe-test, Resend, SendGrid, Mailgun, S3, Supabase Storage and OAuth adapters plus custom plugins perform bounded read-only checks; production-like access is fail-closed | provider fixture integration, production-guard tests, and browser smoke |
| Plugin permissions | Fresh workers receive declared/referenced environment only, wrap global `fetch` with a hostname allowlist, discard output, enforce time/memory limits, validate/redact evidence, and document trusted-code residual risk | provider/source permission, timeout, schema, snapshot and cleanup tests |
| Multi-role Level 7 | A distinct authenticated context independently observes the result | cross-role browser smoke |
| Browser matrix | Same contract runs in Chromium, Firefox, and WebKit with aggregate evidence | hosted three-engine smoke |
| Coding-agent verification | Baseline, agent command, rebuild, affected flows, integrity checks, evidence-based follow-up | agent unit and end-to-end smoke |
| Performance budgets | Total time, slowest step, and memory violations fail verification | deterministic unit and browser smoke |
| Public CLI | Every release command parses; advanced options remain visible and cross-platform; a clean browser directory bootstraps Chromium on first scan and reuses it afterward | CLI tests on Node 20/22 and three OS families plus clean-tarball first-run acceptance |
| Package and SDK | CLI, ESM entrypoint, declarations, normative docs, examples, and license notices ship in tarball | `pnpm smoke:package <tarball>` after pack |

## Release gate

Run locally:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm audit --audit-level high
pnpm exec playwright install chromium
pnpm smoke
pnpm pack
pnpm smoke:package ./realdone-*.tgz
```

Hosted CI additionally gates PostgreSQL 17, Chromium/Firefox/WebKit, Ubuntu/Windows/macOS, Node 20/22, package creation, and the full Chromium browser smoke on every OS family. External gate 15 now requires bound evidence for backend CRUD, PostgreSQL, Supabase, authentication, upload, export, multi-role, AI-generated apps and multi-step flows; successful `main` aggregates are signed with GitHub artifact attestations. A release tag is created only after the hosted run succeeds and every status row is `IMPLEMENTED`.

## Product boundaries

RealDone verifies observable behavior; it is not a visual-quality scorer, general static analyzer, complete security scanner, random-clicking AI agent, hosted dashboard, or proof that every business rule is correct. Production side effects remain blocked unless the user explicitly supplies a safe sandbox/provider and permission.
