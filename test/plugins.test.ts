import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PluginHost } from "../src/plugins/host.js";
import { behaviorContractSchema } from "../src/contracts/schema.js";

async function fixturePlugin(directory: string, name: string, source: string, kind = "payment"): Promise<string> {
  const entry = path.join(directory, `${name}.mjs`);
  const manifest = path.join(directory, `${name}.json`);
  await writeFile(entry, source);
  await writeFile(manifest, JSON.stringify({
    apiVersion: "1.0",
    name,
    version: "1.0.0",
    entry: `./${name}.mjs`,
    providers: [{ name: `${name}-provider`, kind }],
  }));
  return manifest;
}

test("plugin host verifies typed provider evidence in an isolated worker", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "realdone-plugin-"));
  const previous = process.env.REALDONE_PLUGIN_SECRET_TOKEN;
  process.env.REALDONE_PLUGIN_SECRET_TOKEN = "plugin-secret-value";
  try {
    const manifest = await fixturePlugin(directory, "payment-fixture", `
      export default {
        apiVersion: '1.0',
        name: 'payment-fixture',
        async verifyProvider(expectation) {
          return {
            found: expectation.reference.value === 'payment-42',
            detail: 'confirmed payment-42 with ' + process.env.REALDONE_PLUGIN_SECRET_TOKEN,
            metadata: { reference: 'payment-42' }
          };
        }
      };
    `);
    const host = await PluginHost.load([manifest], { timeoutMs: 1_000, memoryLimitMb: 64 });
    const evidence = await host.verifyProvider({
      type: "provider",
      provider: "payment-fixture-provider",
      kind: "payment",
      operation: "settled",
      resource: "payment-intent",
      reference: { value: "payment-42" },
      state: "confirmed",
    });
    assert.equal(evidence.passed, true);
    assert.equal(evidence.evidenceLevel, 6);
    assert.equal(evidence.detail.includes("payment-42"), false);
    assert.equal(evidence.detail.includes("plugin-secret-value"), false);
    assert.equal(evidence.metadata?.reference, "[REDACTED_PROVIDER_VALUE]");
    await assert.rejects(
      host.verifyProvider({
        type: "provider",
        provider: "payment-fixture-provider",
        kind: "email",
        operation: "delivered",
        resource: "message",
        reference: { value: "message-1" },
        state: "confirmed",
      }),
      /is payment, not email/,
    );
  } finally {
    if (previous === undefined) delete process.env.REALDONE_PLUGIN_SECRET_TOKEN;
    else process.env.REALDONE_PLUGIN_SECRET_TOKEN = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("plugin host terminates a provider that exceeds its deadline", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "realdone-plugin-timeout-"));
  try {
    const manifest = await fixturePlugin(directory, "storage-timeout", `
      export default {
        apiVersion: '1.0',
        name: 'storage-timeout',
        async verifyProvider() { await new Promise((resolve) => setTimeout(resolve, 10000)); }
      };
    `, "storage");
    const host = await PluginHost.load([manifest], { timeoutMs: 30, memoryLimitMb: 32 });
    await assert.rejects(
      host.verifyProvider({
        type: "provider",
        provider: "storage-timeout-provider",
        kind: "storage",
        operation: "exists",
        resource: "object",
        reference: { value: "object-1" },
        state: "confirmed",
      }),
      /timed out after 30ms/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("plugin host rejects invalid operational limits", async () => {
  await assert.rejects(PluginHost.load([], { timeoutMs: 0 }), /timeout must be a positive integer/);
  await assert.rejects(PluginHost.load([], { memoryLimitMb: 0 }), /memory limit must be a positive integer/);
});

test("behavior contract accepts payment, inbox, and object-storage provider kinds", () => {
  for (const kind of ["payment", "email", "storage"] as const) {
    const parsed = behaviorContractSchema.safeParse({
      schemaVersion: "1.0",
      id: `${kind}-provider-flow`,
      name: `${kind} provider flow`,
      baseUrl: "http://localhost:3000",
      createdAt: "2026-07-22T00:00:00.000Z",
      tags: [],
      steps: [{
        id: "S001",
        type: "navigate",
        pageUrl: "http://localhost:3000",
        atMs: 0,
        expected: [{
          type: "provider",
          provider: `${kind}-test`,
          kind,
          operation: "lookup",
          resource: "result",
          reference: { env: "REALDONE_PROVIDER_REFERENCE" },
          state: "confirmed",
        }],
      }],
      cleanup: [],
      source: { browser: "Chromium", recordedBy: "realdone" },
    });
    assert.equal(parsed.success, true);
  }
});
