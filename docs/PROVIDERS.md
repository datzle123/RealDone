# Maintained provider adapters

Provider checks confirm Level 6 outcomes without replaying external mutations. Configuration stores environment-variable names, not credentials. Built-in adapters perform bounded read/HEAD/introspection requests only.

```bash
realdone verify flow.json --provider-config .realdone/providers.json
```

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
