# RealDone benchmark fixtures

The fixture app pairs known failures with correct controls. It is intentionally dependency-free so scanner changes are not hidden behind a framework.

| Route | Expected behavior |
| --- | --- |
| `/fake-create` | RD101 + RD201 |
| `/fake-update` | RD101 + RD202 |
| `/real-create` | VERIFIED at persistence level |
| `/success-despite-failure` | RD001 + RD302 |
| `/duplicate-submit` | RD003 |
| `/fake-delete` | RD203 when destructive actions are explicitly enabled |
| `/no-effect` | RD002 |
| `/selector-shift` | VERIFIED through semantic role/name after the CSS path changes |
| `/missing` | RD001 broken navigation |

Run with `pnpm fixture`, then scan the printed URL. `pnpm smoke` builds RealDone, starts the fixture on an ephemeral local port, runs a real browser benchmark, verifies a replay sample and cleanup, and shuts the fixture down.

```bash
realdone benchmark http://127.0.0.1:<port> \
  --expected benchmarks/fixture-app/expected.json \
  --allow-destructive \
  --verify-replays
```
