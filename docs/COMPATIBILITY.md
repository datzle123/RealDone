# Compatibility matrix

`v1.2.0` is release-gated on the matrix below.

| Surface | Release gate |
| --- | --- |
| Node.js | 20 and 22 |
| Operating systems | Ubuntu, Windows, macOS |
| Browsers | Playwright Chromium, Firefox, WebKit |
| PostgreSQL adapter | PostgreSQL 17 service in CI |
| Package managers | pnpm 10 for repository development; managed targets discovered for npm, pnpm, Yarn and Bun; npm-compatible published package |
| Module format | Node ESM with generated declarations and source maps |

The Ubuntu full gate runs PostgreSQL integration, all three browser engines, browser/agent/provider smoke, managed-runtime/environment fixtures, dependency audit, and package creation. Windows and macOS run typecheck, unit/failure-mode tests, production build, managed-runtime/environment smoke, Chromium installation, and the complete single-browser smoke on Node 20/22.

Chromium accepts a custom executable through `--browser-path`. Firefox and WebKit use Playwright-managed binaries so RealDone does not accidentally launch an incompatible system browser.

Codex and Claude Code integrations are command presets, not embedded SDKs. RealDone verifies the current documented non-interactive argument contracts; installed agent authentication and provider availability remain the user's responsibility.
