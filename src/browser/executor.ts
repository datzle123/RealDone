import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Browser, Frame, Locator, Page } from "playwright";
import { createCanary, valueForField } from "../core/canary.js";
import { classifyAction } from "../core/classify.js";
import { hashText, isSensitiveKey, safeUrl } from "../core/redact.js";
import { isTransientBrowserError, withRetry } from "../core/retry.js";
import { actionSkipReason, isSafetyEscalation } from "../core/safety.js";
import type { ActionSpec, ExecutionEvidence, FilledField, ScanOptions, UploadEvidence } from "../types.js";
import { attachEvidence, captureState, collectUiClaims } from "./evidence.js";
import { resolveSemanticLocator, SemanticTargetNotFoundError } from "./locator.js";
import { waitForEnvironmentRender } from "../environment/health.js";
import { prepareDynamicActions } from "./discover.js";

type InteractionScope = Page | Frame;

export class PreExecutionSafetyError extends Error {
  constructor(readonly reason: string, readonly action: ActionSpec) {
    super(reason);
    this.name = "PreExecutionSafetyError";
  }
}

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

async function assertLiveActionSafety(
  scope: InteractionScope,
  locator: Locator,
  action: ActionSpec,
  options: ScanOptions,
): Promise<void> {
  const signals = await locator.evaluate((element) => {
    const form = element instanceof HTMLFormElement
      ? element
      : element instanceof HTMLButtonElement || element instanceof HTMLInputElement
        ? element.form ?? element.closest("form")
        : element.closest("form");
    const submitter = element instanceof HTMLFormElement
      ? [...element.querySelectorAll('button[type="submit"], input[type="submit"], input[type="image"], button:not([type])')]
          .find((candidate) => {
            const node = candidate as HTMLElement;
            const style = window.getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return !node.hasAttribute("disabled") && node.getAttribute("aria-disabled") !== "true" && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          }) as HTMLButtonElement | HTMLInputElement | undefined
      : element instanceof HTMLButtonElement || element instanceof HTMLInputElement
        ? element
        : undefined;
    const effectiveElement = submitter ?? element;
    const actionUrl = effectiveElement instanceof HTMLAnchorElement
      ? effectiveElement.href
      : (
          effectiveElement instanceof HTMLButtonElement || effectiveElement instanceof HTMLInputElement
        ) && effectiveElement.hasAttribute("formaction")
        ? effectiveElement.formAction
        : form?.action;
    const method = (
      effectiveElement instanceof HTMLButtonElement || effectiveElement instanceof HTMLInputElement
    ) && effectiveElement.hasAttribute("formmethod")
      ? effectiveElement.formMethod
      : form?.method;
    const target = effectiveElement instanceof HTMLAnchorElement
      ? effectiveElement.target
      : (
          effectiveElement instanceof HTMLButtonElement || effectiveElement instanceof HTMLInputElement
        ) && effectiveElement.hasAttribute("formtarget")
        ? effectiveElement.formTarget
        : form?.target;
    const fields = form
      ? [...form.querySelectorAll("input, textarea, select")]
      : element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
        ? [element]
        : [];
    return {
      tag: element.tagName.toLowerCase(),
      isForm: Boolean(form),
      ...(actionUrl ? { actionUrl } : {}),
      ...(method ? { method } : {}),
      ...(target ? { target } : {}),
      ...(effectiveElement instanceof HTMLAnchorElement && effectiveElement.hasAttribute("download") ? { download: true } : {}),
      liveLabel: (
        effectiveElement.getAttribute("aria-label") ||
        (effectiveElement as HTMLElement).innerText ||
        (effectiveElement instanceof HTMLInputElement ? effectiveElement.value : "") ||
        effectiveElement.getAttribute("title") ||
        ""
      ).replace(/\s+/g, " ").trim().slice(0, 240),
      fieldTypes: fields.map((field) => field instanceof HTMLInputElement ? field.type || "text" : field.tagName.toLowerCase()),
      fieldHints: fields.flatMap((field) => [
        field.getAttribute("name"),
        field.getAttribute("aria-label"),
        field.getAttribute("placeholder"),
        ...(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement
          ? [...(field.labels ?? [])].map((label) => label.textContent)
          : []),
      ].filter((value): value is string => Boolean(value))),
      semanticHints: [
        element.id,
        element.getAttribute("name"),
        element.getAttribute("data-action"),
        element.getAttribute("data-endpoint"),
        element.getAttribute("data-provider"),
        element.getAttribute("data-url"),
        effectiveElement.getAttribute("data-action"),
        effectiveElement.getAttribute("data-endpoint"),
        effectiveElement.getAttribute("data-provider"),
        effectiveElement.getAttribute("data-url"),
      ].filter((value): value is string => Boolean(value)).slice(0, 8),
    };
  });
  const runtimeClassification = classifyAction(
    signals.liveLabel || action.label,
    signals.tag,
    signals.tag === "a" ? signals.actionUrl : undefined,
    signals.isForm,
    {
      pageUrl: scope.url(),
      ...(signals.actionUrl ? { actionUrl: signals.actionUrl } : {}),
      ...(signals.method ? { method: signals.method } : {}),
      ...(signals.target ? { target: signals.target } : {}),
      ...(signals.download ? { download: true } : {}),
      fieldTypes: signals.fieldTypes,
      fieldHints: signals.fieldHints,
      semanticHints: signals.semanticHints,
    },
  );
  const escalated = isSafetyEscalation(action, runtimeClassification);
  const runtimeAction: ActionSpec = {
    ...action,
    ...(escalated ? runtimeClassification : {}),
    fingerprint: {
      ...action.fingerprint,
      ...(signals.tag === "a" && signals.actionUrl ? { href: signals.actionUrl } : {}),
    },
  };
  const reason = actionSkipReason(runtimeAction, {
    target: new URL(options.targetUrl),
    allowHosts: options.allowHosts,
    allowDestructive: options.allowDestructive,
    allowExternal: options.allowExternal,
  });
  if (reason) throw new PreExecutionSafetyError(`Pre-execution safety check: ${reason}`, runtimeAction);
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

function isSameDocumentAnchor(href: string | undefined, pageUrl: string): boolean {
  if (!href) return false;
  try {
    const target = new URL(href, pageUrl);
    const source = new URL(pageUrl);
    return Boolean(target.hash)
      && target.origin === source.origin
      && target.pathname === source.pathname
      && target.search === source.search;
  } catch {
    return false;
  }
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
    await assertLiveActionSafety(targetScope, locator, action, options);
    if (action.intent === "delete") {
      const targetText = await nearestTargetText(locator);
      if (targetText) evidence.targetText = targetText;
    }
    attached = attachEvidence(page, startedAt, evidence);
    evidence.filledFields = await fillForm(targetScope, action, canary, evidence.uploads ??= []);
    evidence.beforeAction = await captureState(targetScope, canary, startedAt);
    // Filling can run application handlers that replace the submitter or escalate
    // its target. Re-read the effective live action immediately before activation.
    const liveLocator = action.fields.length > 0
      ? targetScope.locator(action.fingerprint.selector).first()
      : locator;
    if ((await liveLocator.count()) === 0) {
      throw new PreExecutionSafetyError("Pre-execution safety check: target changed after field preparation.", action);
    }
    await assertLiveActionSafety(targetScope, liveLocator, action, options);

    if (action.activation === "enter") {
      await liveLocator.press("Enter", { timeout: options.timeoutMs });
    } else if (action.activation === "check") {
      await liveLocator.check({ timeout: options.timeoutMs });
    } else if (action.activation === "select") {
      const option = await liveLocator.evaluate((element) => {
        const select = element as HTMLSelectElement;
        return [...select.options].find((item) => !item.disabled && item.value)?.value;
      });
      if (!option) throw new Error("No usable option was available for the discovered select action.");
      await liveLocator.selectOption(option, { timeout: options.timeoutMs });
    } else if (action.activation === "hover") {
      await liveLocator.hover({ timeout: options.timeoutMs });
    } else if (action.activation === "contextmenu") {
      await liveLocator.click({ button: "right", timeout: options.timeoutMs });
    } else if (action.kind === "navigation" && action.fingerprint.tag === "a" && isSameDocumentAnchor(action.fingerprint.href, action.pageUrl)) {
      // Same-document anchors include keyboard-first skip links that are kept
      // outside the viewport until focused. Enter dispatches the normal anchor
      // activation while preserving the accessible interaction path.
      await liveLocator.focus({ timeout: options.timeoutMs });
      await liveLocator.press("Enter", { timeout: options.timeoutMs });
    } else if (action.fingerprint.tag === "form" || action.activation === "submit") {
      const submit = liveLocator.locator('button[type="submit"], input[type="submit"], input[type="image"], button:not([type])').first();
      if ((await submit.count()) > 0) await submit.click({ timeout: options.timeoutMs });
      else await liveLocator.evaluate((form) => (form as HTMLFormElement).requestSubmit());
    } else {
      await liveLocator.click({ timeout: options.timeoutMs });
    }

    if (action.kind === "mutation") {
      evidence.targetDisabledAfter = await liveLocator.isDisabled({ timeout: 250 }).catch(() => false);
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
    if (error instanceof PreExecutionSafetyError) throw error;
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
