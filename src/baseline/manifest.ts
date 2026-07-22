import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { loadBehaviorContract, type BehaviorContract, type ContractVerification } from "../contracts/schema.js";
import { verifyContract, type VerifyContractOptions } from "../contracts/verifier.js";

export interface BaselineStep {
  id: string;
  status: "passed" | "failed" | "skipped";
  assertions: Array<{ type: string; passed: boolean; detail: string }>;
}

export interface ManifestContract {
  id: string;
  name: string;
  file: string;
  hash: string;
  tags: string[];
  routes: string[];
  endpoints: Array<{ method: string; pattern: string }>;
  sourceFiles: string[];
  stepCount: number;
  baseline?: {
    passed: boolean;
    verificationId: string;
    performancePassed?: boolean;
    steps: BaselineStep[];
  };
}

export interface BehaviorManifest {
  schemaVersion: "1.0";
  generatedAt: string;
  contracts: ManifestContract[];
}

export interface BuildManifestOptions {
  manifestFile: string;
  verify: boolean;
  verifyOptions: VerifyContractOptions;
  verificationOutputRoot?: string;
}

const baselineStepSchema = z.object({
  id: z.string(),
  status: z.enum(["passed", "failed", "skipped"]),
  assertions: z.array(z.object({ type: z.string(), passed: z.boolean(), detail: z.string() })),
});

const manifestContractSchema = z.object({
  id: z.string(),
  name: z.string(),
  file: z.string(),
  hash: z.string(),
  tags: z.array(z.string()),
  routes: z.array(z.string()),
  endpoints: z.array(z.object({ method: z.string(), pattern: z.string() })),
  sourceFiles: z.array(z.string()),
  stepCount: z.number().int().nonnegative(),
  baseline: z
    .object({ passed: z.boolean(), verificationId: z.string(), performancePassed: z.boolean().optional(), steps: z.array(baselineStepSchema) })
    .optional(),
});

const manifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  generatedAt: z.string(),
  contracts: z.array(manifestContractSchema),
});

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function contractHash(contract: BehaviorContract): string {
  return createHash("sha256").update(JSON.stringify(canonical(contract))).digest("hex");
}

function routesFor(contract: BehaviorContract): string[] {
  const routes = contract.steps.flatMap((step) => {
    const values = [step.pageUrl, step.url].filter((value): value is string => Boolean(value));
    return values.map((value) => {
      try {
        return new URL(value).pathname;
      } catch {
        return value;
      }
    });
  });
  return [...new Set(routes)].sort();
}

function endpointsFor(contract: BehaviorContract): Array<{ method: string; pattern: string }> {
  const endpoints = contract.steps.flatMap((step) =>
    step.expected.flatMap((expectation) =>
      expectation.type === "request"
        ? [{ method: expectation.method, pattern: expectation.urlPattern }]
        : expectation.type === "authorization" && expectation.request
          ? [{ method: expectation.request.method, pattern: expectation.request.url }]
        : [],
    ),
  );
  return [...new Map(endpoints.map((item) => [`${item.method} ${item.pattern}`, item])).values()];
}

function baselineFor(verification: ContractVerification): NonNullable<ManifestContract["baseline"]> {
  return {
    passed: verification.passed,
    verificationId: verification.verificationId,
    ...(verification.performance ? { performancePassed: verification.performance.passed } : {}),
    steps: verification.steps.map((step) => ({
      id: step.stepId,
      status: step.status,
      assertions: step.assertions.map((assertion) => ({
        type: assertion.expectation.type,
        passed: assertion.passed,
        detail: assertion.detail,
      })),
    })),
  };
}

export async function collectContractFiles(inputs: string[]): Promise<string[]> {
  const files: string[] = [];
  const visit = async (input: string): Promise<void> => {
    const absolute = path.resolve(input);
    const info = await stat(absolute);
    if (info.isDirectory()) {
      for (const entry of await readdir(absolute, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        await visit(path.join(absolute, entry.name));
      }
    } else if (absolute.endsWith(".json") && !absolute.endsWith(".rrweb.json")) {
      files.push(absolute);
    }
  };
  for (const input of inputs) await visit(input);
  return [...new Set(files)].sort();
}

export async function buildBehaviorManifest(
  contractFiles: string[],
  options: BuildManifestOptions,
): Promise<BehaviorManifest> {
  const manifestDirectory = path.dirname(path.resolve(options.manifestFile));
  const contracts: ManifestContract[] = [];
  for (const file of contractFiles) {
    const contract = await loadBehaviorContract(file);
    const verification = options.verify
      ? await verifyContract(file, {
          ...options.verifyOptions,
          outputRoot: options.verificationOutputRoot ?? path.join(manifestDirectory, "baseline-runs"),
        })
      : undefined;
    contracts.push({
      id: contract.id,
      name: contract.name,
      file: path.relative(manifestDirectory, file).split(path.sep).join("/"),
      hash: contractHash(contract),
      tags: contract.tags,
      routes: routesFor(contract),
      endpoints: endpointsFor(contract),
      sourceFiles: contract.scope?.files ?? [],
      stepCount: contract.steps.length,
      ...(verification ? { baseline: baselineFor(verification.verification) } : {}),
    });
  }
  return { schemaVersion: "1.0", generatedAt: new Date().toISOString(), contracts };
}

export async function captureBaseline(
  inputs: string[],
  outputFile: string,
  verifyOptions: VerifyContractOptions,
  verify = true,
): Promise<BehaviorManifest> {
  const file = path.resolve(outputFile);
  await mkdir(path.dirname(file), { recursive: true });
  const contractFiles = await collectContractFiles(inputs);
  if (contractFiles.length === 0) throw new Error("No behavior contract JSON files were found.");
  const manifest = await buildBehaviorManifest(contractFiles, {
    manifestFile: file,
    verify,
    verifyOptions,
  });
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function loadBehaviorManifest(file: string): Promise<BehaviorManifest> {
  const input = JSON.parse(await readFile(file, "utf8")) as unknown;
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid behavior manifest: ${parsed.error.message}`);
  return parsed.data as BehaviorManifest;
}
