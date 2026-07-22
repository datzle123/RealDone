import { z } from "zod";

const platformSchema = z.enum(["linux", "macos", "windows"]);
export const releaseExternalCaseSchema = z.object({
  name: z.string().min(1),
  repository: z.string().min(1),
  pinnedCommit: z.string().regex(/^[0-9a-f]{7,40}$/i),
  evidenceFile: z.string().min(1),
  status: z.enum(["passed", "failed", "blocked"]),
  environmentValid: z.boolean(),
  severeRegressions: z.number().int().nonnegative(),
});

const releaseChecksSchema = z.object({
  typecheck: z.boolean(),
  unitTests: z.boolean(),
  browserIntegration: z.boolean(),
  cleanup: z.boolean(),
  environmentHealth: z.boolean(),
  schemaCompatibility: z.boolean(),
  artifactSecrets: z.boolean(),
});

const releaseBenchmarkSchema = z.object({
  truncated: z.boolean(),
  expectationCoverage: z.number().min(0).max(1),
  verdictAccuracy: z.number().min(0).max(1),
  detectorAccuracy: z.number().min(0).max(1),
  falsePositiveRate: z.number().min(0).max(1),
  replaySuccessRate: z.number().min(0).max(1),
  cleanupSuccess: z.number().min(0).max(1),
  environmentValidity: z.number().min(0).max(1),
});

export const releaseRunAttestationSchema = z.object({
  schemaVersion: z.literal("1.0"),
  generatedAt: z.string().min(1),
  source: z.string().min(1),
  platform: platformSchema,
  checks: releaseChecksSchema,
  benchmark: releaseBenchmarkSchema,
});

export const releaseGateEvidenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  generatedAt: z.string().min(1),
  checks: releaseChecksSchema,
  benchmark: releaseBenchmarkSchema,
  platforms: z.array(platformSchema),
  externalCases: z.array(releaseExternalCaseSchema),
});

export type ReleaseGateEvidence = z.infer<typeof releaseGateEvidenceSchema>;
export type ReleaseRunAttestation = z.infer<typeof releaseRunAttestationSchema>;
export type ReleaseExternalCase = z.infer<typeof releaseExternalCaseSchema>;
export type ReleasePlatform = z.infer<typeof platformSchema>;

export interface ReleaseGateThresholds {
  verdictAccuracy: number;
  detectorAccuracy: number;
  replaySuccessRate: number;
  requiredExternalCases: number;
}

export interface ReleaseGateResult {
  id: `RG${string}`;
  specificationItem: number;
  name: string;
  passed: boolean;
  expected: string;
  observed: string;
}

export interface ReleaseGateReport {
  schemaVersion: "1.0";
  generatedAt: string;
  passed: boolean;
  passedGates: number;
  totalGates: 15;
  thresholds: ReleaseGateThresholds;
  gates: ReleaseGateResult[];
}

const defaultThresholds: ReleaseGateThresholds = {
  verdictAccuracy: 1,
  detectorAccuracy: 1,
  replaySuccessRate: 1,
  requiredExternalCases: 3,
};

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export function mergeReleaseGateEvidence(attestationInput: unknown, externalCaseInput: unknown): ReleaseGateEvidence {
  const attestations = z.array(releaseRunAttestationSchema).min(1).parse(attestationInput);
  const externalCases = z.array(releaseExternalCaseSchema).parse(externalCaseInput);
  const minimum = (select: (attestation: ReleaseRunAttestation) => number): number => Math.min(...attestations.map(select));
  const maximum = (select: (attestation: ReleaseRunAttestation) => number): number => Math.max(...attestations.map(select));
  const everyCheck = (select: (attestation: ReleaseRunAttestation) => boolean): boolean => attestations.every(select);
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    checks: {
      typecheck: everyCheck((item) => item.checks.typecheck),
      unitTests: everyCheck((item) => item.checks.unitTests),
      browserIntegration: everyCheck((item) => item.checks.browserIntegration),
      cleanup: everyCheck((item) => item.checks.cleanup),
      environmentHealth: everyCheck((item) => item.checks.environmentHealth),
      schemaCompatibility: everyCheck((item) => item.checks.schemaCompatibility),
      artifactSecrets: everyCheck((item) => item.checks.artifactSecrets),
    },
    benchmark: {
      truncated: attestations.some((item) => item.benchmark.truncated),
      expectationCoverage: minimum((item) => item.benchmark.expectationCoverage),
      verdictAccuracy: minimum((item) => item.benchmark.verdictAccuracy),
      detectorAccuracy: minimum((item) => item.benchmark.detectorAccuracy),
      falsePositiveRate: maximum((item) => item.benchmark.falsePositiveRate),
      replaySuccessRate: minimum((item) => item.benchmark.replaySuccessRate),
      cleanupSuccess: minimum((item) => item.benchmark.cleanupSuccess),
      environmentValidity: minimum((item) => item.benchmark.environmentValidity),
    },
    platforms: [...new Set(attestations.map((item) => item.platform))].sort(),
    externalCases,
  };
}

