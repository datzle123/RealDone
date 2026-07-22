import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { createPostgresAdapterFromFile, type PostgresSourceAdapter } from "../adapters/postgres/index.js";
import { attachEvidence, type EvidenceSink } from "../browser/evidence.js";
import { resolveSemanticLocator } from "../browser/locator.js";
import { launchBrowser, type BrowserName } from "../browser/runtime.js";
import { createContractCleanupLedger, writeCleanupLedger } from "../cleanup/ledger.js";
import { classifyAction } from "../core/classify.js";
import { redactText } from "../core/redact.js";
import { PluginHost } from "../plugins/host.js";
import { evaluatePerformance, loadPerformanceBudget } from "../performance/budget.js";
import { actionSkipReason } from "../core/safety.js";
import type { NetworkEvidence } from "../types.js";
import { loadBehaviorContract, type BehaviorStep, type ContractExpectation, type ContractVerification, type StepVerification } from "./schema.js";
import { renderContractVerification } from "./report.js";

export interface VerifyContractOptions {
  outputRoot: string;
  headed: boolean;
  timeoutMs: number;
  settleMs: number;
  maxRetries: number;
  continueOnFailure: boolean;
  allowDestructive: boolean;
  allowExternal: boolean;
  allowHosts: string[];
  executablePath?: string;
  storageStatePath?: string;
  postgresConfigPath?: string;
  browserName?: BrowserName;
  roleStorageStates?: Record<string, string>;
  pluginManifests?: string[];
  pluginTimeoutMs?: number;
  pluginMemoryLimitMb?: number;
  performanceBudgetFile?: string;
}

export interface VerifyContractResult {
  verification: ContractVerification;
  outputDirectory: string;
  exitCode: number;
}

function verificationId(): string {
  return `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${randomBytes(2).toString("hex")}`;
}

function emptySink(): EvidenceSink {
  return { network: [], console: [], pageErrors: [], dialogs: [], downloads: [] };
}

async function executeStep(page: Page, step: BehaviorStep, locator?: Locator): Promise<void> {
  switch (step.type) {
    case "navigate":
      await page.goto(step.url ?? step.pageUrl, { waitUntil: "domcontentloaded" });
      return;
    case "fill": {
      if (!locator) throw new Error("Fill step has no locator.");
      const value = step.secretEnv ? process.env[step.secretEnv] : step.value;
      if (value === undefined || value === "[REDACTED]") {
        throw new Error(`Missing secret value. Set environment variable ${step.secretEnv ?? "referenced by the contract"}.`);
      }
      await locator.fill(value);
      return;
    }
    case "check":
      if (!locator) throw new Error("Check step has no locator.");
      if (step.checked === false) await locator.uncheck();
      else await locator.check();
      return;
    case "select":
      if (!locator) throw new Error("Select step has no locator.");
      if (step.value === undefined) throw new Error("Select step has no value.");
      await locator.selectOption(step.value);
      return;
    case "click":
      if (!locator) throw new Error("Click step has no locator.");
      await locator.click();
  }
}

function networkMatches(network: NetworkEvidence[], expectation: Extract<ContractExpectation, { type: "request" }>): boolean {
  return network.some((entry) => {
    let value = entry.url;
    try {
      const url = new URL(entry.url);
      value = `${url.pathname}${url.search}`;
    } catch {
      // Match the stored safe URL.
    }
    return (
      entry.method === expectation.method &&
      new RegExp(expectation.urlPattern).test(value) &&
      (expectation.status === undefined || entry.status === expectation.status)
    );
  });
}

function redactSourceExpectation(
  expectation: Extract<ContractExpectation, { type: "source" }>,
): Extract<ContractExpectation, { type: "source" }> {
  return {
    ...expectation,
    filters: expectation.filters.map((filter) =>
      "env" in filter ? filter : { field: filter.field, value: "[REDACTED]" },
    ),
  };
}

