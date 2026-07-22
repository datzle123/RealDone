import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { attachEvidence, type EvidenceSink } from "../browser/evidence.js";
import { resolveSemanticLocator } from "../browser/locator.js";
import { launchChromium } from "../browser/runtime.js";
import { classifyAction } from "../core/classify.js";
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

async function verifyExpectation(
  page: Page,
  expectation: ContractExpectation,
  network: NetworkEvidence[],
): Promise<{ passed: boolean; detail: string }> {
  switch (expectation.type) {
    case "request": {
      const passed = networkMatches(network, expectation);
      return { passed, detail: `${expectation.method} ${expectation.urlPattern}${expectation.status ? ` → ${expectation.status}` : ""}` };
    }
    case "url": {
      const pathname = new URL(page.url()).pathname;
      const passed = new RegExp(expectation.pattern).test(pathname);
      return { passed, detail: `URL ${pathname} matches ${expectation.pattern}` };
    }
    case "text": {
      const passed = await page.getByText(expectation.value, { exact: true }).last().isVisible().catch(() => false);
      return { passed, detail: `Visible text: ${expectation.value}` };
    }
    case "persistence": {
      await page.reload({ waitUntil: "domcontentloaded" });
      const passed = await page.getByText(expectation.value, { exact: false }).last().isVisible().catch(() => false);
      return { passed, detail: `Text persisted after reload: ${expectation.value}` };
    }
  }
}

export async function verifyContract(
  contractFile: string,
  options: VerifyContractOptions,
): Promise<VerifyContractResult> {
  const absoluteContract = path.resolve(contractFile);
  const contract = await loadBehaviorContract(absoluteContract);
  const id = verificationId();
  const outputDirectory = path.resolve(options.outputRoot, id);
  await mkdir(outputDirectory, { recursive: true });
  const contractStorage = contract.authState?.path
    ? path.resolve(path.dirname(absoluteContract), contract.authState.path)
    : undefined;
  const storageStatePath = options.storageStatePath ?? contractStorage;
  const browser = await launchChromium({
    headed: options.headed,
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  });
  const context = await browser.newContext(storageStatePath ? { storageState: storageStatePath } : {});
  const page = await context.newPage();
  const startedAt = new Date();
  const results: StepVerification[] = [];
  let blocked = false;
  try {
    for (const step of contract.steps) {
      const stepStarted = Date.now();
      if (blocked) {
        results.push({ stepId: step.id, type: step.type, status: "skipped", durationMs: 0, reason: "A previous step failed.", assertions: [] });
        continue;
      }
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
        const assertions = [];
        for (const expectation of step.expected) {
          const outcome = await verifyExpectation(page, expectation, sink.network);
          assertions.push({ expectation, ...outcome });
        }
        const passed = assertions.every((assertion) => assertion.passed) && sink.pageErrors.length === 0;
        results.push({
          stepId: step.id,
          type: step.type,
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
    await context.close();
    await browser.close();
  }
  const verification: ContractVerification = {
    schemaVersion: "1.0",
    verificationId: id,
    contractId: contract.id,
    contractName: contract.name,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    passed: results.every((step) => step.status === "passed"),
    steps: results,
  };
  await Promise.all([
    writeFile(path.join(outputDirectory, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`),
    writeFile(path.join(outputDirectory, "report.html"), renderContractVerification(verification)),
  ]);
  return { verification, outputDirectory, exitCode: verification.passed ? 0 : 1 };
}
