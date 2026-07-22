import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runManagedScan } from "../application/managed-scan.js";
import { captureBaseline } from "../baseline/manifest.js";
import { runRegressionGate } from "../baseline/regression.js";
import type { BrowserName } from "../browser/runtime.js";
import { verifyContract, type VerifyContractOptions } from "../contracts/verifier.js";
import { redactEnvironmentText } from "../core/redact.js";
import { recordFlow } from "../record/recorder.js";
import { runReplay } from "../replay.js";
import { REALDONE_VERSION } from "../version.js";
import { McpServer, StdioServerTransport } from "./sdk-adapter.js";

export interface RealDoneMcpDependencies {
  runManagedScan: typeof runManagedScan;
  verifyContract: typeof verifyContract;
  recordFlow: typeof recordFlow;
  captureBaseline: typeof captureBaseline;
  runRegressionGate: typeof runRegressionGate;
  runReplay: typeof runReplay;
}

export interface RealDoneMcpServerOptions {
  projectRoot?: string;
  dependencies?: Partial<RealDoneMcpDependencies>;
}

const browserSchema = z.enum(["chromium", "firefox", "webkit"]);
const relativePathSchema = z.string().min(1).max(1_000);

function projectPath(projectRoot: string, input: string): string {
  const resolved = path.resolve(projectRoot, input);
  const relative = path.relative(projectRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path is outside the MCP project root: ${input}`);
  }
  return resolved;
}

function toolSuccess(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function toolFailure(error: unknown) {
  const message = redactEnvironmentText(error instanceof Error ? error.message : String(error), process.env);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function verificationOptions(
  projectRoot: string,
  outputDirectory: string,
  input: {
    browser?: BrowserName | undefined;
    deep?: boolean | undefined;
    trace?: boolean | undefined;
    traceOnFailure?: boolean | undefined;
    sqlite?: string | undefined;
    postgresConfig?: string | undefined;
    databaseConfigs?: string[] | undefined;
    providerConfigs?: string[] | undefined;
    plugins?: string[] | undefined;
    performanceBudget?: string | undefined;
    workers?: number | undefined;
  },
): VerifyContractOptions {
  return {
    outputRoot: projectPath(projectRoot, outputDirectory),
    headed: false,
    timeoutMs: 10_000,
    settleMs: 500,
    maxRetries: 2,
    continueOnFailure: false,
    allowDestructive: false,
    allowExternal: false,
    allowHosts: [],
    browserName: input.browser ?? "chromium",
    deep: input.deep ?? false,
    trace: input.trace ?? false,
    traceOnFailure: input.traceOnFailure ?? true,
    workers: input.workers ?? 1,
    databaseConfigPaths: (input.databaseConfigs ?? []).map((file) => projectPath(projectRoot, file)),
    providerConfigPaths: (input.providerConfigs ?? []).map((file) => projectPath(projectRoot, file)),
    pluginManifests: (input.plugins ?? []).map((file) => projectPath(projectRoot, file)),
    ...(input.sqlite ? { sqlitePath: projectPath(projectRoot, input.sqlite) } : {}),
    ...(input.postgresConfig ? { postgresConfigPath: projectPath(projectRoot, input.postgresConfig) } : {}),
    ...(input.performanceBudget ? { performanceBudgetFile: projectPath(projectRoot, input.performanceBudget) } : {}),
  };
}

const verificationInput = {
  browser: browserSchema.optional().describe("Browser engine; Chromium is the default."),
  deep: z.boolean().optional().describe("Require clean-context persistence verification."),
  trace: z.boolean().optional().describe("Capture a Playwright trace."),
  traceOnFailure: z.boolean().optional().describe("Retain a trace only when verification fails."),
  sqlite: relativePathSchema.optional().describe("Project-relative SQLite database path."),
  postgresConfig: relativePathSchema.optional().describe("Project-relative PostgreSQL adapter config."),
  databaseConfigs: z.array(relativePathSchema).max(20).optional(),
  providerConfigs: z.array(relativePathSchema).max(20).optional(),
  plugins: z.array(relativePathSchema).max(20).optional(),
  performanceBudget: relativePathSchema.optional(),
  workers: z.number().int().min(1).max(8).optional().describe("Bounded contract or browser workers."),
};

async function latestReportDirectory(projectRoot: string): Promise<string> {
  const root = projectPath(projectRoot, ".realdone/reports");
  const entries = await readdir(root, { withFileTypes: true });
  const latest = entries.filter((entry) => entry.isDirectory()).sort((left, right) => right.name.localeCompare(left.name))[0];
  if (!latest) throw new Error("No RealDone report exists yet.");
  return path.join(root, latest.name);
}

async function readBoundedJson(file: string, maxBytes = 20 * 1024 * 1024): Promise<unknown> {
  const info = await stat(file);
  if (!info.isFile() || info.size > maxBytes) throw new Error(`Report artifact is missing or exceeds ${maxBytes} bytes.`);
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

export function createRealDoneMcpServer(options: RealDoneMcpServerOptions = {}): McpServer {
  const projectRoot = path.resolve(options.projectRoot ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const dependencies: RealDoneMcpDependencies = {
    runManagedScan,
    verifyContract,
    recordFlow,
    captureBaseline,
    runRegressionGate,
    runReplay,
    ...options.dependencies,
  };
  const server = new McpServer(
    { name: "realdone", version: REALDONE_VERSION },
    {
      instructions: "RealDone independently verifies web behavior in a real browser. Before code changes, call baseline when contracts exist; after changes, call verify_change. Use scan for an immediate safe check. Never treat the agent's own completion claim as evidence. Tools are fail-closed: destructive and external effects remain disabled.",
    },
  );

  server.registerTool("scan", {
    title: "Scan web application behavior",
    description: "Run RealDone in a real Chromium browser. With no URL, discover and manage the web project in the MCP server working directory.",
    inputSchema: {
      url: z.string().url().optional(),
      deep: z.boolean().optional(),
      full: z.boolean().optional().describe("Use large safe-audit budgets and deep persistence checks."),
      trace: z.boolean().optional(),
      traceOnFailure: z.boolean().optional().describe("Retain Playwright traces only for non-passing findings."),
      maxPages: z.number().int().min(1).max(100).optional(),
      maxActions: z.number().int().min(1).max(250).optional(),
      maxDurationMs: z.number().int().min(10_000).max(600_000).optional(),
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  }, async (input) => {
    try {
      const result = await dependencies.runManagedScan({
        ...(input.url ? { url: input.url } : {}),
        projectDirectory: projectRoot,
        manageRuntime: false,
        runtimeMode: "development",
        runtimeRestarts: 1,
        scanOptions: {
          outputRoot: projectPath(projectRoot, ".realdone/reports"),
          headed: false,
          allowHosts: [],
          allowDestructive: false,
          allowExternal: false,
          mutationAllowed: false,
          maxPages: input.maxPages ?? (input.full ? 100 : 8),
          maxActions: input.maxActions ?? (input.full ? 500 : 24),
          timeoutMs: 10_000,
          settleMs: 800,
          maxDurationMs: input.maxDurationMs ?? (input.full ? 1_800_000 : 120_000),
          maxRetries: 2,
          deep: input.deep ?? input.full ?? false,
          trace: input.trace ?? false,
          traceOnFailure: input.traceOnFailure ?? input.full ?? true,
          video: false,
          environmentTimeoutMs: 10_000,
          acceptEnvironmentRisk: false,
          allowIframes: false,
        },
      });
      return toolSuccess({
        passed: result.exitCode === 0,
        exitCode: result.exitCode,
        reportDirectory: result.reportDirectory,
        summary: result.report.summary,
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("record", {
    title: "Record a behavior flow",
    description: "Open a headed browser for a bounded time while the user demonstrates a flow. Secrets are stored as environment references.",
    inputSchema: {
      url: z.string().url(),
      name: z.string().min(1).max(200),
      output: relativePathSchema.optional(),
      durationSeconds: z.number().int().min(5).max(300),
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  }, async (input) => {
    try {
      const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "flow";
      const result = await dependencies.recordFlow({
        targetUrl: input.url,
        name: input.name,
        outputFile: projectPath(projectRoot, input.output ?? `.realdone/flows/${slug}.json`),
        headed: true,
        timeoutMs: 15_000,
        settleMs: 500,
        stopSignal: new Promise((resolve) => setTimeout(resolve, input.durationSeconds * 1_000)),
      });
      return toolSuccess({
        contractFile: result.contractFile,
        rrwebFile: result.rrwebFile,
        steps: result.contract.steps.length,
        rrwebEvents: result.contract.artifacts?.rrwebEventCount ?? 0,
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("verify", {
    title: "Verify a behavior contract",
    description: "Execute a versioned RealDone behavior contract and return an evidence-backed result.",
    inputSchema: { contract: relativePathSchema, ...verificationInput },
    annotations: { destructiveHint: false, openWorldHint: true },
  }, async (input) => {
    try {
      const result = await dependencies.verifyContract(
        projectPath(projectRoot, input.contract),
        verificationOptions(projectRoot, ".realdone/verifications", input),
      );
      return toolSuccess({
        passed: result.verification.passed,
        exitCode: result.exitCode,
        verificationId: result.verification.verificationId,
        outputDirectory: result.outputDirectory,
        failedSteps: result.verification.steps.filter((step) => step.status === "failed").map((step) => step.stepId),
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("baseline", {
    title: "Capture behavior baseline",
    description: "Verify contracts and save a green baseline before code changes.",
    inputSchema: {
      contracts: z.array(relativePathSchema).min(1).max(100).optional(),
      output: relativePathSchema.optional(),
      ...verificationInput,
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  }, async (input) => {
    try {
      const output = projectPath(projectRoot, input.output ?? ".realdone/baseline.json");
      const manifest = await dependencies.captureBaseline(
        (input.contracts ?? [".realdone/flows"]).map((file) => projectPath(projectRoot, file)),
        output,
        verificationOptions(projectRoot, ".realdone/baseline-runs", input),
        true,
      );
      const failed = manifest.contracts.filter((contract) => contract.baseline && !contract.baseline.passed).length;
      return toolSuccess({ passed: failed === 0, baselineFile: output, contracts: manifest.contracts.length, failed });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("verify_change", {
    title: "Verify code changes against a baseline",
    description: "Re-run affected or all contracts after an AI code change. Agent output is never used as verification evidence.",
    inputSchema: {
      baseline: relativePathSchema.optional(),
      contracts: z.array(relativePathSchema).max(100).optional(),
      changedFiles: z.array(relativePathSchema).max(5_000).optional(),
      ...verificationInput,
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  }, async (input) => {
    try {
      const changedFiles = (input.changedFiles ?? []).map((file) => {
        const absolute = projectPath(projectRoot, file);
        return path.relative(projectRoot, absolute).split(path.sep).join("/");
      });
      const result = await dependencies.runRegressionGate({
        baselineFile: projectPath(projectRoot, input.baseline ?? ".realdone/baseline.json"),
        contractInputs: (input.contracts ?? []).map((file) => projectPath(projectRoot, file)),
        changedFiles,
        outputRoot: projectPath(projectRoot, ".realdone/ci"),
        verifyOptions: verificationOptions(projectRoot, ".realdone/ci", input),
      });
      return toolSuccess({
        passed: result.report.passed,
        exitCode: result.exitCode,
        outputDirectory: result.outputDirectory,
        selectedContracts: result.report.selectedContracts,
        regressions: result.report.regressions,
        expectedChanges: result.report.expectedChanges,
        changes: result.report.changes.map((change) => ({
          contractId: change.contractId,
          outcome: change.outcome,
          detectorCodes: change.detectorCodes,
          detail: change.detail,
        })),
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("replay", {
    title: "Replay a RealDone finding",
    description: "Freshly execute a finding reproduction and classify whether it still reproduces.",
    inputSchema: {
      findingId: z.string().min(1).max(200),
      reportDirectory: relativePathSchema.optional(),
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  }, async (input) => {
    try {
      const result = await dependencies.runReplay(input.findingId, {
        ...(input.reportDirectory ? { reportDirectory: projectPath(projectRoot, input.reportDirectory) } : {}),
        outputRoot: projectPath(projectRoot, ".realdone/replays"),
        headed: false,
      });
      return toolSuccess({
        outcome: result.replay.outcome,
        exitCode: result.exitCode,
        reportDirectory: result.reportDirectory,
        detail: result.replay.detail,
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("get_report", {
    title: "Read a RealDone report summary",
    description: "Read the latest or selected report summary without returning raw evidence values.",
    inputSchema: { reportDirectory: relativePathSchema.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (input) => {
    try {
      const reportDirectory = input.reportDirectory
        ? projectPath(projectRoot, input.reportDirectory)
        : await latestReportDirectory(projectRoot);
      const summary = await readBoundedJson(path.join(reportDirectory, "summary.json"));
      const rawFindings = await readBoundedJson(path.join(reportDirectory, "findings.json"));
      const findings = Array.isArray(rawFindings)
        ? rawFindings.slice(0, 200).map((finding) => {
          const value = finding as Record<string, unknown>;
          const action = value.action as Record<string, unknown> | undefined;
          const detectors = Array.isArray(value.detectorMatches) ? value.detectorMatches : [];
          return {
            id: value.id,
            label: action?.label,
            verdict: value.verdict,
            reason: value.reason,
            detectorCodes: detectors.map((detector) => (detector as Record<string, unknown>).code),
          };
        })
        : [];
      return toolSuccess({ reportDirectory, summary, findings });
    } catch (error) {
      return toolFailure(error);
    }
  });

  return server;
}

export async function runRealDoneMcpServer(options: RealDoneMcpServerOptions = {}): Promise<void> {
  const server = createRealDoneMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`RealDone MCP ${REALDONE_VERSION} running on stdio for ${path.resolve(options.projectRoot ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd())}\n`);
}
