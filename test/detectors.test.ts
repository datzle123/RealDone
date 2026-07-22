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

test("classifies refresh-only persistence as browser-local in deep mode", () => {
  const result = detect(action, evidence({
    afterNewContext: state(600, "fresh", false),
    network: [],
    uiClaims: [{ kind: "success", text: "Saved locally", at: 80 }],
  }));
  assert.equal(result.verdict, "BROWSER_LOCAL");
  assert.equal(result.evidenceLevel, 5);
  assert.ok(result.detectorMatches.some((item) => item.code === "RD102"));
  assert.equal(result.detectorMatches.some((item) => item.code === "RD301"), false);
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
  const result = detect(action, evidence({
    network: [request, { ...request, id: "net-2", startedAt: 55 }],
    afterRefresh: state(400, "before", false),
  }));
  assert.equal(result.verdict, "BROKEN");
  assert.ok(result.detectorMatches.some((item) => item.code === "RD003"));
});

test("detects stuck loading and pending network work", () => {
  const result = detect(
    { ...action, kind: "local", intent: "interact", label: "Load forever" },
    evidence({ targetBusyAfter: true, networkSettled: false, network: [] }),
  );
  assert.equal(result.verdict, "BROKEN");
  assert.ok(result.detectorMatches.some((item) => item.code === "RD004"));
});

test("adds broken-navigation evidence for failed documents", () => {
  const result = detect(
    { ...action, kind: "navigation", intent: "navigate", label: "Open missing page" },
    evidence({
      after: state(100, "before", false),
      network: [{ id: "net-doc", method: "GET", url: "http://localhost/missing", resourceType: "document", startedAt: 20, status: 404, ok: false }],
    }),
  );
  assert.equal(result.verdict, "BROKEN");
  assert.ok(result.detectorMatches.some((item) => item.code === "RD005"));
});

test("links duplicate writes to a control that remained enabled", () => {
  const request = { id: "net-1", method: "POST", url: "http://localhost/api/customers", resourceType: "fetch", startedAt: 50, status: 201, ok: true };
  const result = detect(action, evidence({ network: [request, { ...request, id: "net-2" }], targetDisabledAfter: false }));
  assert.ok(result.detectorMatches.some((item) => item.code === "RD006"));
});

test("detects a discovered Enter action with no effect", () => {
  const before = state(0, "same", false);
  const result = detect(
    { ...action, activation: "enter", label: "New message" },
    evidence({ before, after: state(100, "same", false), afterRefresh: state(400, "same", false), network: [] }),
  );
  assert.equal(result.verdict, "BROKEN");
  assert.ok(result.detectorMatches.some((item) => item.code === "RD007"));
});

test("distinguishes new-session, memory-only, and app-restart persistence failures", () => {
  const newSession = detect(action, evidence({ afterNewContext: state(700, "fresh", false), network: [] }));
  assert.ok(newSession.detectorMatches.some((item) => item.code === "RD103"));

  const memoryOnly = detect(action, evidence({ afterRefresh: state(400, "before", false), network: [] }));
  assert.ok(memoryOnly.detectorMatches.some((item) => item.code === "RD104"));

  const appRestart = detect(action, evidence({
    afterHardRefresh: state(500, "hard", true),
    afterAppRestart: state(900, "restart", false),
  }));
  assert.ok(appRestart.detectorMatches.some((item) => item.code === "RD105"));
});

test("detects partial and wrong-resource API update read-backs", () => {
  const partial = detect(
    { ...action, intent: "update", label: "Save profile" },
    evidence({ apiReadBack: { url: "http://localhost/api/profile", status: 200, ok: true, canaryPresent: true, expectedFieldValues: 2, matchedFieldValues: 1 } }),
  );
  assert.ok(partial.detectorMatches.some((item) => item.code === "RD204"));

  const wrong = detect(
    { ...action, intent: "update", label: "Save profile" },
    evidence({ apiReadBack: { url: "http://localhost/api/profile", status: 200, ok: true, canaryPresent: false, expectedFieldValues: 2, matchedFieldValues: 0 } }),
  );
  assert.equal(wrong.verdict, "BROKEN");
  assert.ok(wrong.detectorMatches.some((item) => item.code === "RD205"));
});

test("detects redirects to hard-coded success endpoints without a write", () => {
  const after = { ...state(100, "success", true), url: "http://localhost/success-complete" };
  const result = detect(action, evidence({ after, afterRefresh: { ...after, at: 400 }, network: [] }));
  assert.equal(result.verdict, "CONTRADICTORY");
  assert.ok(result.detectorMatches.some((item) => item.code === "RD304"));
  assert.ok(result.detectorMatches.some((item) => item.code === "RD305"));
});

test("detects fake deletion when a removed target returns", () => {
  const result = detect(
    { ...action, intent: "delete", risk: "destructive", label: "Delete customer" },
    evidence({ targetText: "Alice Delete customer", targetVisibleAfter: false, targetVisibleAfterRefresh: true }),
  );
  assert.equal(result.verdict, "EPHEMERAL");
  assert.ok(result.detectorMatches.some((item) => item.code === "RD203"));
});

test("does not call a missing semantic target a broken application action", () => {
  const result = detect(action, evidence({
    executionError: "No visible element matched the semantic fingerprint. The action was not executed.",
    targetNotFound: true,
  }));
  assert.equal(result.verdict, "UNCERTAIN");
  assert.equal(result.detectorMatches.some((item) => item.code === "RD001"), false);
});

test("keeps generated login credential rejection uncertain", () => {
  const login = {
    ...action,
    label: "Login",
    intent: "submit" as const,
    fields: [
      { selector: "#email", tag: "input" as const, type: "email", name: "email", required: true, disabled: false },
      { selector: "#password", tag: "input" as const, type: "password", name: "password", required: true, disabled: false },
    ],
  };
  const result = detect(login, evidence({
    after: state(100, "filled", true),
    afterRefresh: state(400, "empty", false),
    network: [{ id: "net-1", method: "POST", url: "http://localhost/api/users/login", resourceType: "fetch", startedAt: 50, finishedAt: 80, status: 404, ok: false }],
  }));
  assert.equal(result.verdict, "UNCERTAIN");
  assert.equal(result.detectorMatches.some((item) => ["RD001", "RD101", "RD303"].includes(item.code)), false);
});
