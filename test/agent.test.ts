import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { commandPassed, runCommand, type CommandResult } from "../src/agent/command.js";
import { renderFollowUpPrompt } from "../src/agent/followup.js";
import {
  captureAgentGitState,
  changedFilesFromGitState,
  decideAgentIntegrity,
  parseGitStatus,
} from "../src/agent/pipeline.js";
import { createAgentCommand } from "../src/agent/presets.js";
import { selectAffectedContracts } from "../src/baseline/affected.js";
import type { BehaviorManifest } from "../src/baseline/manifest.js";

function result(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    executable: "agent",
    argumentCount: 1,
    startedAt: "2026-07-22T00:00:00.000Z",
    finishedAt: "2026-07-22T00:00:01.000Z",
    durationMs: 1_000,
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    ...overrides,
  };
}

async function git(cwd: string, args: string[]): Promise<void> {
  const completed = await runCommand({ executable: "git", args, cwd, timeoutMs: 10_000 });
  assert.equal(commandPassed(completed), true, completed.stderr || completed.spawnError);
}

function manifest(): BehaviorManifest {
  const contract = (id: string, sourceFiles: string[]) => ({
    id,
    name: id,
    file: `${id}.json`,
    hash: id,
    tags: [],
    routes: [],
    endpoints: [],
    sourceFiles,
    stepCount: 1,
    baseline: { passed: true, verificationId: id, steps: [] },
  });
  return {
    schemaVersion: "1.0",
    generatedAt: "2026-07-23T00:00:00.000Z",
    contracts: [
      contract("agent-flow", ["src/agent-created.ts"]),
      contract("build-flow", ["src/build-created.ts"]),
      contract("unrelated-flow", ["src/unrelated.ts"]),
    ],
  };
}

test("agent presets use current non-interactive safety contracts", () => {
  const codex = createAgentCommand({ preset: "codex", task: "Implement it", cwd: ".", timeoutMs: 1_000 });
  assert.deepEqual(codex.args.slice(0, 8), [
    "--ask-for-approval", "never", "--sandbox", "workspace-write", "exec", "--ephemeral", "--json", "Implement it",
  ]);
  assert.equal(codex.args.includes("--full-auto"), false);

  const claude = createAgentCommand({ preset: "claude", task: "Implement it", cwd: ".", timeoutMs: 1_000, maxTurns: 12 });
  assert.deepEqual(claude.args, [
    "-p", "--output-format", "json", "--permission-mode", "acceptEdits", "--max-turns", "12", "Implement it",
  ]);
  assert.throws(
    () => createAgentCommand({ preset: "generic", task: "Implement it", cwd: ".", timeoutMs: 1_000 }),
    /requires --agent-command/,
  );
});

test("generic command runner is shell-free, bounded, timed, and secret-redacted", async () => {
  const secret = "super-secret-token-value";
  const completed = await runCommand({
    executable: process.execPath,
    args: ["-e", "process.stdout.write(process.env.REALDONE_AGENT_SECRET_TOKEN + ' postgres://user:pass@host/db ' + 'x'.repeat(200))"],
    cwd: process.cwd(),
    timeoutMs: 5_000,
    maxOutputBytes: 96,
    env: { REALDONE_AGENT_SECRET_TOKEN: secret },
  });
  assert.equal(commandPassed(completed), true);
  assert.equal(completed.stdout.includes(secret), false);
  assert.equal(completed.stdout.includes("postgres://"), false);
  assert.match(completed.stdout, /REDACTED/);
  assert.equal(completed.stdoutTruncated, true);

  const timed = await runCommand({
    executable: process.execPath,
    args: ["-e", "setTimeout(() => {}, 1000)"],
    cwd: process.cwd(),
    timeoutMs: 20,
  });
  assert.equal(timed.timedOut, true);
  assert.equal(commandPassed(timed), false);
});

test("Git status parser preserves modified, untracked, and rename paths", () => {
  const parsed = parseGitStatus(" M src/a.ts\0?? new file.ts\0R  new.ts\0old.ts\0");
  assert.deepEqual(parsed, ["new file.ts", "new.ts", "old.ts", "src/a.ts"]);
});

