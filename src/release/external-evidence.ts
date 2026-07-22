import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  releaseExternalCapabilitySchema,
  releaseExternalCaseSchema,
  type ReleaseExternalCase,
} from "./gates.js";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/i);
const evidenceArtifactSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  kind: z.enum([
    "contract-verification",
    "external-scan",
    "agent-session",
    "agent-baseline",
    "agent-regression",
    "agent-repair",
    "database-confirmation",
    "provider-confirmation",
    "test-result",
  ]),
  sourceArtifact: z.string().min(1),
  sourceSha256: sha256Schema,
}).strict();
const agentCycleQualificationSchema = z.object({
  kind: z.literal("codex-agent-cycle"),
  sessionArtifact: z.string().min(1),
  baselineArtifact: z.string().min(1),
  regressionArtifact: z.string().min(1),
  failedVerificationArtifact: z.string().min(1),
  repairedArtifact: z.string().min(1),
}).strict();
const sourceDiffSchema = z.object({
  adapter: z.string().min(1),
  resource: z.string().min(1),
  added: z.array(z.string()).default([]),
  removed: z.array(z.string()).default([]),
  changed: z.array(z.string()).default([]),
  softDeleted: z.array(z.string()).default([]),
  truncated: z.boolean().optional(),
}).passthrough();
const scanFindingSchema = z.object({
  action: z.object({
    label: z.string().min(1),
    pageUrl: z.string().optional(),
    fields: z.array(z.object({
      type: z.string().optional(),
    }).passthrough()).default([]),
  }).passthrough(),
  verdict: z.string().min(1),
  evidenceLevel: z.number().int().nonnegative(),
  evidence: z.object({
    persistenceScope: z.string().optional(),
    sourceDiffs: z.array(sourceDiffSchema).default([]),
    uploads: z.array(z.object({
      size: z.number().int().nonnegative(),
      contentHash: z.string().optional(),
      containsCanary: z.boolean().optional(),
    }).passthrough()).default([]),
    downloadEvidence: z.array(z.object({
      size: z.number().int().nonnegative(),
      contentHash: z.string().optional(),
    }).passthrough()).default([]),
  }).passthrough(),
}).passthrough();
const sourceScanSchema = z.object({
  schemaVersion: z.literal("1.0"),
  scanId: z.string().min(1),
  summary: z.object({
    pagesDiscovered: z.number().int().nonnegative(),
    visibleActions: z.number().int().nonnegative(),
    actionsVerified: z.number().int().nonnegative(),
    actionsSkipped: z.number().int().nonnegative(),
    verdicts: z.record(z.string(), z.number().int().nonnegative()),
    environmentStatus: z.enum(["VALID", "ENVIRONMENT_INVALID", "BLOCKED"]),
  }).passthrough(),
  completeness: z.object({
    truncated: z.boolean(),
  }).passthrough(),
  findings: z.array(scanFindingSchema),
}).passthrough();
const caseResultSchema = z.object({
  name: z.string().min(1),
  repository: z.string().min(1),
  pinnedCommit: z.string().regex(/^[0-9a-f]{7,40}$/i),
  status: z.enum(["passed", "failed", "blocked"]),
  environmentValid: z.boolean(),
  severeRegressions: z.number().int().nonnegative(),
  capabilities: z.array(releaseExternalCapabilitySchema)
    .refine((values) => new Set(values).size === values.length, "External capabilities must be unique.")
    .default([]),
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
  artifacts: z.array(evidenceArtifactSchema).default([]),
  qualification: agentCycleQualificationSchema.optional(),
  assertions: z.array(z.object({
    id: z.string().min(1),
    passed: z.boolean(),
    expected: z.string().min(1),
    observed: z.string().min(1),
    evidenceArtifacts: z.array(z.string().min(1)).default(["scan"]),
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
      return !relative.startsWith("src/release/") && relative !== "src/version.ts";
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
    && left.severeRegressions === right.severeRegressions
    && left.capabilities.length === right.capabilities.length
    && left.capabilities.every((capability) => right.capabilities.includes(capability));
}

function sameRecord(left: Record<string, number>, right: Record<string, number>): boolean {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
  return keys.every((key) => left[key] === right[key]);
}

function severeVerdictCount(verdicts: Record<string, number>): number {
  return ["BROKEN", "CONTRADICTORY", "NO_EFFECT"]
    .reduce((total, verdict) => total + (verdicts[verdict] ?? 0), 0);
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

const baselineEvidenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  contracts: z.array(z.object({
    id: z.string().min(1),
    hash: sha256Schema,
    stepCount: z.number().int().positive().optional(),
    baseline: z.object({ passed: z.literal(true), verificationId: z.string().min(1) }).passthrough(),
  }).passthrough()).min(1),
}).passthrough();
const regressionEvidenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  runId: z.string().min(1),
  passed: z.boolean(),
  selectedContracts: z.number().int().positive(),
  regressions: z.number().int().nonnegative(),
  changes: z.array(z.object({
    contractId: z.string().min(1),
    outcome: z.string().min(1),
    detectorCodes: z.array(z.string()),
    hashChanged: z.boolean(),
  }).passthrough()).min(1),
}).passthrough();
const verificationEvidenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  verificationId: z.string().min(1),
  contractId: z.string().min(1),
  passed: z.literal(false),
  steps: z.array(z.object({ status: z.enum(["passed", "failed", "skipped"]) }).passthrough()).min(1),
}).passthrough();
const codexSessionEvidenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  sessionId: z.string().min(1),
  originator: z.literal("Codex Desktop"),
  source: z.literal("exec"),
  modelProvider: z.literal("codex_local_access"),
  cliVersion: z.string().min(1),
  mcpEvents: z.array(z.object({
    tool: z.enum(["baseline", "verify_change"]),
    passed: z.boolean(),
    runId: z.string().optional(),
    selectedContracts: z.number().int().nonnegative().optional(),
    regressions: z.number().int().nonnegative().optional(),
  }).strict()).min(3),
}).strict();
const roleVerificationEvidenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  passed: z.literal(true),
  roles: z.array(z.string().min(1)).min(2),
  steps: z.array(z.object({
    status: z.literal("passed"),
    assertions: z.array(z.object({
      expectation: z.object({
        type: z.string().min(1),
      }).passthrough(),
      passed: z.literal(true),
      evidenceLevel: z.literal(7),
      persistenceScope: z.literal("CROSS_USER_CONFIRMED"),
    }).passthrough()).min(1),
  }).passthrough()).min(1),
}).passthrough();
const cleanupEvidenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  resources: z.array(z.object({
    status: z.literal("cleaned"),
  }).passthrough()).min(1),
}).passthrough();

