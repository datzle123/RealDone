import assert from "node:assert/strict";
import test from "node:test";
import { detect } from "../src/detectors/index.js";
import type { ActionSpec, ExecutionEvidence, StateSnapshot } from "../src/types.js";

const action: ActionSpec = {
  id: "create-customer",
  pageUrl: "http://localhost:3000/customers",
  kind: "mutation",
  intent: "create",
  risk: "safe",
  label: "Create customer",
  fingerprint: { selector: "form", tag: "form", ordinal: 0 },
  fields: [],
};

function state(at: number, domHash: string, canaryPresent: boolean): StateSnapshot {
  return {
    at,
    url: "http://localhost:3000/customers",
    domHash,
    title: "Customers",
    canaryPresent,
    storage: { local: [], session: [], cookieNames: [] },
  };
}

function evidence(overrides: Partial<ExecutionEvidence> = {}): ExecutionEvidence {
  return {
    startedAt: new Date(0).toISOString(),
    durationMs: 500,
    canary: "RD_TEST_ABC123",
    before: state(0, "before", false),
    after: state(100, "after", true),
    afterRefresh: state(400, "refresh", true),
    network: [{ id: "net-1", method: "POST", url: "http://localhost/api/customers", resourceType: "fetch", startedAt: 50, finishedAt: 80, status: 201, ok: true }],
    console: [],
    pageErrors: [],
    uiClaims: [],
    filledFields: [],
    dialogs: [],
    downloads: [],
    ...overrides,
  };
}

test("verifies a mutation only when the canary survives reload", () => {
  const result = detect(action, evidence());
  assert.equal(result.verdict, "VERIFIED");
  assert.equal(result.evidenceLevel, 5);
});

test("detects fake create after refresh disappearance", () => {
  const result = detect(action, evidence({ afterRefresh: state(400, "before", false), network: [] }));
  assert.equal(result.verdict, "EPHEMERAL");
  assert.ok(result.detectorMatches.some((item) => item.code === "RD201"));
});

test("detects a false success when the write fails", () => {
  const result = detect(
    { ...action, intent: "update", label: "Save settings" },
    evidence({
      after: state(100, "after", false),
      afterRefresh: state(400, "before", false),
      network: [{ id: "net-1", method: "PATCH", url: "http://localhost/api/settings", resourceType: "fetch", startedAt: 50, finishedAt: 80, status: 500, ok: false }],
      uiClaims: [{ kind: "success", text: "Saved successfully", at: 60 }],
    }),
  );
  assert.equal(result.verdict, "CONTRADICTORY");
  assert.ok(result.detectorMatches.some((item) => item.code === "RD302"));
});

test("detects duplicate write submissions", () => {
  const request = { id: "net-1", method: "POST", url: "http://localhost/api/customers", resourceType: "fetch", startedAt: 50, finishedAt: 80, status: 201, ok: true };
  const result = detect(action, evidence({ network: [request, { ...request, id: "net-2", startedAt: 55 }] }));
  assert.equal(result.verdict, "BROKEN");
  assert.ok(result.detectorMatches.some((item) => item.code === "RD003"));
});

test("detects fake deletion when a removed target returns", () => {
  const result = detect(
    { ...action, intent: "delete", risk: "destructive", label: "Delete customer" },
    evidence({ targetText: "Alice Delete customer", targetVisibleAfter: false, targetVisibleAfterRefresh: true }),
  );
  assert.equal(result.verdict, "EPHEMERAL");
  assert.ok(result.detectorMatches.some((item) => item.code === "RD203"));
});
