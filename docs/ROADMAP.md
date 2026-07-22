# Roadmap and phase gates

Each phase is releasable: implementation, documentation, automated tests, changelog, Git tag, and GitHub push are part of its definition of done.

## Phase 1 — Core proof (`v0.1.0`)

Goal: catch fake create/update/delete and false-success behavior with reproducible evidence.

Acceptance gate:

- CLI `scan` and `replay`.
- Chromium runtime, same-origin discovery, forms/buttons/links.
- Network, console, page, DOM, URL, storage, UI-claim evidence.
- Canary generation and refresh verification.
- RD001–RD303 core detectors.
- Local HTML/JSON report, screenshots, network logs, reproduction contracts.
- Public broken fixtures and correct controls.
- Unit/type/build/browser-smoke checks.

## Phase 2 — Reliability (`v0.2.0`)

Goal: make the same finding reproducible across ordinary UI change and repeated scans.

Acceptance gate:

- Weighted semantic element fingerprints and resolver diagnostics.
- Cleanup ledger with dependency order and idempotent cleanup.
- Bounded retry policy for transient navigation/locator/network states.
- Action classifier overrides and allow/deny policy file.
- Global/page/action scan budgets.
- Precision, recall, false-positive, reproduction, cleanup, time, memory, and selector-survival metrics.

## Phase 3 — Flow recorder (`v0.3.0`)

Goal: let a user teach a complex flow once and replay it deterministically.

Acceptance gate:

- Headed browser recorder for click/fill/check/select/navigation.
- Human-readable, schema-validated behavior contract.
- Auth storage-state capture with explicit secret warning.
- Contract assertions and cleanup steps.
- Deterministic `verify` command with per-step evidence.

## Phase 4 — Baseline and CI (`v0.4.0`)

Goal: turn verified behavior into a regression gate.

Acceptance gate:

- Versioned behavior manifest and baseline capture.
- Behavioral diff with expected change vs regression.
- CI exit policy and compact PR summary.
- Reusable GitHub Action.
- Playwright test export for recorded contracts.
- Affected-flow selection from routes/endpoints/files.

## Phase 5 — PostgreSQL adapter (`v0.5.0`)

Goal: provide Level 6 source-of-truth evidence for one ecosystem.

Acceptance gate:

- Read-only-by-default PostgreSQL adapter using parameterized values and allowlisted identifiers.
- Canary read-back with scoped table/column mapping.
- Transaction-aware cleanup ledger integration.
- Secret redaction and TLS configuration.
- Docker-based integration fixture and failure-mode tests.

## Phase 6 — Agent verification (`v0.6.0`)

Goal: verify coding-agent claims against observable application behavior.

Acceptance gate:

- Generic command adapter plus Codex and Claude Code presets.
- Baseline → agent run → rebuild → affected-flow verification pipeline.
- Changed-file/route/endpoint flow selection.
- Evidence-based follow-up fix prompts.
- Agent output is never accepted as verification evidence.

## Phase 7 — Advanced verification (`v1.0.0`)

Goal: support high-value verification without making the default scan heavy.

Acceptance gate:

- Multi-role contracts and Level 7 cross-user confirmation.
- Provider contract for payment sandbox, test inbox, and object storage.
- Chromium/Firefox/WebKit matrix.
- Stable plugin SDK and plugin isolation/timeouts.
- Threat model, compatibility matrix, performance budgets, docs site-ready content.
- Full benchmark dashboard and release hardening.