type SourceScan = z.infer<typeof sourceScanSchema>;
type EvidenceArtifact = z.infer<typeof evidenceArtifactSchema>;

function parseJsonArtifact(
  rawArtifacts: Map<string, Buffer>,
  id: string,
  label: string,
): unknown {
  const raw = rawArtifacts.get(id);
  if (!raw) throw new Error(`${label} references an unbound artifact: ${id}`);
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON: ${id}`);
  }
}

function requireArtifactKind(
  artifactKinds: Map<string, EvidenceArtifact["kind"]>,
  id: string,
  expected: EvidenceArtifact["kind"],
  label: string,
): void {
  if (artifactKinds.get(id) !== expected) {
    throw new Error(`${label} must reference a ${expected} artifact: ${id}`);
  }
}

function validateCodexAgentCycle(
  qualification: z.infer<typeof agentCycleQualificationSchema>,
  rawArtifacts: Map<string, Buffer>,
  artifactKinds: Map<string, EvidenceArtifact["kind"]>,
): void {
  requireArtifactKind(artifactKinds, qualification.sessionArtifact, "agent-session", "Codex session evidence");
  requireArtifactKind(artifactKinds, qualification.baselineArtifact, "agent-baseline", "Agent baseline evidence");
  requireArtifactKind(artifactKinds, qualification.regressionArtifact, "agent-regression", "Agent regression evidence");
  requireArtifactKind(artifactKinds, qualification.failedVerificationArtifact, "contract-verification", "Failed verification evidence");
  requireArtifactKind(artifactKinds, qualification.repairedArtifact, "agent-repair", "Agent repair evidence");
  const session = codexSessionEvidenceSchema.parse(
    parseJsonArtifact(rawArtifacts, qualification.sessionArtifact, "Codex session evidence"),
  );
  const baseline = baselineEvidenceSchema.parse(
    parseJsonArtifact(rawArtifacts, qualification.baselineArtifact, "Agent baseline evidence"),
  );
  const regression = regressionEvidenceSchema.parse(
    parseJsonArtifact(rawArtifacts, qualification.regressionArtifact, "Agent regression evidence"),
  );
  const repaired = regressionEvidenceSchema.parse(
    parseJsonArtifact(rawArtifacts, qualification.repairedArtifact, "Agent repair evidence"),
  );
  const failedVerification = verificationEvidenceSchema.parse(
    parseJsonArtifact(rawArtifacts, qualification.failedVerificationArtifact, "Failed verification evidence"),
  );
  const baselineContracts = new Set(baseline.contracts.map((contract) => contract.id));
  const regressionContracts = regression.changes.map((change) => change.contractId);
  const repairedContracts = repaired.changes.map((change) => change.contractId);
  const baselineEventIndex = session.mcpEvents.findIndex((event) => event.tool === "baseline" && event.passed);
  const brokenEventIndex = session.mcpEvents.findIndex((event) => event.tool === "verify_change" && event.runId === regression.runId);
  const repairedEventIndex = session.mcpEvents.findIndex((event) => event.tool === "verify_change" && event.runId === repaired.runId);
  const brokenEvent = session.mcpEvents[brokenEventIndex];
  const repairedEvent = session.mcpEvents[repairedEventIndex];
  const regressionSet = new Set(regressionContracts);
  const repairedSet = new Set(repairedContracts);
  const rd901Contracts = new Set(regression.changes
    .filter((change) => change.outcome === "REGRESSION" && change.detectorCodes.includes("RD901"))
    .map((change) => change.contractId));
  const regressionOutcomeCount = regression.changes.filter((change) => change.outcome === "REGRESSION").length;
  if (
    baselineEventIndex < 0
    || brokenEventIndex <= baselineEventIndex
    || repairedEventIndex <= brokenEventIndex
    || regression.passed
    || regression.regressions < 1
    || regression.regressions !== regressionOutcomeCount
    || regression.selectedContracts !== regression.changes.length
    || regressionSet.size !== regression.changes.length
    || rd901Contracts.size < 1
    || repaired.passed !== true
    || repaired.regressions !== 0
    || repaired.selectedContracts !== repaired.changes.length
    || repairedSet.size !== repaired.changes.length
    || !repaired.changes.every((change) => change.outcome === "VERIFIED")
    || regression.changes.some((change) => change.hashChanged)
    || repaired.changes.some((change) => change.hashChanged)
    || regressionSet.size !== repairedSet.size
    || !regressionContracts.every((id) => baselineContracts.has(id) && repairedSet.has(id))
    || !rd901Contracts.has(failedVerification.contractId)
    || !failedVerification.steps.some((step) => step.status === "failed")
    || !brokenEvent || brokenEvent.passed || brokenEvent.selectedContracts !== regression.selectedContracts || brokenEvent.regressions !== regression.regressions
    || !repairedEvent || !repairedEvent.passed || repairedEvent.selectedContracts !== repaired.selectedContracts || repairedEvent.regressions !== 0
  ) {
    throw new Error("Codex agent cycle is not a baseline -> regression -> repair qualification with unchanged contracts.");
  }
}

function isVerifiedFinding(finding: z.infer<typeof scanFindingSchema>, minimumLevel = 0): boolean {
  return finding.verdict === "VERIFIED" && finding.evidenceLevel >= minimumLevel;
}

function hasSourceMutation(diff: z.infer<typeof sourceDiffSchema>): boolean {
  return diff.truncated !== true
    && (diff.added.length > 0 || diff.changed.length > 0 || diff.removed.length > 0 || diff.softDeleted.length > 0);
}

function citedScans(
  evidenceArtifacts: string[],
  source: SourceScan,
  rawArtifacts: Map<string, Buffer>,
  artifactKinds: Map<string, EvidenceArtifact["kind"]>,
): SourceScan[] {
  return evidenceArtifacts.map((id) => {
    if (id === "scan") return source;
    requireArtifactKind(artifactKinds, id, "external-scan", "External scan capability evidence");
    return sourceScanSchema.parse(parseJsonArtifact(rawArtifacts, id, "External scan capability evidence"));
  });
}

function validateCapabilityEvidence(
  capability: z.infer<typeof releaseExternalCapabilitySchema>,
  evidenceArtifacts: string[],
  source: SourceScan,
  qualification: z.infer<typeof agentCycleQualificationSchema> | undefined,
  rawArtifacts: Map<string, Buffer>,
  artifactKinds: Map<string, EvidenceArtifact["kind"]>,
): void {
  const fail = (): never => {
    throw new Error(`External-case capability lacks semantic observable evidence: ${capability}`);
  };

  if (capability === "ai-generated") {
    if (!qualification) return fail();
    validateCodexAgentCycle(qualification, rawArtifacts, artifactKinds);
    return;
  }

  if (capability === "multi-role") {
    const validRoleEvidence = evidenceArtifacts.some((id) => {
      if (id === "scan" || artifactKinds.get(id) !== "contract-verification") return false;
      const parsed = roleVerificationEvidenceSchema.safeParse(parseJsonArtifact(rawArtifacts, id, "Multi-role capability evidence"));
      if (!parsed.success) return false;
      const assertionTypes = new Set(parsed.data.steps.flatMap((step) =>
        step.assertions.map((assertion) => assertion.expectation.type)));
      return assertionTypes.has("authorization") && assertionTypes.has("cross-role");
    });
    if (!validRoleEvidence) fail();
    return;
  }

  if (capability === "multi-step") {
    const validMultiStepEvidence = evidenceArtifacts.some((id) => {
      if (id === "scan" || artifactKinds.get(id) !== "agent-baseline") return false;
      const parsed = baselineEvidenceSchema.safeParse(parseJsonArtifact(rawArtifacts, id, "Multi-step capability evidence"));
      return parsed.success && parsed.data.contracts.some((contract) => (contract.stepCount ?? 0) >= 2);
    });
    if (!validMultiStepEvidence) fail();
    return;
  }

  const scans = citedScans(
    evidenceArtifacts.filter((id) => id === "scan" || artifactKinds.get(id) === "external-scan"),
    source,
    rawArtifacts,
    artifactKinds,
  );
  const findings = scans.flatMap((scan) => scan.findings);

  if (capability === "backend-crud") {
    const sourceDiffs = findings
      .filter((finding) => isVerifiedFinding(finding, 6))
      .flatMap((finding) => finding.evidence.sourceDiffs)
      .filter((diff) => diff.truncated !== true);
    const hasCreate = sourceDiffs.some((diff) => diff.added.length > 0);
    const hasUpdate = sourceDiffs.some((diff) => diff.changed.length > 0);
    const hasDelete = sourceDiffs.some((diff) => diff.removed.length > 0 || diff.softDeleted.length > 0);
    const hasCleanup = evidenceArtifacts.some((id) => {
      if (id === "scan" || artifactKinds.get(id) !== "test-result") return false;
      return cleanupEvidenceSchema.safeParse(parseJsonArtifact(rawArtifacts, id, "Backend CRUD cleanup evidence")).success;
    });
    if (!hasCreate || !hasUpdate || !hasDelete || !hasCleanup) fail();
    return;
  }

  if (capability === "postgresql" || capability === "supabase") {
    const hasConfirmedSourceMutation = findings.some((finding) =>
      isVerifiedFinding(finding, 6)
      && finding.evidence.sourceDiffs.some((diff) => diff.adapter.toLowerCase() === capability && hasSourceMutation(diff)));
    if (!hasConfirmedSourceMutation) fail();
    return;
  }

  if (capability === "authentication") {
    const hasPersistentAuthentication = findings.some((finding) =>
      isVerifiedFinding(finding, 5)
      && finding.action.fields.some((field) => field.type?.toLowerCase() === "password"));
    if (!hasPersistentAuthentication) fail();
    return;
  }

  if (capability === "upload") {
    const hasRealUpload = findings.some((finding) =>
      isVerifiedFinding(finding)
      && finding.evidence.uploads.some((upload) =>
        upload.size > 0 && (upload.contentHash?.length ?? 0) >= 8 && upload.containsCanary === true));
    if (!hasRealUpload) fail();
    return;
  }

  const hasNonEmptyExport = findings.some((finding) =>
    isVerifiedFinding(finding)
    && finding.evidence.downloadEvidence.some((download) =>
      download.size > 0 && (download.contentHash?.length ?? 0) >= 8));
  if (!hasNonEmptyExport) fail();
}

async function confinedFile(root: string, requested: string, label: string): Promise<string> {
  const requestedFile = path.resolve(root, requested);
  if (!isWithin(root, requestedFile)) {
    throw new Error(`${label} escapes the repository: ${requested}`);
  }
  let file: string;
  try {
    file = await realpath(requestedFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${label} is missing: ${requested}`);
    }
    throw error;
  }
  if (!isWithin(root, file)) {
    throw new Error(`${label} escapes the repository: ${requested}`);
  }
  if (!(await stat(file)).isFile()) {
    throw new Error(`${label} is not a file: ${requested}`);
  }
  return file;
}

