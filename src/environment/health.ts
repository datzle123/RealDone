import type { Browser, BrowserContext, Page, Request, Response } from "playwright";
import { redactText, safeUrl } from "../core/redact.js";
import type { EnvironmentFinding, EnvironmentHealth, EnvironmentStatus } from "../types.js";

export interface EnvironmentHealthOptions {
  timeoutMs: number;
  settleMs: number;
  storageStatePath?: string;
  healthEndpoint?: string;
  acceptedRisk?: boolean;
}

interface AssetObservation {
  url: string;
  kind: "script" | "stylesheet";
  status?: number;
  contentType?: string;
  failure?: string;
}

export interface EnvironmentRenderObservation {
  bodyTextLength: number;
  visibleElements: number;
  interactiveElements: number;
  ready: boolean;
}

const EMPTY_RENDER: EnvironmentRenderObservation = {
  bodyTextLength: 0,
  visibleElements: 0,
  interactiveElements: 0,
  ready: false,
};

function environmentFinding(
  code: EnvironmentFinding["code"],
  title: string,
  detail: string,
  url?: string,
): EnvironmentFinding {
  return { code, title, detail: redactText(detail).slice(0, 1_000), ...(url ? { url: safeUrl(url) } : {}) };
}

function contentTypeBase(value?: string | null): string | undefined {
  return value?.split(";")[0]?.trim().toLowerCase() || undefined;
}

function isExpectedAssetType(asset: AssetObservation): boolean {
  const type = asset.contentType ?? "";
  if (asset.kind === "script") {
    return /(?:java|ecma)script|application\/wasm|application\/json/.test(type);
  }
  return type === "text/css";
}

async function observeRender(page: Page): Promise<EnvironmentRenderObservation> {
  return page.evaluate(() => {
    const bodyTextLength = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().length;
    const elements = [...(document.body?.querySelectorAll("*") ?? [])].slice(0, 5_000);
    const visible = elements.filter((element) => {
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    });
    const interactiveElements = visible.filter((element) =>
      element.matches("a[href], button, input, textarea, select, [role=button], [role=link], [tabindex]"),
    ).length;
    const ready = bodyTextLength >= 10 && (interactiveElements > 0 || visible.length >= 3 || bodyTextLength >= 80);
    return { bodyTextLength, visibleElements: visible.length, interactiveElements, ready };
  });
}

