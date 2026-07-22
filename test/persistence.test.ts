import assert from "node:assert/strict";
import test from "node:test";
import { resolvePersistenceScope } from "../src/browser/executor.js";
import type { ExecutionEvidence, StateSnapshot } from "../src/types.js";

function state(canaryPresent: boolean): StateSnapshot {
  return {
    at: 1,
    url: "http://127.0.0.1/resource",
    domHash: canaryPresent ? "present" : "absent",
    title: "Persistence control",
    canaryPresent,
    storage: { local: [], session: [], cookieNames: [] },
  };
}

function evidence(overrides: Partial<ExecutionEvidence>): ExecutionEvidence {
  return {
    startedAt: new Date(0).toISOString(),
    durationMs: 1,
    canary: "RD_TEST_SCOPE",
    network: [],
    console: [],
    pageErrors: [],
    uiClaims: [],
    filledFields: [],
    dialogs: [],
    downloads: [],
    ...overrides,
  };
}

test("resolves observable browser and backend persistence scopes", () => {
  assert.equal(resolvePersistenceScope(evidence({ after: state(true) })), "MEMORY_ONLY");
  assert.equal(resolvePersistenceScope(evidence({ after: state(true), afterRefresh: state(true) })), "TAB_PERSISTENT");
  assert.equal(resolvePersistenceScope(evidence({ after: state(true), afterRefresh: state(true), afterHardRefresh: state(true) })), "SESSION_PERSISTENT");
  assert.equal(resolvePersistenceScope(evidence({
    after: state(true),
    afterRefresh: state(true),
    afterHardRefresh: state(true),
    afterNewTab: state(true),
    afterNewContext: state(false),
  })), "BROWSER_LOCAL");
  assert.equal(resolvePersistenceScope(evidence({
    after: state(true),
    afterRefresh: state(true),
    afterHardRefresh: state(true),
    afterNewTab: state(true),
    afterNewContext: state(true),
  })), "BACKEND_PERSISTENT");
  assert.equal(resolvePersistenceScope(evidence({ apiReadBack: { url: "http://127.0.0.1/api/resource/1", ok: true, canaryPresent: true } })), "BACKEND_PERSISTENT");
});