export async function validateExternalCaseEvidenceFiles(
  manifestInput: unknown,
  rootDirectory = process.cwd(),
  expectedEngineFingerprint?: string,
): Promise<ReleaseExternalCase[]> {
  const manifest = z.array(releaseExternalCaseSchema).parse(manifestInput);
  const root = await realpath(rootDirectory);
  const engineFingerprint = expectedEngineFingerprint ?? await calculateReleaseEngineFingerprint(root);
  const caseNames = new Set<string>();
  const evidenceFiles = new Set<string>();

  for (const item of manifest) {
    const normalizedName = item.name.trim().toLowerCase();
    const normalizedEvidenceFile = item.evidenceFile.replaceAll("\\", "/").toLowerCase();
    if (caseNames.has(normalizedName) || evidenceFiles.has(normalizedEvidenceFile)) {
      throw new Error(`External-case manifest contains a duplicate case or evidence file: ${item.name}`);
    }
    caseNames.add(normalizedName);
    evidenceFiles.add(normalizedEvidenceFile);
  }

  for (const item of manifest) {
    const evidenceFile = await confinedFile(root, item.evidenceFile, "External-case evidence");
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
    const sourceFile = await confinedFile(root, evidence.scan.sourceArtifact, "External-case source artifact");
    const sourceRaw = await readFile(sourceFile);
    const sourceDigest = createHash("sha256").update(sourceRaw).digest("hex");
    if (sourceDigest !== evidence.scan.sourceSha256.toLowerCase()) {
      throw new Error(`External-case source artifact digest mismatch: ${evidence.scan.sourceArtifact}`);
    }
    const source = sourceScanSchema.parse(JSON.parse(sourceRaw.toString("utf8")));
    if (
      source.scanId !== evidence.scan.scanId
      || source.summary.environmentStatus !== evidence.scan.environmentStatus
      || source.completeness.truncated !== evidence.scan.truncated
      || source.summary.pagesDiscovered !== evidence.scan.pagesDiscovered
      || source.summary.visibleActions !== evidence.scan.visibleActions
      || source.summary.actionsVerified !== evidence.scan.actionsVerified
      || source.summary.actionsSkipped !== evidence.scan.actionsSkipped
      || !sameRecord(source.summary.verdicts, evidence.scan.verdicts)
    ) {
      throw new Error(`External-case evidence does not match its source scan: ${item.name}`);
    }
    if (evidence.case.severeRegressions !== severeVerdictCount(source.summary.verdicts)) {
      throw new Error(`External-case severe regression count does not match its source scan: ${item.name}`);
    }
    const artifactIds = new Set<string>();
    const rawArtifacts = new Map<string, Buffer>();
    const artifactKinds = new Map<string, EvidenceArtifact["kind"]>();
    for (const artifact of evidence.artifacts) {
      if (artifactIds.has(artifact.id) || artifact.id === "scan") {
        throw new Error(`External-case artifact ID is duplicated or reserved: ${artifact.id}`);
      }
      artifactIds.add(artifact.id);
      const artifactFile = await confinedFile(root, artifact.sourceArtifact, "External-case bound artifact");
      const artifactRaw = await readFile(artifactFile);
      const artifactDigest = createHash("sha256").update(artifactRaw).digest("hex");
      if (artifactDigest !== artifact.sourceSha256.toLowerCase()) {
        throw new Error(`External-case bound artifact digest mismatch: ${artifact.sourceArtifact}`);
      }
      rawArtifacts.set(artifact.id, artifactRaw);
      artifactKinds.set(artifact.id, artifact.kind);
    }
    for (const assertion of evidence.assertions) {
      if (assertion.evidenceArtifacts.some((id) => id !== "scan" && !artifactIds.has(id))) {
        throw new Error(`External-case assertion references an unbound artifact: ${assertion.id}`);
      }
    }
    for (const capability of item.capabilities) {
      const assertion = evidence.assertions.find((candidate) => candidate.id === `capability:${capability}`);
      if (!assertion?.passed || assertion.evidenceArtifacts.length === 0) {
        throw new Error(`External-case capability lacks passing bound evidence: ${item.name} / ${capability}`);
      }
      validateCapabilityEvidence(
        capability,
        assertion.evidenceArtifacts,
        source,
        evidence.qualification,
        rawArtifacts,
        artifactKinds,
      );
    }
    if (evidence.qualification && !item.capabilities.includes("ai-generated")) {
      validateCodexAgentCycle(evidence.qualification, rawArtifacts, artifactKinds);
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
