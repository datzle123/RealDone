import assert from "node:assert/strict";
import test from "node:test";
import { applyActionPolicy, actionPolicySchema } from "../src/core/policy.js";
import { withRetry } from "../src/core/retry.js";
import { createCleanupLedger } from "../src/cleanup/ledger.js";
import type { ActionPolicy, ActionSpec, Finding, ScanReport } from "../src/types.js";

const action: ActionSpec = {
  id: "save",
  pageUrl: "http://localhost/settings",
  kind: "mutation",
  intent: "update",
  risk: "safe",
  label: "Save settings",
  fingerprint: { selector: "#save", tag: "button", ordinal: 0 },
  fields: [],
};

test("validates and applies action policy overrides and denials", () => {
  const policy = actionPolicySchema.parse({
    schemaVersion: "1.0",
    rules: [
      { match: { label: "Save" }, set: { risk: "destructive" } },
      { match: { url: "/settings" }, effect: "deny", reason: "Fixture policy" },
    ],
  }) as ActionPolicy;
  const result = applyActionPolicy(action, policy);
  assert.equal(result.action.risk, "destructive");
  assert.equal(result.deniedReason, "Fixture policy");
});

test("bounded retry succeeds after transient attempts without unbounded looping", async () => {
  let attempts = 0;
  const value = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      return "ok";
    },
    { retries: 2, baseDelayMs: 1 },
  );
  assert.equal(value, "ok");
  assert.equal(attempts, 3);
});

test("cleanup ledger derives an idempotent resource URL from POST evidence", () => {
  const finding: Finding = {
    id: "RD-001",
    action: { ...action, intent: "create", label: "Create customer" },
    verdict: "VERIFIED",
    evidenceLevel: 5,
    reason: "persisted",
    detectorMatches: [],
    evidence: {
      startedAt: "2026-07-22T00:00:00.000Z",
      durationMs: 100,
      canary: "RD_TEST_123456",
      network: [
        {
          id: "net-1",
          method: "POST",
          url: "http://localhost/api/customers",
          resourceType: "fetch",
          resourceTypeHint: "customers",
          responseResourceId: "42",
          startedAt: 20,
          status: 201,
          ok: true,
        },
      ],
      console: [],
      pageErrors: [],
      uiClaims: [],
      filledFields: [],
      dialogs: [],
      downloads: [],
    },
  };
  const report: ScanReport = {
    schemaVersion: "1.0",
    scanId: "scan",
    targetUrl: "http://localhost",
    startedAt: "2026-07-22T00:00:00.000Z",
    finishedAt: "2026-07-22T00:00:01.000Z",
    options: {
      maxPages: 1,
      maxActions: 1,
      timeoutMs: 1000,
      settleMs: 100,
      maxDurationMs: 10_000,
      maxRetries: 2,
      allowDestructive: false,
      allowExternal: false,
      mutationAllowed: true,
    },
    summary: {
      pagesDiscovered: 1,
      visibleActions: 1,
      actionsVerified: 1,
      actionsSkipped: 0,
      verdicts: { VERIFIED: 1, CONTRADICTORY: 0, EPHEMERAL: 0, BROWSER_LOCAL: 0, BROKEN: 0, NO_EFFECT: 0, UNCERTAIN: 0, SKIPPED: 0 },
    },
    pages: [],
    findings: [finding],
  };
  const ledger = createCleanupLedger(report);
  assert.equal(ledger.resources[0]?.cleanupUrl, "http://localhost/api/customers/42");
  assert.equal(ledger.resources[0]?.status, "pending");
});
