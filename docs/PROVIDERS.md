# Maintained provider adapters

Provider checks confirm Level 6 outcomes without replaying external mutations. Configuration stores environment-variable names, not credentials. Built-in adapters perform bounded read/HEAD/introspection requests only.

```bash
realdone verify flow.json --provider-config .realdone/providers.json
```

The same config can link a safe automatic scan to an independently observed provider resource:

```bash
realdone scan http://localhost:3000 --allow-external \
  --provider-config .realdone/providers.json
```

Pass the adapter again when replaying a finding produced by that scan:

```bash
realdone replay RD-001 --report-dir .realdone/reports/<scan-id> \
  --provider-config .realdone/providers.json
```

The reproduction stores only value-free provider name, kind, resource, operation, and expected state requirements, never config paths, references, or credentials. Replay requires fresh, passing and causally linked Level 6 evidence for every exact recorded rule. Missing config, a mismatched rule, a failed lookup, an adapter error, or non-causal proof produces `REPLAY_UNCERTAIN`.

```json
{
  "automaticChecks": [
    {
      "provider": "stripe-test",
      "kind": "payment",
      "operation": "succeeded",
      "resource": "payment-intent",
      "state": "confirmed",
      "match": {
        "actionLabelIncludes": "Pay order",
        "actionKind": "external",
        "requestUrlIncludes": "/api/payments"
      },
      "reference": { "from": "response-resource-id" }
    }
  ]
}
```

`reference.from` also accepts `upload-file-name`, `download-file-name`, or `environment` with an `env` name. At least one matcher is mandatory. All matched checks must pass; a provider result upgrades the scan to Level 6 only when it is causally linked to the action's successful write/unique upload. An email/storage result cannot satisfy a payment confirmation. Rules are never inferred, and mixed results, non-causal observations or adapter failures stay `UNCERTAIN` rather than becoming unsupported application-defect verdicts.

Automatic checks are capped at 20 across all repeated config files and run with bounded concurrency under the scan's global deadline. JSON responses are limited to 1 MB. Evidence metadata is bounded and redacted against the resource reference, configured parameters and provider credentials before it reaches report artifacts.

The maintained set is:

- Stripe payment intents, charges, refunds, and checkout sessions—test/restricted test keys only; live keys are always rejected;
- Resend and SendGrid message lookup;
- Mailgun event lookup;
- S3 `HEAD` signed with AWS Signature v4;
- Supabase Storage `HEAD`;
- OAuth token introspection;
- custom provider plugins through Plugin SDK v1.

See [`examples/realdone.providers.json`](../examples/realdone.providers.json). Remote email/storage/OAuth endpoints require explicit `allowProduction`; use only disposable sandbox resources. Stripe's key-mode check is stricter and cannot be overridden.

```json
{
  "type": "provider",
  "provider": "stripe-test",
  "kind": "payment",
  "operation": "succeeded",
  "resource": "payment-intent",
  "reference": { "env": "RD_PAYMENT_INTENT_ID" },
  "state": "confirmed"
}
```

References, tokens, API keys, credentials, authorization headers, object keys, and configured parameters are redacted from evidence. Reports retain provider name/kind, operation/resource, confirmed/absent state, bounded safe metadata, duration, and pass/fail.
