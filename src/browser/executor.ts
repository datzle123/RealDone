import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Browser, Locator, Page } from "playwright";
import { createCanary, valueForField } from "../core/canary.js";
import { isSensitiveKey } from "../core/redact.js";
import { isTransientBrowserError, withRetry } from "../core/retry.js";
import type { ActionSpec, ExecutionEvidence, FilledField, ScanOptions } from "../types.js";
import { attachEvidence, captureState, collectUiClaims } from "./evidence.js";
import { resolveSemanticLocator, SemanticTargetNotFoundError } from "./locator.js";

async function fillForm(page: Page, action: ActionSpec, canary: string): Promise<FilledField[]> {
  const filled: FilledField[] = [];
  for (const field of action.fields) {
    if (field.disabled) continue;
    const plan = valueForField(field, canary);
    const locator = page.locator(field.selector).first();
    if ((await locator.count()) === 0 || !(await locator.isVisible().catch(() => false))) continue;
    try {
      if (plan.check) {
        await locator.check({ timeout: 2_000 });
        filled.push({ selector: field.selector, name: field.name ?? field.label ?? field.type, type: field.type, value: "true", redacted: false });
      } else if (plan.selectFirstUsable) {
        const option = await locator.evaluate((element) => {
          const select = element as HTMLSelectElement;
          return [...select.options].find((item) => !item.disabled && item.value)?.value;
        });
        if (option) {
          await locator.selectOption(option);
          filled.push({ selector: field.selector, name: field.name ?? field.label ?? "select", type: field.type, value: option, redacted: false });
        }
      } else if (plan.value !== undefined) {
        await locator.fill(plan.value, { timeout: 2_000 });
        const name = field.name ?? field.label ?? field.placeholder ?? field.type;
        const redacted = plan.redacted || isSensitiveKey(name);
        filled.push({ selector: field.selector, name, type: field.type, value: redacted ? "[REDACTED]" : plan.value, redacted });
      }
    } catch {
      // A single unsupported field must not invalidate an otherwise runnable form.
    }
  }
  return filled;
}

async function nearestTargetText(locator: Locator): Promise<string | undefined> {
  return locator
    .evaluate((element) => {
      const container = element.closest('tr, [role="row"], li, article, [data-testid*="item"], .card');
      const text = (container?.textContent ?? "").replace(/\s+/g, " ").trim();
      return text.length >= 3 ? text.slice(0, 180) : undefined;
    })
    .catch(() => undefined);
}

async function targetIsVisible(page: Page, targetText?: string): Promise<boolean | undefined> {
  if (!targetText) return undefined;
  return page.locator("body").innerText().then((text) => text.includes(targetText)).catch(() => undefined);
}

function screenshotName(action: ActionSpec, suffix: string): string {
  return `${action.id}-${suffix}.png`;
}

