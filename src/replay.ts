import { access, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BuiltinProviderHost } from "./providers/builtin.js";
import { runScan, type ScanProgress, type ScanResult } from "./scan.js";
import type { ExecutionEvidence, Finding, ReplayEvidence, Reproduction, ScanOptions, Verdict } from "./types.js";

const findingIdSchema = z.string().regex(/^RD-[0-9]{3,8}$/);
const verdictSchema = z.enum(["VERIFIED", "CONTRADICTORY", "EPHEMERAL", "BROWSER_LOCAL", "BROKEN", "NO_EFFECT", "UNCERTAIN", "SKIPPED"]);
const reproductionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  findingId: findingIdSchema,
  sourceScanId: z.string().min(1).max(200),
  targetUrl: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Replay target must use HTTP(S)."),
  action: z.object({
    id: z.string().min(1).max(200),
    pageUrl: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Replay action page must use HTTP(S)."),
    activation: z.enum(["click", "submit", "enter", "check", "select", "hover", "contextmenu", "record"]).optional(),
    kind: z.enum(["navigation", "local", "mutation", "external"]),
    intent: z.enum(["create", "update", "delete", "submit", "navigate", "interact", "external", "unknown"]),
    risk: z.enum(["safe", "external", "destructive"]),
    label: z.string().min(1).max(500),
    fingerprint: z.object({
      selector: z.string().min(1).max(4_000),
      tag: z.string().min(1).max(100),
      ordinal: z.number().int().nonnegative().max(100_000),
    }).passthrough(),
    fields: z.array(z.object({
      selector: z.string().min(1).max(4_000),
      tag: z.enum(["input", "textarea", "select"]),
      type: z.string().min(1).max(100),
      required: z.boolean(),
      disabled: z.boolean(),
    }).passthrough()).max(100),
    recordingRequired: z.string().max(1_000).optional(),
  }).passthrough(),
  sourceVerdict: verdictSchema.optional(),
  sourceDetectorCodes: z.array(z.string().regex(/^RD[0-9]{3,4}$/)).max(100).optional(),
  providerRequirements: z.object({
    automatic: z.literal(true),
    providers: z.array(z.object({
      name: z.string().min(1).max(200),
      kind: z.enum(["payment", "email", "storage", "oauth"]),
      resource: z.string().min(1).max(500).optional(),
      operation: z.string().min(1).max(500).optional(),
      state: z.enum(["confirmed", "absent"]).optional(),
    }).strict()).max(100),
  }).strict().optional(),
  options: z.object({
    timeoutMs: z.number().int().positive().max(600_000).optional(),
    settleMs: z.number().int().nonnegative().max(60_000).optional(),
    maxDurationMs: z.number().int().positive().max(1_800_000).optional(),
    maxRetries: z.number().int().nonnegative().max(10).optional(),
    allowDestructive: z.boolean().optional(),
    allowExternal: z.boolean().optional(),
    deep: z.boolean().optional(),
    trace: z.boolean().optional(),
    traceOnFailure: z.boolean().optional(),
    video: z.boolean().optional(),
  }).passthrough(),
}).passthrough();

export interface ReplayResult extends ScanResult {
  replay: ReplayEvidence;
}

export interface ReplayClassificationInput {
  environmentStatus?: "VALID" | "ENVIRONMENT_INVALID" | "BLOCKED";
  sourceKnown: boolean;
  sourceVerdict: Verdict;
  sourceDetectorCodes: string[];
  replayVerdict?: Verdict;
  replayDetectorCodes: string[];
  targetNotFound: boolean;
  providerConfirmationRequired?: boolean;
  providerConfirmationSatisfied?: boolean;
}

export function classifyReplayOutcome(input: ReplayClassificationInput): ReplayEvidence["outcome"] {
  if (input.environmentStatus && input.environmentStatus !== "VALID") return "ENVIRONMENT_CHANGED";
  if (!input.replayVerdict || input.targetNotFound) return "TARGET_ACTION_NOT_FOUND";
  if (!input.sourceKnown) return "REPLAY_UNCERTAIN";
  if (input.providerConfirmationRequired && !input.providerConfirmationSatisfied) return "REPLAY_UNCERTAIN";
  if (input.replayVerdict === input.sourceVerdict && input.sourceDetectorCodes.every((code) => input.replayDetectorCodes.includes(code))) {
    return "FINDING_REPRODUCED";
  }
  if (input.replayVerdict === "UNCERTAIN" || input.replayVerdict === "SKIPPED") return "REPLAY_UNCERTAIN";
  return "FINDING_NO_LONGER_REPRODUCED";
}

