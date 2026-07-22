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
  ]) {
    assert.match(help.stdout, new RegExp(`\\b${command}\\b`));
  }
});

test("CLI help exposes deep and advanced verification controls", async () => {
  const scan = await cli("scan", "--help");
  assert.equal(commandPassed(scan), true, scan.stderr);
  for (const option of ["--deep", "--trace", "--video", "--policy", "--storage-state", "--browser-path", "--manage-runtime", "--environment-timeout", "--allow-iframe"]) {
    assert.ok(scan.stdout.includes(option), `scan help is missing ${option}`);
  }

  const verify = await cli("verify", "--help");
  assert.equal(commandPassed(verify), true, verify.stderr);
  for (const option of ["--deep", "--trace", "--video", "--browser", "--role-state", "--postgres-config", "--plugin", "--performance-budget"]) {
    assert.ok(verify.stdout.includes(option), `verify help is missing ${option}`);
  }
});
