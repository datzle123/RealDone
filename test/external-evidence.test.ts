import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  calculateReleaseEngineFingerprint,
  validateExternalCaseEvidenceFiles,
  type ExternalCaseEvidenceDocument,
} from "../src/release/external-evidence.js";

const fingerprint = "b".repeat(64);

function document(): ExternalCaseEvidenceDocument {
  return {
    schemaVersion: "1.0",
    generatedAt: "2026-07-22T00:00:00.000Z",
    engineFingerprint: fingerprint,
    case: {
      name: "External control",
      repository: "example/external-control",
      pinnedCommit: "abcdef0",
      status: "passed",
      environmentValid: true,
      severeRegressions: 0,
      capabilities: [],
    },
    scan: {
      scanId: "scan-1",
      sourceArtifact: "scan.json",
      sourceSha256: "c".repeat(64),
      environmentStatus: "VALID",
      truncated: false,
      pagesDiscovered: 1,
      visibleActions: 1,
      actionsVerified: 1,
      actionsSkipped: 0,
      verdicts: { VERIFIED: 1 },
    },
    artifacts: [],
    assertions: [{ id: "control", passed: true, expected: "VERIFIED", observed: "VERIFIED", evidenceArtifacts: ["scan"] }],
  };
}

test("validates bound external-case evidence and rejects stale or changed evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "realdone-external-evidence-"));
  await mkdir(path.join(root, "release", "evidence"), { recursive: true });
  const source = {
    schemaVersion: "1.0",
    scanId: "scan-1",
    summary: {
      pagesDiscovered: 1,
      visibleActions: 1,
      actionsVerified: 1,
      actionsSkipped: 0,
      verdicts: { VERIFIED: 1 },
      environmentStatus: "VALID",
    },
    completeness: { truncated: false, reasons: [] },
    findings: [],
  };
  const sourceRaw = `${JSON.stringify(source, null, 2)}\n`;
  const sourceFile = path.join(root, "release", "evidence", "scan.json");
  await writeFile(sourceFile, sourceRaw);
  const evidence = structuredClone(document());
  evidence.scan.sourceArtifact = "release/evidence/scan.json";
  evidence.scan.sourceSha256 = createHash("sha256").update(sourceRaw).digest("hex");
  const raw = `${JSON.stringify(evidence, null, 2)}\n`;
  const evidenceFile = path.join(root, "release", "evidence", "control.json");
  await writeFile(evidenceFile, raw);
  const manifest = [{
    ...evidence.case,
    evidenceFile: "release/evidence/control.json",
    evidenceSha256: createHash("sha256").update(raw).digest("hex"),
    engineFingerprint: fingerprint,
  }];

  assert.equal((await validateExternalCaseEvidenceFiles(manifest, root, fingerprint)).length, 1);
  await assert.rejects(() => validateExternalCaseEvidenceFiles(manifest, root, "d".repeat(64)), /stale/);
  await writeFile(evidenceFile, `${raw} `);
  await assert.rejects(() => validateExternalCaseEvidenceFiles(manifest, root, fingerprint), /digest mismatch/);
});

