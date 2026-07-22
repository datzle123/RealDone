# RealDone Plugin SDK v1

The stable `apiVersion: "1.0"` SDK lets a trusted local plugin verify payment-sandbox, test-inbox, or object-storage outcomes without coupling RealDone core to one vendor.

## Manifest

`realdone.plugin.json` stays beside the entry module:

```json
{
  "apiVersion": "1.0",
  "name": "test-inbox",
  "version": "1.0.0",
  "entry": "./index.mjs",
  "providers": [
    { "name": "test-inbox-provider", "kind": "email" }
  ]
}
```

The entry must be relative and remain within the plugin directory. Provider names are unique across loaded manifests.

## Entry module

```js
export default {
  apiVersion: "1.0",
  name: "test-inbox",
  async verifyProvider(expectation) {
    const messageId = "env" in expectation.reference
      ? process.env[expectation.reference.env]
      : expectation.reference.value;

    const message = await lookupTestMessage(messageId);
    return {
      found: Boolean(message),
      detail: "Test inbox lookup completed.",
      metadata: { status: message?.status ?? "missing" }
    };
  }
};
```

Plugins return an observation, not a verdict. RealDone computes `passed` from `found` and the contract's requested state, attaches Level 6, and validates the serialized evidence shape.

TypeScript plugins can import `definePlugin`, `RealDonePlugin`, `ProviderExpectation`, and `ProviderObservation` from `realdone`.

## Runtime isolation

Each provider call runs in a fresh worker thread. Defaults:

- 5-second deadline;
- 64 MB old-generation memory limit;
- discarded plugin stdout/stderr;
- worker termination after result, failure, timeout, or invalid evidence;
- environment/provider-reference redaction before evidence is written.

Tune the operational limits explicitly:

```bash
realdone verify flow.json \
  --plugin ./plugins/test-inbox/realdone.plugin.json \
  --plugin-timeout 10000 \
  --plugin-memory 96
```

Worker isolation limits hangs, crashes, and memory growth. It is **not a security sandbox**: a plugin is JavaScript code with the user's filesystem, process environment, and network authority. Install only reviewed plugins, pin their source, and use least-privilege sandbox credentials. See the [threat model](THREAT_MODEL.md).

The checked-in [storage fixture plugin](../examples/plugins/storage-fixture/realdone.plugin.json) is a minimal runnable example.
