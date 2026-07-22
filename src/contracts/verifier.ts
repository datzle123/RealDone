import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, Locator, Page, Video } from "playwright";
import { createPostgresAdapterFromFile } from "../adapters/postgres/index.js";
import { SqliteSourceAdapter } from "../adapters/sqlite/index.js";
import { createSourceAdapterFromFile } from "../adapters/registry.js";
import type { SourceAdapterKind, SourceOfTruthAdapter } from "../adapters/types.js";
import { attachEvidence, type EvidenceSink } from "../browser/evidence.js";
import { resolveSemanticLocator } from "../browser/locator.js";
import { launchBrowser, type BrowserName } from "../browser/runtime.js";
import { createContractCleanupLedger, writeCleanupLedger } from "../cleanup/ledger.js";
import { classifyAction } from "../core/classify.js";
import { redactText, safeUrl } from "../core/redact.js";
import { PluginHost } from "../plugins/host.js";
import { BuiltinProviderHost } from "../providers/builtin.js";
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
  sqlitePath?: string;
  databaseConfigPaths?: string[];
  providerConfigPaths?: string[];
  browserName?: BrowserName;
  roleStorageStates?: Record<string, string>;
  pluginManifests?: string[];
  pluginTimeoutMs?: number;
  pluginMemoryLimitMb?: number;
  performanceBudgetFile?: string;
  deep?: boolean;
  trace?: boolean;
  video?: boolean;
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

