import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { captureBaseline, collectContractFiles, type BehaviorManifest } from "../baseline/manifest.js";
import { runRegressionGate, type RegressionReport } from "../baseline/regression.js";
import type { VerifyContractOptions } from "../contracts/verifier.js";
import { redactText } from "../core/redact.js";
import { commandPassed, runCommand, type CommandResult, type CommandSpec } from "./command.js";
import { renderFollowUpPrompt } from "./followup.js";
import { createAgentCommand, type AgentPreset } from "./presets.js";

export interface AgentVerificationOptions {
  task: string;
  preset: AgentPreset;
  workingDirectory: string;
  contractInputs: string[];
  outputRoot: string;
  agentTimeoutMs: number;
  agentExecutable?: string;
  agentArgs: string[];
  agentMaxTurns: number;
  build: Omit<CommandSpec, "cwd">;
  allowDirty: boolean;
  allowContractChanges: boolean;
  verifyOptions: VerifyContractOptions;
}

export interface CommandSummary {
  executable: string;
  argumentCount: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  stdoutFile: string;
  stderrFile: string;
  spawnError?: string;
}

export interface AgentVerificationReport {
  schemaVersion: "1.0";
  runId: string;
  taskHash: string;
  preset: AgentPreset;
  workingDirectory: string;
  startedAt: string;
  finishedAt: string;
  baselinePassed: boolean;
  behaviorPassed: boolean;
  passed: boolean;
  changedFiles: string[];
  contractFilesChanged: string[];
  baselineTampered: boolean;
  beforeHead: string;
  afterHead: string;
  agent?: CommandSummary;
  build?: CommandSummary;
  regression?: RegressionReport;
  verificationError?: string;
  followUpPrompt?: string;
  evidencePolicy: "agent-output-is-not-verification-evidence";
}

export interface AgentVerificationResult {
  report: AgentVerificationReport;
  outputDirectory: string;
  exitCode: number;
}

function runId(): string {
  return `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${randomBytes(2).toString("hex")}`;
}

function pathsFromNul(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

export function parseGitStatus(value: string): string[] {
  const records = pathsFromNul(value);
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const status = record.slice(0, 2);
    paths.push(record.slice(3));
    if (/[RC]/.test(status)) {
      const source = records[index + 1];
      if (source) paths.push(source);
      index += 1;
    }
  }
  return [...new Set(paths)].sort();
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runCommand({ executable: "git", args, cwd, timeoutMs: 30_000, maxOutputBytes: 5_000_000 });
  if (!commandPassed(result)) {
    throw new Error(`Git command failed: git ${args[0] ?? ""}: ${result.stderr || (result.spawnError ?? "unknown error")}`);
  }
  return result.stdout;
}

export interface AgentGitState {
  head: string;
  status: string[];
}

export async function captureAgentGitState(cwd: string): Promise<AgentGitState> {
  const [head, status] = await Promise.all([
    git(cwd, ["rev-parse", "HEAD"]),
    git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ]);
  return { head: head.trim(), status: parseGitStatus(status) };
}

export async function changedFilesFromGitState(
  cwd: string,
  beforeHead: string,
  finalState: AgentGitState,
): Promise<string[]> {
  const committed = beforeHead === finalState.head
    ? []
    : pathsFromNul(await git(cwd, ["diff", "--name-only", "-z", beforeHead, finalState.head]));
  return [...new Set([...committed, ...finalState.status])].sort();
}

export interface AgentIntegrityDecision {
  baselineTampered: boolean;
  integrityPassed: boolean;
  regressionChangedFiles: string[];
}

export function decideAgentIntegrity(input: {
  agentTamperedBaseline: boolean;
  buildTamperedBaseline: boolean;
  contractFilesChanged: string[];
  changedFiles: string[];
  allowContractChanges: boolean;
}): AgentIntegrityDecision {
  const baselineTampered = input.agentTamperedBaseline || input.buildTamperedBaseline;
  return {
    baselineTampered,
    integrityPassed: !baselineTampered && (input.allowContractChanges || input.contractFilesChanged.length === 0),
    // Contract edits cannot narrow verification using their own, potentially manipulated scope metadata.
    regressionChangedFiles: input.contractFilesChanged.length > 0 ? [] : [...input.changedFiles],
  };
}

