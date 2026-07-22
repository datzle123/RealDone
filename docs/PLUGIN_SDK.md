# RealDone Plugin SDK v1

The stable `apiVersion: "1.0"` SDK lets a trusted local plugin verify custom payment/email/storage/OAuth outcomes or bridge a project-owned Prisma/custom database without coupling RealDone core to one vendor or generated client.

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
  ],
  "sources": [
    { "name": "project-prisma", "kind": "prisma" }
  ],
  "permissions": {
    "environment": ["TEST_INBOX_TOKEN", "REALDONE_PRISMA_BRIDGE_MODULE"],
    "networkHosts": ["sandbox.example.test"]
  }
}
```

The entry must be relative and remain within the plugin directory. Provider and source connector names are unique across loaded manifests. Environment names and `fetch` hostnames must be declared; an environment variable directly referenced by a contract is also passed for that one call.

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

## Prisma and custom source connectors

A source connector can implement five bounded operations:

- `verifySource(expectation)` returns a row count and matched alias names;
- `discoverSource(input)` returns resource fields, primary keys, and soft-delete fields;
- `snapshotSource(input)` returns at most `limit + 1` project-owned rows for immediate in-memory hashing; raw rows are never written to evidence;
- `cleanupSource(target)` performs only the exact project-owned primary-key deletion after RealDone receives both cleanup confirmations;
- the core computes verdicts, schema hashes, row hashes, diffs, cleanup evidence, limits, and redaction.

```js
export default {
  apiVersion: "1.0",
  name: "project-prisma",
  async verifySource(expectation) {
    return {
      matchedRows: await bridge.count(expectation.resource, expectation.filters),
      matchedFields: expectation.filters.map((filter) => filter.field),
      detail: "Project Prisma count completed."
    };
  },
  async discoverSource(input) {
    return bridge.discover(input.resource);
  },
  async snapshotSource(input) {
    return bridge.snapshot(input.resource, input.limit);
  },
  async cleanupSource(target) {
    return { deletedRows: await bridge.cleanup(target.resource, target.filters) };
  }
};
```

Use `connector` in both the source expectation and cleanup target when more than one connector exists. The shipped [Prisma source bridge](../examples/plugins/prisma-source/realdone.plugin.json) loads only the project-owned module named by `REALDONE_PRISMA_BRIDGE_MODULE`; RealDone never guesses a generated Prisma Client path.

## Runtime isolation

Each plugin method call runs in a fresh worker thread. Defaults:

- 5-second deadline;
- 64 MB old-generation memory limit;
- discarded plugin stdout/stderr;
- worker termination after result, failure, timeout, or invalid evidence;
- an environment containing only declared names and contract-referenced environment values;
- global `fetch` limited to declared hostnames;
- provider/source reference redaction before evidence is written.

Tune the operational limits explicitly:

```bash
realdone verify flow.json \
  --plugin ./plugins/test-inbox/realdone.plugin.json \
  --plugin-timeout 10000 \
  --plugin-memory 96
```

Worker isolation limits hangs, crashes, memory growth, accidental environment exposure, and ordinary undeclared `fetch` calls. It is **not a security sandbox**: reviewed plugin code can still use Node filesystem APIs or open network connections through APIs other than the wrapped global `fetch`. Install only reviewed plugins, pin their source, and use least-privilege sandbox credentials. See the [threat model](THREAT_MODEL.md).

The checked-in [storage fixture plugin](../examples/plugins/storage-fixture/realdone.plugin.json) and [Prisma source bridge](../examples/plugins/prisma-source/realdone.plugin.json) are runnable protocol examples.