export async function waitForEnvironmentRender(
  page: Page,
  timeoutMs: number,
  settleMs: number,
  requireInteractive = false,
): Promise<EnvironmentRenderObservation> {
  const deadline = Date.now() + timeoutMs;
  let observation = EMPTY_RENDER;
  do {
    observation = await observeRender(page).catch(() => EMPTY_RENDER);
    if (observation.ready && (!requireInteractive || observation.interactiveElements > 0)) {
      await page.waitForTimeout(Math.min(Math.max(settleMs, 100), 500));
      return observeRender(page).catch(() => observation);
    }
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  return observation;
}

async function checkHealthEndpoint(targetUrl: string, endpoint: string): Promise<EnvironmentFinding | undefined> {
  const url = new URL(endpoint, targetUrl);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000), redirect: "manual" });
    if (response.ok) return undefined;
    return environmentFinding(
      "RD1004",
      "Invalid test-data environment",
      `Configured health endpoint returned HTTP ${response.status}.`,
      url.toString(),
    );
  } catch (error) {
    return environmentFinding(
      "RD1004",
      "Invalid test-data environment",
      `Configured health endpoint could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      url.toString(),
    );
  }
}

function statusFor(findings: EnvironmentFinding[], mainStatus?: number): EnvironmentStatus {
  if (mainStatus === 401 || mainStatus === 403 || findings.some((finding) => finding.code === "RD1005")) {
    return "BLOCKED";
  }
  return findings.length > 0 ? "ENVIRONMENT_INVALID" : "VALID";
}

export async function inspectEnvironment(
  browser: Browser,
  targetUrl: string,
  options: EnvironmentHealthOptions,
): Promise<EnvironmentHealth> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const findings: EnvironmentFinding[] = [];
  const assets = new Map<string, AssetObservation>();
  const pending: Promise<void>[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  let context: BrowserContext;
  let mainStatus: number | undefined;
  let mainContentType: string | undefined;
  let render: EnvironmentRenderObservation = EMPTY_RENDER;

  try {
    context = await browser.newContext(options.storageStatePath ? { storageState: options.storageStatePath } : {});
  } catch (error) {
    findings.push(environmentFinding(
      "RD1005",
      "Misconfigured auth state",
      `The configured browser auth state could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    ));
    return {
      status: "BLOCKED",
      checkedAt,
      durationMs: Date.now() - startedAt,
      targetUrl: safeUrl(targetUrl),
      assets: { checked: 0, scripts: 0, stylesheets: 0, failed: 0 },
      render,
      findings,
      acceptedRisk: Boolean(options.acceptedRisk),
    };
  }

  const page = await context.newPage();
  const targetOrigin = new URL(targetUrl).origin;
  const onResponse = (response: Response): void => {
    const request = response.request();
    const resourceType = request.resourceType();
    if (!['script', 'stylesheet'].includes(resourceType)) return;
    if (new URL(response.url()).origin !== targetOrigin) return;
    const observation: AssetObservation = {
      url: response.url(),
      kind: resourceType as AssetObservation["kind"],
      status: response.status(),
    };
    assets.set(`${observation.kind}:${observation.url}`, observation);
    pending.push(response.headerValue("content-type").then((value) => {
      const parsed = contentTypeBase(value);
      if (parsed) observation.contentType = parsed;
    }));
  };
  const onRequestFailed = (request: Request): void => {
    const resourceType = request.resourceType();
    if (!['script', 'stylesheet'].includes(resourceType)) return;
    if (new URL(request.url()).origin !== targetOrigin) return;
    assets.set(`${resourceType}:${request.url()}`, {
      url: request.url(),
      kind: resourceType as AssetObservation["kind"],
      failure: request.failure()?.errorText ?? "Request failed",
    });
  };
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning", "warn"].includes(message.type())) consoleErrors.push(message.text());
  });

  try {
    const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    mainStatus = response?.status();
    mainContentType = contentTypeBase(await response?.headerValue("content-type"));
    render = await waitForEnvironmentRender(page, options.timeoutMs, options.settleMs);
    await Promise.allSettled(pending);

    if (!response || (mainStatus ?? 500) >= 400 || !mainContentType?.includes("text/html")) {
      findings.push(environmentFinding(
        "RD1001",
        "Invalid static root",
        `The main document returned ${mainStatus ? `HTTP ${mainStatus}` : "no response"} with content type ${mainContentType ?? "unknown"}.`,
        targetUrl,
      ));
    }

    for (const asset of assets.values()) {
      if (asset.failure || (asset.status ?? 500) >= 400) {
        findings.push(environmentFinding(
          "RD1002",
          "Critical asset missing",
          asset.failure ?? `${asset.kind} returned HTTP ${asset.status}.`,
          asset.url,
        ));
      } else if (!isExpectedAssetType(asset)) {
        findings.push(environmentFinding(
          "RD1001",
          "Invalid static root",
          `${asset.kind} was served as ${asset.contentType ?? "an unknown content type"}; the server may be returning an HTML fallback for a missing asset.`,
          asset.url,
        ));
      }
    }

    if (!render.ready) {
      const diagnostic = [...pageErrors, ...consoleErrors].slice(0, 5).join(" | ");
      findings.push(environmentFinding(
        "RD1003",
        "Bootstrap failure",
        diagnostic || `The application did not render enough visible content to interact with within ${options.timeoutMs}ms.`,
        page.url(),
      ));
    }

    const healthFinding = options.healthEndpoint
      ? await checkHealthEndpoint(targetUrl, options.healthEndpoint)
      : undefined;
    if (healthFinding) findings.push(healthFinding);

    const testEnvironment = await page.evaluate(() =>
      document.querySelector('meta[name="realdone:test-environment"]')?.getAttribute("content") ?? null,
    );
    if (testEnvironment?.toLowerCase() === "invalid") {
      findings.push(environmentFinding(
        "RD1004",
        "Invalid test-data environment",
        "The application declared its test-data environment invalid.",
        page.url(),
      ));
    }
  } catch (error) {
    findings.push(environmentFinding(
      "RD1003",
      "Bootstrap failure",
      error instanceof Error ? error.message : String(error),
      targetUrl,
    ));
  } finally {
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
    await context.close();
  }

  const values = [...assets.values()];
  return {
    status: statusFor(findings, mainStatus),
    checkedAt,
    durationMs: Date.now() - startedAt,
    targetUrl: safeUrl(targetUrl),
    ...(mainStatus || mainContentType
      ? { mainDocument: { ...(mainStatus ? { status: mainStatus } : {}), ...(mainContentType ? { contentType: mainContentType } : {}) } }
      : {}),
    assets: {
      checked: values.length,
      scripts: values.filter((asset) => asset.kind === "script").length,
      stylesheets: values.filter((asset) => asset.kind === "stylesheet").length,
      failed: values.filter((asset) => asset.failure || (asset.status ?? 500) >= 400 || !isExpectedAssetType(asset)).length,
    },
    render,
    findings,
    acceptedRisk: Boolean(options.acceptedRisk),
  };
}