export async function executeAction(
  browser: Browser,
  action: ActionSpec,
  options: ScanOptions,
  screenshotDirectory: string,
): Promise<ExecutionEvidence> {
  const startedWall = new Date();
  const startedAt = Date.now();
  const canary = createCanary();
  const evidence: ExecutionEvidence = {
    startedAt: startedWall.toISOString(),
    durationMs: 0,
    canary,
    network: [],
    console: [],
    pageErrors: [],
    uiClaims: [],
    filledFields: [],
    dialogs: [],
    downloads: [],
  };
  const reportDirectory = path.dirname(screenshotDirectory);
  const traceDirectory = path.join(reportDirectory, "traces");
  const videoDirectory = path.join(reportDirectory, "videos");
  await Promise.all([
    mkdir(screenshotDirectory, { recursive: true }),
    ...(options.trace ? [mkdir(traceDirectory, { recursive: true })] : []),
    ...(options.video ? [mkdir(videoDirectory, { recursive: true })] : []),
  ]);
  const context = await browser.newContext(
    {
      ...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
      ...(options.video ? { recordVideo: { dir: videoDirectory } } : {}),
    },
  );
  const page = await context.newPage();
  const video = page.video();
  if (options.trace) await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  let attached: ReturnType<typeof attachEvidence> | undefined;

  try {
    await withRetry(
      () => page.goto(action.pageUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs }),
      { retries: options.maxRetries, shouldRetry: isTransientBrowserError },
    );
    await page.waitForTimeout(Math.min(options.settleMs, 1_000));
    const resolved = await resolveSemanticLocator(page, action.fingerprint, options.maxRetries);
    const locator = resolved.locator;
    evidence.locatorResolution = resolved.diagnostics;
    evidence.before = await captureState(page, canary, startedAt);
    if (action.intent === "delete") {
      const targetText = await nearestTargetText(locator);
      if (targetText) evidence.targetText = targetText;
    }
    attached = attachEvidence(page, startedAt, evidence);
    evidence.filledFields = await fillForm(page, action, canary);

    if (action.activation === "enter") {
      await locator.press("Enter", { timeout: options.timeoutMs });
    } else if (action.fingerprint.tag === "form" || action.activation === "submit") {
      const submit = locator.locator('button[type="submit"], input[type="submit"], button:not([type])').first();
      if ((await submit.count()) > 0) await submit.click({ timeout: options.timeoutMs });
      else await locator.evaluate((form) => (form as HTMLFormElement).requestSubmit());
    } else {
      await locator.click({ timeout: options.timeoutMs });
    }

    await page.waitForLoadState("domcontentloaded", { timeout: Math.min(options.timeoutMs, 3_000) }).catch(() => undefined);
    await page.waitForTimeout(options.settleMs);
    evidence.after = await captureState(page, canary, startedAt);
    evidence.uiClaims = await collectUiClaims(page, startedAt);
    const targetVisibleAfter = await targetIsVisible(page, evidence.targetText);
    if (targetVisibleAfter !== undefined) evidence.targetVisibleAfter = targetVisibleAfter;

    const hasWrite = evidence.network.some((request) => ["POST", "PUT", "PATCH", "DELETE"].includes(request.method));
    const hasFailure = evidence.network.some((request) => request.failure || (request.status ?? 0) >= 400);
    const noVisibleChange = evidence.before.domHash === evidence.after.domHash && evidence.before.url === evidence.after.url;
    if (action.kind === "mutation" || hasWrite || hasFailure || noVisibleChange || evidence.pageErrors.length > 0) {
      const screenshotPath = path.join(screenshotDirectory, screenshotName(action, "after"));
      await page.screenshot({ path: screenshotPath, fullPage: true });
      evidence.screenshot = screenshotPath;
    }

    if (action.kind === "mutation") {
      await page.reload({ waitUntil: "domcontentloaded", timeout: options.timeoutMs });
      await page.waitForTimeout(options.settleMs);
      evidence.afterRefresh = await captureState(page, canary, startedAt);
      const targetVisibleAfterRefresh = await targetIsVisible(page, evidence.targetText);
      if (targetVisibleAfterRefresh !== undefined) evidence.targetVisibleAfterRefresh = targetVisibleAfterRefresh;
      const refreshPath = path.join(screenshotDirectory, screenshotName(action, "refresh"));
      await page.screenshot({ path: refreshPath, fullPage: true });
      evidence.refreshScreenshot = refreshPath;

      if (options.deep) {
        const persistenceUrl = page.url();
        const freshContext = await browser.newContext(
          options.storageStatePath ? { storageState: options.storageStatePath } : {},
        );
        try {
          const freshPage = await freshContext.newPage();
          await withRetry(
            () => freshPage.goto(persistenceUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs }),
            { retries: options.maxRetries, shouldRetry: isTransientBrowserError },
          );
          await freshPage.waitForTimeout(options.settleMs);
          evidence.afterNewContext = await captureState(freshPage, canary, startedAt);
          const targetVisibleAfterNewContext = await targetIsVisible(freshPage, evidence.targetText);
          if (targetVisibleAfterNewContext !== undefined) {
            evidence.targetVisibleAfterNewContext = targetVisibleAfterNewContext;
          }
        } finally {
          await freshContext.close();
        }
      }
    }
  } catch (error) {
    if (error instanceof SemanticTargetNotFoundError) {
      evidence.targetNotFound = true;
      evidence.locatorResolution = error.diagnostics;
    }
    evidence.executionError = error instanceof Error ? error.message : String(error);
    const screenshotPath = path.join(screenshotDirectory, screenshotName(action, "error"));
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    evidence.screenshot = screenshotPath;
  } finally {
    await attached?.flush();
    attached?.detach();
    evidence.durationMs = Date.now() - startedAt;
    if (options.trace) {
      const tracePath = path.join(traceDirectory, `${action.id}.zip`);
      const saved = await context.tracing.stop({ path: tracePath }).then(() => true).catch(() => false);
      if (saved) evidence.trace = tracePath;
    }
    await context.close();
    if (video) {
      const videoPath = await video.path().catch(() => undefined);
      if (videoPath) evidence.video = videoPath;
    }
  }
  return evidence;
}
