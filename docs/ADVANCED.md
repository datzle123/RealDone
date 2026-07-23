# Advanced verification

Advanced features are opt-in. Default `scan` remains one Chromium worker with no database, provider, plugin, extra role, video, or AI requirement.

The examples use the installed `realdone` binary. Without a global install, prefix them with `npx`, for example `npx realdone scan`.

From a discoverable project root, the shortest form starts the app, finds its local URL, scans it, and stops the managed runtime:

```bash
realdone scan
```

Zero-config managed discovery covers Node `dev`/`start` scripts even without package-manager metadata, static HTML, Django, FastAPI, Flask, Laravel, Rails, ASP.NET Core, Spring Boot through Maven/Gradle wrappers, Deno tasks, Go, Rust and Composer-based PHP scripts. The detector uses explicit files/scripts and conventional local ports; it does not execute guessed source fragments. Pass a URL when the application is already running or uses a custom runtime. Once a web app is reachable over HTTP, browser verification is language- and framework-independent.

Before any interactive CLI command that autonomously operates browser actions begins, RealDone asks once for project-level action consent and warns that an ordinary app handler may hide an email, payment, webhook, or other provider effect. This covers `scan`, `verify`, `benchmark`, verified `baseline`, `ci`, `matrix`, coding-agent `run`, and `replay`; human-driven `record` and dry metadata-only operations do not need it. Answering yes authorizes the permitted actions only for that command. Non-interactive CLI use must pass `--yes`; without it RealDone exits before starting the runtime or browser. `--allow-external`, `--allow-destructive`, and production-like `--allow-host` checks remain separate.

Quick scan uses 8 pages, 24 actions, and a two-minute budget. Full safe audit raises those defaults to 100 pages, 500 actions, deep persistence, and 30 minutes while keeping destructive and external effects disabled:

```bash
realdone scan --full
```

Explicit `--max-pages`, `--max-actions`, `--max-duration`, or policy budgets override the corresponding preset. If any budget is exhausted, the report is marked `truncated`; RealDone never presents a partial scan as complete.

## Project discovery, managed runtime, and environment validity

Create a reviewable runtime profile without reading environment values:

```bash
realdone init ../my-app
```

The generated `.realdone/project.json` records framework/package-manager hints, development/build/production/Docker commands, port, conventional routes, database/auth/test-framework hints, and environment filenames. Start and clean up the target automatically around a scan:

```bash
realdone scan --project ../my-app --manage-runtime
realdone scan --project ../my-app --manage-runtime --runtime-mode production
realdone scan --project ../my-app --manage-runtime --runtime-mode docker
```

Before action discovery, RealDone checks the main HTML document, same-origin scripts/stylesheets, content types, bootstrap errors, configured health endpoint, auth-state readability, and render readiness. It repeats the static-root/bootstrap check for discovered routes. A JavaScript or CSS URL receiving an HTML SPA fallback produces `ENVIRONMENT_INVALID` and RD1001/RD1002 instead of an application `BROKEN` finding. The report stores this evidence in `environment.json`; `--accept-environment-risk` is the explicit override when the operator has independently confirmed the harness is representative.

Automatic discovery prepares hover-revealed and scroll/lazy content, executes native checkbox/select and context-menu actions, and records popup/download evidence. Same-origin iframe execution is explicit:

```bash
realdone scan http://localhost:3000 --allow-iframe
```

Same-origin upload forms are classified as external and remain skipped by default. With `--allow-external` on an allowed local/staging host, the automatic scanner may submit a generated canary file; standalone, ambiguous, cross-origin, or non-HTTP uploads remain an RD008 recorded-flow boundary. Canvas, rich-text and drag/drop controls also require recording. Record the exact file/content/gesture once instead of letting the scanner guess:

```bash
realdone record http://localhost:3000 --name "Upload and approve receipt"
```

Discovery classifies effective form actions/methods, provider and endpoint hints, file fields, downloads, popups, and destructive semantics. Immediately before filling or activating a target, the executor reads those signals again. A target that changed into a mutation, external effect, destructive action, or recorded-flow boundary is `SKIPPED` before execution. Production-like targets need an explicit `--allow-host` in addition to `--allow-external` or `--allow-destructive`.

No browser scanner can infer a server-side email/payment hidden behind an otherwise ordinary same-origin handler with no observable semantic signal. Use a deny/set rule in `--policy`, a recorded flow, or a provider-specific sandbox hint for those domain-specific actions.

## Deep fresh-context verification

Standard mutation scans reload the current page. Deep mode adds an independent browser context using only the configured initial auth state:

