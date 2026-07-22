import assert from "node:assert/strict";
import test from "node:test";
import { classifyReplayOutcome, providerRequirementsSatisfied, replayExecutionOptions, replayExitCode, replayPermissionOptions } from "../src/replay.js";
import type { ExecutionEvidence, Reproduction } from "../src/types.js";

const base = {
  environmentStatus: "VALID" as const,
  sourceKnown: true,
  sourceVerdict: "BROKEN" as const,
  sourceDetectorCodes: ["RD003"],
  replayVerdict: "BROKEN" as const,
  replayDetectorCodes: ["RD003"],
  targetNotFound: false,
};

test("classifies every normative replay outcome", () => {
  assert.equal(classifyReplayOutcome(base), "FINDING_REPRODUCED");
  assert.equal(classifyReplayOutcome({ ...base, replayVerdict: "VERIFIED", replayDetectorCodes: [] }), "FINDING_NO_LONGER_REPRODUCED");
  assert.equal(classifyReplayOutcome({ ...base, environmentStatus: "ENVIRONMENT_INVALID" }), "ENVIRONMENT_CHANGED");
  assert.equal(classifyReplayOutcome({ ...base, targetNotFound: true }), "TARGET_ACTION_NOT_FOUND");
  assert.equal(classifyReplayOutcome({ ...base, replayVerdict: "UNCERTAIN", replayDetectorCodes: [] }), "REPLAY_UNCERTAIN");
  assert.equal(classifyReplayOutcome({ ...base, sourceKnown: false }), "REPLAY_UNCERTAIN");
  assert.equal(classifyReplayOutcome({ ...base, providerConfirmationRequired: true, providerConfirmationSatisfied: false }), "REPLAY_UNCERTAIN");
});

test("requires causal passing evidence from every exact recorded provider rule", () => {
  const requirements = {
    automatic: true,
    providers: [{ name: "stripe-test", kind: "payment", resource: "payment-intent", operation: "succeeded", state: "confirmed" }],
  } satisfies NonNullable<Reproduction["providerRequirements"]>;
  const providerEvidence = {
    provider: "stripe-test",
    kind: "payment",
    resource: "payment-intent",
    operation: "succeeded",
    state: "confirmed",
    found: true,
    passed: true,
    evidenceLevel: 6,
    durationMs: 1,
    detail: "Confirmed in the provider sandbox.",
    automaticLinkage: { referenceSource: "response-resource-id", causallyLinked: true, requestId: "request-1" },
  } as const;
  const evidence = (overrides: Partial<ExecutionEvidence>): ExecutionEvidence => ({
    startedAt: "2026-07-23T00:00:00.000Z",
    durationMs: 1,
    canary: "RD_TEST",
    network: [],
    console: [],
    pageErrors: [],
    uiClaims: [],
    filledFields: [],
    dialogs: [],
    downloads: [],
    ...overrides,
  });

  assert.equal(providerRequirementsSatisfied(requirements, evidence({ providerEvidence: [providerEvidence] })), true);
  assert.equal(providerRequirementsSatisfied(requirements, evidence({})), false, "missing provider proof must fail closed");
  assert.equal(providerRequirementsSatisfied(requirements, evidence({
    providerEvidence: [{ ...providerEvidence, kind: "email" }],
  })), false, "a provider with the wrong kind cannot satisfy the source requirement");
  assert.equal(providerRequirementsSatisfied(requirements, evidence({
    providerEvidence: [{ ...providerEvidence, resource: "checkout-session" }],
  })), false, "a different resource rule from the same provider cannot satisfy replay");
  assert.equal(providerRequirementsSatisfied(requirements, evidence({
    providerEvidence: [{ ...providerEvidence, operation: "created" }],
  })), false, "a different operation rule from the same provider cannot satisfy replay");
  assert.equal(providerRequirementsSatisfied(requirements, evidence({
    providerEvidence: [{ ...providerEvidence, passed: false }],
  })), false, "failed provider evidence cannot satisfy replay");
  assert.equal(providerRequirementsSatisfied(requirements, evidence({
    providerEvidence: [{ ...providerEvidence, automaticLinkage: { ...providerEvidence.automaticLinkage, causallyLinked: false } }],
  })), false, "non-causal provider evidence cannot satisfy replay");
  assert.equal(providerRequirementsSatisfied(requirements, evidence({
    providerEvidence: [providerEvidence],
    providerErrors: [{ provider: "stripe-test", kind: "payment", resource: "payment-intent", operation: "succeeded", state: "confirmed", detail: "Sandbox unavailable." }],
  })), false, "a provider error cannot be hidden by another passing check");
});

test("replay requires fresh side-effect authority instead of inheriting source grants", () => {
  assert.deepEqual(replayPermissionOptions({ outputRoot: ".realdone", headed: false }), {
    allowDestructive: false,
    allowExternal: false,
    allowHosts: [],
  });
  assert.deepEqual(replayPermissionOptions({
    outputRoot: ".realdone",
    headed: false,
    allowDestructive: true,
    allowExternal: true,
    allowHosts: ["staging.example.test", "staging.example.test"],
  }), {
    allowDestructive: true,
    allowExternal: true,
    allowHosts: ["staging.example.test"],
  });
  assert.deepEqual(replayExecutionOptions({
    timeoutMs: 1_000,
    settleMs: 10,
    maxDurationMs: 2_000,
    maxRetries: 1,
    allowDestructive: true,
    allowExternal: true,
    deep: false,
    trace: false,
    traceOnFailure: false,
    video: false,
  }, { outputRoot: ".realdone", headed: false }), {
    timeoutMs: 1_000,
    settleMs: 10,
    maxDurationMs: 2_000,
    maxRetries: 1,
    allowDestructive: false,
    allowExternal: false,
    deep: false,
    trace: false,
    traceOnFailure: false,
    video: false,
    allowHosts: [],
  });
});

test("maps reproduced, changed, and inconclusive replay outcomes to distinct exit semantics", () => {
  assert.equal(replayExitCode("FINDING_REPRODUCED"), 0);
  assert.equal(replayExitCode("FINDING_NO_LONGER_REPRODUCED"), 1);
  assert.equal(replayExitCode("ENVIRONMENT_CHANGED"), 2);
  assert.equal(replayExitCode("TARGET_ACTION_NOT_FOUND"), 2);
  assert.equal(replayExitCode("REPLAY_UNCERTAIN"), 2);
});