test("rejects missing, changed, or contradictory source scans", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "realdone-external-source-"));
  await mkdir(path.join(root, "release", "evidence"), { recursive: true });
  const sourceFile = path.join(root, "release", "evidence", "scan.json");
  const source = {
    schemaVersion: "1.0",
    scanId: "scan-1",
    summary: {
      pagesDiscovered: 1,
      visibleActions: 1,
      actionsVerified: 1,
      actionsSkipped: 0,
      verdicts: { VERIFIED: 1 },
      environmentStatus: "VALID",
    },
    completeness: { truncated: false },
    findings: [],
  };
  const sourceRaw = `${JSON.stringify(source)}\n`;
  await writeFile(sourceFile, sourceRaw);
  const evidence = structuredClone(document());
  evidence.scan.sourceArtifact = "release/evidence/scan.json";
  evidence.scan.sourceSha256 = createHash("sha256").update(sourceRaw).digest("hex");
  const evidenceRaw = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(path.join(root, "release", "evidence", "control.json"), evidenceRaw);
  const manifest = [{
    ...evidence.case,
    evidenceFile: "release/evidence/control.json",
    evidenceSha256: createHash("sha256").update(evidenceRaw).digest("hex"),
    engineFingerprint: fingerprint,
  }];

  evidence.scan.sourceArtifact = "release/evidence/missing.json";
  const missingEvidenceRaw = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(path.join(root, "release", "evidence", "control.json"), missingEvidenceRaw);
  manifest[0]!.evidenceSha256 = createHash("sha256").update(missingEvidenceRaw).digest("hex");
  await assert.rejects(() => validateExternalCaseEvidenceFiles(manifest, root, fingerprint), /source artifact is missing/);

  evidence.scan.sourceArtifact = "release/evidence/scan.json";
  const restoredEvidenceRaw = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(path.join(root, "release", "evidence", "control.json"), restoredEvidenceRaw);
  manifest[0]!.evidenceSha256 = createHash("sha256").update(restoredEvidenceRaw).digest("hex");
  await writeFile(sourceFile, `${sourceRaw} `);
  await assert.rejects(() => validateExternalCaseEvidenceFiles(manifest, root, fingerprint), /source artifact digest mismatch/);

  const contradictorySource = structuredClone(source);
  contradictorySource.summary.actionsVerified = 0;
  const contradictory = `${JSON.stringify(contradictorySource)}\n`;
  await writeFile(sourceFile, contradictory);
  evidence.scan.sourceSha256 = createHash("sha256").update(contradictory).digest("hex");
  const contradictoryEvidenceRaw = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(path.join(root, "release", "evidence", "control.json"), contradictoryEvidenceRaw);
  manifest[0]!.evidenceSha256 = createHash("sha256").update(contradictoryEvidenceRaw).digest("hex");
  await assert.rejects(() => validateExternalCaseEvidenceFiles(manifest, root, fingerprint), /does not match its source scan/);

  const extraVerdictSource = structuredClone(source);
  const verdicts: Record<string, number> = extraVerdictSource.summary.verdicts;
  verdicts.UNCERTAIN = 0;
  const extraVerdictRaw = `${JSON.stringify(extraVerdictSource)}\n`;
  await writeFile(sourceFile, extraVerdictRaw);
  evidence.scan.sourceSha256 = createHash("sha256").update(extraVerdictRaw).digest("hex");
  const extraVerdictEvidenceRaw = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(path.join(root, "release", "evidence", "control.json"), extraVerdictEvidenceRaw);
  manifest[0]!.evidenceSha256 = createHash("sha256").update(extraVerdictEvidenceRaw).digest("hex");
  await assert.rejects(() => validateExternalCaseEvidenceFiles(manifest, root, fingerprint), /does not match its source scan/);

  const severeSource = structuredClone(source);
  const severeVerdicts: Record<string, number> = severeSource.summary.verdicts;
  severeVerdicts.BROKEN = 1;
  const severeRaw = `${JSON.stringify(severeSource)}\n`;
  await writeFile(sourceFile, severeRaw);
  evidence.scan.sourceSha256 = createHash("sha256").update(severeRaw).digest("hex");
  evidence.scan.verdicts = severeSource.summary.verdicts;
  const severeEvidenceRaw = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(path.join(root, "release", "evidence", "control.json"), severeEvidenceRaw);
  manifest[0]!.evidenceSha256 = createHash("sha256").update(severeEvidenceRaw).digest("hex");
  await assert.rejects(() => validateExternalCaseEvidenceFiles(manifest, root, fingerprint), /severe regression count/);
});

