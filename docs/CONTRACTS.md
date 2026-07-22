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

Steps are `navigate`, `fill`, `check`, `select`, or `click`. Interaction steps contain weighted semantic candidates. Click steps can infer:

- write request method and path pattern;
- response status;
- resulting URL pattern;
- visible status/alert text.

Contracts may also include explicit persistence expectations that reload the page and check visible text.

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

`provider` expectations cover payment sandboxes, test inboxes, and object-storage sandboxes. The contract names a provider capability; an explicit Plugin SDK v1 manifest supplies its implementation. Plugins return observations, while RealDone applies `confirmed` or `absent` semantics and computes the verdict.

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

Run the contract with `--plugin ./plugin/realdone.plugin.json`. Provider reference values and known secrets are redacted from evidence. See the [Plugin SDK](PLUGIN_SDK.md).

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
