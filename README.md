# RealDone

![RealDone — Your app looks done. Prove it works.](.github/assets/realdone-hero.svg)

**Prove that a web app works — in a real browser, with real evidence.**

[![CI](https://github.com/datzle123/RealDone/actions/workflows/ci.yml/badge.svg)](https://github.com/datzle123/RealDone/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/realdone.svg)](https://www.npmjs.com/package/realdone)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node 20 & 22](https://img.shields.io/badge/node-20%20%7C%2022-43853d.svg)](docs/COMPATIBILITY.md)

**RealDone answers one question: does the feature a user can see actually work?**

It opens your app in a real browser, discovers visible actions, performs the safe ones, reloads or reads back the result, and saves evidence that can be replayed.

It does **not** score visual design or trust a button, TODO, mock response, HTTP `200`, success toast, or coding-agent claim by itself.

| The app appears to… | RealDone checks… |
| --- | --- |
| save a record | whether it survives reload or exists in the source of truth |
| enforce a role | whether another role, direct route, and API are actually denied |
| upload or export | whether real non-empty bytes were transferred |
| complete an AI coding task | whether existing behavior regressed after the change |

```text
Open app → find actions → perform action → observe network/UI/storage
         → reload/read back → classify result → save evidence + replay
```

## Try it

Run this inside any web project—no test files, account, AI, or cloud service required:

```bash
npx realdone scan
```

Chromium is downloaded automatically on the first scan if it is missing.

Before operating a project, the interactive CLI asks once whether it is disposable local/staging data; non-interactive automation must pass `--yes` explicitly. External and destructive actions still require their separate flags.

If the app is already running, pass its URL:

```bash
npx realdone scan http://localhost:3000
```

RealDone prints the path to a local HTML report:

![RealDone evidence report](docs/assets/report-preview.png)

## Three ways to use it

### 1. Scan an app

```bash
npx realdone scan
```

Best for a quick first check. Default mode uses one Chromium worker, safe actions only, no AI, no account, and no database credential.

### 2. Record and verify an important flow

```bash
npx realdone record http://localhost:3000 --name "Create customer"
npx realdone verify .realdone/flows/create-customer.json
```

Use this for login, checkout, CRUD, upload, export, or multi-step flows. The recorder stores semantic locators and masked rrweb evidence; deterministic verification uses the versioned RealDone contract.

### 3. Let a coding agent call RealDone

```bash
npx realdone mcp --project ../my-app --allow-project-actions
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

RealDone `v1.3.1` meets the full normative product specification with executable evidence.

- Current fingerprint `1f88dd858…` passed all 15 normative gates on Windows, macOS, and Linux in [the final v1.3.0 run](https://github.com/datzle123/RealDone/actions/runs/29958920559).
- All 22 normative product areas and all 58 detector classes are `IMPLEMENTED` and executable-gated.
- GitHub signed the hosted release evidence; the authenticated Codex regression/repair cycle and all nine external capability classes are SHA-256-bound and validator-parsed.
- [`realdone`](https://www.npmjs.com/package/realdone) is published on npm and the registry-installed `npx realdone scan` path is smoke-verified.

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
