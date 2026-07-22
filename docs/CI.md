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
      - uses: datzle123/RealDone@v1.3.0
        with:
          baseline: .realdone/baseline.json
          contracts: .realdone/flows
          allow-host: staging.example.test
          postgres-config: .realdone/postgres.json
          sqlite: ./data/application.sqlite
          database-configs: |
            .realdone/supabase.json
          provider-configs: |
            .realdone/providers.json
          browser: chromium
          role-states: |
            support=.realdone/auth/support.json
          plugins: |
            .realdone/plugins/test-inbox/realdone.plugin.json
          performance-budget: .realdone/performance.json
          deep: "true"
```

Provide database/provider credentials and optional CA material as masked workflow environment secrets named by the adapter configs. Action inputs contain only SQLite/config/plugin paths. When `GITHUB_STEP_SUMMARY` is available, RealDone writes a compact contract/result table to the pull request job summary.

The action accepts one `browser` per job (`chromium`, `firefox`, or `webkit`). Use a job matrix when every engine must gate a pull request. `database-configs`, `provider-configs`, `role-states`, and `plugins` are newline-separated; secret values remain in environment variables or Playwright auth-state files rather than action inputs. Set `install-browser: "false"` only when the selected Playwright browser is already installed.

`deep`, `trace`, and `video` are separate boolean inputs. Deep verification increases browser-context count; traces and videos can be large and may contain private application content, so enable them selectively.

## Playwright export

```bash
realdone export-playwright .realdone/flows/create-customer.json \
  --out tests/create-customer.spec.ts
```

Exported specs import `@playwright/test`; install it in the project that executes the generated test. RealDone's own release gate runs an exported external-project flow with the matching Playwright test runner.

Exported tests use user-facing locators where possible and preserve request/status, URL, text, persistence, and secret-environment expectations. Level 6 source assertions remain in the RealDone contract and are emitted as comments because a plain Playwright test has no source-adapter policy.

## Hosted release provenance

Aggregation rejects platform attestations from mixed source revisions and duplicate external case/evidence identities.

After the Linux, Windows, and macOS jobs pass, the `normative release gates (15/15)` job merges their attestations with repository-bound external-case evidence and evaluates all 15 specification gates. Gate 15 requires passing evidence for all nine §27 classes: backend CRUD, PostgreSQL, Supabase, authentication, upload, export, multi-role, AI-generated apps, and multi-step flows. The validator parses the cited raw scans and SHA-256-bound artifacts for source-confirmed CRUD, database-adapter mutations, persistent authentication, real upload/download bytes, Level 7 roles, multi-step contracts, and the agent cycle; an assertion label alone never qualifies. The merge also scans every committed `release/evidence` artifact for secrets and folds the result into RG14.

For coding-agent qualification, the evidence validator additionally parses a bound Codex session projection, green baseline, selected RD901 regression, failed browser verification, and repaired zero-regression run. Contract hashes must remain unchanged across the cycle.

After the aggregate succeeds on a push to `main`, GitHub Actions creates a signed artifact attestation for the merged `release-evidence.json` and `release-gates.json` files before uploading them.

Download those two files from the workflow run and verify either one with:

```bash
gh attestation verify release-gates.json --repo datzle123/RealDone
```

A local file, maintainer statement, or skipped aggregate job is not hosted release qualification.
