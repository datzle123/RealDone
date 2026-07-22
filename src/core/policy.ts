import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ActionPolicy, ActionPolicyRule, ActionSpec } from "../types.js";

const actionKind = z.enum(["navigation", "local", "mutation", "external"]);
const actionIntent = z.enum(["create", "update", "delete", "submit", "navigate", "interact", "external", "unknown"]);
const risk = z.enum(["safe", "external", "destructive"]);

export const actionPolicySchema = z
  .object({
    schemaVersion: z.literal("1.0").default("1.0"),
    allowHosts: z.array(z.string().min(1)).default([]),
    budgets: z
      .object({
        maxPages: z.number().int().positive().optional(),
        maxActions: z.number().int().positive().optional(),
        maxDurationMs: z.number().int().positive().optional(),
        maxRetries: z.number().int().min(0).max(5).optional(),
      })
      .strict()
      .optional(),
    rules: z
      .array(
        z
          .object({
            match: z
              .object({
                url: z.string().optional(),
                label: z.string().optional(),
                kind: actionKind.optional(),
                intent: actionIntent.optional(),
              })
              .strict(),
            effect: z.enum(["allow", "deny"]).optional(),
            set: z
              .object({ kind: actionKind.optional(), intent: actionIntent.optional(), risk: risk.optional() })
              .strict()
              .optional(),
            reason: z.string().optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export async function loadActionPolicy(file: string): Promise<ActionPolicy> {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Could not read policy ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = actionPolicySchema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "policy"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid RealDone policy: ${detail}`);
  }
  return result.data as ActionPolicy;
}

function regexMatches(pattern: string | undefined, value: string): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(pattern, "i").test(value);
  } catch {
    throw new Error(`Invalid regular expression in policy: ${pattern}`);
  }
}

function ruleMatches(rule: ActionPolicyRule, action: ActionSpec): boolean {
  return (
    regexMatches(rule.match.url, action.pageUrl) &&
    regexMatches(rule.match.label, action.label) &&
    (!rule.match.kind || rule.match.kind === action.kind) &&
    (!rule.match.intent || rule.match.intent === action.intent)
  );
}

export interface PolicyActionResult {
  action: ActionSpec;
  deniedReason?: string;
}

export function applyActionPolicy(action: ActionSpec, policy?: ActionPolicy): PolicyActionResult {
  if (!policy) return { action };
  let current = structuredClone(action);
  let deniedReason: string | undefined;
  for (const rule of policy.rules) {
    if (!ruleMatches(rule, current)) continue;
    if (rule.set) current = { ...current, ...rule.set };
    if (rule.effect === "deny") deniedReason = rule.reason ?? "Action denied by the configured policy.";
    if (rule.effect === "allow") deniedReason = undefined;
  }
  return { action: current, ...(deniedReason ? { deniedReason } : {}) };
}
