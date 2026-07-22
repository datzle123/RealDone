import assert from "node:assert/strict";
import test from "node:test";
import { classifyReplayOutcome, replayExitCode } from "../src/replay.js";

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
});

test("maps reproduced, changed, and inconclusive replay outcomes to distinct exit semantics", () => {
  assert.equal(replayExitCode("FINDING_REPRODUCED"), 0);
  assert.equal(replayExitCode("FINDING_NO_LONGER_REPRODUCED"), 1);
  assert.equal(replayExitCode("ENVIRONMENT_CHANGED"), 2);
  assert.equal(replayExitCode("TARGET_ACTION_NOT_FOUND"), 2);
  assert.equal(replayExitCode("REPLAY_UNCERTAIN"), 2);
});