async function fileHashes(files: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  await Promise.all(files.map(async (file) => {
    const content = await readFile(file);
    result.set(path.resolve(file), createHash("sha256").update(content).digest("hex"));
  }));
  return result;
}

function changedHashPaths(before: Map<string, string>, after: Map<string, string>, cwd: string): string[] {
  const files = new Set([...before.keys(), ...after.keys()]);
  return [...files]
    .filter((file) => before.get(file) !== after.get(file))
    .map((file) => path.relative(cwd, file).split(path.sep).join("/"))
    .sort();
}

async function commandSummary(
  outputDirectory: string,
  name: string,
  result: CommandResult,
): Promise<CommandSummary> {
  const stdoutFile = `${name}.stdout.log`;
  const stderrFile = `${name}.stderr.log`;
  await Promise.all([
    writeFile(path.join(outputDirectory, stdoutFile), result.stdout),
    writeFile(path.join(outputDirectory, stderrFile), result.stderr),
  ]);
  return {
    executable: result.executable,
    argumentCount: result.argumentCount,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
    stdoutFile,
    stderrFile,
    ...(result.spawnError ? { spawnError: result.spawnError } : {}),
  };
}

async function writeReport(outputDirectory: string, report: AgentVerificationReport): Promise<void> {
  await writeFile(path.join(outputDirectory, "agent-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
}

export async function loadTask(task?: string, taskFile?: string): Promise<string> {
  if (task && taskFile) throw new Error("Use either --task or --task-file, not both.");
  const value = task ?? (taskFile ? await readFile(path.resolve(taskFile), "utf8") : undefined);
  if (!value?.trim()) throw new Error("Agent verification requires --task or --task-file.");
  return value.trim();
}

export async function runAgentVerification(options: AgentVerificationOptions): Promise<AgentVerificationResult> {
  const id = runId();
  const cwd = path.resolve(options.workingDirectory);
  const outputDirectory = path.resolve(options.outputRoot, id);
  await mkdir(outputDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  const before = await captureAgentGitState(cwd);
  if (!options.allowDirty && before.status.length > 0) {
    throw new Error(`Agent verification requires a clean worktree. Existing changes: ${before.status.join(", ")}`);
  }

  const baselineFile = path.join(outputDirectory, "baseline.json");
  const absoluteContractInputs = options.contractInputs.map((input) => path.resolve(cwd, input));
  const contractFilesBefore = await collectContractFiles(absoluteContractInputs);
  const contractHashesBefore = await fileHashes(contractFilesBefore);
  const baseline: BehaviorManifest = await captureBaseline(
    absoluteContractInputs,
    baselineFile,
    {
      ...options.verifyOptions,
      outputRoot: path.join(outputDirectory, "baseline-runs"),
    },
    true,
  );
  const baselinePassed = baseline.contracts.every((contract) => contract.baseline?.passed === true);
  if (!baselinePassed) {
    const followUpPrompt = renderFollowUpPrompt({ task: options.task, currentManifest: baseline });
    await writeFile(path.join(outputDirectory, "follow-up.md"), followUpPrompt);
    const report: AgentVerificationReport = {
      schemaVersion: "1.0",
      runId: id,
      taskHash: createHash("sha256").update(options.task).digest("hex"),
      preset: options.preset,
      workingDirectory: cwd,
      startedAt,
      finishedAt: new Date().toISOString(),
      baselinePassed: false,
      behaviorPassed: false,
      passed: false,
      changedFiles: [],
      contractFilesChanged: [],
      baselineTampered: false,
      beforeHead: before.head,
      afterHead: before.head,
      followUpPrompt: "follow-up.md",
      evidencePolicy: "agent-output-is-not-verification-evidence",
    };
    await writeReport(outputDirectory, report);
    return { report, outputDirectory, exitCode: 1 };
  }

  const sealedBaseline = await readFile(baselineFile, "utf8");
  const baselineHash = createHash("sha256").update(sealedBaseline).digest("hex");

  const agentSpec = createAgentCommand({
    preset: options.preset,
    task: options.task,
    cwd,
    timeoutMs: options.agentTimeoutMs,
    ...(options.agentExecutable ? { executable: options.agentExecutable } : {}),
    args: options.agentArgs,
    maxTurns: options.agentMaxTurns,
  });
  const agentResult = await runCommand(agentSpec);
  const baselineAfterAgent = await readFile(baselineFile, "utf8").catch(() => "");
  const agentTamperedBaseline = createHash("sha256").update(baselineAfterAgent).digest("hex") !== baselineHash;
  if (agentTamperedBaseline) await writeFile(baselineFile, sealedBaseline);
  const buildResult = await runCommand({ ...options.build, cwd });
  const baselineAfterBuild = await readFile(baselineFile, "utf8").catch(() => "");
  const buildTamperedBaseline = createHash("sha256").update(baselineAfterBuild).digest("hex") !== baselineHash;
  if (buildTamperedBaseline) await writeFile(baselineFile, sealedBaseline);
  const contractFilesAfter = await collectContractFiles(absoluteContractInputs).catch(() => []);
  const contractHashesAfter = await fileHashes(contractFilesAfter);
  const contractFilesChanged = changedHashPaths(contractHashesBefore, contractHashesAfter, cwd);
  const postBuild = await captureAgentGitState(cwd);
  const changed = await changedFilesFromGitState(cwd, before.head, postBuild);
  const integrity = decideAgentIntegrity({
    agentTamperedBaseline,
    buildTamperedBaseline,
    contractFilesChanged,
    changedFiles: changed,
    allowContractChanges: options.allowContractChanges,
  });
  let regression: Awaited<ReturnType<typeof runRegressionGate>> | undefined;
  let verificationError: string | undefined;
  if (commandPassed(buildResult) && contractFilesAfter.length > 0) {
    try {
      regression = await runRegressionGate({
        baselineFile,
        contractInputs: absoluteContractInputs,
        changedFiles: integrity.regressionChangedFiles,
        outputRoot: path.join(outputDirectory, "regression"),
        verifyOptions: {
          ...options.verifyOptions,
          outputRoot: path.join(outputDirectory, "regression-runs"),
        },
      });
    } catch (error) {
      verificationError = redactText(error instanceof Error ? error.message : String(error));
    }
  } else if (contractFilesAfter.length === 0) {
    verificationError = "No behavior contract files remained after the agent/build run.";
  }
  const behaviorPassed = Boolean(regression?.report.passed);
  const passed = commandPassed(agentResult) && commandPassed(buildResult) && behaviorPassed && integrity.integrityPassed;
  const [agent, build] = await Promise.all([
    commandSummary(outputDirectory, "agent", agentResult),
    commandSummary(outputDirectory, "build", buildResult),
  ]);
  const after = await captureAgentGitState(cwd);
  const followUpPrompt = passed
    ? undefined
    : renderFollowUpPrompt({
        task: options.task,
        agent: agentResult,
        build: buildResult,
        ...(regression ? { regression: regression.report, currentManifest: regression.currentManifest } : {}),
        baselineTampered: integrity.baselineTampered,
        contractFilesChanged,
        ...(verificationError ? { verificationError } : {}),
      });
  if (followUpPrompt) await writeFile(path.join(outputDirectory, "follow-up.md"), followUpPrompt);
  const report: AgentVerificationReport = {
    schemaVersion: "1.0",
    runId: id,
    taskHash: createHash("sha256").update(options.task).digest("hex"),
    preset: options.preset,
    workingDirectory: cwd,
    startedAt,
    finishedAt: new Date().toISOString(),
    baselinePassed,
    behaviorPassed,
    passed,
    changedFiles: changed,
    contractFilesChanged,
    baselineTampered: integrity.baselineTampered,
    beforeHead: before.head,
    afterHead: after.head,
    agent,
    build,
    ...(regression ? { regression: regression.report } : {}),
    ...(verificationError ? { verificationError } : {}),
    ...(followUpPrompt ? { followUpPrompt: "follow-up.md" } : {}),
    evidencePolicy: "agent-output-is-not-verification-evidence",
  };
  await writeReport(outputDirectory, report);
  return { report, outputDirectory, exitCode: passed ? 0 : 1 };
}
