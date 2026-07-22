import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { diffSourceSnapshots, type DiscoverableSourceAdapter, type SourceSnapshot } from "./adapters/types.js";
import { discoverSiteDetailed, normalizeCrawlUrl } from "./browser/discover.js";
import { executeAction, PreExecutionSafetyError } from "./browser/executor.js";
import { launchChromium } from "./browser/runtime.js";
import { actionSkipReason, isMutationHostAllowed, validateTarget } from "./core/safety.js";
import { applyActionPolicy } from "./core/policy.js";
import { summarize } from "./core/summary.js";
import { findingFromEvidence } from "./detectors/index.js";
import { inspectEnvironment } from "./environment/health.js";
import { writeReport } from "./report/writer.js";
import { redactEnvironmentText } from "./core/redact.js";
import type { ActionSpec, EnvironmentHealth, ExecutionEvidence, Finding, ScanOptions, ScanReport, SourceSnapshotError } from "./types.js";

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
    popupUrls: [],
  };
}

function skippedFinding(id: string, action: ActionSpec, reason: string): Finding {
  const discoveryDetector = action.recordingRequired
    ? [{ code: "RD008" as const, title: "Action discovery boundary", detail: action.recordingRequired }]
    : [];
  return {
    id,
    action,
    verdict: "SKIPPED",
    evidenceLevel: 0,
    reason,
    skippedReason: reason,
    detectorMatches: discoveryDetector,
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

interface SourceSnapshotPlan {
  adapter: DiscoverableSourceAdapter;
  resources: string[];
  discoveryError?: string;
}

async function prepareSourceSnapshotPlans(adapters: DiscoverableSourceAdapter[]): Promise<SourceSnapshotPlan[]> {
  return Promise.all(adapters.map(async (adapter): Promise<SourceSnapshotPlan> => {
    try {
      const schema = await adapter.discoverSchema();
      const resources = [...new Set(schema.map((resource) => resource.resource))].sort().slice(0, 20);
      return resources.length > 0
        ? { adapter, resources }
        : { adapter, resources, discoveryError: "No source resources were discovered." };
    } catch (error) {
      return {
        adapter,
        resources: [],
        discoveryError: redactEnvironmentText(error instanceof Error ? error.message : String(error), process.env),
      };
    }
  }));
}

async function captureSourceSnapshots(
  plans: SourceSnapshotPlan[],
  stage: "before" | "after",
  limit: number,
): Promise<{ snapshots: SourceSnapshot[]; errors: SourceSnapshotError[] }> {
  const snapshots: SourceSnapshot[] = [];
  const errors: SourceSnapshotError[] = [];
  for (const plan of plans) {
    if (plan.discoveryError) {
      errors.push({ adapter: plan.adapter.kind, stage: "discover", detail: plan.discoveryError });
      continue;
    }
    for (const resource of plan.resources) {
      try {
        snapshots.push(await plan.adapter.snapshot(resource, limit));
      } catch (error) {
        errors.push({
          adapter: plan.adapter.kind,
          stage,
          resource,
          detail: redactEnvironmentText(error instanceof Error ? error.message : String(error), process.env),
        });
      }
    }
  }
  return { snapshots, errors };
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
  if (options.sourceSnapshotLimit !== undefined && (!Number.isInteger(options.sourceSnapshotLimit) || options.sourceSnapshotLimit < 1 || options.sourceSnapshotLimit > 1_000)) {
    throw new Error("Source snapshot limit must be between 1 and 1000 rows.");
  }
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
          traceOnFailure: Boolean(options.traceOnFailure),
          video: Boolean(options.video),
          environmentTimeoutMs: options.environmentTimeoutMs ?? Math.max(options.timeoutMs, 5_000),
          acceptEnvironmentRisk: false,
          allowIframes: Boolean(options.allowIframes),
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
          allowIframes: Boolean(options.allowIframes),
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
    const sourcePlans = await prepareSourceSnapshotPlans(options.sourceAdapters ?? []);
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
      const sourceEnabled = sourcePlans.length > 0 && ["mutation", "external"].includes(action.kind);
      const sourceBefore = sourceEnabled
        ? await captureSourceSnapshots(sourcePlans, "before", options.sourceSnapshotLimit ?? 100)
        : undefined;
      let evidence: ExecutionEvidence;
      try {
        evidence = await executeAction(browser, action, options, screenshots);
      } catch (error) {
        if (error instanceof PreExecutionSafetyError) {
          findings.push(skippedFinding(findingId, error.action, error.reason));
          continue;
        }
        throw error;
      }
      let providerMatchedChecks = 0;
      let providerConfirmationComplete = false;
      if (options.providerVerifier) {
        const providerResult = await options.providerVerifier.verifyAutomatic(action, evidence, { deadline });
        providerMatchedChecks = providerResult.matchedChecks;
        if (providerResult.matchedChecks > 0) {
          evidence.providerEvidence = providerResult.evidence;
          evidence.providerErrors = providerResult.errors;
          providerConfirmationComplete =
            providerResult.errors.length === 0 &&
            providerResult.evidence.length === providerResult.matchedChecks &&
            providerResult.evidence.every((entry) => entry.passed && entry.automaticLinkage?.causallyLinked === true);
          if (providerConfirmationComplete) {
            evidence.persistenceScope = "SOURCE_OF_TRUTH_CONFIRMED";
          }
        }
      }
      const sourceAfter = sourceEnabled
        ? await captureSourceSnapshots(sourcePlans, "after", options.sourceSnapshotLimit ?? 100)
        : undefined;
      if (sourceBefore && sourceAfter) {
        if (evidence.before) evidence.before.sourceSnapshots = sourceBefore.snapshots;
        if (evidence.after) evidence.after.sourceSnapshots = sourceAfter.snapshots;
        const afterByKey = new Map(sourceAfter.snapshots.map((snapshot) => [`${snapshot.adapter}:${snapshot.resource}`, snapshot]));
        evidence.sourceDiffs = sourceBefore.snapshots.flatMap((before) => {
          const after = afterByKey.get(`${before.adapter}:${before.resource}`);
          return after ? [diffSourceSnapshots(before, after)] : [];
        });
        evidence.sourceSnapshotErrors = [...sourceBefore.errors, ...sourceAfter.errors];
      }
      const finding = findingFromEvidence(findingId, action, evidence);
      if (sourceEnabled && (evidence.sourceSnapshotErrors?.length ?? 0) > 0 && finding.verdict === "VERIFIED") {
        finding.verdict = "UNCERTAIN";
        finding.reason = "The browser effect was observed, but configured source snapshots were unavailable.";
      }
      if (providerMatchedChecks > 0 && !providerConfirmationComplete && finding.verdict === "VERIFIED") {
        finding.verdict = "UNCERTAIN";
        finding.evidenceLevel = Math.min(finding.evidenceLevel, 3) as Finding["evidenceLevel"];
        finding.reason = (evidence.providerErrors?.length ?? 0) > 0
          ? "The browser effect was observed, but configured provider confirmation was unavailable."
          : "The browser effect was observed, but every configured provider check was not causally confirmed.";
      }
      if (options.traceOnFailure && !options.trace && ["VERIFIED", "BROWSER_LOCAL", "SKIPPED"].includes(finding.verdict) && evidence.trace) {
        await rm(evidence.trace, { force: true });
        delete evidence.trace;
      }
      findings.push(finding);
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
        traceOnFailure: Boolean(options.traceOnFailure),
        video: Boolean(options.video),
        environmentTimeoutMs: options.environmentTimeoutMs ?? Math.max(options.timeoutMs, 5_000),
        acceptEnvironmentRisk: Boolean(options.acceptEnvironmentRisk),
        allowIframes: Boolean(options.allowIframes),
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
