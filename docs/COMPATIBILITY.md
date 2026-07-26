# Compatibility matrix

`v1.3.3` passed the matrix below in hosted run [`30189340006`](https://github.com/datzle123/RealDone/actions/runs/30189340006), including installed-tarball scan/cleanup gates for metadata-free static and npm projects. GitHub signed the 15/15 aggregate for source commit `b682da329fde789f2f8aa6fe339b0195887c778d`.

Unreleased main fingerprint `f3f65840…` preserved the same matrix and package path in hosted run [`30195945498`](https://github.com/datzle123/RealDone/actions/runs/30195945498). All 15 gates passed on Linux, Windows and macOS with Node 20/22, and GitHub signed the aggregate evidence and gate report for merge commit `2572aba57edf418f87750352ed3b3d36868015ac`.

| Surface | Release gate |
| --- | --- |
| Node.js | 20 and 22 |
| Operating systems | Ubuntu, Windows, macOS |
| Browsers | Playwright Chromium, Firefox, WebKit |
| PostgreSQL adapter | PostgreSQL 17 service in CI |
| Local/remote source adapters | SQLite on every OS; Supabase/Firebase local REST fixtures; MongoDB 8 service with the official driver; Prisma/custom plugin bridge |
| Provider adapters | Stripe-test, Resend, SendGrid, Mailgun, S3, Supabase Storage and OAuth bounded protocol fixtures |
| Package managers | pnpm 10 for repository development; managed targets discovered for npm, pnpm, Yarn and Bun; npm-compatible published package |
| Module format | Node ESM with generated declarations and source maps |

The Ubuntu full gate runs PostgreSQL integration, all three browser engines, browser/agent/provider smoke, managed-runtime/environment fixtures, dependency audit, and package creation. Windows and macOS run typecheck, unit/failure-mode tests, production build, managed-runtime/environment smoke, Chromium installation, and the complete single-browser smoke on Node 20/22.

Chromium accepts a custom executable through `--browser-path`. Firefox and WebKit use Playwright-managed binaries so RealDone does not accidentally launch an incompatible system browser.

The requested Playwright browser is downloaded automatically on first use when it is missing. Set `REALDONE_SKIP_BROWSER_INSTALL=1` to disable bootstrap and install browsers manually.

Codex and Claude Code integrations are command presets, not embedded SDKs. RealDone verifies the current documented non-interactive argument contracts; installed agent authentication and provider availability remain the user's responsibility.

## Unreleased report compatibility

Coverage-balanced action selection adds an optional `completeness.selection` object to `scan.json`. Existing `schemaVersion: "1.0"` fields and meanings are unchanged, old reports remain readable, and validators use passthrough/additive compatibility. Consumers may ignore the new telemetry or use it to distinguish discovered, selected, omitted, and route-represented action coverage.
