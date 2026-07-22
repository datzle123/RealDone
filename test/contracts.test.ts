import assert from "node:assert/strict";
import test from "node:test";
import { behaviorContractSchema } from "../src/contracts/schema.js";

test("behavior contract schema accepts deterministic interaction steps", () => {
  const result = behaviorContractSchema.safeParse({
    schemaVersion: "1.0",
    id: "create-customer",
    name: "Create customer",
    baseUrl: "http://localhost:3000",
    createdAt: "2026-07-22T00:00:00.000Z",
    tags: ["critical"],
    steps: [
      {
        id: "S001",
        type: "navigate",
        pageUrl: "http://localhost:3000/customers",
        url: "http://localhost:3000/customers",
        atMs: 0,
        expected: [],
      },
      {
        id: "S002",
        type: "click",
        pageUrl: "http://localhost:3000/customers",
        atMs: 500,
        fingerprint: { selector: "#create", tag: "button", ordinal: 0 },
        expected: [{ type: "request", method: "POST", urlPattern: "^/api/customers$", status: 201 }],
      },
    ],
    cleanup: [],
    source: { browser: "Chromium", recordedBy: "realdone" },
  });
  assert.equal(result.success, true);
});

test("behavior contract schema rejects empty flows", () => {
  const result = behaviorContractSchema.safeParse({
    schemaVersion: "1.0",
    id: "empty",
    name: "Empty",
    baseUrl: "http://localhost:3000",
    createdAt: "2026-07-22T00:00:00.000Z",
    steps: [],
    source: { browser: "Chromium", recordedBy: "realdone" },
  });
  assert.equal(result.success, false);
});
