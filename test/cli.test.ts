import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { commandPassed, runCommand } from "../src/agent/command.js";

const cliFile = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const repository = fileURLToPath(new URL("../", import.meta.url));

async function cli(...args: string[]) {
  return runCommand({
    executable: process.execPath,
    args: ["--import", "tsx", cliFile, ...args],
    cwd: repository,
    timeoutMs: 10_000,
  });
}

test("CLI exposes every release command and the package version", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  const version = await cli("--version");
  assert.equal(commandPassed(version), true, version.stderr);
  assert.equal(version.stdout.trim(), packageJson.version);

  const help = await cli("--help");
  assert.equal(commandPassed(help), true, help.stderr);
  for (const command of [
    "init",
    "scan",
    "cleanup",
    "record",
    "verify",
    "benchmark",
    "baseline",
    "ci",
    "matrix",
    "affected",
    "export-playwright",
    "run",
    "replay",
    "mcp",
  ]) {
    assert.match(help.stdout, new RegExp(`\\b${command}\\b`));
  }
});

test("CLI help exposes deep and advanced verification controls", async () => {
  const scan = await cli("scan", "--help");
  assert.equal(commandPassed(scan), true, scan.stderr);
  assert.match(scan.stdout, /omit it to discover and\s+run the current project/i);
  for (const option of ["--yes", "--full", "--deep", "--trace", "--trace-on-failure", "--video", "--policy", "--storage-state", "--browser-path", "--manage-runtime", "--environment-timeout", "--allow-iframe", "--sqlite", "--database-config", "--provider-config"]) {
    assert.ok(scan.stdout.includes(option), `scan help is missing ${option}`);
  }

  const mcp = await cli("mcp", "--help");
  assert.equal(commandPassed(mcp), true, mcp.stderr);
  assert.ok(mcp.stdout.includes("--allow-project-actions"), "MCP help is missing project-action consent");

  const verify = await cli("verify", "--help");
  assert.equal(commandPassed(verify), true, verify.stderr);
  for (const option of ["--yes", "--deep", "--trace", "--video", "--browser", "--role-state", "--postgres-config", "--sqlite", "--database-config", "--provider-config", "--plugin", "--performance-budget"]) {
    assert.ok(verify.stdout.includes(option), `verify help is missing ${option}`);
  }

  const cleanup = await cli("cleanup", "--help");
  assert.equal(commandPassed(cleanup), true, cleanup.stderr);
  for (const option of ["--confirm", "--confirm-database", "--postgres-config", "--sqlite", "--database-config", "--plugin"]) {
    assert.ok(cleanup.stdout.includes(option), `cleanup help is missing ${option}`);
  }

  const replay = await cli("replay", "--help");
  assert.equal(commandPassed(replay), true, replay.stderr);
  for (const option of ["--yes", "--provider-config", "--allow-destructive", "--allow-external", "--allow-host"]) {
    assert.ok(replay.stdout.includes(option), `replay help is missing ${option}`);
  }

  for (const command of ["benchmark", "baseline", "ci", "matrix", "run"]) {
    const help = await cli(command, "--help");
    assert.equal(commandPassed(help), true, help.stderr);
    assert.ok(help.stdout.includes("--yes"), `${command} help is missing --yes`);
  }
});

test("non-interactive scan requires explicit project action consent before browser startup", async () => {
  const result = await cli("scan", "http://127.0.0.1:1", "--json");
  assert.equal(commandPassed(result), false);
  assert.match(result.stderr, /--yes/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|browser/i);
});

test("non-interactive contract verification fails closed before reading the contract", async () => {
  const result = await cli("verify", "missing-contract.json");
  assert.equal(commandPassed(result), false);
  assert.match(result.stderr, /--yes/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
});

test("replay rejects finding IDs that could escape the reproductions directory", async () => {
  const result = await cli("replay", "../outside", "--yes");
  assert.equal(commandPassed(result), false);
  assert.doesNotMatch(result.stderr, /No reproduction found/);
});
