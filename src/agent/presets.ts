import type { CommandSpec } from "./command.js";

export type AgentPreset = "codex" | "claude" | "generic";

export interface AgentCommandOptions {
  preset: AgentPreset;
  task: string;
  cwd: string;
  timeoutMs: number;
  executable?: string;
  args?: string[];
  maxTurns?: number;
}

export function createAgentCommand(options: AgentCommandOptions): CommandSpec {
  switch (options.preset) {
    case "codex":
      return {
        executable: options.executable ?? "codex",
        args: [
          "--ask-for-approval",
          "never",
          "--sandbox",
          "workspace-write",
          "exec",
          "--ephemeral",
          "--json",
          ...(options.args ?? []),
          options.task,
        ],
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
      };
    case "claude":
      return {
        executable: options.executable ?? "claude",
        args: [
          "-p",
          "--output-format",
          "json",
          "--permission-mode",
          "acceptEdits",
          "--max-turns",
          String(options.maxTurns ?? 50),
          ...(options.args ?? []),
          options.task,
        ],
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
      };
    case "generic":
      if (!options.executable) throw new Error("Generic agent preset requires --agent-command.");
      return {
        executable: options.executable,
        args: [...(options.args ?? []), options.task],
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
      };
  }
}

export function parseAgentPreset(value: string): AgentPreset {
  if (value === "codex" || value === "claude" || value === "generic") return value;
  throw new Error(`Expected codex, claude, or generic; received: ${value}`);
}