```bash
realdone scan http://localhost:3000 --deep
realdone verify .realdone/flows/create-customer.json --deep
```

For automatic scans, a canary that survives reload but disappears in the fresh context produces `BROWSER_LOCAL` and `RD102`. This describes persistence scope rather than automatically treating browser-local state as a defect. For recorded contracts, each explicit `persistence` expectation must also be visible in the fresh context, so the contract decides whether browser-local storage is acceptable.

Capture full debugging artifacts explicitly when needed:

```bash
realdone verify flow.json --deep --trace --video
```

Trace ZIPs and browser videos are linked from local HTML/JSON evidence. They can contain application content, so keep them under the ignored `.realdone/` tree and review them before sharing.

Attach read-only, value-free source snapshots to every executed mutation when source-of-truth change evidence is needed:

```bash
realdone scan http://localhost:3000 --deep --sqlite ./app.db
realdone scan http://localhost:3000 --deep --database-config ./realdone.supabase.json
```

Each configured adapter discovers only its allowlisted resources, hashes at most 100 rows per resource by default, records before/after snapshots and writes added/removed/changed/soft-delete key hashes into the finding snapshot artifact. Use `--source-snapshot-limit` to lower or raise the bounded row limit. Adapter failures make an otherwise passing mutation `UNCERTAIN`; they never silently upgrade browser evidence to source-of-truth confirmation.

Attach an explicit read-only provider rule when an external action returns a provider resource ID:

```bash
realdone scan http://localhost:3000 --allow-external \
  --provider-config .realdone/providers.json
```

Automatic provider rules match a declared action/request and take the reference from an observed response resource ID, prepared upload filename, completed download filename, or named environment variable. Every matched check must pass, and Level 6 `SOURCE_OF_TRUTH_CONFIRMED` additionally requires causal action linkage: a successful write returning the resource ID, or a successful write carrying a unique canary upload. Other references remain supporting evidence and cannot turn a no-op into `VERIFIED`. Missing references, mixed results and unavailable adapters remain `UNCERTAIN`; no automatic rule sends a provider mutation or stores the reference in evidence. At most 20 checks are loaded across repeated config files, up to four run concurrently, and each lookup inherits the remaining global scan deadline.

## Multi-role contracts and Level 7

Declare named roles with separate Playwright storage-state files. The primary role continues to use the top-level `authState`.

```json
{
  "authState": { "path": "auth/admin.json" },
  "roles": {
    "support": {
      "description": "Support user in the same tenant",
      "authState": { "path": "auth/support.json" }
    }
  }
}
```

A step may run as a named role through `"role": "support"`. A mutation step can independently ask another role to observe the result:

```json
{
  "type": "cross-role",
  "role": "support",
  "pageUrl": "http://localhost:3000/customers",
  "assertion": {
    "type": "text",
    "value": "RD_TEST_CUSTOMER",
    "state": "visible"
  }
}
```

The named role receives a separate browser context and storage state. A passing assertion is Level 7 evidence. Override a role state without editing the contract:

```bash
realdone verify flow.json --role-state support=.realdone/auth/support.json
```

This confirms an observable cross-user outcome; it does not prove every authorization rule. Use disposable accounts in a local or staging tenant.

## Browser matrix

Run one contract against all release-gated engines:

```bash
pnpm exec playwright install chromium firefox webkit
realdone matrix .realdone/flows/create-customer.json
```

Select a subset with repeated flags:

```bash
realdone matrix flow.json --browser chromium --browser webkit
```

The result contains `matrix.json`, `matrix.md`, `matrix.html`, and one complete verification report per browser. `--browser-path` applies only to the Chromium entry.

## Provider contracts

Provider expectations cover three stable capability kinds:

- `payment` for sandbox payment state;
- `email` for a test inbox or mail-capture service;
- `storage` for an object-storage sandbox.

```json
{
  "type": "provider",
  "provider": "test-inbox-provider",
  "kind": "email",
  "operation": "delivered",
  "resource": "message",
  "reference": { "env": "RD_MESSAGE_ID" },
  "state": "confirmed"
}
```

The provider name is supplied by either a maintained provider configuration or an explicit plugin manifest:

```bash
realdone verify flow.json \
  --provider-config .realdone/providers.json

realdone verify flow.json \
  --plugin ./plugins/test-inbox/realdone.plugin.json
```

RealDone validates the maintained-adapter/plugin observation, applies the contract's confirmed/absent semantics itself, redacts reference values and known secrets, and reports Level 6 provider evidence. See [provider adapters](PROVIDERS.md) and the [Plugin SDK](PLUGIN_SDK.md).
