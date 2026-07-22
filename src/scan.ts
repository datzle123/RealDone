import { randomBytes } from "node:crypto";
import path from "node:path";
import { discoverSite } from "./browser/discover.js";
import { executeAction } from "./browser/executor.js";
import { launchChromium } from "./browser/runtime.js";
import { actionSkipReason, isMutationHostAllowed, validateTarget } from "./core/safety.js";
import { summarize } from "./core/summary.js";
import { findingFromEvidence } from "./detectors/index.js";
import { writeReport } from "./report/writer.js";
import type { ActionSpec, ExecutionEvidence, Finding, ScanOptions, ScanReport } from "./types.js";

export interface ScanProgress {
  stage: "runtime" | "discovery" | "action" | "report";
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

export async function runScan(
  inputOptions: ScanOptions,
  onProgress: (progress: ScanProgress) => void = () => undefined,
): Promise<ScanResult> {
  const target = validateTarget(inputOptions.targetUrl);
  const id = scanId();
  const reportDirectory = path.resolve(inputOptions.outputRoot, id);
  const screenshots = path.join(reportDirectory, "screenshots");
  const startedAt = new Date().toISOString();
  const mutationAllowed = isMutationHostAllowed(target, inputOptions.allowHosts);
  const options: ScanOptions = { ...inputOptions, mutationAllowed };

  onProgress({ stage: "runtime", message: "Starting Chromium" });
  const browser = await launchChromium({
    headed: options.headed,
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  });
  try {
    onProgress({ stage: "discovery", message: "Discovering pages and visible actions" });
    const pages = options.replayAction
      ? [{ url: options.replayAction.pageUrl, title: "Replay", actions: [options.replayAction] }]
      : await discoverSite(browser, target.toString(), {
          maxPages: options.maxPages,
          timeoutMs: options.timeoutMs,
          settleMs: options.settleMs,
          ...(options.storageStatePath ? { storageStatePath: options.storageStatePath } : {}),
        });
    const allActions = pages.flatMap((page) => page.actions);
    const selected = allActions
      .filter((action) => !options.onlyActionId || action.id === options.onlyActionId)
      .slice(0, options.maxActions);
    const findings: Finding[] = [];
    for (const [index, action] of selected.entries()) {
      const findingId = `RD-${String(index + 1).padStart(3, "0")}`;
      onProgress({
        stage: "action",
        message: `${action.label} (${action.kind}/${action.intent})`,
        current: index + 1,
        total: selected.length,
      });
      const reason = actionSkipReason(action, {
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
        allowDestructive: options.allowDestructive,
        allowExternal: options.allowExternal,
        mutationAllowed,
      },
      summary: summarize(findings, pages.length, allActions.length),
      pages,
      findings,
    };
    onProgress({ stage: "report", message: `Writing evidence report to ${reportDirectory}` });
    const portableReport = await writeReport(reportDirectory, report);
    const failed = findings.some((finding) =>
      ["BROKEN", "CONTRADICTORY", "EPHEMERAL", "NO_EFFECT"].includes(finding.verdict),
    );
    return { report: portableReport, reportDirectory, exitCode: failed ? 1 : 0 };
  } finally {
    await browser.close();
  }
}
