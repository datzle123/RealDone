# Compatibility matrix

`v1.3.0` passed the matrix below in hosted run [`29958126604`](https://github.com/datzle123/RealDone/actions/runs/29958126604). `v1.3.1` qualified npm distribution and the installed-bin path. The `v1.3.2` candidate expands managed runtime discovery and adds installed-tarball scan/cleanup gates for metadata-free static and npm projects; the hosted matrix remains the release authority.

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