test("rejects source scan paths outside the repository before trusting their digest", async () => {
  const container = await mkdtemp(path.join(os.tmpdir(), "realdone-external-confinement-"));
  const root = path.join(container, "repository");
  try {
    await mkdir(path.join(root, "release", "evidence"), { recursive: true });
    const outsideFile = path.join(container, "outside-scan.json");
    const outsideRaw = `${JSON.stringify({
      schemaVersion: "1.0",
      scanId: "scan-1",
      summary: {
        pagesDiscovered: 1,
        visibleActions: 1,
        actionsVerified: 1,
        actionsSkipped: 0,
        verdicts: { VERIFIED: 1 },
        environmentStatus: "VALID",
      },
      completeness: { truncated: false },
      findings: [],
    })}\n`;
    await writeFile(outsideFile, outsideRaw);
    const evidence = document();
    evidence.scan.sourceArtifact = "../outside-scan.json";
    evidence.scan.sourceSha256 = createHash("sha256").update(outsideRaw).digest("hex");
    const evidenceRaw = `${JSON.stringify(evidence, null, 2)}\n`;
    await writeFile(path.join(root, "release", "evidence", "control.json"), evidenceRaw);
    const manifest = [{
      ...evidence.case,
      evidenceFile: "release/evidence/control.json",
      evidenceSha256: createHash("sha256").update(evidenceRaw).digest("hex"),
      engineFingerprint: fingerprint,
    }];

    await assert.rejects(() => validateExternalCaseEvidenceFiles(manifest, root, fingerprint), /source artifact escapes the repository/);
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});

test("engine fingerprints ignore release plumbing but change with product behavior", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "realdone-engine-fingerprint-"));
  await mkdir(path.join(root, "src", "browser"), { recursive: true });
  await mkdir(path.join(root, "src", "project"), { recursive: true });
  await mkdir(path.join(root, "src", "runtime"), { recursive: true });
  await mkdir(path.join(root, "src", "application"), { recursive: true });
  await mkdir(path.join(root, "src", "release"), { recursive: true });
  await writeFile(path.join(root, "src", "browser", "engine.ts"), "export const behavior = 1;\n");
  await writeFile(path.join(root, "src", "project", "discovery.ts"), "export const discovery = 1;\n");
  await writeFile(path.join(root, "src", "runtime", "manager.ts"), "export const runtime = 1;\n");
  await writeFile(path.join(root, "src", "application", "managed-scan.ts"), "export const managed = 1;\n");
  await writeFile(path.join(root, "src", "release", "gates.ts"), "export const gate = 1;\n");
  await writeFile(path.join(root, "src", "version.ts"), 'export const VERSION = "1.2.0";\n');
  await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  const first = await calculateReleaseEngineFingerprint(root);
  await writeFile(path.join(root, "src", "release", "gates.ts"), "export const gate = 2;\n");
  assert.equal(await calculateReleaseEngineFingerprint(root), first);
  await writeFile(path.join(root, "src", "version.ts"), 'export const VERSION = "1.3.0";\n');
  assert.equal(await calculateReleaseEngineFingerprint(root), first);
  await writeFile(path.join(root, "src", "project", "discovery.ts"), "export const discovery = 2;\n");
  await writeFile(path.join(root, "src", "runtime", "manager.ts"), "export const runtime = 2;\n");
  await writeFile(path.join(root, "src", "application", "managed-scan.ts"), "export const managed = 2;\n");
  assert.equal(await calculateReleaseEngineFingerprint(root), first);
  await writeFile(path.join(root, "src", "browser", "engine.ts"), "export const behavior = 2;\n");
  assert.notEqual(await calculateReleaseEngineFingerprint(root), first);
});

