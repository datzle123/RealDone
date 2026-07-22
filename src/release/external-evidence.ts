import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { releaseExternalCaseSchema, type ReleaseExternalCase } from "./gates.js";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/i);
const caseResultSchema = z.object({
  name: z.string().min(1),
  repository: z.string().min(1),
  pinnedCommit: z.string().regex(/^[0-9a-f]{7,40}$/i),
  status: z.enum(["passed", "failed", "blocked"]),
  environmentValid: z.boolean(),
  severeRegressions: z.number().int().nonnegative(),
}).strict();

export const externalCaseEvidenceDocumentSchema = z.object({
  schemaVersion: z.literal("1.0"),
  generatedAt: z.string().datetime(),
  engineFingerprint: sha256Schema,
  case: caseResultSchema,
  scan: z.object({
    scanId: z.string().min(1),
    sourceArtifact: z.string().min(1),
    sourceSha256: sha256Schema,
    environmentStatus: z.enum(["VALID", "ENVIRONMENT_INVALID", "BLOCKED"]),
    truncated: z.boolean(),
    pagesDiscovered: z.number().int().nonnegative(),
    visibleActions: z.number().int().nonnegative(),
    actionsVerified: z.number().int().nonnegative(),
    actionsSkipped: z.number().int().nonnegative(),
    verdicts: z.record(z.string(), z.number().int().nonnegative()),
  }).strict(),
  assertions: z.array(z.object({
    id: z.string().min(1),
    passed: z.boolean(),
    expected: z.string().min(1),
    observed: z.string().min(1),
  }).strict()).min(1),
}).strict();

export type ExternalCaseEvidenceDocument = z.infer<typeof externalCaseEvidenceDocumentSchema>;

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

export async function calculateReleaseEngineFingerprint(rootDirectory = process.cwd()): Promise<string> {
  const root = await realpath(rootDirectory);
  const sourceRoot = path.join(root, "src");
  const candidates = (await filesUnder(sourceRoot))
    .filter((file) => {
      const relative = path.relative(root, file).replaceAll(path.sep, "/");
      return !relative.startsWith("src/release/");
    });
  const lockfile = path.join(root, "pnpm-lock.yaml");
  if ((await stat(lockfile)).isFile()) candidates.push(lockfile);
  candidates.sort((left, right) => path.relative(root, left).localeCompare(path.relative(root, right)));

  const hash = createHash("sha256");
  for (const file of candidates) {
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    hash.update(relative);
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function sameCase(left: ReleaseExternalCase, right: ExternalCaseEvidenceDocument["case"]): boolean {
  return left.name === right.name
    && left.repository === right.repository
    && left.pinnedCommit.toLowerCase() === right.pinnedCommit.toLowerCase()
    && left.status === right.status
    && left.environmentValid === right.environmentValid
    && left.severeRegressions === right.severeRegressions;
}

export async function validateExternalCaseEvidenceFiles(
  manifestInput: unknown,
  rootDirectory = process.cwd(),
  expectedEngineFingerprint?: string,
): Promise<ReleaseExternalCase[]> {
  const manifest = z.array(releaseExternalCaseSchema).parse(manifestInput);
  const root = await realpath(rootDirectory);
  const engineFingerprint = expectedEngineFingerprint ?? await calculateReleaseEngineFingerprint(root);

  for (const item of manifest) {
    const requestedFile = path.resolve(root, item.evidenceFile);
    const evidenceFile = await realpath(requestedFile);
    if (evidenceFile !== root && !evidenceFile.startsWith(`${root}${path.sep}`)) {
      throw new Error(`External-case evidence escapes the repository: ${item.evidenceFile}`);
    }
    const raw = await readFile(evidenceFile);
    const digest = createHash("sha256").update(raw).digest("hex");
    if (digest !== item.evidenceSha256.toLowerCase()) {
      throw new Error(`External-case evidence digest mismatch: ${item.evidenceFile}`);
    }
    const evidence = externalCaseEvidenceDocumentSchema.parse(JSON.parse(raw.toString("utf8")));
    if (!sameCase(item, evidence.case)) {
      throw new Error(`External-case manifest does not match its evidence: ${item.name}`);
    }
    if (item.engineFingerprint.toLowerCase() !== engineFingerprint || evidence.engineFingerprint.toLowerCase() !== engineFingerprint) {
      throw new Error(`External-case evidence is stale for the current RealDone engine: ${item.name}`);
    }
    if (item.status === "passed" && (
      !item.environmentValid
      || item.severeRegressions !== 0
      || evidence.scan.environmentStatus !== "VALID"
      || evidence.scan.truncated
      || evidence.assertions.some((assertion) => !assertion.passed)
    )) {
      throw new Error(`External case is marked passed without passing observable evidence: ${item.name}`);
    }
  }
  return manifest;
}
