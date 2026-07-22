import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";
import { PostgresSourceAdapter } from "../src/adapters/postgres/index.js";
import { diffSourceSnapshots } from "../src/adapters/types.js";
import { postgresAdapterConfigSchema } from "../src/adapters/postgres/config.js";
import { runCleanup, writeCleanupLedger } from "../src/cleanup/ledger.js";

const connectionString = process.env.REALDONE_POSTGRES_TEST_URL;

test("PostgreSQL adapter confirms Level 6 evidence and performs idempotent keyed cleanup", {
  skip: connectionString ? false : "Set REALDONE_POSTGRES_TEST_URL to run the PostgreSQL integration fixture.",
}, async () => {
  const pool = new Pool({ connectionString, ssl: false });
  const marker = `RD_TEST_PG_${Date.now()}`;
  const id = `customer-${Date.now()}`;
  await pool.query(`CREATE TABLE IF NOT EXISTS public.realdone_customers (
    id text PRIMARY KEY,
    email text NOT NULL,
    display_name text NOT NULL
  )`);
  await pool.query("CREATE TABLE IF NOT EXISTS public.realdone_uuid_rows (id uuid PRIMARY KEY)");
  await pool.query("DELETE FROM public.realdone_customers WHERE id = $1", [id]);
  await pool.query(
    "INSERT INTO public.realdone_customers (id, email, display_name) VALUES ($1, $2, $3)",
    [id, `${marker.toLowerCase()}@example.test`, marker],
  );

  const envName = "REALDONE_POSTGRES_TEST_URL";
  const config = postgresAdapterConfigSchema.parse({
    schemaVersion: "1.0",
    adapter: "postgresql",
    connectionEnv: envName,
    tls: { mode: "disable" },
    allowCleanup: true,
    resources: {
      customers: {
        schema: "public",
        table: "realdone_customers",
        columns: { id: "id", email: "email", name: "display_name" },
        cleanupKey: ["id"],
      },
      uuidRows: {
        schema: "public",
        table: "realdone_uuid_rows",
        columns: { id: "id" },
      },
    },
  });
  const adapter = new PostgresSourceAdapter(config);
  const fixtureDirectory = await mkdtemp(path.join(tmpdir(), "realdone-postgres-"));
  try {
    const present = await adapter.verify({
      type: "source",
      adapter: "postgresql",
      resource: "customers",
      filters: [{ field: "name", value: marker }],
      state: "present",
      maxMatches: 1,
    });
    assert.equal(present.passed, true);
    assert.equal(present.matchedRows, 1);
    assert.equal(present.evidenceLevel, 6);
    assert.equal(present.transaction, "read-only");

    const schema = (await adapter.discoverSchema("customers"))[0];
    assert.deepEqual(schema?.primaryKey, ["id"]);
    assert.deepEqual(schema?.fields.map((field) => field.name), ["id", "email", "name"]);
    const before = await adapter.snapshot("customers", 10_000);
    await pool.query("UPDATE public.realdone_customers SET display_name = $1 WHERE id = $2", [`${marker}_UPDATED`, id]);
    const after = await adapter.snapshot("customers", 10_000);
    assert.equal(diffSourceSnapshots(before, after).changed.length, 1);
    await pool.query("UPDATE public.realdone_customers SET display_name = $1 WHERE id = $2", [marker, id]);

    const injection = await adapter.verify({
      type: "source",
      adapter: "postgresql",
      resource: "customers",
      filters: [{ field: "name", value: `${marker}' OR TRUE --` }],
      state: "absent",
    });
    assert.equal(injection.passed, true);

    await assert.rejects(
      adapter.verify({
        type: "source",
        adapter: "postgresql",
        resource: "uuidRows",
        filters: [{ field: "id", value: marker }],
        state: "present",
      }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return message.includes("[REDACTED_SOURCE_VALUE]") && !message.includes(marker);
      },
    );

    const configFile = path.join(fixtureDirectory, "postgres.json");
    await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
    await writeCleanupLedger(fixtureDirectory, {
      schemaVersion: "1.0",
      scanId: "postgres-integration",
      targetUrl: "http://localhost",
      resources: [{
        id: "cleanup-pg-customer",
        findingId: "integration",
        actionId: "create-customer",
        type: "customers",
        canary: marker,
        createdAt: new Date().toISOString(),
        sourceUrl: "postgresql:customers",
        strategy: "postgresql",
        postgres: { adapter: "postgresql", resource: "customers", filters: [{ field: "id", value: id }] },
        dependsOn: [],
        status: "pending",
        attempts: 0,
      }],
    });
    const cleanup = await runCleanup(fixtureDirectory, {
      confirm: true,
      confirmDatabase: true,
      postgresConfigPath: configFile,
      allowHosts: [],
      retries: 0,
    });
    assert.equal(cleanup.cleaned, 1);
    const cleanedAgain = await adapter.cleanup(
      { adapter: "postgresql", resource: "customers", filters: [{ field: "id", value: id }] },
      { confirmed: true },
    );
    assert.equal(cleanedAgain.deletedRows, 0);

    const absent = await adapter.verify({
      type: "source",
      adapter: "postgresql",
      resource: "customers",
      filters: [{ field: "id", value: id }],
      state: "absent",
    });
    assert.equal(absent.passed, true);
  } finally {
    await adapter.close();
    await pool.query("DELETE FROM public.realdone_customers WHERE id = $1", [id]);
    await pool.end();
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});