test("requires semantic capability evidence instead of a passing assertion label", async () => {
  const committedManifest = JSON.parse(await readFile(path.resolve("release/external-cases.json"), "utf8"));
  const releasedFingerprint = committedManifest[0]?.engineFingerprint as string;
  assert.equal((await validateExternalCaseEvidenceFiles(committedManifest, process.cwd(), releasedFingerprint)).length, 5);
  await assert.rejects(
    () => validateExternalCaseEvidenceFiles([...committedManifest, committedManifest[0]], process.cwd(), releasedFingerprint),
    /duplicate case or evidence file/,
  );

  const root = await mkdtemp(path.join(os.tmpdir(), "realdone-external-capability-"));
  await mkdir(path.join(root, "release", "evidence"), { recursive: true });
  const source = {
    schemaVersion: "1.0",
    scanId: "self-asserted-scan",
    summary: {
      pagesDiscovered: 1,
      visibleActions: 1,
      actionsVerified: 1,
      actionsSkipped: 0,
      verdicts: { VERIFIED: 1 },
      environmentStatus: "VALID",
    },
    completeness: { truncated: false },
    findings: [],
  };
  const sourceRaw = `${JSON.stringify(source, null, 2)}\n`;
  await writeFile(path.join(root, "release", "evidence", "scan.json"), sourceRaw);
  const evidence = document();
  evidence.case.capabilities = ["upload"];
  evidence.scan.scanId = source.scanId;
  evidence.scan.sourceArtifact = "release/evidence/scan.json";
  evidence.scan.sourceSha256 = createHash("sha256").update(sourceRaw).digest("hex");
  evidence.assertions = [{
    id: "capability:upload",
    passed: true,
    expected: "real upload",
    observed: "claimed upload",
    evidenceArtifacts: ["scan"],
  }];
  const evidenceRaw = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(path.join(root, "release", "evidence", "self-asserted.json"), evidenceRaw);
  const manifest = [{
    ...evidence.case,
    evidenceFile: "release/evidence/self-asserted.json",
    evidenceSha256: createHash("sha256").update(evidenceRaw).digest("hex"),
    engineFingerprint: fingerprint,
  }];
  await assert.rejects(
    () => validateExternalCaseEvidenceFiles(manifest, root, fingerprint),
    /lacks semantic observable evidence: upload/,
  );

  evidence.case.capabilities = ["ai-generated"];
  evidence.assertions[0]!.id = "capability:ai-generated";
  const missingQualificationRaw = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(path.join(root, "release", "evidence", "self-asserted.json"), missingQualificationRaw);
  manifest[0] = {
    ...evidence.case,
    evidenceFile: "release/evidence/self-asserted.json",
    evidenceSha256: createHash("sha256").update(missingQualificationRaw).digest("hex"),
    engineFingerprint: fingerprint,
  };
  await assert.rejects(
    () => validateExternalCaseEvidenceFiles(manifest, root, fingerprint),
    /lacks semantic observable evidence: ai-generated/,
  );
});