function redactProviderExpectation(
  expectation: Extract<ContractExpectation, { type: "provider" }>,
): Extract<ContractExpectation, { type: "provider" }> {
  return {
    ...expectation,
    reference: "env" in expectation.reference ? expectation.reference : { value: "[REDACTED]" },
    ...(expectation.parameters ? {
      parameters: Object.fromEntries(Object.keys(expectation.parameters).map((key) => [key, "[REDACTED]"])),
    } : {}),
  };
}

async function verifyExpectation(
  page: Page,
  expectation: ContractExpectation,
  network: NetworkEvidence[],
  postgres?: PostgresSourceAdapter,
  rolePage?: (role: string) => Promise<Page>,
  plugins?: PluginHost,
): Promise<StepVerification["assertions"][number]> {
  switch (expectation.type) {
    case "request": {
      const passed = networkMatches(network, expectation);
      return {
        expectation,
        passed,
        detail: `${expectation.method} ${expectation.urlPattern}${expectation.status ? ` → ${expectation.status}` : ""}`,
        evidenceLevel: expectation.status === undefined ? 2 : 3,
      };
    }
    case "url": {
      const pathname = new URL(page.url()).pathname;
      const passed = new RegExp(expectation.pattern).test(pathname);
      return { expectation, passed, detail: `URL ${pathname} matches ${expectation.pattern}`, evidenceLevel: 1 };
    }
    case "text": {
      const passed = await page.getByText(expectation.value, { exact: true }).last().isVisible().catch(() => false);
      return { expectation, passed, detail: `Visible text: ${expectation.value}`, evidenceLevel: 1 };
    }
    case "persistence": {
      await page.reload({ waitUntil: "domcontentloaded" });
      const passed = await page.getByText(expectation.value, { exact: false }).last().isVisible().catch(() => false);
      return { expectation, passed, detail: `Text persisted after reload: ${expectation.value}`, evidenceLevel: 5 };
    }
    case "source": {
      const reportExpectation = redactSourceExpectation(expectation);
      if (!postgres) {
        return {
          expectation: reportExpectation,
          passed: false,
          detail: "PostgreSQL source expectation requires --postgres-config.",
          evidenceLevel: 6,
        };
      }
      try {
        const sourceEvidence = await postgres.verify(expectation);
        const maximum = expectation.maxMatches === undefined ? "" : `, maximum ${expectation.maxMatches}`;
        return {
          expectation: reportExpectation,
          passed: sourceEvidence.passed,
          detail: `PostgreSQL ${expectation.resource}: ${sourceEvidence.matchedRows} row(s), expected ${expectation.state}${maximum}`,
          evidenceLevel: 6,
          sourceEvidence,
        };
      } catch (error) {
        return {
          expectation: reportExpectation,
          passed: false,
          detail: `PostgreSQL source check failed: ${redactText(error instanceof Error ? error.message : String(error))}`,
          evidenceLevel: 6,
        };
      }
    }
    case "provider": {
      const reportExpectation = redactProviderExpectation(expectation);
      if (!plugins) {
        return {
          expectation: reportExpectation,
          passed: false,
          detail: `Provider expectation requires a plugin manifest: ${expectation.provider}`,
          evidenceLevel: 6,
        };
      }
      try {
        const providerEvidence = await plugins.verifyProvider(expectation);
        return {
          expectation: reportExpectation,
          passed: providerEvidence.passed,
          detail: `${expectation.kind} provider ${expectation.provider}: ${providerEvidence.detail}`,
          evidenceLevel: 6,
          providerEvidence,
        };
      } catch (error) {
        return {
          expectation: reportExpectation,
          passed: false,
          detail: `Provider check failed: ${redactText(error instanceof Error ? error.message : String(error))}`,
          evidenceLevel: 6,
        };
      }
    }
    case "cross-role": {
      if (!rolePage) {
        return { expectation, passed: false, detail: "Cross-role verifier is unavailable.", evidenceLevel: 7 };
      }
      try {
        const target = await rolePage(expectation.role);
        await target.goto(expectation.pageUrl, { waitUntil: "domcontentloaded" });
        if (expectation.assertion.type === "url") {
          const current = target.url();
          const passed = new RegExp(expectation.assertion.pattern).test(current);
          return {
            expectation,
            passed,
            detail: `Role ${expectation.role} URL ${current} matches ${expectation.assertion.pattern}`,
            evidenceLevel: 7,
          };
        }
        const visible = await target.getByText(expectation.assertion.value, { exact: false }).last().isVisible().catch(() => false);
        const passed = expectation.assertion.state === "visible" ? visible : !visible;
        return {
          expectation,
          passed,
          detail: `Role ${expectation.role}: text ${expectation.assertion.state} (${expectation.assertion.value})`,
          evidenceLevel: 7,
        };
      } catch (error) {
        return {
          expectation,
          passed: false,
          detail: `Cross-role check failed for ${expectation.role}: ${redactText(error instanceof Error ? error.message : String(error))}`,
          evidenceLevel: 7,
        };
      }
    }
  }
}

