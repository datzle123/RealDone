import { randomBytes } from "node:crypto";
import path from "node:path";
import { discoverSiteDetailed, normalizeCrawlUrl } from "./browser/discover.js";
import { executeAction } from "./browser/executor.js";
import { launchChromium } from "./browser/runtime.js";
import { actionSkipReason, isMutationHostAllowed, validateTarget } from "./core/safety.js";
import { applyActionPolicy } from "./core/policy.js";
import { summarize } from "./core/summary.js";
import { findingFromEvidence } from "./detectors/index.js";
import { inspectEnvironment } from "./environment/health.js";
import { writeReport } from "./report/writer.js";
import type { ActionSpec, EnvironmentHealth, ExecutionEvidence, Finding, ScanOptions, ScanReport } from "./types.js";

export interface ScanProgress {
  stage: "runtime" | "environment" | "discovery" | "action" | "report";
  message: string;
  current?: number;
  total?: number;
}

export interface ScanResult {
  report: ScanReport;
  reportDirectory: string;
  exitCode: number;
}

function scanId(): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${timestamp}-${randomBytes(2).toString("hex")}`;
}

function emptyEvidence(): ExecutionEvidence {
  return {
    startedAt: "",
    durationMs: 0,
    canary: "",
    network: [],
    console: [],
    pageErrors: [],
    uiClaims: [],
    filledFields: [],
    dialogs: [],
    downloads: [],
  };
}

function skippedFinding(id: string, action: ActionSpec, reason: string): Finding {
  return {
    id,
    action,
    verdict: "SKIPPED",
    evidenceLevel: 0,
    reason,
    skippedReason: reason,
    detectorMatches: [],
    evidence: emptyEvidence(),
  };
}

function mergeEnvironmentHealth(
  target: EnvironmentHealth,
  route: EnvironmentHealth,
): void {
  if (route.status !== "VALID") target.invalidRoutes = (target.invalidRoutes ?? 0) + 1;
  if (route.status === "BLOCKED" || (route.status === "ENVIRONMENT_INVALID" && target.status === "VALID")) {
    target.status = route.status;
  }
  target.durationMs += route.durationMs;
  target.assets.checked += route.assets.checked;
  target.assets.scripts += route.assets.scripts;
  target.assets.stylesheets += route.assets.stylesheets;
  target.assets.failed += route.assets.failed;
  target.findings.push(...route.findings);
}

export async function runScan(
  inputOptions: ScanOptions,
  onProgress: (progress: ScanProgress) => void = () => undefined,
): Promise<ScanResult> {
  const target = validateTarget(inputOptions.targetUrl);
  const id = scanId();
  const reportDirectory = path.resolve(inputOptions.outputRoot, id);
  const screenshots = path.join(reportDirectory, "screenshots");
  const startedAt = new Date().toISOString();
  const allowHosts = [...new Set([...inputOptions.allowHosts, ...(inputOptions.policy?.allowHosts ?? [])])];
  const mutationAllowed = isMutationHostAllowed(target, allowHosts);
  const options: ScanOptions = { ...inputOptions, allowHosts, mutationAllowed };
  const deadline = Date.now() + options.maxDurationMs;

  onProgress({ stage: "runtime", message: "Starting Chromium" });
  const browser = await launchChromium({
    headed: options.headed,
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  });
  try {
    onProgress({ stage: "environment", message: "Checking document, assets, bootstrap, and render readiness" });
    const environment = await inspectEnvironment(browser, target.toString(), {
      timeoutMs: options.environmentTimeoutMs ?? Math.max(options.timeoutMs, 5_000),
      settleMs: options.settleMs,
      acceptedRisk: Boolean(options.acceptEnvironmentRisk),
      ...(options.storageStatePath ? { storageStatePath: options.storageStatePath } : {}),
      ...(options.healthEndpoint ? { healthEndpoint: options.healthEndpoint } : {}),
    });
    environment.routesChecked = 1;
    environment.invalidRoutes = environment.status === "VALID" ? 0 : 1;
    if (environment.status !== "VALID" && !options.acceptEnvironmentRisk) {
      const report: ScanReport = {
        schemaVersion: "1.0",
        scanId: id,
        targetUrl: target.toString(),
        startedAt,
        finishedAt: new Date().toISOString(),
        options: {
          maxPages: options.maxPages,
          maxActions: options.maxActions,
          timeoutMs: options.timeoutMs,
          settleMs: options.settleMs,
          maxDurationMs: options.maxDurationMs,
          maxRetries: options.maxRetries,
          allowDestructive: options.allowDestructive,
          allowExternal: options.allowExternal,
          mutationAllowed,
          deep: Boolean(options.deep),
          trace: Boolean(options.trace),
          video: Boolean(options.video),
          environmentTimeoutMs: options.environmentTimeoutMs ?? Math.max(options.timeoutMs, 5_000),
          acceptEnvironmentRisk: false,
        },
        summary: { ...summarize([], 0, 0), environmentStatus: environment.status },
        pages: [],
        findings: [],
        environment,
      };
      onProgress({ stage: "report", message: `Writing environment-invalid report to ${reportDirectory}` });
      const portableReport = await writeReport(reportDirectory, report);
      return { report: portableReport, reportDirectory, exitCode: 2 };
    }
    onProgress({ stage: "discovery", message: "Discovering pages and visible actions" });
    const discovery = options.replayAction
      ? { pages: [{ url: options.replayAction.pageUrl, title: "Replay", actions: [options.replayAction] }], truncated: false, reasons: [] as Array<"max-pages" | "max-duration"> }
      : await discoverSiteDetailed(browser, target.toString(), {
          maxPages: options.maxPages,
          timeoutMs: options.timeoutMs,
          settleMs: options.settleMs,
          maxRetries: options.maxRetries,
          deadline,
          ...(options.storageStatePath ? { storageStatePath: options.storageStatePath } : {}),
        });
    const pages = discovery.pages;
    const environmentDenials = new Map<string, string>();
    if (!options.replayAction) {
      const targetUrl = new URL(target.toString());
      for (const page of pages) {
        const pageUrl = new URL(page.url);
        if (pageUrl.toString() === targetUrl.toString()) continue;
        const routeEnvironment = await inspectEnvironment(browser, page.url, {
          timeoutMs: options.environmentTimeoutMs ?? Math.max(options.timeoutMs, 5_000),
          settleMs: options.settleMs,
          acceptedRisk: Boolean(options.acceptEnvironmentRisk),
          ...(options.storageStatePath ? { storageStatePath: options.storageStatePath } : {}),
        });
        environment.routesChecked = (environment.routesChecked ?? 1) + 1;
        const routeHasHarnessFailure =
          routeEnvironment.assets.failed > 0 ||
          routeEnvironment.findings.some((finding) => finding.code !== "RD1001") ||
          (routeEnvironment.mainDocument?.status === 200 && !routeEnvironment.mainDocument.contentType?.includes("text/html"));
        if (!routeHasHarnessFailure) {
          routeEnvironment.status = "VALID";
          routeEnvironment.findings = [];
          routeEnvironment.assets.failed = 0;
        }
        mergeEnvironmentHealth(environment, routeEnvironment);
        if (routeEnvironment.status !== "VALID" && !options.acceptEnvironmentRisk) {
          const invalidUrl = normalizeCrawlUrl(page.url) ?? page.url;
          for (const sourcePage of pages) {
            for (const action of sourcePage.actions) {
              const href = action.fingerprint.href;
              if (href && (normalizeCrawlUrl(href) ?? href) === invalidUrl) {
                environmentDenials.set(
                  action.id,
                  `Target route environment is ${routeEnvironment.status}: ${routeEnvironment.findings.map((finding) => finding.code).join(", ")}.`,
                );
              }
            }
          }
          page.actions = [];
          page.error = `Environment ${routeEnvironment.status}: ${routeEnvironment.findings.map((finding) => finding.code).join(", ")}`;
        }
      }
    }
    const policyDenials = new Map<string, string>(environmentDenials);
    for (const page of pages) {
      page.actions = page.actions.map((action) => {
        const applied = applyActionPolicy(action, options.policy);
        if (applied.deniedReason) policyDenials.set(applied.action.id, applied.deniedReason);
        return applied.action;
      });
    }
    const allActions = pages.flatMap((page) => page.actions);
    const selected = allActions
      .filter((action) => !options.onlyActionId || action.id === options.onlyActionId)
      .slice(0, options.maxActions);
    const actionTruncated = allActions.filter((action) => !options.onlyActionId || action.id === options.onlyActionId).length > options.maxActions;
    const findings: Finding[] = [];
    for (const [index, action] of selected.entries()) {
      const findingId = `RD-${String(index + 1).padStart(3, "0")}`;
      onProgress({
        stage: "action",
        message: `${action.label} (${action.kind}/${action.intent})`,
        current: index + 1,
        total: selected.length,
      });
      const budgetReason = Date.now() >= deadline ? "Global scan time budget was exhausted." : undefined;
      const reason = budgetReason ?? policyDenials.get(action.id) ?? actionSkipReason(action, {
        target,
        allowHosts: options.allowHosts,
        allowDestructive: options.allowDestructive,
        allowExternal: options.allowExternal,
      });
      if (reason) {
        findings.push(skippedFinding(findingId, action, reason));
        continue;
      }
      const evidence = await executeAction(browser, action, options, screenshots);
      findings.push(findingFromEvidence(findingId, action, evidence));
    }
    const report: ScanReport = {
      schemaVersion: "1.0",
      scanId: id,
      targetUrl: target.toString(),
      startedAt,
      finishedAt: new Date().toISOString(),
      options: {
        maxPages: options.maxPages,
        maxActions: options.maxActions,
        timeoutMs: options.timeoutMs,
        settleMs: options.settleMs,
        maxDurationMs: options.maxDurationMs,
        maxRetries: options.maxRetries,
        allowDestructive: options.allowDestructive,
        allowExternal: options.allowExternal,
        mutationAllowed,
        deep: Boolean(options.deep),
        trace: Boolean(options.trace),
        video: Boolean(options.video),
        environmentTimeoutMs: options.environmentTimeoutMs ?? Math.max(options.timeoutMs, 5_000),
        acceptEnvironmentRisk: Boolean(options.acceptEnvironmentRisk),
      },
      summary: summarize(findings, pages.length, allActions.length),
      pages,
      findings,
      environment,
      completeness: {
        truncated: discovery.truncated || actionTruncated || Date.now() >= deadline,
        reasons: [
          ...discovery.reasons,
          ...(actionTruncated ? ["max-actions" as const] : []),
          ...(Date.now() >= deadline && !discovery.reasons.includes("max-duration") ? ["max-duration" as const] : []),
        ],
      },
    };
    report.summary.environmentStatus = environment.status;
    onProgress({ stage: "report", message: `Writing evidence report to ${reportDirectory}` });
    const portableReport = await writeReport(reportDirectory, report);
    const failed = findings.some((finding) =>
      ["BROKEN", "CONTRADICTORY", "EPHEMERAL", "NO_EFFECT"].includes(finding.verdict),
    );
    const environmentFailed = environment.status !== "VALID" && !environment.acceptedRisk;
    return { report: portableReport, reportDirectory, exitCode: environmentFailed ? 2 : failed ? 1 : 0 };
  } finally {
    await browser.close();
  }
}
