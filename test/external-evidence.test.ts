import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    assertions: [{ id: "control", passed: true, expected: "VERIFIED", observed: "VERIFIED" }],
  };
}

test("validates bound external-case evidence and rejects stale or changed evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "realdone-external-evidence-"));
  await mkdir(path.join(root, "release", "evidence"), { recursive: true });
  const source = {
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
  await mkdir(path.join(root, "src", "release"), { recursive: true });
  await writeFile(path.join(root, "src", "browser", "engine.ts"), "export const behavior = 1;\n");
  await writeFile(path.join(root, "src", "release", "gates.ts"), "export const gate = 1;\n");
  await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  const first = await calculateReleaseEngineFingerprint(root);
  await writeFile(path.join(root, "src", "release", "gates.ts"), "export const gate = 2;\n");
  assert.equal(await calculateReleaseEngineFingerprint(root), first);
  await writeFile(path.join(root, "src", "browser", "engine.ts"), "export const behavior = 2;\n");
  assert.notEqual(await calculateReleaseEngineFingerprint(root), first);
});
