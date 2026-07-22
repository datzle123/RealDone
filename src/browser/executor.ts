import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Browser, Frame, Locator, Page } from "playwright";
import { createCanary, valueForField } from "../core/canary.js";
import { hashText, isSensitiveKey, safeUrl } from "../core/redact.js";
import { isTransientBrowserError, withRetry } from "../core/retry.js";
import type { ActionSpec, ExecutionEvidence, FilledField, ScanOptions, UploadEvidence } from "../types.js";
import { attachEvidence, captureState, collectUiClaims } from "./evidence.js";
import { resolveSemanticLocator, SemanticTargetNotFoundError } from "./locator.js";
import { waitForEnvironmentRender } from "../environment/health.js";
import { prepareDynamicActions } from "./discover.js";

type InteractionScope = Page | Frame;

function scopeFor(page: Page, action: ActionSpec): InteractionScope {
  const frameUrl = action.fingerprint.frameUrl;
  if (!frameUrl) return page;
  const exact = page.frames().find((frame) => frame.url() === frameUrl);
  if (exact) return exact;
  const expected = new URL(frameUrl);
  const matching = page.frames().find((frame) => {
    try {
      const candidate = new URL(frame.url());
      return candidate.origin === expected.origin && candidate.pathname === expected.pathname;
    } catch {
      return false;
    }
  });
  if (!matching) throw new Error(`The same-origin iframe ${frameUrl} was not available in the execution context.`);
  return matching;
}

