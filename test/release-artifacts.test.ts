import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { scanArtifactSecrets } from "../src/release/artifacts.js";
import { checkArtifactSchemaCompatibility } from "../src/release/schema.js";

test("artifact secret gate scans text and ZIP entries without echoing secrets", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "realdone-artifact-secrets-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const secret = "RD_RELEASE_SECRET_7f31b19a";
  await writeFile(path.join(directory, "clean.json"), JSON.stringify({ token: "[REDACTED]", password: "RD_PASSWORD_ENV" }));
  await writeFile(path.join(directory, "leak.log"), `unexpected=${secret}\n`);
  await writeFile(path.join(directory, "trace.zip"), zipSync({
    "trace.network": strToU8(JSON.stringify({ authorization: "Bearer abcdefghijklmnopqrstuvwxyz123456" })),
  }));

  const scan = await scanArtifactSecrets(directory, { secrets: [{ label: "release sentinel", value: secret }] });
  assert.equal(scan.passed, false);
  assert.equal(scan.scannedArchives, 1);
  assert.ok(scan.findings.some((finding) => finding.kind === "exact-secret" && finding.file === "leak.log"));
  assert.ok(scan.findings.some((finding) => finding.kind === "bearer-token" && finding.file.includes("trace.zip!trace.network")));
  assert.equal(JSON.stringify(scan).includes(secret), false);
  assert.equal(JSON.stringify(scan).includes("abcdefghijklmnopqrstuvwxyz123456"), false);
});

test("artifact secret gate passes redacted evidence and fails closed on archive limits", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "realdone-artifact-limits-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "report.json"), JSON.stringify({ password: "[REDACTED]", token: "REALDONE_TOKEN_ENV" }));
  const clean = await scanArtifactSecrets(directory);
  assert.equal(clean.passed, true);

  await writeFile(path.join(directory, "trace.zip"), zipSync({ "one.txt": strToU8("safe") }));
  const bounded = await scanArtifactSecrets(directory, { maxArchiveEntries: 0 });
  assert.equal(bounded.passed, false);
  assert.ok(bounded.findings.some((finding) => finding.kind === "scan-limit"));
});

test("artifact schema gate accepts a compatible set and rejects a missing required artifact", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "realdone-artifact-schema-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const baseline = path.join(directory, "baseline.json");
  const artifact = path.join(directory, "result.json");
  await writeFile(baseline, JSON.stringify({
    schemaVersion: "1.0",
    artifacts: [{
      name: "result.json",
      required: {
        schemaVersion: ["string"],
        summary: ["object"],
        "summary.passed": ["boolean"],
        findings: ["array"],
      },
    }],
  }));
  await writeFile(artifact, JSON.stringify({ schemaVersion: "1.0", summary: { passed: true }, findings: [] }));

  const compatible = await checkArtifactSchemaCompatibility(directory, baseline);
  assert.equal(compatible.passed, true);
  assert.equal(compatible.checkedFiles, 1);

  await rm(artifact);
  const missing = await checkArtifactSchemaCompatibility(directory, baseline);
  assert.equal(missing.passed, false);
  assert.deepEqual(missing.issues, [{ artifact: "result.json", kind: "missing-artifact" }]);
});

test("artifact schema gate reports removed keys and type changes without artifact values", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "realdone-artifact-schema-redaction-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const baseline = path.join(directory, "baseline.json");
  const secretValue = "artifact-value-must-never-appear";
  await writeFile(baseline, JSON.stringify({
    schemaVersion: "1.0",
    artifacts: [{
      name: "result.json",
      required: {
        stableKey: ["string"],
        count: ["number"],
      },
    }],
  }));
  await writeFile(path.join(directory, "result.json"), JSON.stringify({ count: secretValue, unrelated: secretValue }));

  const result = await checkArtifactSchemaCompatibility(directory, baseline);
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.kind === "missing-path" && issue.path === "stableKey"));
  assert.ok(result.issues.some((issue) => issue.kind === "type-mismatch" && issue.path === "count" && issue.actual === "string"));
  assert.equal(JSON.stringify(result).includes(secretValue), false);
});