export function replayExitCode(outcome: ReplayEvidence["outcome"]): 0 | 1 | 2 {
  if (outcome === "FINDING_REPRODUCED") return 0;
  if (outcome === "FINDING_NO_LONGER_REPRODUCED") return 1;
  return 2;
}

async function findReproduction(findingId: string, reportDirectory?: string): Promise<string> {
  findingIdSchema.parse(findingId);
  if (reportDirectory) {
    const candidate = path.resolve(reportDirectory, "reproductions", `${findingId}.json`);
    await access(candidate);
    return candidate;
  }
  const root = path.resolve(".realdone", "reports");
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
    const candidate = path.join(root, entry.name, "reproductions", `${findingId}.json`);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through older scans.
    }
  }
  throw new Error(`No reproduction found for ${findingId}. Pass --report-dir explicitly.`);
}

export interface ReplayOptions {
  reportDirectory?: string;
  outputRoot: string;
  headed: boolean;
  executablePath?: string;
  storageStatePath?: string;
  providerConfigPaths?: string[];
  allowDestructive?: boolean;
  allowExternal?: boolean;
  allowHosts?: string[];
}

export function replayPermissionOptions(options: ReplayOptions): Pick<ScanOptions, "allowDestructive" | "allowExternal" | "allowHosts"> {
  return {
    allowDestructive: Boolean(options.allowDestructive),
    allowExternal: Boolean(options.allowExternal),
    allowHosts: [...new Set(options.allowHosts ?? [])],
  };
}

export function replayExecutionOptions(
  recorded: Reproduction["options"],
  options: ReplayOptions,
): Reproduction["options"] & Pick<ScanOptions, "allowDestructive" | "allowExternal" | "allowHosts"> {
  return { ...recorded, ...replayPermissionOptions(options) };
}

export function providerRequirementsSatisfied(
  requirements: Reproduction["providerRequirements"],
  evidence?: ExecutionEvidence,
): boolean {
  if (!requirements || requirements.providers.length === 0) return true;
  const confirmations = evidence?.providerEvidence ?? [];
  const errors = evidence?.providerErrors ?? [];
  return requirements.providers.every((required) => {
    const matchesRequirement = (entry: {
      provider: string;
      kind: string;
      resource?: string;
      operation?: string;
      state?: "confirmed" | "absent";
    }): boolean => entry.provider === required.name &&
      entry.kind === required.kind &&
      (!required.resource || entry.resource === required.resource) &&
      (!required.operation || entry.operation === required.operation) &&
      (!required.state || entry.state === required.state);
    const matching = confirmations.filter(matchesRequirement);
    return matching.length > 0 &&
      matching.every((entry) => entry.passed && entry.automaticLinkage?.causallyLinked === true) &&
      !errors.some(matchesRequirement);
  });
}

