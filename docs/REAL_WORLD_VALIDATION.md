# Real-world validation

RealDone release gates include deterministic fixtures, but fixtures alone can hide assumptions in discovery and execution. This validation uses pinned external applications, records environment-only setup changes separately from defect injection, and publishes both RealDone limitations and final reproducible evidence.

## Target matrix

| Repository/application | Pinned commit | License | Scale on 2026-07-22 | Purpose |
| --- | --- | --- | --- | --- |
| [tastejs/todomvc](https://github.com/tastejs/todomvc), React + TypeScript React | [`ff43b02e`](https://github.com/tastejs/todomvc/commit/ff43b02e59dfa604386bb382034b2cd07c2bcd8a) | MIT unless a subdirectory says otherwise | 28,942 stars | standalone Enter actions and browser-local vs memory-only persistence |
| [actualbudget/actual](https://github.com/actualbudget/actual), browser build | [`7325498a`](https://github.com/actualbudget/actual/commit/7325498af773d591a7bc70d5af16d3912f566654) | MIT | 27,655 stars | complex local-first UI, history-dependent state and live control values |
| [TonyMckes/conduit-realworld-example-app](https://github.com/TonyMckes/conduit-realworld-example-app) | [`5e127d85`](https://github.com/TonyMckes/conduit-realworld-example-app/commit/5e127d8569b300e0a21dc2c20ea680da4967b1aa) | MIT | 117 stars | hash-router CRUD/auth, real recorder/verify/replay/baseline/matrix/agent workflow |

TodoMVC and Actual source were not changed for their original scans. Conduit used the repository-documented SQLite option plus a three-line `storage` mapping and local `.env`; no product behavior was changed for the original scan.

## Reproduction

```bash
cd examples/react
npm ci
npm run build

# Serve the TodoMVC repository root so /learn.json and example assets resolve.
# Then, from the RealDone repository:
realdone scan http://127.0.0.1:37127/examples/react/dist/ \
  --deep \
  --trace \
  --max-pages 2 \
  --max-actions 20 \
  --max-duration 60000
```

## Observed results

The scan discovered 2 pages and 15 visible actions. Three actions were executed and twelve cross-origin documentation/source links were skipped by the default safety policy.

| Application flow | RealDone result | Evidence |
| --- | --- | --- |
| React `New Todo Input` + Enter | `EPHEMERAL` | `RD101`, `RD201`; canary appeared, then disappeared after reload |
| TypeScript React `What needs to be done?` + Enter | `BROWSER_LOCAL` | `RD102`; canary survived reload but disappeared in a fresh browser context |
| External project/documentation links | `SKIPPED` | Cross-origin navigation requires explicit `--allow-external` |

Replaying the React finding reproduced the same `EPHEMERAL` verdict and the same `RD101`/`RD201` detector set.

### Actual Budget original application

```bash
corepack yarn install --immutable
corepack yarn workspace plugins-service build
corepack yarn workspace @actual-app/web build:browser
```

The browser build was served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, as required by the project. The final deep/trace scan exited successfully with 2 pages and 10 visible actions: 6 `VERIFIED`, 1 `UNCERTAIN`, 3 policy `SKIPPED`, and zero `NO_EFFECT`, `BROKEN`, `CONTRADICTORY`, or persistence-defect findings. The remaining `UNCERTAIN` action is explicitly history-dependent and was not executed against a substitute control.

### Conduit original application and full workflow

The frontend production build and Express backend ran together on `127.0.0.1:37201`, backed by an embedded SQLite file. The final deep/trace scan exited successfully with 3 hash routes and 29 visible actions: 16 `VERIFIED`, 1 `BROWSER_LOCAL`, 1 credential-gated `UNCERTAIN`, 11 policy/idempotent `SKIPPED`, and zero `BROKEN`, `NO_EFFECT`, `CONTRADICTORY`, or `EPHEMERAL` findings.

A disposable user then drove the actual product workflow, not a mocked verifier:

| RealDone surface | External-project result |
| --- | --- |
| SDK recorder | 5 semantic steps and 20 masked rrweb events; contract/rrweb contained no raw password |
| CLI `record` | 1 navigation step and 2 rrweb events captured through the public command |
| `verify --trace --video` | passed the recorded POST `/api/users/login` status and navigation assertions |
| `replay` | reproduced the Sign up `BROWSER_LOCAL` verdict |
| `matrix` | Chromium, Firefox and WebKit all passed |
| `baseline` + `ci` | 1 passing baseline, 1 selected critical contract, 0 regressions |
| `export-playwright` | generated spec executed through Playwright: 1 test passed |
| `run generic` | baseline, external build and post-agent behavior passed; agent claim remained operational output only |
| `cleanup` | dry run completed safely; both created resources remained `manual` because the external app has no user-delete endpoint |

The first intentional-defect Conduit copy also caught an over-broad nearby-field heuristic: the unrelated `Do nothing` button inherited inputs from other forms and looked effective because RealDone itself filled them. Nearby fields are now limited to direct siblings in a single-action container; a multi-form correct control prevents that false pass.

The duplicate-write action created two SQLite rows while the cleanup ledger initially tracked only the first successful POST. Cleanup generation now emits one dependency-safe entry per created response ID, so duplicate findings do not leave the second resource behind.

### TodoMVC invalid static-root control

The intentional TodoMVC defect copy exposed a harness error: its `Demo` link opened an unbuilt TypeScript React example, while the generic SPA server returned `index.html` for missing JavaScript and CSS. The original scanner counted that navigation as application `BROKEN`. With the environment gate, the same live scan reports `ENVIRONMENT_INVALID`, four RD1001 asset/content-type findings, and marks `Demo` `SKIPPED`; the intentional `EPHEMERAL`, `CONTRADICTORY`, and `NO_EFFECT` controls remain detected and there are zero application `BROKEN` findings. This demonstrates that environment findings are separated without hiding the planted product defects.

After Phase B expanded discovery/execution, both external controls were rerun: Actual Budget remained `VALID` with 6 `VERIFIED`, 1 history-dependent `UNCERTAIN`, 3 policy `SKIPPED`, and zero defect verdicts; the TodoMVC defect copy retained exactly its planted `EPHEMERAL`, `CONTRADICTORY`, and `NO_EFFECT` outcomes while the invalid Demo target stayed environment-scoped. The broader control surface introduced no external regression.

After Phase C added hard reload, new-tab, API read-back, semantic snapshot and persistence-scope evidence, both applications were run again from their pinned builds. Actual Budget again produced 6 `VERIFIED`, 1 history-dependent `UNCERTAIN`, 3 policy `SKIPPED`, a `VALID` environment and zero application-defect verdicts. The TodoMVC defect copy produced the planted memory-only create, fake update/delete and no-effect findings, zero `BROKEN` findings, and kept all four static-root content-type failures in `ENVIRONMENT_INVALID` evidence.

After Phase D introduced mock/auth/file/payment and authorization detectors, both external controls were run again. Actual Budget remained unchanged at 6 `VERIFIED`, 1 `UNCERTAIN`, 3 `SKIPPED`, `VALID`, with no application defect. TodoMVC retained only the planted two contradictory mutations, one memory-only create and one no-effect action; its four invalid static-root findings remained environment-only and no new `BROKEN` verdict appeared.

## Product changes driven by this run

The first scan exposed that RealDone only treated forms, links, and buttons as actions. TodoMVC creates an item through a standalone input's Enter key, so RealDone initially missed the primary behavior. The runtime now:

- identifies semantically likely standalone Enter-submit inputs;
- fills them with generated canary data;
- activates them with Enter;
- applies normal reload and fresh-context persistence checks;
- preserves the activation mode in reproduction contracts;
- blocks cross-origin navigation unless explicitly authorized.

The public fixture suite contains an Enter-submit control so this real-world discovery path remains release-gated.

### Stateful target safety found on Actual Budget

The first Actual Budget run discovered a `Back` action in a history-dependent state. A fresh execution context did not contain that semantic target; the old ordinal fallback clicked a different button and reported `NO_EFFECT`. RealDone now refuses ordinal substitution, preserves resolver diagnostics, and returns `UNCERTAIN` without executing another control. A history-dependent fixture and correct control gate this behavior.

The same run showed that setting an input's live `value` property does not necessarily change visible body text or HTML attributes. State snapshots now hash redacted live control state, and URL-bearing sibling inputs allow `Connect`-style controls to be classified as external and skipped by default.

### Hash-router discovery found on Conduit

The first Conduit RealWorld run reached only the landing page because ordinary fragment normalization also removed meaningful `#/login` and `#/register` routes. It also classified the `Sign up` navigation link as a create mutation based on its label. RealDone now preserves hash-router paths and gives link navigation precedence while retaining destructive/external risk policy.

On the expanded run, self-links on the current hash route produced no change by design, and the Login form rejected generated credentials with HTTP 404. Current-route links are now skipped as idempotent navigation, while generated-credential rejection is `UNCERTAIN` and requests a disposable auth state instead of becoming an application defect.

Recording a real Conduit login flow exposed that rrweb masked the password correctly but the semantic fingerprint still used the live input value as an accessible-name fallback. Recorder fingerprints now use label/ARIA/title/placeholder/name only, secret environment names derive from stable field identity, and both contract and rrweb artifacts are gated against raw secret leakage.

Exporting that contract to Playwright exposed two separate URL semantics: navigation must preserve the `#/login` route, while the recorded `^/$` assertion intentionally targets the pathname. The exporter now keeps route hashes for `page.goto` and polls `new URL(page.url()).pathname` for contract URL assertions.
