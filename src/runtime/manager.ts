import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import crossSpawn from "cross-spawn";
import type { ChildProcess } from "node:child_process";
import { redactEnvironmentText } from "../core/redact.js";
import type { RuntimeCommand } from "../project/discovery.js";

export interface ManagedRuntimeOptions {
  cwd: string;
  command: RuntimeCommand;
  healthUrl: string;
  healthTimeoutMs: number;
  restartLimit: number;
  environment?: Record<string, string>;
  logFile?: string;
  stopCommand?: RuntimeCommand;
}

export interface RuntimeSnapshot {
  state: "idle" | "starting" | "healthy" | "stopping" | "stopped" | "failed";
  pid?: number;
  restarts: number;
  healthUrl: string;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  logs: string[];
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function commandText(command: RuntimeCommand): string {
  return [command.executable, ...command.args].join(" ");
}

async function runProcess(command: RuntimeCommand, cwd: string, environment?: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = crossSpawn(command.executable, command.args, {
      cwd,
      env: { ...process.env, ...environment },
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && !signal) resolve();
      else reject(new Error(`${commandText(command)} failed (${signal ?? code ?? "unknown"}).`));
    });
  });
}

export class RuntimeManager {
  readonly options: ManagedRuntimeOptions;
  #child?: ChildProcess;
  #stopping = false;
  #restartTimer: NodeJS.Timeout | undefined;
  #snapshot: RuntimeSnapshot;

  constructor(options: ManagedRuntimeOptions) {
    if (!Number.isInteger(options.restartLimit) || options.restartLimit < 0) {
      throw new Error("Runtime restartLimit must be a non-negative integer.");
    }
    this.options = { ...options, cwd: path.resolve(options.cwd) };
    this.#snapshot = {
      state: "idle",
      restarts: 0,
      healthUrl: options.healthUrl,
      logs: [],
    };
  }

  snapshot(): RuntimeSnapshot {
    return structuredClone(this.#snapshot);
  }

  async #writeLog(stream: "stdout" | "stderr" | "runtime", value: string): Promise<void> {
    const text = redactEnvironmentText(value, { ...process.env, ...this.options.environment }).replace(/\r/g, "").trim();
    if (!text) return;
    const line = `[${new Date().toISOString()}] ${stream}: ${text}`.slice(0, 4_000);
    this.#snapshot.logs.push(line);
    if (this.#snapshot.logs.length > 200) this.#snapshot.logs.splice(0, this.#snapshot.logs.length - 200);
    if (this.options.logFile) {
      await mkdir(path.dirname(this.options.logFile), { recursive: true });
      await appendFile(this.options.logFile, `${line}\n`);
    }
  }

  #spawn(): void {
    const command = this.options.command;
    const child = crossSpawn(command.executable, command.args, {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.environment },
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.#child = child;
    if (child.pid) this.#snapshot.pid = child.pid;
    child.stdout?.on("data", (chunk) => void this.#writeLog("stdout", String(chunk)));
    child.stderr?.on("data", (chunk) => void this.#writeLog("stderr", String(chunk)));
    child.once("error", (error) => {
      void this.#writeLog("runtime", `Failed to start ${commandText(command)}: ${error.message}`);
      this.#snapshot.state = "failed";
    });
    child.once("exit", (code, signal) => {
      this.#snapshot.exitCode = code;
      this.#snapshot.signal = signal;
      delete this.#snapshot.pid;
      if (this.#stopping) return;
      if (this.#snapshot.restarts >= this.options.restartLimit) {
        this.#snapshot.state = "failed";
        void this.#writeLog("runtime", `Target exited and restart limit ${this.options.restartLimit} was exhausted.`);
        return;
      }
      this.#snapshot.restarts += 1;
      this.#snapshot.state = "starting";
      void this.#writeLog("runtime", `Target exited; restarting (${this.#snapshot.restarts}/${this.options.restartLimit}).`);
      this.#restartTimer = setTimeout(() => {
        this.#restartTimer = undefined;
        this.#spawn();
      }, 250);
    });
  }

  async #waitForHealth(): Promise<void> {
    const deadline = Date.now() + this.options.healthTimeoutMs;
    let lastError = "No health response was received.";
    while (Date.now() < deadline) {
      try {
        const response = await fetch(this.options.healthUrl, {
          signal: AbortSignal.timeout(Math.min(2_000, Math.max(250, deadline - Date.now()))),
        });
        if (response.ok) return;
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (this.#snapshot.state === "failed" && !this.#restartTimer) break;
      await delay(150);
    }
    const recentLogs = this.#snapshot.logs.slice(-8);
    const diagnostic = recentLogs.length > 0 ? `\nRecent runtime logs:\n${recentLogs.join("\n")}` : "";
    throw new Error(`Managed runtime did not become healthy at ${this.options.healthUrl}: ${lastError}${diagnostic}`);
  }

  async start(): Promise<RuntimeSnapshot> {
    if (!["idle", "stopped"].includes(this.#snapshot.state)) {
      throw new Error(`Managed runtime cannot start from state ${this.#snapshot.state}.`);
    }
    this.#stopping = false;
    this.#snapshot.state = "starting";
    this.#snapshot.startedAt = new Date().toISOString();
    delete this.#snapshot.stoppedAt;
    delete this.#snapshot.exitCode;
    delete this.#snapshot.signal;
    await this.#writeLog("runtime", `Starting ${commandText(this.options.command)} in ${this.options.cwd}.`);
    this.#spawn();
    try {
      await this.#waitForHealth();
      this.#snapshot.state = "healthy";
      await this.#writeLog("runtime", `Health check passed at ${this.options.healthUrl}.`);
      return this.snapshot();
    } catch (error) {
      this.#snapshot.state = "failed";
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<RuntimeSnapshot> {
    if (["idle", "stopped"].includes(this.#snapshot.state)) return this.snapshot();
    this.#stopping = true;
    this.#snapshot.state = "stopping";
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = undefined;
    }
    const child = this.#child;
    if (child?.pid && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      if (process.platform === "win32") {
        await new Promise<void>((resolve) => {
          const killer = crossSpawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { shell: false, stdio: "ignore" });
          killer.once("error", () => resolve());
          killer.once("exit", () => resolve());
        });
      } else {
        try {
          process.kill(-(child.pid), "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
      await Promise.race([exited, delay(3_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    if (this.options.stopCommand) {
      await runProcess(this.options.stopCommand, this.options.cwd, this.options.environment).catch((error) =>
        this.#writeLog("runtime", `Stop command failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
    this.#snapshot.state = "stopped";
    this.#snapshot.stoppedAt = new Date().toISOString();
    delete this.#snapshot.pid;
    await this.#writeLog("runtime", "Target process stopped.");
    return this.snapshot();
  }

  async restart(): Promise<RuntimeSnapshot> {
    await this.stop();
    return this.start();
  }
}

export async function runBuildCommand(
  command: RuntimeCommand,
  cwd: string,
  environment?: Record<string, string>,
): Promise<void> {
  await runProcess(command, path.resolve(cwd), environment);
}
