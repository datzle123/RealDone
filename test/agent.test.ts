import assert from "node:assert/strict";
import test from "node:test";
import { commandPassed, runCommand, type CommandResult } from "../src/agent/command.js";
import { renderFollowUpPrompt } from "../src/agent/followup.js";
import { parseGitStatus } from "../src/agent/pipeline.js";
import { createAgentCommand } from "../src/agent/presets.js";

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
