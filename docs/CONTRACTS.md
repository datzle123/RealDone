# Behavior contracts

A behavior contract is the deterministic output of `realdone record`. It is intentionally smaller and more stable than raw session recording.

## Record

```bash
realdone record http://localhost:3000 \
  --name "Create customer" \
  --save-auth .realdone/auth/admin.json
```

Use the opened browser normally, then press Enter or Ctrl+C in the terminal. RealDone writes:

- `.realdone/flows/create-customer.json` — editable deterministic contract;
- `.realdone/flows/create-customer.rrweb.json` — masked raw session evidence;
- optional auth state at the explicit `--save-auth` path.

Auth state contains cookies and may grant account access. Keep it under `.realdone/`, never commit it, and use disposable staging accounts.

## Steps and expectations

Steps are `navigate`, `fill`, `check`, `select`, `click`, `press`, `upload`, `richtext`, or `drag`. Interaction steps contain weighted semantic candidates; drag steps carry independent source and target fingerprints. Upload steps store an environment-variable name such as `REALDONE_UPLOAD_RECEIPT_FILE`, never the developer's local file path. Click steps can infer:

- write request method and path pattern;
- response status;
- resulting URL pattern;
- visible status/alert text;
- popup pathname;
- downloaded filename and non-empty content.

Contracts may also include explicit persistence expectations that reload the page and check visible text.

The verifier never falls back to an old DOM ordinal. It resolves test ID, role/name or label, stable ID, href, visible text, then CSS; if none identify a visible target, the step fails without clicking another element.

```json
{
  "id": "S003",
  "type": "click",
  "pageUrl": "http://localhost:3000/customers",
  "fingerprint": {
    "selector": "button[type=submit]",
    "tag": "button",
    "role": "button",
    "accessibleName": "Create customer",
    "ordinal": 0
  },
  "expected": [
    { "type": "request", "method": "POST", "urlPattern": "^/api/customers$", "status": 201 },
    { "type": "text", "value": "Customer created successfully" }
  ]
}
```

Complex actions remain deterministic and portable:

```json
[
  { "id": "S004", "type": "press", "key": "Enter", "fingerprint": { "selector": "#command", "tag": "input", "ordinal": 0 }, "expected": [] },
  { "id": "S005", "type": "upload", "fileEnv": "REALDONE_UPLOAD_RECEIPT_FILE", "fingerprint": { "selector": "#receipt", "tag": "input", "ordinal": 1 }, "expected": [] },
  { "id": "S006", "type": "drag", "fingerprint": { "selector": "#card", "tag": "div", "ordinal": 0 }, "targetFingerprint": { "selector": "#done", "tag": "div", "ordinal": 1 }, "expected": [] }
]
```

For Level 6 evidence, add a PostgreSQL source expectation. Resource and field names are aliases from the adapter config; the contract cannot supply raw SQL identifiers.

```json
{
  "type": "source",
  "adapter": "postgresql",
  "resource": "customers",
  "filters": [{ "field": "email", "value": "rd-test@example.test" }],
  "state": "present",
  "maxMatches": 1
}
```

Source filter values may use `{ "field": "id", "env": "RD_CUSTOMER_ID" }` when a value must not be stored. See [PostgreSQL source verification](POSTGRESQL.md) for the config, TLS, and cleanup gates.

## Roles and Level 7 expectations

Named roles use separate browser contexts and storage-state files. Add the role to the contract and select it on any step:

```json
{
  "roles": {
    "support": {
      "description": "Independent support user",
      "authState": { "path": "auth/support.json" }
    }
  },
  "steps": [{
    "id": "S004",
    "type": "navigate",
    "role": "support",
    "pageUrl": "http://localhost:3000/customers",
    "atMs": 1200,
    "expected": []
  }]
}
```

A `cross-role` expectation asks another role to navigate independently and confirm visible text or a URL. Passing it produces Level 7 evidence. Use `--role-state support=.realdone/auth/support.json` to override a configured state without editing the contract. See [Advanced verification](ADVANCED.md).

## Provider expectations

`provider` expectations cover payment sandboxes, test inboxes, object storage, and OAuth introspection. The contract names a provider capability; either a maintained `--provider-config` adapter or an explicit Plugin SDK v1 manifest supplies its implementation. Adapters/plugins return observations, while RealDone applies `confirmed` or `absent` semantics and computes the verdict.

```json
{
  "type": "provider",
  "provider": "storage-fixture-provider",
  "kind": "storage",
  "operation": "exists",
  "resource": "customer-export",
  "reference": { "env": "RD_OBJECT_KEY" },
  "state": "confirmed"
}
```

Run the contract with `--provider-config .realdone/providers.json` or `--plugin ./plugin/realdone.plugin.json`. Provider reference values and known secrets are redacted from evidence. See [provider adapters](PROVIDERS.md) and the [Plugin SDK](PLUGIN_SDK.md).

## Secrets

Password-like fields never store their value. The contract contains `secretEnv`, for example `REALDONE_PASSWORD`. Set it only for the verification process:

```bash
REALDONE_PASSWORD="..." realdone verify .realdone/flows/login.json
```

## Verify

```bash
realdone verify .realdone/flows/create-customer.json \
  --postgres-config .realdone/postgres.json \
  --performance-budget .realdone/performance.json
```

Verification stops after the first failed step unless `--continue` is supplied. Production-like mutation hosts require `--allow-host`; destructive and external actions require `--allow-destructive` or `--allow-external` respectively.

Use `realdone matrix <contract>` to verify the same contract across Chromium, Firefox, and WebKit. Performance-budget violations fail the run just like behavioral assertion failures.

Add `--deep` when a `persistence` expectation must survive both reload and a fresh browser context initialized from the configured auth state. This is stricter than normal verification and intentionally rejects values that exist only in the current context's local storage.

## Replay outcomes

`realdone replay <finding-id> --report-dir <scan-directory>` creates a new canary, resolves the original semantic target, runs it in a fresh browser, and writes `replay.json`. Reproductions created from an automatic provider-backed scan retain only value-free provider name, kind, resource, operation, and expected state requirements. Supply the same sandbox adapters again with one or more `--provider-config` options; config paths, references, and credentials are never copied into the reproduction.

Replay validates the finding ID and reproduction schema before execution. It never inherits `allowExternal`, `allowDestructive`, or staging-host authority from the source scan: a CLI invocation must grant those permissions again with `--allow-external`, `--allow-destructive`, and/or `--allow-host`. MCP replay intentionally exposes none of those side-effect grants.

Provider-backed replay is fail-closed. Every required provider name/kind/resource/operation/state tuple must produce passing Level 6 evidence causally linked to the fresh action. A missing adapter, mismatched provider rule, failed check, provider error, or non-causal observation returns `REPLAY_UNCERTAIN` rather than treating browser-only evidence as a definitive replay.

The outcome is one of:

- `FINDING_REPRODUCED` — source verdict and detector set remain present;
- `FINDING_NO_LONGER_REPRODUCED` — the target ran but the source finding changed;
- `ENVIRONMENT_CHANGED` — the fresh environment health gate failed;
- `TARGET_ACTION_NOT_FOUND` — no semantic target matched, so no substitute action ran;
- `REPLAY_UNCERTAIN` — execution did not provide enough source or replay evidence.

Reproduced findings exit `0`, changed findings exit `1`, and inconclusive environment/target/evidence outcomes exit `2`.
