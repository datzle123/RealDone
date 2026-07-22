import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { FirebaseSourceAdapter } from "../src/adapters/firebase/index.js";
import { firebaseAdapterConfigSchema } from "../src/adapters/firebase/config.js";
import { MongoSourceAdapter } from "../src/adapters/mongodb/index.js";
import { mongoAdapterConfigSchema } from "../src/adapters/mongodb/config.js";
import { SupabaseSourceAdapter } from "../src/adapters/supabase/index.js";
import { supabaseAdapterConfigSchema } from "../src/adapters/supabase/config.js";

async function localServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not bind TCP.");
  return { url: `http://127.0.0.1:${address.port}`, close: async () => { server.close(); await once(server, "close"); } };
}

test("Supabase adapter verifies, snapshots, and cleans an allowlisted local PostgREST resource", async () => {
  let deleted = false;
  const fixture = await localServer((request, response) => {
    assert.equal(request.headers.apikey, "supabase-test-key");
    response.setHeader("content-type", "application/json");
    if (request.method === "DELETE") {
      deleted = true;
      response.end(JSON.stringify([{ customer_id: 7, customer_email: "rd@example.test", removed_at: null }]));
      return;
    }
    response.setHeader("content-range", "0-0/1");
    response.end(JSON.stringify([{ customer_id: 7, customer_email: "rd@example.test", removed_at: null }]));
  });
  process.env.RD_SUPABASE_KEY = "supabase-test-key";
  try {
    const config = supabaseAdapterConfigSchema.parse({
      schemaVersion: "1.0",
      adapter: "supabase",
      url: fixture.url,
      keyEnv: "RD_SUPABASE_KEY",
      allowCleanup: true,
      resources: {
        customers: {
          target: "customer_rows",
          fields: {
            id: { target: "customer_id", type: "integer", nullable: false },
            email: { target: "customer_email", type: "text", nullable: false },
            deletedAt: { target: "removed_at", type: "timestamp" },
          },
          primaryKey: ["id"],
          softDeleteFields: ["deletedAt"],
        },
      },
    });
    const adapter = new SupabaseSourceAdapter(config);
    const evidence = await adapter.verify({ type: "source", adapter: "supabase", resource: "customers", filters: [{ field: "email", value: "rd@example.test" }], state: "present", maxMatches: 1 });
    assert.equal(evidence.passed, true);
    assert.equal(JSON.stringify(evidence).includes("rd@example.test"), false);
    const snapshot = await adapter.snapshot("customers", 10);
    assert.equal(snapshot.rows.length, 1);
    assert.equal(snapshot.rows[0]?.softDeleted, false);
    const cleanup = await adapter.cleanup({ adapter: "supabase", resource: "customers", filters: [{ field: "id", value: 7 }] }, { confirmed: true });
    assert.equal(cleanup.deletedRows, 1);
    assert.equal(deleted, true);
    await adapter.close();
    assert.throws(() => new SupabaseSourceAdapter({ ...config, url: "https://project.supabase.co" }), /production access is blocked/);
  } finally {
    delete process.env.RD_SUPABASE_KEY;
    await fixture.close();
  }
});

test("Firebase adapter uses the official REST shapes without exposing document values", async () => {
  let deleted = false;
  const fixture = await localServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "POST" && request.url?.endsWith(":runQuery")) {
      response.end(JSON.stringify([{ document: { name: "projects/demo/databases/(default)/documents/customers/customer-7", fields: { email: { stringValue: "rd@example.test" }, deletedAt: { nullValue: null } } } }]));
      return;
    }
    if (request.method === "DELETE") {
      deleted = true;
      response.end("{}");
      return;
    }
    response.end(JSON.stringify({ documents: [{ name: "projects/demo/databases/(default)/documents/customers/customer-7", fields: { email: { stringValue: "rd@example.test" }, deletedAt: { nullValue: null } } }] }));
  });
  const config = firebaseAdapterConfigSchema.parse({
    schemaVersion: "1.0",
    adapter: "firebase",
    projectId: "demo",
    baseUrl: fixture.url,
    allowCleanup: true,
    resources: {
      customers: {
        target: "customers",
        fields: { id: { target: "__name__", type: "string", nullable: false }, email: { target: "email", type: "string" }, deletedAt: { target: "deletedAt", type: "timestamp" } },
        primaryKey: ["id"],
        softDeleteFields: ["deletedAt"],
      },
    },
  });
  try {
    const adapter = new FirebaseSourceAdapter(config);
    const evidence = await adapter.verify({ type: "source", adapter: "firebase", resource: "customers", filters: [{ field: "email", value: "rd@example.test" }], state: "present", maxMatches: 1 });
    assert.equal(evidence.passed, true);
    assert.equal(JSON.stringify(evidence).includes("rd@example.test"), false);
    assert.equal((await adapter.snapshot("customers")).rows.length, 1);
    assert.equal((await adapter.cleanup({ adapter: "firebase", resource: "customers", filters: [{ field: "id", value: "customer-7" }] }, { confirmed: true })).deletedRows, 1);
    assert.equal(deleted, true);
    assert.throws(() => new FirebaseSourceAdapter({ ...config, baseUrl: "https://firestore.googleapis.com/v1" }), /production access is blocked/);
  } finally {
    await fixture.close();
  }
});

test("MongoDB adapter uses mapped driver filters and primary-key cleanup guards", async () => {
  const rows = [{ _id: "customer-7", email: "rd@example.test", deletedAt: null }];
  const collection = {
    countDocuments: async (query: Record<string, unknown>) => rows.filter((row) => Object.entries(query).every(([key, value]) => row[key as keyof typeof row] === value)).length,
    find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => rows }) }) }),
    deleteMany: async (query: Record<string, unknown>) => {
      const before = rows.length;
      for (let index = rows.length - 1; index >= 0; index -= 1) if (Object.entries(query).every(([key, value]) => rows[index]?.[key as keyof typeof rows[number]] === value)) rows.splice(index, 1);
      return { deletedCount: before - rows.length };
    },
  };
  const fakeClient = { db: () => ({ collection: () => collection }), close: async () => undefined };
  const config = mongoAdapterConfigSchema.parse({
    schemaVersion: "1.0",
    adapter: "mongodb",
    connectionEnv: "RD_MONGODB_URL",
    database: "realdone",
    tls: { mode: "allow-local" },
    allowCleanup: true,
    resources: {
      customers: {
        target: "customers",
        fields: { id: { target: "_id", type: "string", nullable: false }, email: { target: "email", type: "string" }, deletedAt: { target: "deletedAt", type: "date" } },
        primaryKey: ["id"],
        softDeleteFields: ["deletedAt"],
      },
    },
  });
  const adapter = new MongoSourceAdapter(config, fakeClient as never);
  const evidence = await adapter.verify({ type: "source", adapter: "mongodb", resource: "customers", filters: [{ field: "email", value: "rd@example.test" }], state: "present" });
  assert.equal(evidence.passed, true);
  assert.equal((await adapter.snapshot("customers")).rows.length, 1);
  await assert.rejects(adapter.cleanup({ adapter: "mongodb", resource: "customers", filters: [{ field: "email", value: "rd@example.test" }] }, { confirmed: true }), /primary-key fields/);
  assert.equal((await adapter.cleanup({ adapter: "mongodb", resource: "customers", filters: [{ field: "id", value: "customer-7" }] }, { confirmed: true })).deletedRows, 1);
  await adapter.close();
});
