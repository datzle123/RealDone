import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReleaseGates, mergeReleaseGateEvidence, type ReleaseGateEvidence, type ReleaseRunAttestation } from "../src/release/gates.js";

function passingEvidence(): ReleaseGateEvidence {
  return {
    schemaVersion: "1.0",
    generatedAt: "2026-07-22T00:00:00.000Z",
    checks: {
      typecheck: true,
      unitTests: true,
      browserIntegration: true,
      cleanup: true,
      environmentHealth: true,
      schemaCompatibility: true,
      artifactSecrets: true,
    },
    benchmark: {
      truncated: false,
      expectationCoverage: 1,
      verdictAccuracy: 1,
      detectorAccuracy: 1,
      falsePositiveRate: 0,
      replaySuccessRate: 1,
      cleanupSuccess: 1,
      environmentValidity: 1,
    },
    platforms: ["linux", "macos", "windows"],
    externalCases: ["TodoMVC", "Actual Budget", "Conduit"].map((name, index) => ({
      name,
      repository: `example/case-${index}`,
      pinnedCommit: `abcdef${index}`,
      evidenceFile: `external/case-${index}.json`,
      evidenceSha256: "a".repeat(64),
      engineFingerprint: "b".repeat(64),
      status: "passed" as const,
      environmentValid: true,
      severeRegressions: 0,
      capabilities: [
        ["upload", "export", "ai-generated"],
        ["postgresql", "supabase", "multi-role"],
        ["backend-crud", "authentication", "multi-step"],
      ][index] as ReleaseGateEvidence["externalCases"][number]["capabilities"],
    })),
  };
}

test("all 15 normative release gates pass only with complete evidence", () => {
  const report = evaluateReleaseGates(passingEvidence());
  assert.equal(report.passed, true);
  assert.equal(report.passedGates, 15);
  assert.equal(report.totalGates, 15);
  assert.deepEqual(report.gates.map((gate) => gate.specificationItem), Array.from({ length: 15 }, (_, index) => index + 1));
});

test("release evaluator identifies every failed gate independently", () => {
  const evidence = passingEvidence();
  evidence.checks = Object.fromEntries(Object.keys(evidence.checks).map((key) => [key, false])) as ReleaseGateEvidence["checks"];
  evidence.benchmark = {
    truncated: true,
    expectationCoverage: 0.99,
    verdictAccuracy: 0.98,
    detectorAccuracy: 0.97,
    falsePositiveRate: 0.01,
    replaySuccessRate: 0.96,
    cleanupSuccess: 0.95,
    environmentValidity: 0.94,
  };
  evidence.platforms = ["linux"];
  const firstCase = evidence.externalCases[0];
  assert.ok(firstCase);
  evidence.externalCases[0] = { ...firstCase, status: "failed", severeRegressions: 1 };

  const report = evaluateReleaseGates(evidence);
  assert.equal(report.passed, false);
  assert.equal(report.passedGates, 0);
  assert.deepEqual(report.gates.filter((gate) => !gate.passed).map((gate) => gate.id), Array.from({ length: 15 }, (_, index) => `RG${String(index + 1).padStart(2, "0")}`));
});

test("release evaluator rejects incomplete or invented evidence", () => {
  const evidence = passingEvidence() as unknown as Record<string, unknown>;
  delete evidence.externalCases;
  assert.throws(() => evaluateReleaseGates(evidence));
  assert.throws(() => evaluateReleaseGates(passingEvidence(), { requiredExternalCases: 0 }));
});

test("external gate requires every normative real-world capability instead of only a case count", () => {
  const evidence = passingEvidence();
  for (const externalCase of evidence.externalCases) {
    externalCase.capabilities = externalCase.capabilities.filter((capability) => capability !== "supabase");
  }
  const gate = evaluateReleaseGates(evidence).gates.find((candidate) => candidate.id === "RG15");
  assert.equal(gate?.passed, false);
  assert.match(gate?.observed ?? "", /missing supabase/);
});

test("platform attestations merge with worst-case metrics instead of hiding a failing run", () => {
  const evidence = passingEvidence();
  const attestations = evidence.platforms.map((platform): ReleaseRunAttestation => ({
    schemaVersion: "1.0",
    generatedAt: evidence.generatedAt,
      source: "candidate-sha",
    platform,
    checks: structuredClone(evidence.checks),
    benchmark: structuredClone(evidence.benchmark),
  }));
  const windows = attestations.find((item) => item.platform === "windows");
  assert.ok(windows);
  windows.benchmark.verdictAccuracy = 0.75;

  const merged = mergeReleaseGateEvidence(attestations, evidence.externalCases, true);
  assert.equal(merged.benchmark.verdictAccuracy, 0.75);
  assert.deepEqual(merged.platforms, ["linux", "macos", "windows"]);
  const report = evaluateReleaseGates(merged);
  assert.equal(report.gates.find((gate) => gate.id === "RG06")?.passed, false);

  attestations[1] = { ...attestations[1]!, source: "different-sha" };
  assert.throws(
    () => mergeReleaseGateEvidence(attestations, evidence.externalCases, true),
    /same source revision/,
  );
});

test("committed external-artifact secret failures are folded into RG14", () => {
  const evidence = passingEvidence();
  const attestations = evidence.platforms.map((platform): ReleaseRunAttestation => ({
    schemaVersion: "1.0",
    generatedAt: evidence.generatedAt,
      source: "candidate-sha",
    platform,
    checks: structuredClone(evidence.checks),
    benchmark: structuredClone(evidence.benchmark),
  }));

  assert.equal(mergeReleaseGateEvidence(attestations, evidence.externalCases, true).checks.artifactSecrets, true);
  const merged = mergeReleaseGateEvidence(attestations, evidence.externalCases, false);
  assert.equal(merged.checks.artifactSecrets, false);
  assert.equal(evaluateReleaseGates(merged).gates.find((gate) => gate.id === "RG14")?.passed, false);
});
