import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { LocatorResolution, SemanticFingerprint } from "../types.js";

export type ContractStepType = "navigate" | "click" | "fill" | "check" | "select";

export type ContractExpectation =
  | { type: "request"; method: string; urlPattern: string; status?: number }
  | { type: "url"; pattern: string }
  | { type: "text"; value: string }
  | { type: "persistence"; value: string };

export interface BehaviorStep {
  id: string;
  type: ContractStepType;
  pageUrl: string;
  atMs: number;
  fingerprint?: SemanticFingerprint;
  url?: string;
  value?: string;
  secretEnv?: string;
  checked?: boolean;
  expected: ContractExpectation[];
}

export interface BehaviorContract {
  schemaVersion: "1.0";
  id: string;
  name: string;
  baseUrl: string;
  createdAt: string;
  tags: string[];
  steps: BehaviorStep[];
  authState?: { path: string };
  artifacts?: { rrweb: string; rrwebEventCount: number };
  cleanup: Array<{ type: "ledger" | "request"; value: string }>;
  source: { browser: string; recordedBy: "realdone" };
}

export interface StepVerification {
  stepId: string;
  type: ContractStepType;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  reason: string;
  locatorResolution?: LocatorResolution;
  assertions: Array<{ expectation: ContractExpectation; passed: boolean; detail: string }>;
}

export interface ContractVerification {
  schemaVersion: "1.0";
  verificationId: string;
  contractId: string;
  contractName: string;
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  steps: StepVerification[];
}

const candidateSchema = z.object({
  strategy: z.enum(["testid", "role", "id", "href", "text", "css", "ordinal"]),
  weight: z.number(),
  selector: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  value: z.string().optional(),
  exact: z.boolean().optional(),
});

const fingerprintSchema = z.object({
  selector: z.string(),
  tag: z.string(),
  role: z.string().optional(),
  accessibleName: z.string().optional(),
  text: z.string().optional(),
  testId: z.string().optional(),
  id: z.string().optional(),
  href: z.string().optional(),
  type: z.string().optional(),
  ordinal: z.number().int().nonnegative(),
  candidates: z.array(candidateSchema).optional(),
});

const expectationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("request"), method: z.string(), urlPattern: z.string(), status: z.number().int().optional() }),
  z.object({ type: z.literal("url"), pattern: z.string() }),
  z.object({ type: z.literal("text"), value: z.string() }),
  z.object({ type: z.literal("persistence"), value: z.string() }),
]);

const stepSchema = z.object({
  id: z.string(),
  type: z.enum(["navigate", "click", "fill", "check", "select"]),
  pageUrl: z.string(),
  atMs: z.number().nonnegative(),
  fingerprint: fingerprintSchema.optional(),
  url: z.string().optional(),
  value: z.string().optional(),
  secretEnv: z.string().optional(),
  checked: z.boolean().optional(),
  expected: z.array(expectationSchema).default([]),
});

export const behaviorContractSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string(),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  createdAt: z.string(),
  tags: z.array(z.string()).default([]),
  steps: z.array(stepSchema).min(1),
  authState: z.object({ path: z.string() }).optional(),
  artifacts: z.object({ rrweb: z.string(), rrwebEventCount: z.number().int().nonnegative() }).optional(),
  cleanup: z.array(z.object({ type: z.enum(["ledger", "request"]), value: z.string() })).default([]),
  source: z.object({ browser: z.string(), recordedBy: z.literal("realdone") }),
});

export async function loadBehaviorContract(file: string): Promise<BehaviorContract> {
  const input = JSON.parse(await readFile(file, "utf8")) as unknown;
  const parsed = behaviorContractSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid behavior contract: ${parsed.error.message}`);
  return parsed.data as BehaviorContract;
}

export async function writeBehaviorContract(file: string, contract: BehaviorContract): Promise<void> {
  const parsed = behaviorContractSchema.safeParse(contract);
  if (!parsed.success) throw new Error(`Invalid behavior contract: ${parsed.error.message}`);
  await writeFile(file, `${JSON.stringify(parsed.data, null, 2)}\n`);
}
