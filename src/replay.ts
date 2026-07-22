import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runScan, type ScanProgress, type ScanResult } from "./scan.js";
import type { Finding, ReplayEvidence, Reproduction, ScanOptions, Verdict } from "./types.js";

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
}

export function classifyReplayOutcome(input: ReplayClassificationInput): ReplayEvidence["outcome"] {
  if (input.environmentStatus && input.environmentStatus !== "VALID") return "ENVIRONMENT_CHANGED";
  if (!input.replayVerdict || input.targetNotFound) return "TARGET_ACTION_NOT_FOUND";
  if (!input.sourceKnown) return "REPLAY_UNCERTAIN";
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
}

export async function runReplay(
  findingId: string,
  replayOptions: ReplayOptions,
  onProgress: (progress: ScanProgress) => void = () => undefined,
): Promise<ReplayResult> {
  const reproductionPath = await findReproduction(findingId, replayOptions.reportDirectory);
  const reproduction = JSON.parse(await readFile(reproductionPath, "utf8")) as Reproduction;
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
  const options: ScanOptions = {
    targetUrl: reproduction.targetUrl,
    outputRoot: replayOptions.outputRoot,
    headed: replayOptions.headed,
    allowHosts: [new URL(reproduction.targetUrl).hostname],
    maxPages: 1,
    maxActions: 1,
    mutationAllowed: true,
    replayAction: reproduction.action,
    ...reproduction.options,
    maxDurationMs: reproduction.options.maxDurationMs ?? 60_000,
    maxRetries: reproduction.options.maxRetries ?? 2,
    ...(replayOptions.executablePath ? { executablePath: replayOptions.executablePath } : {}),
    ...(replayOptions.storageStatePath ? { storageStatePath: replayOptions.storageStatePath } : {}),
  };
  const result = await runScan(options, onProgress);
  const finding = result.report.findings[0];
  const replayCodes = finding?.detectorMatches.map((match) => match.code) ?? [];
  const outcome = classifyReplayOutcome({
    ...(result.report.environment?.status ? { environmentStatus: result.report.environment.status } : {}),
    sourceKnown,
    sourceVerdict: normalizedSourceVerdict,
    sourceDetectorCodes: normalizedSourceCodes,
    ...(finding ? { replayVerdict: finding.verdict } : {}),
    replayDetectorCodes: replayCodes,
    targetNotFound: Boolean(finding?.evidence.targetNotFound),
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
    detail: {
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
