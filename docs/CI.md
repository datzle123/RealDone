# Baseline and CI

## Capture a baseline

Record important flows, make sure the application is running, then capture a green baseline:

```bash
realdone baseline .realdone/flows --out .realdone/baseline.json
```

The manifest stores contract hashes, routes, request patterns, tags, source scopes, and compact per-step verification outcomes. Commit behavior contracts and the baseline manifest; do not commit auth state or rrweb evidence containing private application content.

## Local regression gate

```bash
realdone ci \
  --baseline .realdone/baseline.json \
  --contracts .realdone/flows
```

The gate fails only when a baseline behavior that passed now fails or disappears. A changed contract that still passes is reported as an expected change; a former failure that passes is an improvement.

Use repeated `--changed-file` flags to run only affected contracts. Contracts tagged `critical` always run. Add explicit source globs to a contract's optional scope:

```json
{
  "tags": ["critical"],
  "scope": {
    "files": ["src/app/customers/**", "src/api/customers/**"]
  }
}
```

## GitHub Action

```yaml
name: RealDone
on: [pull_request]

jobs:
  behavior:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: datzle123/RealDone@v1.2.0
        with:
          baseline: .realdone/baseline.json
          contracts: .realdone/flows
          allow-host: staging.example.test
          postgres-config: .realdone/postgres.json
          browser: chromium
          role-states: |
            support=.realdone/auth/support.json
          plugins: |
            .realdone/plugins/test-inbox/realdone.plugin.json
          performance-budget: .realdone/performance.json
          deep: "true"
```

Provide the PostgreSQL connection URL and optional CA as masked workflow environment secrets named by the adapter config. The action input contains only the config path. When `GITHUB_STEP_SUMMARY` is available, RealDone writes a compact contract/result table to the pull request job summary.

The action accepts one `browser` per job (`chromium`, `firefox`, or `webkit`). Use a job matrix when every engine must gate a pull request. `role-states` and `plugins` are newline-separated; secret values remain in environment variables or Playwright auth-state files rather than action inputs. Set `install-browser: "false"` only when the selected Playwright browser is already installed.

`deep`, `trace`, and `video` are separate boolean inputs. Deep verification increases browser-context count; traces and videos can be large and may contain private application content, so enable them selectively.

## Playwright export

```bash
realdone export-playwright .realdone/flows/create-customer.json \
  --out tests/create-customer.spec.ts
```

Exported specs import `@playwright/test`; install it in the project that executes the generated test. RealDone's own release gate runs an exported external-project flow with the matching Playwright test runner.

Exported tests use user-facing locators where possible and preserve request/status, URL, text, persistence, and secret-environment expectations. Level 6 source assertions remain in the RealDone contract and are emitted as comments because a plain Playwright test has no source-adapter policy.
