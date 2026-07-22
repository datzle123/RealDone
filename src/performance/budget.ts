import { readFile } from "node:fs/promises";
import { z } from "zod";

export interface PerformanceBudget {
  schemaVersion: "1.0";
  maxVerificationMs?: number;
  maxStepMs?: number;
  maxMemoryDeltaMb?: number;
}

export interface PerformanceMeasurement {
  verificationMs: number;
  maxStepMs: number;
  memoryDeltaMb: number;
}

export interface PerformanceEvaluation extends PerformanceMeasurement {
  passed: boolean;
  violations: string[];
  budget: Omit<PerformanceBudget, "schemaVersion">;
}

export const performanceBudgetSchema = z.object({
  schemaVersion: z.literal("1.0"),
  maxVerificationMs: z.number().int().positive().optional(),
  maxStepMs: z.number().int().positive().optional(),
  maxMemoryDeltaMb: z.number().positive().optional(),
}).refine((value) => value.maxVerificationMs !== undefined || value.maxStepMs !== undefined || value.maxMemoryDeltaMb !== undefined, {
  message: "At least one performance limit is required",
});

export async function loadPerformanceBudget(file: string): Promise<PerformanceBudget> {
  const input = JSON.parse(await readFile(file, "utf8")) as unknown;
  const parsed = performanceBudgetSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid performance budget: ${parsed.error.message}`);
  return parsed.data as PerformanceBudget;
}

export function evaluatePerformance(
  budget: PerformanceBudget,
  measurement: PerformanceMeasurement,
): PerformanceEvaluation {
  const violations: string[] = [];
  if (budget.maxVerificationMs !== undefined && measurement.verificationMs > budget.maxVerificationMs) {
    violations.push(`Verification took ${measurement.verificationMs}ms; budget is ${budget.maxVerificationMs}ms.`);
  }
  if (budget.maxStepMs !== undefined && measurement.maxStepMs > budget.maxStepMs) {
    violations.push(`Slowest step took ${measurement.maxStepMs}ms; budget is ${budget.maxStepMs}ms.`);
  }
  if (budget.maxMemoryDeltaMb !== undefined && measurement.memoryDeltaMb > budget.maxMemoryDeltaMb) {
    violations.push(`Memory grew ${measurement.memoryDeltaMb}MB; budget is ${budget.maxMemoryDeltaMb}MB.`);
  }
  return {
    ...measurement,
    passed: violations.length === 0,
    violations,
    budget: {
      ...(budget.maxVerificationMs === undefined ? {} : { maxVerificationMs: budget.maxVerificationMs }),
      ...(budget.maxStepMs === undefined ? {} : { maxStepMs: budget.maxStepMs }),
      ...(budget.maxMemoryDeltaMb === undefined ? {} : { maxMemoryDeltaMb: budget.maxMemoryDeltaMb }),
    },
  };
}