interface RolePages {
  page(role?: string): Promise<Page>;
  close(): Promise<void>;
}

function createRolePages(
  browser: Browser,
  contractFile: string,
  contract: Awaited<ReturnType<typeof loadBehaviorContract>>,
  options: VerifyContractOptions,
): RolePages {
  const opened = new Map<string, { context: BrowserContext; page: Page }>();
  const contractDirectory = path.dirname(contractFile);
  const storageFor = (role: string): string | undefined => {
    if (role === "default") {
      const contractStorage = contract.authState?.path
        ? path.resolve(contractDirectory, contract.authState.path)
        : undefined;
      return options.storageStatePath ?? contractStorage;
    }
    const override = options.roleStorageStates?.[role];
    if (override) return path.resolve(override);
    const configured = contract.roles?.[role]?.authState.path;
    return configured ? path.resolve(contractDirectory, configured) : undefined;
  };
  return {
    page: async (role = "default") => {
      const existing = opened.get(role);
      if (existing) return existing.page;
      if (role !== "default" && !contract.roles?.[role]) throw new Error(`Unknown behavior role: ${role}`);
      const storageState = storageFor(role);
      const context = await browser.newContext(storageState ? { storageState } : {});
      const page = await context.newPage();
      opened.set(role, { context, page });
      return page;
    },
    close: async () => {
      await Promise.allSettled([...opened.values()].map(({ context }) => context.close()));
      opened.clear();
    },
  };
}

