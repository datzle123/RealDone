import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Reproduction, ScanReport } from "../types.js";
import { renderHtml } from "./html.js";

function portablePath(reportDirectory: string, value?: string): string | undefined {
  if (!value) return undefined;
  return path.relative(reportDirectory, value).split(path.sep).join("/");
}

export async function writeReport(
  reportDirectory: string,
  sourceReport: ScanReport,
): Promise<ScanReport> {
  await Promise.all([
    mkdir(reportDirectory, { recursive: true }),
    mkdir(path.join(reportDirectory, "screenshots"), { recursive: true }),
    mkdir(path.join(reportDirectory, "network"), { recursive: true }),
    mkdir(path.join(reportDirectory, "reproductions"), { recursive: true }),
  ]);
  const report = structuredClone(sourceReport);
  for (const finding of report.findings) {
    const screenshot = portablePath(reportDirectory, finding.evidence.screenshot);
    const refreshScreenshot = portablePath(reportDirectory, finding.evidence.refreshScreenshot);
    if (screenshot) finding.evidence.screenshot = screenshot;
    else delete finding.evidence.screenshot;
    if (refreshScreenshot) finding.evidence.refreshScreenshot = refreshScreenshot;
    else delete finding.evidence.refreshScreenshot;

    const reproduction: Reproduction = {
      schemaVersion: "1.0",
      findingId: finding.id,
      sourceScanId: report.scanId,
      targetUrl: report.targetUrl,
      action: finding.action,
      options: {
        timeoutMs: report.options.timeoutMs,
        settleMs: report.options.settleMs,
        allowDestructive: report.options.allowDestructive,
        allowExternal: report.options.allowExternal,
      },
    };
    await Promise.all([
      writeFile(
        path.join(reportDirectory, "reproductions", `${finding.id}.json`),
        `${JSON.stringify(reproduction, null, 2)}\n`,
      ),
      writeFile(
        path.join(reportDirectory, "network", `${finding.id}.json`),
        `${JSON.stringify(finding.evidence.network, null, 2)}\n`,
      ),
    ]);
  }
  await Promise.all([
    writeFile(path.join(reportDirectory, "report.html"), renderHtml(report)),
    writeFile(path.join(reportDirectory, "summary.json"), `${JSON.stringify(report.summary, null, 2)}\n`),
    writeFile(path.join(reportDirectory, "findings.json"), `${JSON.stringify(report.findings, null, 2)}\n`),
    writeFile(path.join(reportDirectory, "scan.json"), `${JSON.stringify(report, null, 2)}\n`),
  ]);
  return report;
}
