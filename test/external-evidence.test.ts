import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { calculateReleaseEngineFingerprint, validateExternalCaseEvidenceFiles } from "../src/release/external-evidence.js";

const fingerprint = "b".repeat(64);

function document() {
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
  } as const;
}

test("validates bound external-case evidence and rejects stale or changed evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "realdone-external-evidence-"));
  await mkdir(path.join(root, "release", "evidence"), { recursive: true });
  const raw = `${JSON.stringify(document(), null, 2)}\n`;
  const evidenceFile = path.join(root, "release", "evidence", "control.json");
  await writeFile(evidenceFile, raw);
  const manifest = [{
    ...document().case,
    evidenceFile: "release/evidence/control.json",
    evidenceSha256: createHash("sha256").update(raw).digest("hex"),
    engineFingerprint: fingerprint,
  }];

  assert.equal((await validateExternalCaseEvidenceFiles(manifest, root, fingerprint)).length, 1);
  await assert.rejects(() => validateExternalCaseEvidenceFiles(manifest, root, "d".repeat(64)), /stale/);
  await writeFile(evidenceFile, `${raw} `);
  await assert.rejects(() => validateExternalCaseEvidenceFiles(manifest, root, fingerprint), /digest mismatch/);
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
