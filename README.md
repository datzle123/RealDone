# RealDone

**Prove that a web app works — in a real browser, with real evidence.**

[![CI](https://github.com/datzle123/RealDone/actions/workflows/ci.yml/badge.svg)](https://github.com/datzle123/RealDone/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node 20 & 22](https://img.shields.io/badge/node-20%20%7C%2022-43853d.svg)](docs/COMPATIBILITY.md)

RealDone opens your app in Chromium, Firefox, or WebKit, finds what a user can do, performs safe actions, reloads the app, and checks the actual result.

It does **not** score visual design. It does **not** call a feature complete because the source contains a button, TODO, mock response, or success toast.

Typical findings: a dead button, a false success message, data that disappears after reload, unauthorized access, or a broken upload.

```text
Open app → find actions → perform action → observe network/UI/storage
         → reload/read back → classify result → save evidence + replay
```

## Try it

RealDone is currently installed from source; the npm package is not published yet.

```bash
git clone https://github.com/datzle123/RealDone.git
cd RealDone
corepack enable
pnpm install
pnpm build
```

Chromium is downloaded automatically on the first scan if it is missing.

Before operating a project, the interactive CLI asks once whether it is disposable local/staging data; non-interactive automation must pass `--yes` explicitly. External and destructive actions still require their separate flags.

Start the web app you want to check, then run:

```bash
pnpm realdone scan http://localhost:3000
```

RealDone prints the path to a local HTML report:

![RealDone evidence report](docs/assets/report-preview.png)

## Three ways to use it

### 1. Scan an app

```bash
pnpm realdone scan http://localhost:3000
```

Best for a quick first check. Default mode uses one Chromium worker, safe actions only, no AI, no account, and no database credential.

### 2. Record and verify an important flow

```bash
pnpm realdone record http://localhost:3000 --name "Create customer"
pnpm realdone verify .realdone/flows/create-customer.json
```

Use this for login, checkout, CRUD, upload, export, or multi-step flows. The recorder stores semantic locators and masked rrweb evidence; deterministic verification uses the versioned RealDone contract.

### 3. Let a coding agent call RealDone

```bash
pnpm realdone mcp --project ../my-app --allow-project-actions
```

The local MCP server lets Codex, Claude, or another AI call scan, baseline, verify-change, replay, and report tools directly. `--allow-project-actions` is the user's one-time consent for that MCP project session; it does not enable external or destructive actions. RealDone still decides pass/fail from independent browser evidence. See [MCP integration](docs/MCP.md).

## What it can verify

| Surface | Evidence |
| --- | --- |
| Browser behavior | UI state, URL, requests/responses, console, storage, reload |
| Persistence | memory, tab, session, browser-local, backend, source of truth |
| Complex flows | keyboard, upload, rich text, drag/drop, popup, download |
| Regression | baseline, affected-flow selection, expected change vs regression |
| Authorization | named roles, direct API/routes, cross-user and revoked-role probes |
| Databases | SQLite, PostgreSQL, Supabase, Firebase, MongoDB, Prisma/custom |
| Providers | Stripe test mode, Resend, SendGrid, Mailgun, S3, Supabase Storage, OAuth |
| Browsers/OS | Chromium, Firefox, WebKit; Windows, macOS, Linux |

Database, provider, multi-role, trace, video, and multi-browser checks are optional. The quick scan stays small.

## Safe by default

- Mutations run automatically only on localhost, `.test`, `.local`, or an explicit staging host.
- Destructive and external-effect actions require explicit opt-in; live form targets are rechecked immediately before execution.
- Stripe live keys are rejected; remote provider/database access is fail-closed by default.
- Credentials come from environment variables and are redacted from evidence.
- Cleanup is a dry run unless separately confirmed.

Review policies before testing any environment with real users or money.

## Current status

RealDone `v1.3.0` meets the full normative product specification with executable evidence.

- Current fingerprint `1f88dd858…` passed all 15 normative gates on Windows, macOS, and Linux in [run 29958126604](https://github.com/datzle123/RealDone/actions/runs/29958126604).
- All 22 normative product areas and all 58 detector classes are `IMPLEMENTED` and executable-gated.
- GitHub signed the hosted release evidence; the authenticated Codex regression/repair cycle and all nine external capability classes are SHA-256-bound and validator-parsed.

[`PRODUCT_STATUS.md`](docs/PRODUCT_STATUS.md) is the only area-completeness ledger. [`PRODUCT_SPECIFICATION.md`](docs/PRODUCT_SPECIFICATION.md) is the full source of truth. A completed roadmap phase is not the same as a completed full product.

## Documentation

- [Start and advanced verification](docs/ADVANCED.md)
- [Record and verify flows](docs/CONTRACTS.md)
- [Database adapters](docs/DATABASE_ADAPTERS.md)
- [Provider adapters and plugins](docs/PROVIDERS.md)
- [CI and GitHub Action](docs/CI.md)
- [MCP integration for coding agents](docs/MCP.md)
- [Architecture and threat model](docs/ARCHITECTURE.md)
- [Evidence-based product status](docs/PRODUCT_STATUS.md)

## Contributing

Detector changes need an intentionally broken case, a correct control, and observable evidence. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

MIT licensed. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