test("accepts a bound Codex regression-repair cycle and rejects a contradictory repair", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "realdone-codex-cycle-"));
  const evidenceDirectory = path.join(root, "release", "evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  const writeJson = async (name: string, value: unknown) => {
    const sourceArtifact = `release/evidence/${name}.json`;
    const raw = `${JSON.stringify(value, null, 2)}\n`;
    await writeFile(path.join(root, sourceArtifact), raw);
    return { sourceArtifact, sourceSha256: createHash("sha256").update(raw).digest("hex") };
  };
  const source = {
    schemaVersion: "1.0",
    scanId: "agent-scan-1",
    summary: {
      pagesDiscovered: 1,
      visibleActions: 1,
      actionsVerified: 1,
      actionsSkipped: 0,
      verdicts: { VERIFIED: 1 },
      environmentStatus: "VALID",
    },
    completeness: { truncated: false },
    findings: [],
  };
  const scan = await writeJson("agent-scan", source);
  const contractId = "increment-counter";
  const runBroken = "broken-run";
  const runRepaired = "repaired-run";
  const session = await writeJson("codex-session", {
    schemaVersion: "1.0",
    sessionId: "codex-session-1",
    originator: "Codex Desktop",
    source: "exec",
    modelProvider: "codex_local_access",
    cliVersion: "0.143.0",
    mcpEvents: [
      { tool: "baseline", passed: true },
      { tool: "verify_change", passed: false, runId: runBroken, selectedContracts: 1, regressions: 1 },
      { tool: "verify_change", passed: true, runId: runRepaired, selectedContracts: 1, regressions: 0 },
    ],
  });
  const baseline = await writeJson("agent-baseline", {
    schemaVersion: "1.0",
    contracts: [{ id: contractId, hash: "a".repeat(64), stepCount: 2, baseline: { passed: true, verificationId: "baseline-verification" } }],
  });
  const broken = await writeJson("agent-regression", {
    schemaVersion: "1.0",
    runId: runBroken,
    passed: false,
    selectedContracts: 1,
    regressions: 1,
    changes: [{ contractId, outcome: "REGRESSION", detectorCodes: ["RD901"], hashChanged: false }],
  });
  const failedVerification = await writeJson("agent-failed-verification", {
    schemaVersion: "1.0",
    verificationId: "failed-verification",
    contractId,
    passed: false,
    steps: [{ status: "passed" }, { status: "failed" }],
  });
  let repairedValue = {
    schemaVersion: "1.0",
    runId: runRepaired,
    passed: true,
    selectedContracts: 1,
    regressions: 0,
    changes: [{ contractId, outcome: "VERIFIED", detectorCodes: [] as string[], hashChanged: false }],
  };
  let repaired = await writeJson("agent-repair", repairedValue);
  const evidence = document();
  evidence.case.name = "AI-generated Codex cycle";
  evidence.case.repository = "example/ai-generated";
  evidence.case.capabilities = ["ai-generated"];
  evidence.scan = {
    scanId: source.scanId,
    sourceArtifact: scan.sourceArtifact,
    sourceSha256: scan.sourceSha256,
    environmentStatus: "VALID",
    truncated: false,
    pagesDiscovered: 1,
    visibleActions: 1,
    actionsVerified: 1,
    actionsSkipped: 0,
    verdicts: { VERIFIED: 1 },
  };
  evidence.artifacts = [
    { id: "codex-session", kind: "agent-session", ...session },
    { id: "baseline", kind: "agent-baseline", ...baseline },
    { id: "regression", kind: "agent-regression", ...broken },
    { id: "failed-verification", kind: "contract-verification", ...failedVerification },
    { id: "repair", kind: "agent-repair", ...repaired },
  ];
  evidence.qualification = {
    kind: "codex-agent-cycle",
    sessionArtifact: "codex-session",
    baselineArtifact: "baseline",
    regressionArtifact: "regression",
    failedVerificationArtifact: "failed-verification",
    repairedArtifact: "repair",
  };
  evidence.assertions = [{
    id: "capability:ai-generated",
    passed: true,
    expected: "Codex baseline, observable regression, and repaired verification",
    observed: "1 selected/1 regression, then 1 selected/0 regressions",
    evidenceArtifacts: ["codex-session", "baseline", "regression", "failed-verification", "repair"],
  }];
  const evidenceFile = path.join(evidenceDirectory, "agent-cycle.json");
  const persistEvidence = async () => {
    const raw = `${JSON.stringify(evidence, null, 2)}\n`;
    await writeFile(evidenceFile, raw);
    return [{
      ...evidence.case,
      evidenceFile: "release/evidence/agent-cycle.json",
      evidenceSha256: createHash("sha256").update(raw).digest("hex"),
      engineFingerprint: fingerprint,
    }];
  };
  assert.equal((await validateExternalCaseEvidenceFiles(await persistEvidence(), root, fingerprint)).length, 1);

  repairedValue = { ...repairedValue, regressions: 1 };
  repaired = await writeJson("agent-repair", repairedValue);
  const repairArtifact = evidence.artifacts.find((artifact) => artifact.id === "repair");
  assert.ok(repairArtifact);
  repairArtifact.sourceSha256 = repaired.sourceSha256;
  await assert.rejects(
    async () => validateExternalCaseEvidenceFiles(await persistEvidence(), root, fingerprint),
    /baseline -> regression -> repair qualification/,
  );
});