test("final post-build Git state reports build-created files and selects their affected flow", async () => {
  const repository = await mkdtemp(path.join(os.tmpdir(), "realdone-agent-git-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.email", "realdone@example.test"]);
    await git(repository, ["config", "user.name", "RealDone Test"]);
    await writeFile(path.join(repository, "README.md"), "fixture\n");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "fixture"]);

    const before = await captureAgentGitState(repository);
    await mkdir(path.join(repository, "src"));
    await writeFile(path.join(repository, "src", "agent-created.ts"), "export const agent = true;\n");
    const afterAgent = await captureAgentGitState(repository);
    assert.deepEqual(await changedFilesFromGitState(repository, before.head, afterAgent), ["src/agent-created.ts"]);

    // Simulate an independent build that generates a product file after the agent exits.
    await writeFile(path.join(repository, "src", "build-created.ts"), "export const build = true;\n");
    const postBuild = await captureAgentGitState(repository);
    const changedFiles = await changedFilesFromGitState(repository, before.head, postBuild);
    assert.deepEqual(changedFiles, ["src/agent-created.ts", "src/build-created.ts"]);
    assert.deepEqual(
      selectAffectedContracts(manifest(), changedFiles).map((contract) => contract.id),
      ["agent-flow", "build-flow"],
    );
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("agent integrity fails closed and contract tampering cannot narrow affected-flow selection", () => {
  const baselineTamper = decideAgentIntegrity({
    agentTamperedBaseline: false,
    buildTamperedBaseline: true,
    contractFilesChanged: [],
    changedFiles: ["src/build-created.ts"],
    allowContractChanges: false,
  });
  assert.equal(baselineTamper.baselineTampered, true);
  assert.equal(baselineTamper.integrityPassed, false);
  assert.deepEqual(baselineTamper.regressionChangedFiles, ["src/build-created.ts"]);

  const contractTamper = decideAgentIntegrity({
    agentTamperedBaseline: false,
    buildTamperedBaseline: false,
    contractFilesChanged: ["flows/build-flow.json"],
    changedFiles: ["flows/build-flow.json"],
    allowContractChanges: false,
  });
  assert.equal(contractTamper.integrityPassed, false);
  assert.deepEqual(contractTamper.regressionChangedFiles, []);
  assert.deepEqual(
    selectAffectedContracts(manifest(), contractTamper.regressionChangedFiles).map((contract) => contract.id),
    ["agent-flow", "build-flow", "unrelated-flow"],
  );
});

test("follow-up prompt uses independent evidence and ignores the agent claim", () => {
  const prompt = renderFollowUpPrompt({
    task: "Add persistent deletion",
    agent: result({ stdout: "CLAIM: completed perfectly" }),
    build: result(),
    regression: {
      schemaVersion: "1.0",
      runId: "run",
      baselineFile: "baseline.json",
      generatedAt: "2026-07-22T00:00:00.000Z",
      passed: false,
      selectedContracts: 1,
      regressions: 1,
      expectedChanges: 0,
      improvements: 0,
      changes: [{
        contractId: "delete-customer",
        name: "Delete customer",
        kind: "regression",
        outcome: "REGRESSION",
        detectorCodes: ["RD901"],
        detail: "A behavior that passed at baseline now fails.",
        baselinePassed: true,
        currentPassed: false,
        hashChanged: false,
      }],
    },
    currentManifest: {
      schemaVersion: "1.0",
      generatedAt: "2026-07-22T00:00:00.000Z",
      contracts: [{
        id: "delete-customer",
        name: "Delete customer",
        file: "delete.json",
        hash: "abc",
        tags: ["critical"],
        routes: ["/customers"],
        endpoints: [{ method: "DELETE", pattern: "/api/customers" }],
        sourceFiles: [],
        stepCount: 1,
        baseline: {
          passed: false,
          verificationId: "verify",
          steps: [{
            id: "S001",
            status: "failed",
            assertions: [{ type: "persistence", passed: false, detail: "Customer returned after reload." }],
          }],
        },
      }],
    },
  });
  assert.match(prompt, /Customer returned after reload/);
  assert.match(prompt, /independent build and RealDone verification/);
  assert.equal(prompt.includes("completed perfectly"), false);
});
