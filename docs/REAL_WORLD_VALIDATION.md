# Real-world validation

RealDone release gates include deterministic fixtures, but fixtures alone can hide assumptions in discovery and execution. This validation uses an unmodified external application and records both RealDone limitations found during the run and the final reproducible evidence.

## Target

- Repository: [tastejs/todomvc](https://github.com/tastejs/todomvc)
- Commit: [`ff43b02e59dfa604386bb382034b2cd07c2bcd8a`](https://github.com/tastejs/todomvc/commit/ff43b02e59dfa604386bb382034b2cd07c2bcd8a)
- License: MIT for repository contents unless otherwise specified
- Scale at validation time: approximately 28,900 GitHub stars
- Application: `examples/react`, production webpack build served locally from the repository root

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

## Product changes driven by this run

The first scan exposed that RealDone only treated forms, links, and buttons as actions. TodoMVC creates an item through a standalone input's Enter key, so RealDone initially missed the primary behavior. The runtime now:

- identifies semantically likely standalone Enter-submit inputs;
- fills them with generated canary data;
- activates them with Enter;
- applies normal reload and fresh-context persistence checks;
- preserves the activation mode in reproduction contracts;
- blocks cross-origin navigation unless explicitly authorized.

The public fixture suite contains an Enter-submit control so this real-world discovery path remains release-gated.
