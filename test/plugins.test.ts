import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PluginHost } from "../src/plugins/host.js";
import { behaviorContractSchema } from "../src/contracts/schema.js";
import { runCleanup, writeCleanupLedger } from "../src/cleanup/ledger.js";

async function fixturePlugin(directory: string, name: string, source: string, kind = "payment", environment: string[] = []): Promise<string> {
  const entry = path.join(directory, `${name}.mjs`);
  const manifest = path.join(directory, `${name}.json`);
  await writeFile(entry, source);
  await writeFile(manifest, JSON.stringify({
    apiVersion: "1.0",
    name,
    version: "1.0.0",
    entry: `./${name}.mjs`,
    providers: [{ name: `${name}-provider`, kind }],
    permissions: { environment, networkHosts: [] },
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
    `, "payment", ["REALDONE_PLUGIN_SECRET_TOKEN"]);
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

test("plugin worker exposes only declared environment and blocks unlisted fetch hosts", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "realdone-plugin-permissions-"));
  process.env.RD_HIDDEN_PLUGIN_SECRET = "must-not-enter-worker";
  try {
    const manifest = await fixturePlugin(directory, "permission-fixture", `
      export default {
        apiVersion: '1.0',
        name: 'permission-fixture',
        async verifyProvider(expectation) {
          if (expectation.operation === 'network') await fetch('https://example.com/private');
          return { found: true, detail: 'hidden=' + String(process.env.RD_HIDDEN_PLUGIN_SECRET) };
        }
      };
    `, "storage");
    const host = await PluginHost.load([manifest]);
    const evidence = await host.verifyProvider({ type: "provider", provider: "permission-fixture-provider", kind: "storage", operation: "environment", resource: "object", reference: { value: "object-1" }, state: "confirmed" });
    assert.equal(evidence.detail, "hidden=undefined");
    await assert.rejects(host.verifyProvider({ type: "provider", provider: "permission-fixture-provider", kind: "storage", operation: "network", resource: "object", reference: { value: "object-1" }, state: "confirmed" }), /network host is not allowlisted/);
  } finally {
    delete process.env.RD_HIDDEN_PLUGIN_SECRET;
    await rm(directory, { recursive: true, force: true });
  }
});

test("plugin host verifies Prisma and custom source bridges with redacted evidence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "realdone-source-plugin-"));
  process.env.RD_PRISMA_SECRET = "prisma-secret-value";
  try {
    const entry = path.join(directory, "prisma-source.mjs");
    const manifest = path.join(directory, "prisma-source.json");
    await writeFile(entry, `
      export default {
        apiVersion: '1.0',
        name: 'prisma-source',
        async verifySource(expectation) {
          return { matchedRows: 1, matchedFields: expectation.filters.map(filter => filter.field), detail: 'found prisma-secret-value and rd@example.test' };
        },
        async discoverSource(input) {
          return [{
            adapter: 'prisma',
            resource: input.resource ?? 'customer',
            fields: [
              { name: 'id', type: 'string', nullable: false },
              { name: 'email', type: 'string', nullable: false },
              { name: 'deletedAt', type: 'datetime', nullable: true }
            ],
            primaryKey: ['id'],
            softDeleteFields: ['deletedAt'],
            schemaHash: 'plugin-placeholder'
          }];
        },
        async snapshotSource() {
          return { rows: [{ id: 'customer-1', email: 'rd@example.test', deletedAt: null }], truncated: false };
        },
        async cleanupSource(target) {
          if (target.filters.length !== 1 || target.filters[0].field !== 'id') throw new Error('primary key required');
          return { deletedRows: 1, detail: 'cleaned prisma-secret-value' };
        }
      };
    `);
    await writeFile(manifest, JSON.stringify({ apiVersion: "1.0", name: "prisma-source", version: "1.0.0", entry: "./prisma-source.mjs", providers: [], sources: [{ name: "prisma-test", kind: "prisma" }] }));
    const host = await PluginHost.load([manifest]);
    const evidence = await host.verifySource({ type: "source", adapter: "prisma", connector: "prisma-test", resource: "customer", filters: [{ field: "email", value: "rd@example.test" }], state: "present", maxMatches: 1 });
    assert.equal(evidence.passed, true);
    assert.equal(evidence.detail?.includes("prisma-secret-value"), false);
    assert.equal(evidence.detail?.includes("rd@example.test"), false);
    const schemas = await host.discoverSource({ adapter: "prisma", connector: "prisma-test", resource: "customer" });
    assert.deepEqual(schemas[0]?.primaryKey, ["id"]);
    assert.notEqual(schemas[0]?.schemaHash, "plugin-placeholder");
    const snapshot = await host.snapshotSource({ adapter: "prisma", connector: "prisma-test", resource: "customer", limit: 10 });
    assert.equal(snapshot.rows.length, 1);
    assert.equal(snapshot.rows[0]?.softDeleted, false);
    assert.equal(JSON.stringify(snapshot).includes("rd@example.test"), false);
    await assert.rejects(
      host.cleanupSource({ adapter: "prisma", connector: "prisma-test", resource: "customer", filters: [{ field: "id", value: "customer-1" }] }, { confirmed: false }),
      /explicit confirmation/,
    );
    const cleanup = await host.cleanupSource(
      { adapter: "prisma", connector: "prisma-test", resource: "customer", filters: [{ field: "id", value: "customer-1" }] },
      { confirmed: true },
    );
    assert.equal(cleanup.deletedRows, 1);
    await writeCleanupLedger(directory, {
      schemaVersion: "1.0",
      scanId: "plugin-cleanup",
      targetUrl: "http://localhost",
      resources: [{
        id: "cleanup-prisma-customer",
        findingId: "prisma-flow",
        actionId: "create-customer",
        type: "customer",
        canary: "[contract cleanup]",
        createdAt: new Date().toISOString(),
        sourceUrl: "prisma:customer",
        strategy: "prisma",
        database: { adapter: "prisma", connector: "prisma-test", resource: "customer", filters: [{ field: "id", value: "customer-1" }] },
        dependsOn: [],
        status: "pending",
        attempts: 0,
      }],
    });
    const cleanupRun = await runCleanup(directory, {
      confirm: true,
      confirmDatabase: true,
      allowHosts: [],
      retries: 0,
      pluginManifests: [manifest],
    });
    assert.equal(cleanupRun.cleaned, 1);
    assert.equal(cleanupRun.failed, 0);
    await assert.rejects(host.verifySource({ type: "source", adapter: "custom", connector: "prisma-test", resource: "customer", filters: [{ field: "id", value: 1 }], state: "present" }), /is prisma, not custom/);
  } finally {
    delete process.env.RD_PRISMA_SECRET;
    await rm(directory, { recursive: true, force: true });
  }
});

test("behavior contract accepts payment, inbox, object-storage, and OAuth provider kinds", () => {
  for (const kind of ["payment", "email", "storage", "oauth"] as const) {
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
