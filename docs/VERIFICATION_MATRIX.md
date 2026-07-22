# Functional verification matrix

This matrix maps RealDone's public behavior to an executable release gate. A feature is not marked complete merely because an API or type exists; the gate must exercise its observable result or a fail-closed boundary.

| Capability | Runtime evidence | Automated gate |
| --- | --- | --- |
| Safe browser scan | Discovers routes/actions, fills fields, executes permitted actions | fixture browser smoke |
| Core verdicts and RD001–RD303 | Broken, no-effect, duplicate, refresh/new-session disappearance, fake CRUD, false/silent success | detector unit tests plus broken/correct fixtures |
| Browser-local scope | Canary survives reload but disappears in a fresh context, producing `BROWSER_LOCAL` + `RD102` | deep localStorage fixture and CLI smoke |
| Evidence reports | HTML, scan/summary/finding JSON, screenshots, network logs, cleanup ledger, reproductions | artifact existence checks in browser smoke |
| Trace and video | Portable Playwright trace ZIP and browser video linked from reports | opt-in CLI and contract smoke |
| Replay and cleanup | Finding reproduces with the same verdict; cleanup supports dry-run and confirmed idempotent execution | benchmark replay sample and cleanup smoke |
| Flow recording | Human-driven interactions become a schema-valid contract plus masked rrweb evidence | recorder browser smoke |
| Recorded verification | Semantic steps and request/status/text/persistence assertions run deterministically | contract browser smoke |
| Deep contract persistence | Explicit persistence passes after reload and in a fresh authenticated context | deep contract smoke |
| Baseline and regression CI | Green baseline passes; intentional server regression fails | green/red regression smoke |
| PostgreSQL Level 6 | Parameterized, allowlisted, read-only verification and guarded cleanup | PostgreSQL 17 hosted integration fixture |
| Provider Level 6 | Trusted plugin observation is worker-bounded, validated, redacted, then judged by core | plugin unit and browser smoke |
| Multi-role Level 7 | A distinct authenticated context independently observes the result | cross-role browser smoke |
| Browser matrix | Same contract runs in Chromium, Firefox, and WebKit with aggregate evidence | hosted three-engine smoke |
| Coding-agent verification | Baseline, agent command, rebuild, affected flows, integrity checks, evidence-based follow-up | agent unit and end-to-end smoke |
| Performance budgets | Total time, slowest step, and memory violations fail verification | deterministic unit and browser smoke |
| Public CLI | Every release command parses; advanced options remain visible and cross-platform | CLI tests on Node 20/22 and three OS families |
| Package and SDK | CLI, ESM entrypoint, declarations, docs, examples, and license notices ship in tarball | pack and package-import smoke |

## Release gate

Run locally:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm audit --audit-level high
pnpm exec playwright install chromium
pnpm smoke
pnpm pack
```

Hosted CI additionally gates PostgreSQL 17, Chromium/Firefox/WebKit, Ubuntu/Windows/macOS, Node 20/22, package creation, and the full Chromium browser smoke on every OS family. A release tag is created only after the hosted run succeeds.

## Product boundaries

RealDone verifies observable behavior; it is not a visual-quality scorer, general static analyzer, complete security scanner, random-clicking AI agent, hosted dashboard, or proof that every business rule is correct. Production side effects remain blocked unless the user explicitly supplies a safe sandbox/provider and permission.
