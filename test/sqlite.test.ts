import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SqliteSourceAdapter, compileSqliteTarget } from "../src/adapters/sqlite/index.js";
import { diffSourceSnapshots } from "../src/adapters/types.js";

test("SQLite adapter discovers schema, verifies rows, diffs hashes, and performs guarded cleanup", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "realdone-sqlite-"));
  const file = path.join(directory, "application.sqlite");
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const { default: Database } = await import("better-sqlite3");
  const setup = new Database(file);
  setup.exec("CREATE TABLE customers (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, deleted_at TEXT)");
  setup.prepare("INSERT INTO customers (id, email, name) VALUES (?, ?, ?)").run(1, "rd-test@example.test", "Before");
  setup.close();

  const adapter = new SqliteSourceAdapter(file);
  const schemas = await adapter.discoverSchema();
  assert.equal(schemas.length, 1);
  assert.deepEqual(schemas[0]?.primaryKey, ["id"]);
  assert.equal(schemas[0]?.fields.find((field) => field.name === "id")?.nullable, false);
  assert.deepEqual(schemas[0]?.softDeleteFields, ["deleted_at"]);
  assert.deepEqual(schemas[0]?.fields.map((field) => field.name), ["id", "email", "name", "deleted_at"]);

  process.env.RD_SQLITE_EMAIL = "rd-test@example.test";
  const evidence = await adapter.verify({
    type: "source",
    adapter: "sqlite",
    resource: "customers",
    filters: [{ field: "email", env: "RD_SQLITE_EMAIL" }],
    state: "present",
    maxMatches: 1,
  });
  delete process.env.RD_SQLITE_EMAIL;
  assert.equal(evidence.passed, true);
  assert.equal(evidence.transaction, "read-only");
  assert.equal(JSON.stringify(evidence).includes("rd-test@example.test"), false);
  const before = await adapter.snapshot("customers");

  const mutate = new Database(file);
  mutate.prepare("UPDATE customers SET name = ?, deleted_at = ? WHERE id = ?").run("After", "2026-07-22T00:00:00Z", 1);
  mutate.prepare("INSERT INTO customers (id, email, name) VALUES (?, ?, ?)").run(2, "cleanup@example.test", "Cleanup");
  mutate.close();
  const after = await adapter.snapshot("customers");
  const diff = diffSourceSnapshots(before, after);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.softDeleted.length, 1);
  assert.equal(diff.removed.length, 0);
  await assert.rejects(
    adapter.cleanup({ adapter: "sqlite", resource: "customers", filters: [{ field: "id", value: 2 }] }, { confirmed: true }),
    /disabled by default/,
  );
  await adapter.close();

  const cleanupAdapter = new SqliteSourceAdapter(file, { allowCleanup: true });
  await assert.rejects(
    cleanupAdapter.cleanup({ adapter: "sqlite", resource: "customers", filters: [{ field: "email", value: "cleanup@example.test" }] }, { confirmed: true }),
    /exactly the primary-key fields/,
  );
  const cleanup = await cleanupAdapter.cleanup(
    { adapter: "sqlite", resource: "customers", filters: [{ field: "id", value: 2 }] },
    { confirmed: true },
  );
  assert.equal(cleanup.deletedRows, 1);
  assert.equal((await cleanupAdapter.verify({ type: "source", adapter: "sqlite", resource: "customers", filters: [{ field: "id", value: 2 }], state: "absent" })).passed, true);
  await cleanupAdapter.close();
});

test("SQLite compiler rejects duplicate, unknown, and unsafe fields while parameterizing values", () => {
  assert.deepEqual(
    compileSqliteTarget([{ field: "id", value: 7 }], new Set(["id"])),
    { where: '"id" IS ?', values: [7], fields: ["id"] },
  );
  assert.throws(() => compileSqliteTarget([{ field: "missing", value: 1 }], new Set(["id"])), /does not exist/);
  assert.throws(() => compileSqliteTarget([{ field: "id", value: 1 }, { field: "id", value: 2 }], new Set(["id"])), /Duplicate/);
  assert.throws(() => compileSqliteTarget([{ field: "id\" OR 1=1 --", value: 1 }], new Set(["id\" OR 1=1 --"])), /Unsafe SQLite identifier/);
});
