import assert from "node:assert/strict";
import test from "node:test";
import { PostgresSourceAdapter, compilePostgresTarget } from "../src/adapters/postgres/index.js";
import { postgresAdapterConfigSchema } from "../src/adapters/postgres/config.js";
import { createContractCleanupLedger } from "../src/cleanup/ledger.js";
import { behaviorContractSchema, type BehaviorContract } from "../src/contracts/schema.js";

const config = postgresAdapterConfigSchema.parse({
  schemaVersion: "1.0",
  adapter: "postgresql",
  connectionEnv: "REALDONE_TEST_DATABASE_URL",
  tls: { mode: "disable" },
  allowCleanup: true,
  resources: {
    customers: {
      schema: "public",
      table: "customers",
      columns: { id: "id", email: "email", name: "display_name" },
      cleanupKey: ["id"],
    },
  },
});

test("PostgreSQL compiler allowlists identifiers and parameterizes values", () => {
  const injection = "rd@example.test' OR TRUE --";
  const compiled = compilePostgresTarget(config, "customers", [
    { field: "email", value: injection },
    { field: "name", env: "RD_CUSTOMER_NAME" },
  ], { RD_CUSTOMER_NAME: "RD_TEST_CUSTOMER" });
  assert.equal(
    compiled.text,
    '"public"."customers" WHERE "email" IS NOT DISTINCT FROM $1 AND "display_name" IS NOT DISTINCT FROM $2',
  );
  assert.deepEqual(compiled.values, [injection, "RD_TEST_CUSTOMER"]);
  assert.equal(compiled.text.includes(injection), false);
});

test("PostgreSQL config rejects non-allowlist identifiers and unknown cleanup keys", () => {
  const unsafe = postgresAdapterConfigSchema.safeParse({
    schemaVersion: "1.0",
    adapter: "postgresql",
    connectionEnv: "DATABASE_URL",
    resources: {
      customers: {
        table: 'customers; DROP TABLE users',
        columns: { id: "id" },
        cleanupKey: ["missing"],
      },
    },
  });
  assert.equal(unsafe.success, false);
});

test("PostgreSQL adapter fails closed without secrets or cleanup confirmation", async () => {
  const adapter = new PostgresSourceAdapter(config);
  const previous = process.env.REALDONE_TEST_DATABASE_URL;
  delete process.env.REALDONE_TEST_DATABASE_URL;
  try {
    await assert.rejects(
      adapter.verify({
        type: "source",
        adapter: "postgresql",
        resource: "customers",
        filters: [{ field: "email", value: "rd@example.test" }],
        state: "present",
      }),
      /Missing PostgreSQL connection environment variable/,
    );
    await assert.rejects(
      adapter.cleanup(
        { adapter: "postgresql", resource: "customers", filters: [{ field: "id", value: "42" }] },
        { confirmed: false },
      ),
      /explicit confirmation/,
    );
  } finally {
    if (previous === undefined) delete process.env.REALDONE_TEST_DATABASE_URL;
    else process.env.REALDONE_TEST_DATABASE_URL = previous;
    await adapter.close();
  }
});

test("behavior contracts preserve Level 6 checks and PostgreSQL cleanup targets", () => {
  const parsed = behaviorContractSchema.parse({
    schemaVersion: "1.0",
    id: "create-customer",
    name: "Create customer",
    baseUrl: "http://localhost:3000",
    createdAt: "2026-07-22T00:00:00.000Z",
    tags: ["critical"],
    steps: [{
      id: "S001",
      type: "navigate",
      pageUrl: "http://localhost:3000/customers",
      atMs: 0,
      expected: [{
        type: "source",
        adapter: "postgresql",
        resource: "customers",
        filters: [{ field: "email", value: "rd@example.test" }],
        state: "present",
        maxMatches: 1,
      }],
    }],
    cleanup: [{
      adapter: "postgresql",
      resource: "customers",
      filters: [{ field: "id", env: "RD_CUSTOMER_ID" }],
    }],
    source: { browser: "Chromium", recordedBy: "realdone" },
  }) as BehaviorContract;
  const ledger = createContractCleanupLedger(parsed, "verification-1");
  assert.equal(ledger.resources.length, 1);
  assert.equal(ledger.resources[0]?.strategy, "postgresql");
  assert.equal(ledger.resources[0]?.status, "pending");
  assert.equal(JSON.stringify(ledger).includes("DATABASE_URL"), false);
});