async function fillForm(page: InteractionScope, action: ActionSpec, canary: string, uploads: UploadEvidence[]): Promise<FilledField[]> {
  const filled: FilledField[] = [];
  for (const [fieldIndex, field] of action.fields.entries()) {
    if (field.disabled) continue;
    const plan = valueForField(field, `${canary}_${fieldIndex + 1}`);
    const locator = page.locator(field.selector).first();
    if ((await locator.count()) === 0 || !(await locator.isVisible().catch(() => false))) continue;
    try {
      if (field.type === "file") {
        const fileName = `${canary}_${fieldIndex + 1}.txt`;
        const contents = `RealDone upload evidence ${canary}_${fieldIndex + 1}`;
        await locator.setInputFiles({ name: fileName, mimeType: "text/plain", buffer: Buffer.from(contents) }, { timeout: 2_000 });
        uploads.push({ fileName, contentType: "text/plain", size: Buffer.byteLength(contents), contentHash: hashText(contents), containsCanary: true });
        filled.push({ selector: field.selector, name: field.name ?? field.label ?? field.type, type: field.type, value: fileName, redacted: false });
      } else if (plan.check) {
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

async function targetIsVisible(page: InteractionScope, targetText?: string): Promise<boolean | undefined> {
  if (!targetText) return undefined;
  return page.locator("body").innerText().then((text) => text.includes(targetText)).catch(() => undefined);
}

function screenshotName(action: ActionSpec, suffix: string): string {
  return `${action.id}-${suffix}.png`;
}

function readBackUrl(evidence: ExecutionEvidence): string | undefined {
  const write = evidence.network.find((request) =>
    ["POST", "PUT", "PATCH"].includes(request.method) && request.ok &&
    (request.method !== "POST" || request.location || request.responseResourceId),
  );
  if (!write) return undefined;
  if (write.location) return write.location;
  if (write.method !== "POST") return write.url;
  const url = new URL(write.url);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeURIComponent(write.responseResourceId as string)}`;
  return url.toString();
}

async function captureApiReadBack(page: Page, evidence: ExecutionEvidence): Promise<void> {
  const url = readBackUrl(evidence);
  if (!url) return;
  try {
    const response = await page.context().request.get(url, { timeout: 5_000 });
    const body = await response.text().catch(() => "");
    const expectedValues = evidence.filledFields.filter((field) => !field.redacted && !["true", "false"].includes(field.value));
    const matchedFieldValues = expectedValues.filter((field) => body.includes(field.value)).length;
    evidence.apiReadBack = {
      url: safeUrl(url),
      status: response.status(),
      ok: response.ok(),
      canaryPresent: body.toLowerCase().includes(evidence.canary.toLowerCase()),
      expectedFieldValues: expectedValues.length,
      matchedFieldValues,
    };
  } catch (error) {
    evidence.apiReadBack = {
      url: safeUrl(url),
      ok: false,
      canaryPresent: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function resolvePersistenceScope(evidence: ExecutionEvidence): ExecutionEvidence["persistenceScope"] {
  if (evidence.apiReadBack?.ok && evidence.apiReadBack.canaryPresent) return "BACKEND_PERSISTENT";
  if (evidence.afterNewContext?.canaryPresent) return "BACKEND_PERSISTENT";
  if (evidence.afterNewTab?.canaryPresent && evidence.afterHardRefresh?.canaryPresent) return "BROWSER_LOCAL";
  if (evidence.afterHardRefresh?.canaryPresent) return "SESSION_PERSISTENT";
  if (evidence.afterRefresh?.canaryPresent) return "TAB_PERSISTENT";
  if (evidence.after?.canaryPresent) return "MEMORY_ONLY";
  return undefined;
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
    downloadEvidence: [],
    uploads: [],
    popupUrls: [],
  };
  const reportDirectory = path.dirname(screenshotDirectory);
  const traceDirectory = path.join(reportDirectory, "traces");
  const videoDirectory = path.join(reportDirectory, "videos");
  await Promise.all([
    mkdir(screenshotDirectory, { recursive: true }),
    ...(options.trace || options.traceOnFailure ? [mkdir(traceDirectory, { recursive: true })] : []),
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
  if (options.trace || options.traceOnFailure) await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  let attached: ReturnType<typeof attachEvidence> | undefined;

  try {
    await withRetry(
      () => page.goto(action.pageUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs }),
      { retries: options.maxRetries, shouldRetry: isTransientBrowserError },
    );
    await waitForEnvironmentRender(page, Math.min(options.timeoutMs, 5_000), options.settleMs, true);
    await prepareDynamicActions(page);
    const targetScope = scopeFor(page, action);
    if (targetScope !== page) await prepareDynamicActions(targetScope);
    const resolved = await resolveSemanticLocator(targetScope, action.fingerprint, options.maxRetries);
    const locator = resolved.locator;
    evidence.locatorResolution = resolved.diagnostics;
    evidence.before = await captureState(targetScope, canary, startedAt);
    if (action.intent === "delete") {
      const targetText = await nearestTargetText(locator);
      if (targetText) evidence.targetText = targetText;
    }
    attached = attachEvidence(page, startedAt, evidence);
    evidence.filledFields = await fillForm(targetScope, action, canary, evidence.uploads ??= []);
    evidence.beforeAction = await captureState(targetScope, canary, startedAt);

    if (action.activation === "enter") {
      await locator.press("Enter", { timeout: options.timeoutMs });
    } else if (action.activation === "check") {
      await locator.check({ timeout: options.timeoutMs });
    } else if (action.activation === "select") {
      const option = await locator.evaluate((element) => {
        const select = element as HTMLSelectElement;
        return [...select.options].find((item) => !item.disabled && item.value)?.value;
      });
      if (!option) throw new Error("No usable option was available for the discovered select action.");
      await locator.selectOption(option, { timeout: options.timeoutMs });
    } else if (action.activation === "hover") {
      await locator.hover({ timeout: options.timeoutMs });
    } else if (action.activation === "contextmenu") {
      await locator.click({ button: "right", timeout: options.timeoutMs });
    } else if (action.fingerprint.tag === "form" || action.activation === "submit") {
      const submit = locator.locator('button[type="submit"], input[type="submit"], button:not([type])').first();
      if ((await submit.count()) > 0) await submit.click({ timeout: options.timeoutMs });
      else await locator.evaluate((form) => (form as HTMLFormElement).requestSubmit());
    } else {
      await locator.click({ timeout: options.timeoutMs });
    }

    if (action.kind === "mutation") {
      evidence.targetDisabledAfter = await locator.isDisabled({ timeout: 250 }).catch(() => false);
    }

    await page.waitForLoadState("domcontentloaded", { timeout: Math.min(options.timeoutMs, 3_000) }).catch(() => undefined);
    evidence.networkSettled = await attached.waitForIdle(Math.min(options.timeoutMs, 3_000));
    await page.waitForTimeout(options.settleMs);
    const statusTarget = targetScope.locator(action.fingerprint.selector).first();
    if ((await statusTarget.count()) > 0) {
      evidence.targetBusyAfter = await statusTarget.getAttribute("aria-busy", { timeout: 250 }).then((value) => value === "true").catch(() => false);
    }
    evidence.popupUrls = context.pages().filter((candidate) => candidate !== page).map((candidate) => safeUrl(candidate.url()));
    evidence.after = await captureState(targetScope, canary, startedAt);
    evidence.uiClaims = await collectUiClaims(targetScope, startedAt);
    const targetVisibleAfter = await targetIsVisible(targetScope, evidence.targetText);
    if (targetVisibleAfter !== undefined) evidence.targetVisibleAfter = targetVisibleAfter;

    const hasWrite = evidence.network.some((request) => ["POST", "PUT", "PATCH", "DELETE"].includes(request.method));
    const hasFailure = evidence.network.some((request) => request.failure || (request.status ?? 0) >= 400);
    const actionBaseline = evidence.beforeAction ?? evidence.before;
    const noVisibleChange = actionBaseline.domHash === evidence.after.domHash && actionBaseline.url === evidence.after.url;
    if (action.kind === "mutation" || hasWrite || hasFailure || noVisibleChange || evidence.pageErrors.length > 0) {
      const screenshotPath = path.join(screenshotDirectory, screenshotName(action, "after"));
      await page.screenshot({ path: screenshotPath, fullPage: true });
      evidence.screenshot = screenshotPath;
    }

    if (action.kind === "mutation") {
      await attached.flush();
      await captureApiReadBack(page, evidence);
      await page.reload({ waitUntil: "domcontentloaded", timeout: options.timeoutMs });
      await waitForEnvironmentRender(page, Math.min(options.timeoutMs, 5_000), options.settleMs, true);
      const refreshedScope = scopeFor(page, action);
      evidence.afterRefresh = await captureState(refreshedScope, canary, startedAt);
      const targetVisibleAfterRefresh = await targetIsVisible(refreshedScope, evidence.targetText);
      if (targetVisibleAfterRefresh !== undefined) evidence.targetVisibleAfterRefresh = targetVisibleAfterRefresh;
      const refreshPath = path.join(screenshotDirectory, screenshotName(action, "refresh"));
      await page.screenshot({ path: refreshPath, fullPage: true });
      evidence.refreshScreenshot = refreshPath;

      await context.setExtraHTTPHeaders({ "cache-control": "no-cache", pragma: "no-cache" });
      await page.reload({ waitUntil: "domcontentloaded", timeout: options.timeoutMs });
      await waitForEnvironmentRender(page, Math.min(options.timeoutMs, 5_000), options.settleMs, true);
      evidence.afterHardRefresh = await captureState(scopeFor(page, action), canary, startedAt);
      await context.setExtraHTTPHeaders({});

      const newTab = await context.newPage();
      try {
        await newTab.goto(action.pageUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
        await waitForEnvironmentRender(newTab, Math.min(options.timeoutMs, 5_000), options.settleMs, true);
        evidence.afterNewTab = await captureState(scopeFor(newTab, action), canary, startedAt);
      } finally {
        await newTab.close();
      }

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
          await waitForEnvironmentRender(freshPage, Math.min(options.timeoutMs, 5_000), options.settleMs, true);
          const freshScope = scopeFor(freshPage, action);
          evidence.afterNewContext = await captureState(freshScope, canary, startedAt);
          const targetVisibleAfterNewContext = await targetIsVisible(freshScope, evidence.targetText);
          if (targetVisibleAfterNewContext !== undefined) {
            evidence.targetVisibleAfterNewContext = targetVisibleAfterNewContext;
          }
        } finally {
          await freshContext.close();
        }
      }

      if (options.restartTarget) {
        await options.restartTarget();
        await page.reload({ waitUntil: "domcontentloaded", timeout: options.timeoutMs });
        await waitForEnvironmentRender(page, Math.min(options.timeoutMs, 5_000), options.settleMs, true);
        evidence.afterAppRestart = await captureState(scopeFor(page, action), canary, startedAt);
      }
      const resolvedPersistenceScope = resolvePersistenceScope(evidence);
      if (resolvedPersistenceScope) evidence.persistenceScope = resolvedPersistenceScope;
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
    if (options.trace || options.traceOnFailure) {
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
