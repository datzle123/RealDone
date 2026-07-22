import spawn from "cross-spawn";
import { redactEnvironmentText, redactText } from "../core/redact.js";

export interface CommandSpec {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export interface CommandResult {
  executable: string;
  argumentCount: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  spawnError?: string;
}

interface CaptureBuffer {
  chunks: Buffer[];
  bytes: number;
  truncated: boolean;
}

function append(buffer: CaptureBuffer, chunk: Buffer, maximum: number): void {
  const remaining = maximum - buffer.bytes;
  if (remaining <= 0) {
    buffer.truncated = true;
    return;
  }
  const accepted = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
  buffer.chunks.push(accepted);
  buffer.bytes += accepted.length;
  if (accepted.length < chunk.length) buffer.truncated = true;
}

function output(buffer: CaptureBuffer, environment: NodeJS.ProcessEnv): string {
  return redactEnvironmentText(Buffer.concat(buffer.chunks).toString("utf8"), environment);
}

export async function runCommand(spec: CommandSpec): Promise<CommandResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const maximum = spec.maxOutputBytes ?? 1_000_000;
  const stdout: CaptureBuffer = { chunks: [], bytes: 0, truncated: false };
  const stderr: CaptureBuffer = { chunks: [], bytes: 0, truncated: false };
  const environment = { ...process.env, ...spec.env };
  return new Promise((resolve) => {
    const child = spawn(spec.executable, spec.args, {
      cwd: spec.cwd,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let timedOut = false;
    let spawnError: string | undefined;
    let forceTimer: NodeJS.Timeout | undefined;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      forceTimer.unref();
    }, spec.timeoutMs);
    timer.unref();
    child.stdout?.on("data", (chunk: Buffer | string) => append(stdout, Buffer.from(chunk), maximum));
    child.stderr?.on("data", (chunk: Buffer | string) => append(stderr, Buffer.from(chunk), maximum));
    child.on("error", (error) => {
      spawnError = redactText(error.message);
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      const finished = Date.now();
      resolve({
        executable: spec.executable,
        argumentCount: spec.args.length,
        startedAt,
        finishedAt: new Date(finished).toISOString(),
        durationMs: finished - started,
        exitCode,
        signal,
        timedOut,
        stdout: output(stdout, environment),
        stderr: output(stderr, environment),
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        ...(spawnError ? { spawnError } : {}),
      });
    });
  });
}

export function commandPassed(result: CommandResult): boolean {
  return result.exitCode === 0 && !result.timedOut && !result.spawnError;
}