export function evaluateReleaseGates(
  input: unknown,
  thresholdOverrides: Partial<ReleaseGateThresholds> = {},
): ReleaseGateReport {
  const evidence = releaseGateEvidenceSchema.parse(input);
  const thresholds = { ...defaultThresholds, ...thresholdOverrides };
  if (
    thresholds.verdictAccuracy < 0 || thresholds.verdictAccuracy > 1
    || thresholds.detectorAccuracy < 0 || thresholds.detectorAccuracy > 1
    || thresholds.replaySuccessRate < 0 || thresholds.replaySuccessRate > 1
    || !Number.isInteger(thresholds.requiredExternalCases) || thresholds.requiredExternalCases < 1
  ) {
    throw new Error("Invalid release-gate thresholds.");
  }
  const platforms = new Set(evidence.platforms);
  const requiredPlatforms: ReleasePlatform[] = ["linux", "macos", "windows"];
  const externalPassed = evidence.externalCases.filter((item) =>
    item.status === "passed" && item.environmentValid && item.severeRegressions === 0,
  );
  const gates: ReleaseGateResult[] = [
    { id: "RG01", specificationItem: 1, name: "Typecheck", passed: evidence.checks.typecheck, expected: "pass", observed: evidence.checks.typecheck ? "pass" : "fail" },
    { id: "RG02", specificationItem: 2, name: "Unit tests", passed: evidence.checks.unitTests, expected: "pass", observed: evidence.checks.unitTests ? "pass" : "fail" },
    { id: "RG03", specificationItem: 3, name: "Browser integration", passed: evidence.checks.browserIntegration, expected: "pass", observed: evidence.checks.browserIntegration ? "pass" : "fail" },
    { id: "RG04", specificationItem: 4, name: "Benchmark completeness", passed: !evidence.benchmark.truncated, expected: "not truncated", observed: evidence.benchmark.truncated ? "truncated" : "complete" },
    { id: "RG05", specificationItem: 5, name: "Expectation coverage", passed: evidence.benchmark.expectationCoverage === 1, expected: "100.00%", observed: percent(evidence.benchmark.expectationCoverage) },
    { id: "RG06", specificationItem: 6, name: "Verdict accuracy", passed: evidence.benchmark.verdictAccuracy >= thresholds.verdictAccuracy, expected: `>= ${percent(thresholds.verdictAccuracy)}`, observed: percent(evidence.benchmark.verdictAccuracy) },
    { id: "RG07", specificationItem: 7, name: "Detector accuracy", passed: evidence.benchmark.detectorAccuracy >= thresholds.detectorAccuracy, expected: `>= ${percent(thresholds.detectorAccuracy)}`, observed: percent(evidence.benchmark.detectorAccuracy) },
    { id: "RG08", specificationItem: 8, name: "Correct-control false positives", passed: evidence.benchmark.falsePositiveRate === 0, expected: "0.00%", observed: percent(evidence.benchmark.falsePositiveRate) },
    { id: "RG09", specificationItem: 9, name: "Replay success", passed: evidence.benchmark.replaySuccessRate >= thresholds.replaySuccessRate, expected: `>= ${percent(thresholds.replaySuccessRate)}`, observed: percent(evidence.benchmark.replaySuccessRate) },
    { id: "RG10", specificationItem: 10, name: "Cleanup", passed: evidence.checks.cleanup && evidence.benchmark.cleanupSuccess === 1, expected: "pass and 100.00%", observed: `${evidence.checks.cleanup ? "pass" : "fail"}; ${percent(evidence.benchmark.cleanupSuccess)}` },
    { id: "RG11", specificationItem: 11, name: "Environment health", passed: evidence.checks.environmentHealth && evidence.benchmark.environmentValidity === 1, expected: "pass and 100.00%", observed: `${evidence.checks.environmentHealth ? "pass" : "fail"}; ${percent(evidence.benchmark.environmentValidity)}` },
    { id: "RG12", specificationItem: 12, name: "Cross-platform smoke", passed: requiredPlatforms.every((platform) => platforms.has(platform)), expected: requiredPlatforms.join(", "), observed: [...platforms].sort().join(", ") || "none" },
    { id: "RG13", specificationItem: 13, name: "Report schema compatibility", passed: evidence.checks.schemaCompatibility, expected: "pass", observed: evidence.checks.schemaCompatibility ? "pass" : "fail" },
    { id: "RG14", specificationItem: 14, name: "Artifact secret scan", passed: evidence.checks.artifactSecrets, expected: "no findings", observed: evidence.checks.artifactSecrets ? "no findings" : "findings or scan failure" },
    { id: "RG15", specificationItem: 15, name: "External case studies", passed: externalPassed.length >= thresholds.requiredExternalCases && externalPassed.length === evidence.externalCases.length, expected: `>= ${thresholds.requiredExternalCases} passed; valid environment; zero severe regressions`, observed: `${externalPassed.length}/${evidence.externalCases.length} passed` },
  ];
  const passedGates = gates.filter((gate) => gate.passed).length;
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    passed: passedGates === gates.length,
    passedGates,
    totalGates: 15,
    thresholds,
    gates,
  };
}