export async function verifyContract(
  contractFile: string,
  options: VerifyContractOptions,
): Promise<VerifyContractResult> {
  const absoluteContract = path.resolve(contractFile);
  const contract = await loadBehaviorContract(absoluteContract);
  const performanceBudget = options.performanceBudgetFile
    ? await loadPerformanceBudget(options.performanceBudgetFile)
    : undefined;
  const id = verificationId();
  const outputDirectory = path.resolve(options.outputRoot, id);
  await mkdir(outputDirectory, { recursive: true });
  const needsPostgres = contract.steps.some((step) => step.expected.some((expectation) => expectation.type === "source"));
  const postgres = needsPostgres && options.postgresConfigPath
    ? await createPostgresAdapterFromFile(options.postgresConfigPath)
    : undefined;
  const plugins = (options.pluginManifests?.length ?? 0) > 0
    ? await PluginHost.load(options.pluginManifests ?? [], {
        ...(options.pluginTimeoutMs === undefined ? {} : { timeoutMs: options.pluginTimeoutMs }),
        ...(options.pluginMemoryLimitMb === undefined ? {} : { memoryLimitMb: options.pluginMemoryLimitMb }),
      })
    : undefined;
  const verificationStarted = Date.now();
  const memoryBefore = process.memoryUsage().rss;
  const browser = await launchBrowser({
    headed: options.headed,
    browserName: options.browserName ?? "chromium",
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  });
  const rolePages = createRolePages(browser, absoluteContract, contract, options);
  const startedAt = new Date();
  const results: StepVerification[] = [];
  let blocked = false;
  try {
    for (const step of contract.steps) {
      const stepStarted = Date.now();
      const role = step.role ?? "default";
      if (blocked) {
        results.push({ stepId: step.id, type: step.type, role, status: "skipped", durationMs: 0, reason: "A previous step failed.", assertions: [] });
        continue;
      }
      const page = await rolePages.page(role);
      const sink = emptySink();
      const attached = attachEvidence(page, stepStarted, sink);
      let resolution: Awaited<ReturnType<typeof resolveSemanticLocator>> | undefined;
      try {
        if (step.type !== "navigate") {
          if (!step.fingerprint) throw new Error("Interaction step is missing a semantic fingerprint.");
          resolution = await resolveSemanticLocator(page, step.fingerprint, options.maxRetries);
        }
        if (step.type === "click" && step.fingerprint) {
          const label = step.fingerprint.accessibleName ?? step.fingerprint.text ?? "Recorded click";
          const classification = classifyAction(label, step.fingerprint.tag, step.fingerprint.href, false);
          const reason = actionSkipReason(
            {
              id: step.id,
              pageUrl: step.pageUrl,
              label,
              fingerprint: step.fingerprint,
              fields: [],
              ...classification,
            },
            {
              target: new URL(step.pageUrl),
              allowHosts: options.allowHosts,
              allowDestructive: options.allowDestructive,
              allowExternal: options.allowExternal,
            },
          );
          if (reason) throw new Error(reason);
        }
        await executeStep(page, step, resolution?.locator);
        await page.waitForLoadState("domcontentloaded", { timeout: Math.min(options.timeoutMs, 3_000) }).catch(() => undefined);
        await page.waitForTimeout(options.settleMs);
        await attached.flush();
        const assertions: StepVerification["assertions"] = [];
        for (const expectation of step.expected) {
          assertions.push(await verifyExpectation(page, expectation, sink.network, postgres, rolePages.page, plugins));
        }
        const passed = assertions.every((assertion) => assertion.passed) && sink.pageErrors.length === 0;
        results.push({
          stepId: step.id,
          type: step.type,
          role,
          status: passed ? "passed" : "failed",
          durationMs: Date.now() - stepStarted,
          reason: passed ? "Step and recorded expectations passed." : sink.pageErrors[0] ?? "One or more recorded expectations failed.",
          ...(resolution ? { locatorResolution: resolution.diagnostics } : {}),
          assertions,
        });
        if (!passed && !options.continueOnFailure) blocked = true;
      } catch (error) {
        results.push({
          stepId: step.id,
          type: step.type,
          role,
          status: "failed",
          durationMs: Date.now() - stepStarted,
          reason: error instanceof Error ? error.message : String(error),
          ...(resolution ? { locatorResolution: resolution.diagnostics } : {}),
          assertions: [],
        });
        if (!options.continueOnFailure) blocked = true;
      } finally {
        await attached.flush();
        attached.detach();
      }
    }
  } finally {
    await rolePages.close();
    await browser.close();
    await postgres?.close();
  }
  const verification: ContractVerification = {
    schemaVersion: "1.0",
    verificationId: id,
    contractId: contract.id,
    contractName: contract.name,
    browser: options.browserName ?? "chromium",
    roles: ["default", ...Object.keys(contract.roles ?? {}).sort()],
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    passed: false,
    steps: results,
  };
  const performance = performanceBudget
    ? evaluatePerformance(performanceBudget, {
        verificationMs: Date.now() - verificationStarted,
        maxStepMs: Math.max(0, ...results.map((step) => step.durationMs)),
        memoryDeltaMb: Math.round(((process.memoryUsage().rss - memoryBefore) / 1024 / 1024) * 100) / 100,
      })
    : undefined;
  verification.passed = results.every((step) => step.status === "passed") && (performance?.passed ?? true);
  if (performance) verification.performance = performance;
  await Promise.all([
    writeFile(path.join(outputDirectory, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`),
    writeFile(path.join(outputDirectory, "report.html"), renderContractVerification(verification)),
    writeCleanupLedger(outputDirectory, createContractCleanupLedger(contract, id)),
  ]);
  return { verification, outputDirectory, exitCode: verification.passed ? 0 : 1 };
}
