# Advanced verification

Advanced features are opt-in. Default `scan` remains one Chromium worker with no database, provider, plugin, extra role, video, or AI requirement.

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

The provider name is supplied by an explicit plugin manifest:

```bash
realdone verify flow.json \
  --plugin ./plugins/test-inbox/realdone.plugin.json
```

RealDone validates the plugin observation, applies the contract's confirmed/absent semantics itself, redacts reference values and known secrets, and reports Level 6 provider evidence. See the [Plugin SDK](PLUGIN_SDK.md).
