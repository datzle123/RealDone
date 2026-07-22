<p align="center">
  <img src=".github/assets/realdone-hero.svg" alt="RealDone — Your app looks done. Prove it works." width="100%">
</p>

<p align="center">
  <strong>Runtime behavioral verification for AI-built web applications.</strong><br>
  RealDone clicks the visible action, observes what actually happens, reloads the page, and reports evidence — not vibes.
</p>

<p align="center">
  <a href="https://github.com/datzle123/RealDone/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/datzle123/RealDone/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-39d98a.svg"></a>
  <a href="https://nodejs.org"><img alt="Node 20+" src="https://img.shields.io/badge/node-%3E%3D20.16-67b7ff.svg"></a>
</p>

---

AI coding agents are very good at making a feature *look* finished: the button clicks, a spinner appears, a success toast fires, and a new row shows up. None of those things prove the feature exists beyond the current browser state.

RealDone runs your application in Chromium and builds an evidence chain:

```text
Visible action
→ Real browser execution
→ Network / console / DOM / storage evidence
→ Reload and read-back
→ Evidence-backed verdict
→ Reproducible finding
```

## Five-minute start

```bash
git clone https://github.com/datzle123/RealDone.git
cd RealDone
corepack enable
pnpm install
pnpm exec playwright install chromium
pnpm build

node dist/cli.js scan http://localhost:3000
```

Or point RealDone at an installed Chrome/Chromium:

```bash
node dist/cli.js scan http://localhost:3000 --browser-path "/path/to/chrome"
```

The result is written locally to `.realdone/reports/<scan-id>/report.html` plus machine-readable JSON and one replay contract per finding.

<p align="center"><img src="docs/assets/report-preview.png" alt="RealDone evidence report" width="100%"></p>

## What a finding looks like

```text
RD-014 · Save settings

00.00s  Opened /settings
00.82s  Filled display name: RD_TEST_8F21C4
01.03s  UI success: Saved successfully
01.03s  Write requests observed: none
02.11s  Reloaded; canary present: false

Verdict: CONTRADICTORY
Detector: RD301 — Success before proof

Reason:
The interface reported success without an observed write request.

Replay:
realdone replay RD-014 --report-dir .realdone/reports/<scan-id>
```

## Verdicts

| Verdict | Meaning |
| --- | --- |
| `VERIFIED` | Observed evidence supports the action at the reported evidence level. |
| `CONTRADICTORY` | The UI claimed success while runtime evidence disagreed. |
| `EPHEMERAL` | The result existed in the current DOM/runtime and disappeared after reload. |
| `BROWSER_LOCAL` | Persistence is limited to one browser context. |
| `BROKEN` | A request, page, console, navigation, or execution error occurred. |
| `NO_EFFECT` | No DOM, URL, network, storage, dialog, or download effect was observed. |
| `UNCERTAIN` | Something happened, but the available evidence cannot prove the intended behavior. |
| `SKIPPED` | Safety policy, credentials, scan budget, or unsupported input prevented execution. |

## Phase 1 detectors

- `RD001` broken action
- `RD002` no observable effect
- `RD003` duplicate submission
- `RD101` refresh disappearance
- `RD201` fake create
- `RD202` fake update
- `RD203` fake delete
- `RD301` success before proof
- `RD302` success despite failure
- `RD303` silent failure

RealDone deliberately prefers a small number of reproducible findings over a large number of guesses.

## CLI

```text
realdone scan <url>
  --max-pages <n>          discovery budget (default 8)
  --max-actions <n>        execution budget (default 24)
  --storage-state <file>   authenticated Playwright state
  --headed                 show Chromium
  --allow-host <hostname>  allow mutation on explicit staging
  --allow-destructive      opt in to destructive actions
  --allow-external         opt in to external effects
  --browser-path <file>    existing Chrome/Chromium executable
  --policy <file>          rules, overrides, hosts, and budgets
  --max-duration <ms>      global time budget
  --retries <n>            transient navigation/locator retries

realdone replay <finding-id> [--report-dir <scan-directory>]
realdone cleanup --report-dir <scan-directory> [--confirm]
realdone benchmark <url> --expected <expectations.json> [--verify-replays]
```

## Safe by default

Full verification is enabled automatically only for `localhost`, `127.0.0.1`, `.test`, and `.local`. Other hosts are discovery-only unless explicitly allowlisted. Payment, email, SMS, invite, upload/export, refund, account deletion, and similar effects are blocked unless the matching opt-in flag is supplied.

Reports never store authorization headers, cookie values, password values, tokens, API keys, or database URLs. Storage is represented by key names and short hashes.

## Architecture

```mermaid
flowchart LR
  CLI["CLI"] --> Runtime["Chromium runtime"]
  Runtime --> Discovery["Route + action discovery"]
  Discovery --> Policy["Safety policy"]
  Policy --> Executor["Safe action executor"]
  Executor --> Evidence["Evidence collector"]
  Evidence --> Persistence["Reload + read-back"]
  Persistence --> Detectors["Detector engine"]
  Detectors --> Reports["HTML + JSON + replay"]
```

The core is deterministic and has no AI, database, cloud, framework, or coding-agent dependency. See [Architecture](docs/ARCHITECTURE.md) for contracts and extension points.

## Reliability controls

Actions are replayed through weighted semantic fingerprints: test ID, accessible role/name, stable ID, href, visible text, CSS path, and ordinal fallback. Every attempt records match count, visible count, weight, timing, selected strategy, and bounded retries.

Use a checked-in policy when a project needs explicit classification or budget controls:

```bash
node dist/cli.js scan http://localhost:3000 --policy examples/realdone.policy.json
```

Mutations that expose a resource ID or `Location` header are added to `cleanup-ledger.json`. Cleanup is a dry run unless `--confirm` is supplied, accepts `404` as already-cleaned, and reuses optional Playwright auth state without copying secrets into the ledger.

## Public benchmark fixtures

The repository includes intentionally broken and correct controls for fake create, real persistence, false success, duplicate submission, fake deletion, no-effect actions, and broken navigation.

```bash
pnpm fixture
# In another terminal:
node dist/cli.js scan http://127.0.0.1:<printed-port> --allow-destructive
```

Run the full browser smoke test with `pnpm smoke`. It also verifies selector survival, a bounded replay sample, and cleanup. The standalone `benchmark` command writes precision/recall/FPR and operational metrics to `benchmark.json`.

## Roadmap

- ✅ **v0.1 Core proof** — scanner, evidence, persistence, report, replay, public fixtures.
- ✅ **v0.2 Reliability** — semantic fingerprints, cleanup ledger, retry/policy/budget, precision/recall harness.
- **v0.3 Flow recorder** — recorded flows, behavior contracts, auth state, deterministic replay.
- **v0.4 Baseline + CI** — behavior diff, regression gate, GitHub Action, Playwright export.
- **v0.5 PostgreSQL adapter** — source-of-truth verification and cleanup.
- **v0.6 Agent verification** — Codex/Claude adapters, affected-flow selection, fix prompts.
- **v1.0 Advanced verification** — multi-role, providers, multi-browser, plugin SDK, hardening.

Every phase has a test gate and its own release tag. Detailed acceptance criteria live in [the roadmap](docs/ROADMAP.md).

## Contributing

Start with the benchmark fixtures. A detector change should include a broken case, a correct control, an expected finding, and a false-positive guard. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) before opening a pull request.

## License

MIT. Third-party components and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