export async function runReplay(
  findingId: string,
  replayOptions: ReplayOptions,
  onProgress: (progress: ScanProgress) => void = () => undefined,
): Promise<ReplayResult> {
  const reproductionPath = await findReproduction(findingId, replayOptions.reportDirectory);
  const reproductionSize = (await stat(reproductionPath)).size;
  if (reproductionSize > 5 * 1024 * 1024) throw new Error("Reproduction exceeds the 5 MB replay limit.");
  const reproduction = reproductionSchema.parse(JSON.parse(await readFile(reproductionPath, "utf8"))) as Reproduction;
  if (reproduction.findingId !== findingId) throw new Error("Reproduction finding ID does not match the requested finding.");
  let sourceVerdict = reproduction.sourceVerdict;
  let sourceDetectorCodes = reproduction.sourceDetectorCodes;
  if (!sourceVerdict || !sourceDetectorCodes) {
    const sourceFindings = JSON.parse(
      await readFile(path.join(path.dirname(path.dirname(reproductionPath)), "findings.json"), "utf8").catch(() => "[]"),
    ) as Finding[];
    const sourceFinding = sourceFindings.find((candidate) => candidate.id === findingId);
    sourceVerdict ??= sourceFinding?.verdict;
    sourceDetectorCodes ??= sourceFinding?.detectorMatches.map((match) => match.code);
  }
  const sourceKnown = Boolean(sourceVerdict && sourceDetectorCodes);
  const normalizedSourceVerdict: Verdict = sourceVerdict ?? "UNCERTAIN";
  const normalizedSourceCodes = sourceDetectorCodes ?? [];
  const providerConfirmationRequired = Boolean(
    reproduction.providerRequirements?.automatic && reproduction.providerRequirements.providers.length > 0,
  );
  const providerVerifier = replayOptions.providerConfigPaths && replayOptions.providerConfigPaths.length > 0
    ? await BuiltinProviderHost.load(replayOptions.providerConfigPaths)
    : undefined;
  const options: ScanOptions = {
    targetUrl: reproduction.targetUrl,
    outputRoot: replayOptions.outputRoot,
    headed: replayOptions.headed,
    maxPages: 1,
    maxActions: 1,
    mutationAllowed: true,
    replayAction: reproduction.action,
    // Historical permission is evidence, never authority for a fresh replay.
    ...replayExecutionOptions(reproduction.options, replayOptions),
    maxDurationMs: reproduction.options.maxDurationMs ?? 60_000,
    maxRetries: reproduction.options.maxRetries ?? 2,
    ...(replayOptions.executablePath ? { executablePath: replayOptions.executablePath } : {}),
    ...(replayOptions.storageStatePath ? { storageStatePath: replayOptions.storageStatePath } : {}),
    ...(providerVerifier ? { providerVerifier } : {}),
  };
  const result = await runScan(options, onProgress);
  const finding = result.report.findings[0];
  const replayCodes = finding?.detectorMatches.map((match) => match.code) ?? [];
  const providerConfirmationSatisfied = !providerConfirmationRequired ||
    providerRequirementsSatisfied(reproduction.providerRequirements, finding?.evidence);
  const outcome = classifyReplayOutcome({
    ...(result.report.environment?.status ? { environmentStatus: result.report.environment.status } : {}),
    sourceKnown,
    sourceVerdict: normalizedSourceVerdict,
    sourceDetectorCodes: normalizedSourceCodes,
    ...(finding ? { replayVerdict: finding.verdict } : {}),
    replayDetectorCodes: replayCodes,
    targetNotFound: Boolean(finding?.evidence.targetNotFound),
    providerConfirmationRequired,
    providerConfirmationSatisfied,
  });
  const replay: ReplayEvidence = {
    schemaVersion: "1.0",
    findingId,
    sourceScanId: reproduction.sourceScanId,
    replayScanId: result.report.scanId,
    outcome,
    sourceVerdict: normalizedSourceVerdict,
    ...(finding ? { replayVerdict: finding.verdict } : {}),
    sourceDetectorCodes: normalizedSourceCodes,
    replayDetectorCodes: replayCodes,
    providerConfirmationRequired,
    providerConfirmationSatisfied,
    detail: providerConfirmationRequired && !providerConfirmationSatisfied
      ? "The replay did not causally confirm every required provider rule from the source execution."
      : {
      FINDING_REPRODUCED: "The fresh execution reproduced the source verdict and detector set.",
      FINDING_NO_LONGER_REPRODUCED: "The target executed, but the source finding no longer matched.",
      ENVIRONMENT_CHANGED: "The replay environment failed its health gate.",
      TARGET_ACTION_NOT_FOUND: "The semantic target could not be resolved in the replay environment.",
      REPLAY_UNCERTAIN: "The replay executed without enough evidence for a definitive reproduction outcome.",
    }[outcome],
  };
  await writeFile(path.join(result.reportDirectory, "replay.json"), `${JSON.stringify(replay, null, 2)}\n`);
  return { ...result, replay, exitCode: replayExitCode(outcome) };
}