async function executeStep(page: Page, step: BehaviorStep, locator?: Locator, targetLocator?: Locator): Promise<void> {
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
    case "press":
      if (!locator || !step.key) throw new Error("Press step is missing a locator or key.");
      await locator.press(step.key);
      return;
    case "upload": {
      if (!locator || !step.fileEnv) throw new Error("Upload step is missing a locator or file environment reference.");
      const file = process.env[step.fileEnv];
      if (!file) throw new Error(`Missing upload file. Set environment variable ${step.fileEnv}.`);
      await locator.setInputFiles(file);
      return;
    }
    case "richtext":
      if (!locator) throw new Error("Rich-text step has no locator.");
      await locator.fill(step.value ?? "");
      return;
    case "drag":
      if (!locator || !targetLocator) throw new Error("Drag step is missing a semantic source or target.");
      await locator.dragTo(targetLocator);
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
  sink: EvidenceSink,
  sourceAdapters?: Map<SourceAdapterKind, SourceOfTruthAdapter>,
  rolePage?: (role: string) => Promise<Page>,
  plugins?: PluginHost,
  builtinProviders?: BuiltinProviderHost,
  freshRolePage?: (role?: string) => Promise<Page>,
  deep = false,
  stepRole = "default",
  settleMs = 0,
): Promise<StepVerification["assertions"][number]> {
  switch (expectation.type) {
    case "request": {
      const passed = networkMatches(sink.network, expectation);
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
    case "download": {
      const download = sink.downloadEvidence?.find((candidate) =>
        !expectation.fileNamePattern || new RegExp(expectation.fileNamePattern).test(candidate.fileName),
      );
      const passed = Boolean(download && !download.failure && (!expectation.nonEmpty || (download.size ?? 0) > 0));
      return {
        expectation,
        passed,
        detail: download ? `Download ${download.fileName}: ${download.size ?? 0} byte(s)` : "Expected download was not observed.",
        evidenceLevel: 5,
      };
    }
    case "popup": {
      const popupPattern = new RegExp(expectation.urlPattern);
      const popup = sink.popupUrls?.find((url) => {
        try {
          return popupPattern.test(new URL(url).pathname);
        } catch {
          return popupPattern.test(url);
        }
      });
      return {
        expectation,
        passed: Boolean(popup),
        detail: popup ? `Popup URL matched: ${popup}` : `No popup matched ${expectation.urlPattern}`,
        evidenceLevel: 1,
      };
    }
    case "persistence": {
      const strategies = expectation.strategies ?? (deep ? ["reload", "clean-context"] as const : ["reload"] as const);
      const url = page.url();
      const outcomes: Array<{ strategy: string; passed: boolean }> = [];
      const visible = async (target: Page): Promise<boolean> => {
        if (settleMs > 0) await target.waitForTimeout(settleMs);
        return target.getByText(expectation.value, { exact: false }).last().isVisible().catch(() => false);
      };
      for (const strategy of strategies) {
        if (strategy === "reload") {
          await page.reload({ waitUntil: "domcontentloaded" });
          outcomes.push({ strategy, passed: await visible(page) });
          continue;
        }
        if (strategy === "hard-reload") {
          await page.context().setExtraHTTPHeaders({ "cache-control": "no-cache", pragma: "no-cache" });
          try {
            await page.reload({ waitUntil: "domcontentloaded" });
            outcomes.push({ strategy, passed: await visible(page) });
          } finally {
            await page.context().setExtraHTTPHeaders({});
          }
          continue;
        }
        if (strategy === "new-tab") {
          const tab = await page.context().newPage();
          try {
            await tab.goto(url, { waitUntil: "domcontentloaded" });
            outcomes.push({ strategy, passed: await visible(tab) });
          } finally {
            await tab.close();
          }
          continue;
        }
        if (!freshRolePage) {
          outcomes.push({ strategy, passed: false });
          continue;
        }
        const fresh = await freshRolePage(stepRole);
        await fresh.goto(url, { waitUntil: "domcontentloaded" });
        outcomes.push({ strategy, passed: await visible(fresh) });
      }
      const passed = outcomes.every((outcome) => outcome.passed);
      const persistenceScope = strategies.some((strategy) => strategy === "clean-context" || strategy === "logout-login")
        ? "BACKEND_PERSISTENT" as const
        : strategies.includes("new-tab")
          ? "BROWSER_LOCAL" as const
          : strategies.includes("hard-reload")
            ? "SESSION_PERSISTENT" as const
            : "TAB_PERSISTENT" as const;
      return {
        expectation,
        passed,
        detail: `Persistence ${outcomes.map((outcome) => `${outcome.strategy}=${outcome.passed ? "present" : "missing"}`).join(", ")}: ${expectation.value}`,
        evidenceLevel: 5,
        ...(passed ? { persistenceScope } : {}),
      };
    }
    case "source": {
      const reportExpectation = redactSourceExpectation(expectation);
      const sourceAdapter = sourceAdapters?.get(expectation.adapter);
      const pluginSource = expectation.adapter === "prisma" || expectation.adapter === "custom";
      if (!sourceAdapter && (!plugins || !pluginSource)) {
        return {
          expectation: reportExpectation,
          passed: false,
          detail: `${expectation.adapter} source expectation requires its explicit adapter option.`,
          evidenceLevel: 6,
        };
      }
      try {
        const sourceEvidence = sourceAdapter
          ? await sourceAdapter.verify(expectation)
          : await plugins!.verifySource(expectation);
        const maximum = expectation.maxMatches === undefined ? "" : `, maximum ${expectation.maxMatches}`;
        return {
          expectation: reportExpectation,
          passed: sourceEvidence.passed,
          detail: `${expectation.adapter} ${expectation.resource}: ${sourceEvidence.matchedRows} row(s), expected ${expectation.state}${maximum}`,
          evidenceLevel: 6,
          sourceEvidence,
          ...(sourceEvidence.passed ? { persistenceScope: "SOURCE_OF_TRUTH_CONFIRMED" as const } : {}),
        };
      } catch (error) {
        return {
          expectation: reportExpectation,
          passed: false,
          detail: `${expectation.adapter} source check failed: ${redactText(error instanceof Error ? error.message : String(error))}`,
          evidenceLevel: 6,
        };
      }
    }
    case "provider": {
      const reportExpectation = redactProviderExpectation(expectation);
      const builtin = builtinProviders?.has(expectation.provider) ?? false;
      if (!plugins && !builtin) {
        return {
          expectation: reportExpectation,
          passed: false,
          detail: `Provider expectation requires a plugin manifest: ${expectation.provider}`,
          evidenceLevel: 6,
        };
      }
      try {
        const providerEvidence = builtin
          ? await builtinProviders!.verifyProvider(expectation)
          : await plugins!.verifyProvider(expectation);
        return {
          expectation: reportExpectation,
          passed: providerEvidence.passed,
          detail: `${expectation.kind} provider ${expectation.provider}: ${providerEvidence.detail}`,
          evidenceLevel: 6,
          providerEvidence,
          ...(providerEvidence.passed ? { persistenceScope: "SOURCE_OF_TRUTH_CONFIRMED" as const } : {}),
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
            ...(passed ? { persistenceScope: "CROSS_USER_CONFIRMED" as const } : {}),
          };
        }
        const visible = await target.getByText(expectation.assertion.value, { exact: false }).last().isVisible().catch(() => false);
        const passed = expectation.assertion.state === "visible" ? visible : !visible;
        return {
          expectation,
          passed,
          detail: `Role ${expectation.role}: text ${expectation.assertion.state} (${expectation.assertion.value})`,
          evidenceLevel: 7,
          ...(passed ? { persistenceScope: "CROSS_USER_CONFIRMED" as const } : {}),
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
    case "authorization": {
      const detectorCode = {
        "ui-only-permission": "RD601",
        "cross-tenant-read": "RD602",
        "cross-tenant-write": "RD603",
        "revoked-role": "RD604",
        "admin-route": "RD605",
      }[expectation.check] as "RD601" | "RD602" | "RD603" | "RD604" | "RD605";
      if (!rolePage) {
        return { expectation, passed: false, detail: "Authorization verifier is unavailable.", evidenceLevel: 7, detectorCode };
      }
      try {
        const target = await rolePage(expectation.role);
        const observations: string[] = [];
        let passed = true;
        if (expectation.ui) {
          await target.goto(expectation.ui.pageUrl, { waitUntil: "domcontentloaded" });
          const visible = await target.getByText(expectation.ui.text, { exact: false }).last().isVisible().catch(() => false);
          const uiPassed = expectation.ui.state === "visible" ? visible : !visible;
          passed &&= uiPassed;
          observations.push(`ui-${expectation.ui.state}=${uiPassed}`);
        }
        if (expectation.request) {
          const response = await target.context().request.fetch(expectation.request.url, {
            method: expectation.request.method,
            timeout: 5_000,
            maxRedirects: 0,
          });
          const denied = [401, 403, 404].includes(response.status());
          passed &&= denied;
          observations.push(`api-status=${response.status()}`);
        }
        if (expectation.route) {
          const response = await target.goto(expectation.route.url, { waitUntil: "domcontentloaded" });
          const text = await target.locator("body").innerText().catch(() => "");
          const denied = [401, 403, 404].includes(response?.status() ?? 0) || /unauthorized|forbidden|access denied|login required/i.test(text);
          passed &&= denied;
          observations.push(`route-status=${response?.status() ?? "none"}, denied=${denied}`);
        }
        return {
          expectation,
          passed,
          detail: `Authorization ${expectation.check} for ${expectation.role}: ${observations.join(", ")}`,
          evidenceLevel: 7,
          ...(passed ? { persistenceScope: "CROSS_USER_CONFIRMED" as const } : { detectorCode }),
        };
      } catch (error) {
        return {
          expectation,
          passed: false,
          detail: `Authorization check failed for ${expectation.role}: ${redactText(error instanceof Error ? error.message : String(error))}`,
          evidenceLevel: 7,
          detectorCode,
        };
      }
    }
  }
}

interface RolePages {
  page(role?: string): Promise<Page>;
  freshPage(role?: string): Promise<Page>;
  close(): Promise<{ traces: string[]; videos: string[] }>;
}

function createRolePages(
  browser: Browser,
  contractFile: string,
  contract: Awaited<ReturnType<typeof loadBehaviorContract>>,
  options: VerifyContractOptions,
  outputDirectory: string,
): RolePages {
  interface ContextEntry {
    context: BrowserContext;
    page: Page;
    name: string;
    video: Video | null;
  }
  const opened = new Map<string, ContextEntry>();
  const contexts: ContextEntry[] = [];
  let freshSequence = 0;
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
  const open = async (role: string, fresh: boolean): Promise<ContextEntry> => {
      if (role !== "default" && !contract.roles?.[role]) throw new Error(`Unknown behavior role: ${role}`);
      const storageState = storageFor(role);
      const context = await browser.newContext({
        ...(storageState ? { storageState } : {}),
        ...(options.video ? { recordVideo: { dir: path.join(outputDirectory, "videos") } } : {}),
      });
      const page = await context.newPage();
      const name = fresh ? `${role}-fresh-${++freshSequence}` : role;
      if (options.trace) await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      const entry = { context, page, name, video: page.video() };
      contexts.push(entry);
      return entry;
  };
  const portable = (value: string): string => path.relative(outputDirectory, value).split(path.sep).join("/");
  return {
    page: async (role = "default") => {
      const existing = opened.get(role);
      if (existing) return existing.page;
      const entry = await open(role, false);
      opened.set(role, entry);
      return entry.page;
    },
    freshPage: async (role = "default") => {
      return (await open(role, true)).page;
    },
    close: async () => {
      const traces: string[] = [];
      const videos: string[] = [];
      for (const entry of contexts) {
        if (options.trace) {
          const tracePath = path.join(outputDirectory, "traces", `${entry.name}.zip`);
          const saved = await entry.context.tracing.stop({ path: tracePath }).then(() => true).catch(() => false);
          if (saved) traces.push(portable(tracePath));
        }
        await entry.context.close().catch(() => undefined);
        if (entry.video) {
          const videoPath = await entry.video.path().catch(() => undefined);
          if (videoPath) videos.push(portable(videoPath));
        }
      }
      opened.clear();
      contexts.length = 0;
      return { traces, videos };
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
  await Promise.all([
    mkdir(outputDirectory, { recursive: true }),
    ...(options.trace ? [mkdir(path.join(outputDirectory, "traces"), { recursive: true })] : []),
    ...(options.video ? [mkdir(path.join(outputDirectory, "videos"), { recursive: true })] : []),
  ]);
  const sourceKinds = new Set(contract.steps.flatMap((step) => step.expected.flatMap((expectation) => expectation.type === "source" ? [expectation.adapter] : [])));
  const sourceAdapters = new Map<SourceAdapterKind, SourceOfTruthAdapter>();
  if (sourceKinds.has("postgresql") && options.postgresConfigPath) {
    sourceAdapters.set("postgresql", await createPostgresAdapterFromFile(options.postgresConfigPath));
  }
  if (sourceKinds.has("sqlite") && options.sqlitePath) {
    sourceAdapters.set("sqlite", new SqliteSourceAdapter(options.sqlitePath));
  }
  for (const configFile of options.databaseConfigPaths ?? []) {
    const adapter = await createSourceAdapterFromFile(configFile);
    if (sourceAdapters.has(adapter.kind)) {
      await adapter.close();
      await Promise.all([...sourceAdapters.values()].map((configured) => configured.close()));
      throw new Error(`Duplicate source adapter configuration: ${adapter.kind}`);
    }
    sourceAdapters.set(adapter.kind, adapter);
  }
  const plugins = (options.pluginManifests?.length ?? 0) > 0
    ? await PluginHost.load(options.pluginManifests ?? [], {
        ...(options.pluginTimeoutMs === undefined ? {} : { timeoutMs: options.pluginTimeoutMs }),
        ...(options.pluginMemoryLimitMb === undefined ? {} : { memoryLimitMb: options.pluginMemoryLimitMb }),
      })
    : undefined;
  const builtinProviders = (options.providerConfigPaths?.length ?? 0) > 0
    ? await BuiltinProviderHost.load(options.providerConfigPaths ?? [])
    : undefined;
  const verificationStarted = Date.now();
  const memoryBefore = process.memoryUsage().rss;
  const browser = await launchBrowser({
    headed: options.headed,
    browserName: options.browserName ?? "chromium",
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  });
  const rolePages = createRolePages(browser, absoluteContract, contract, options, outputDirectory);
  const startedAt = new Date();
  const results: StepVerification[] = [];
  let artifacts: { traces: string[]; videos: string[] } = { traces: [], videos: [] };
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
      let targetResolution: Awaited<ReturnType<typeof resolveSemanticLocator>> | undefined;
      try {
        if (step.type !== "navigate") {
          if (!step.fingerprint) throw new Error("Interaction step is missing a semantic fingerprint.");
          resolution = await resolveSemanticLocator(page, step.fingerprint, options.maxRetries);
          if (step.type === "drag" && step.targetFingerprint) {
            targetResolution = await resolveSemanticLocator(page, step.targetFingerprint, options.maxRetries);
          }
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
        const popupExpectation = step.expected.find((expectation): expectation is Extract<ContractExpectation, { type: "popup" }> => expectation.type === "popup");
        const awaitedPopup = popupExpectation
          ? page.waitForEvent("popup", { timeout: options.timeoutMs }).catch(() => undefined)
          : undefined;
        await executeStep(page, step, resolution?.locator, targetResolution?.locator);
        if (awaitedPopup) {
          const popup = await awaitedPopup;
          if (popup) {
            await popup.waitForLoadState("domcontentloaded", { timeout: options.timeoutMs }).catch(() => undefined);
            sink.popupUrls ??= [];
            const popupUrl = safeUrl(popup.url());
            if (!sink.popupUrls.includes(popupUrl)) sink.popupUrls.push(popupUrl);
          }
        }
        await page.waitForLoadState("domcontentloaded", { timeout: Math.min(options.timeoutMs, 3_000) }).catch(() => undefined);
        await page.waitForTimeout(options.settleMs);
        await attached.flush();
        const assertions: StepVerification["assertions"] = [];
        for (const expectation of step.expected) {
          assertions.push(await verifyExpectation(
            page,
            expectation,
            sink,
            sourceAdapters,
            rolePages.page,
            plugins,
            builtinProviders,
            rolePages.freshPage,
            Boolean(options.deep),
            role,
            options.settleMs,
          ));
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
    artifacts = await rolePages.close();
    await browser.close();
    await Promise.all([...sourceAdapters.values()].map((adapter) => adapter.close()));
  }
  const verification: ContractVerification = {
    schemaVersion: "1.0",
    verificationId: id,
    contractId: contract.id,
    contractName: contract.name,
    browser: options.browserName ?? "chromium",
    roles: ["default", ...Object.keys(contract.roles ?? {}).sort()],
    deep: Boolean(options.deep),
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
  if (artifacts.traces.length > 0 || artifacts.videos.length > 0) verification.artifacts = artifacts;
  await Promise.all([
    writeFile(path.join(outputDirectory, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`),
    writeFile(path.join(outputDirectory, "report.html"), renderContractVerification(verification)),
    writeCleanupLedger(outputDirectory, createContractCleanupLedger(contract, id)),
  ]);
  return { verification, outputDirectory, exitCode: verification.passed ? 0 : 1 };
}
