# Functional verification matrix

This matrix maps RealDone's public behavior to an executable release gate. A feature is not marked complete merely because an API or type exists; the gate must exercise its observable result or a fail-closed boundary.

This is the matrix for the currently shipped subset. The normative complete scope and 15 full-product release gates live in [`PRODUCT_SPECIFICATION.md`](PRODUCT_SPECIFICATION.md); [`PRODUCT_STATUS.md`](PRODUCT_STATUS.md) records missing and partial areas. Passing this matrix alone must not be described as completing specification §32.

| Capability | Runtime evidence | Automated gate |
| --- | --- | --- |
| Safe browser scan | Discovers routes/actions, fills fields, executes permitted actions | fixture browser smoke |
| Project discovery and managed runtime | Detects package/runtime hints, starts, health-checks, restarts, logs and stops a target process | project/runtime unit tests plus managed-app CLI smoke |
| Environment validity | HTML, critical assets/content types, bootstrap/render, health endpoint and auth state produce separate `VALID`/`ENVIRONMENT_INVALID`/`BLOCKED` evidence | broken/static-root, delayed-bootstrap and healthy browser controls plus TodoMVC defect copy |
| External-app behavior | Enter-submit, history-dependent targets, live control state, hash routes and auth contracts run without project-specific selectors | fixtures plus pinned TodoMVC, Actual Budget and Conduit workflows |
| Core verdicts and RD001–RD305 | Broken, no-effect, duplicate, stuck loading/navigation/disabled/keyboard/discovery boundaries, memory/session/restart persistence failures, fake/partial/wrong CRUD and false/silent/redirect success | detector unit tests plus broken/correct browser fixtures |
| Dynamic and complex actions | Hover/lazy scroll, native controls, context menu, popup, download and opt-in same-origin iframe execute; upload/canvas/rich-text/drag require recording | browser benchmark fixtures and deterministic RD008 boundaries |
| Browser-local scope | Canary survives reload but disappears in a fresh context, producing `BROWSER_LOCAL` + `RD102` | deep localStorage fixture and CLI smoke |
| Snapshot and persistence scopes | Redacted semantic controls/cookies, IndexedDB stores, WebSocket frames, hard reload, new tab, session, API read-back and managed restart are recorded without raw values | browser smoke plus deterministic seven-scope tests |
| Evidence reports | HTML, scan/summary/finding/environment JSON, screenshots, network logs, cleanup ledger, reproductions | artifact existence checks in browser smoke |
| Trace and video | Portable Playwright trace ZIP and browser video linked from reports | opt-in CLI and contract smoke |
| Replay and cleanup | Finding reproduces with the same verdict; cleanup supports dry-run and confirmed idempotent execution | benchmark replay sample and cleanup smoke |
| Flow recording | Human-driven interactions become a schema-valid contract plus masked rrweb evidence | recorder browser smoke |
| Recorded verification | Semantic steps and request/status/text/persistence assertions run deterministically | contract browser smoke |
| Deep contract persistence | Versioned reload, hard-reload, new-tab, clean-context and logout/login rehydration strategies pass; provider/source and cross-role checks emit Level 6/7 scopes | deep contract smoke |
| Baseline and regression CI | Green baseline passes; intentional server regression fails | green/red regression smoke |
| PostgreSQL Level 6 | Parameterized, allowlisted, read-only verification and guarded cleanup | PostgreSQL 17 hosted integration fixture |
| Provider Level 6 | Trusted plugin observation is worker-bounded, validated, redacted, then judged by core | plugin unit and browser smoke |
| Multi-role Level 7 | A distinct authenticated context independently observes the result | cross-role browser smoke |
| Browser matrix | Same contract runs in Chromium, Firefox, and WebKit with aggregate evidence | hosted three-engine smoke |
| Coding-agent verification | Baseline, agent command, rebuild, affected flows, integrity checks, evidence-based follow-up | agent unit and end-to-end smoke |
| Performance budgets | Total time, slowest step, and memory violations fail verification | deterministic unit and browser smoke |
| Public CLI | Every release command parses; advanced options remain visible and cross-platform | CLI tests on Node 20/22 and three OS families |
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

Hosted CI additionally gates PostgreSQL 17, Chromium/Firefox/WebKit, Ubuntu/Windows/macOS, Node 20/22, package creation, and the full Chromium browser smoke on every OS family. A subset release tag is created only after the hosted run succeeds. A future full-product release also requires every gate in specification §29 and every status row to be `IMPLEMENTED`.

## Product boundaries

RealDone verifies observable behavior; it is not a visual-quality scorer, general static analyzer, complete security scanner, random-clicking AI agent, hosted dashboard, or proof that every business rule is correct. Production side effects remain blocked unless the user explicitly supplies a safe sandbox/provider and permission.
