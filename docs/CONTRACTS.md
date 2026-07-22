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

## Secrets

Password-like fields never store their value. The contract contains `secretEnv`, for example `REALDONE_PASSWORD`. Set it only for the verification process:

```bash
REALDONE_PASSWORD="..." realdone verify .realdone/flows/login.json
```

## Verify

```bash
realdone verify .realdone/flows/create-customer.json
```

Verification stops after the first failed step unless `--continue` is supplied. Production-like mutation hosts require `--allow-host`; destructive and external actions require `--allow-destructive` or `--allow-external` respectively.
