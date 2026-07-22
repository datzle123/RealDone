import assert from "node:assert/strict";
import test from "node:test";
import { MongoClient } from "mongodb";
import { MongoSourceAdapter } from "../src/adapters/mongodb/index.js";
import { mongoAdapterConfigSchema } from "../src/adapters/mongodb/config.js";
import { diffSourceSnapshots } from "../src/adapters/types.js";

const connectionString = process.env.REALDONE_MONGODB_TEST_URL;

test("MongoDB adapter verifies, snapshots, diffs, and cleans a real server", {
  skip: connectionString ? false : "Set REALDONE_MONGODB_TEST_URL to run the MongoDB integration fixture.",
}, async () => {
  const id = `customer-${Date.now()}`;
  const databaseName = "realdone_integration";
  const client = new MongoClient(connectionString!, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  const collection = client.db(databaseName).collection<{ _id: string; email: string; name: string; deletedAt: Date | null }>("realdone_customers");
  await collection.deleteMany({ _id: id });
  await collection.insertOne({ _id: id, email: `${id}@example.test`, name: "Before", deletedAt: null });

  const config = mongoAdapterConfigSchema.parse({
    schemaVersion: "1.0",
    adapter: "mongodb",
    connectionEnv: "REALDONE_MONGODB_TEST_URL",
    database: databaseName,
    tls: { mode: "allow-local" },
    allowCleanup: true,
    resources: {
      customers: {
        target: "realdone_customers",
        fields: {
          id: { target: "_id", type: "string", nullable: false },
          email: { target: "email", type: "string", nullable: false },
          name: { target: "name", type: "string" },
          deletedAt: { target: "deletedAt", type: "date" },
        },
        primaryKey: ["id"],
        softDeleteFields: ["deletedAt"],
      },
    },
  });
  const adapter = new MongoSourceAdapter(config);
  try {
    const present = await adapter.verify({
      type: "source",
      adapter: "mongodb",
      resource: "customers",
      filters: [{ field: "id", value: id }],
      state: "present",
      maxMatches: 1,
    });
    assert.equal(present.passed, true);
    assert.equal(JSON.stringify(present).includes(id), false);
    assert.deepEqual((await adapter.discoverSchema("customers"))[0]?.primaryKey, ["id"]);

    const before = await adapter.snapshot("customers", 10_000);
    await collection.updateOne({ _id: id }, { $set: { name: "After", deletedAt: new Date() } });
    const after = await adapter.snapshot("customers", 10_000);
    const diff = diffSourceSnapshots(before, after);
    assert.equal(diff.changed.length, 1);
    assert.equal(diff.softDeleted.length, 1);

    const cleanup = await adapter.cleanup(
      { adapter: "mongodb", resource: "customers", filters: [{ field: "id", value: id }] },
      { confirmed: true },
    );
    assert.equal(cleanup.deletedRows, 1);
    assert.equal((await adapter.cleanup(
      { adapter: "mongodb", resource: "customers", filters: [{ field: "id", value: id }] },
      { confirmed: true },
    )).deletedRows, 0);
  } finally {
    await adapter.close();
    await collection.deleteMany({ _id: id });
    await client.close();
  }
});
