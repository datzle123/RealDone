import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { verifyContract, type VerifyContractOptions } from "../contracts/verifier.js";
import type { BrowserName } from "./runtime.js";

export interface BrowserMatrixEntry {
  browser: BrowserName;
  passed: boolean;
  durationMs: number;
  verificationId?: string;
  reportDirectory?: string;
  error?: string;
}

export interface BrowserMatrixReport {
  schemaVersion: "1.0";
  matrixId: string;
  contractFile: string;
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  entries: BrowserMatrixEntry[];
}

export interface BrowserMatrixResult {
  report: BrowserMatrixReport;
  outputDirectory: string;
  exitCode: number;
}

function matrixId(): string {
  return `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${randomBytes(2).toString("hex")}`;
}

function markdown(report: BrowserMatrixReport): string {
  const rows = report.entries.map((entry) =>
    `| ${entry.browser} | ${entry.passed ? "passed" : "failed"} | ${entry.durationMs}ms | ${entry.error ?? entry.reportDirectory ?? "—"} |`,
  ).join("\n");
  return `# RealDone browser matrix\n\n**${report.passed ? "Passed" : "Failed"}** · ${report.matrixId}\n\n| Browser | Result | Duration | Evidence |\n| --- | --- | ---: | --- |\n${rows}\n`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function html(report: BrowserMatrixReport): string {
  const rows = report.entries.map((entry) =>
    `<tr><td>${entry.browser}</td><td class="${entry.passed ? "pass" : "fail"}">${entry.passed ? "PASSED" : "FAILED"}</td><td>${entry.durationMs}ms</td><td>${escapeHtml(entry.error ?? entry.reportDirectory ?? "—")}</td></tr>`,
  ).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>RealDone browser matrix</title><style>body{margin:40px auto;max-width:960px;background:#0a0e12;color:#eef3f6;font:15px/1.5 system-ui}h1{font-size:38px}table{width:100%;border-collapse:collapse;background:#11171e}th,td{padding:12px;border:1px solid #27313c;text-align:left}.pass{color:#39d98a}.fail{color:#ff647c}</style></head><body><h1>Browser matrix</h1><p>${report.matrixId}</p><table><thead><tr><th>Browser</th><th>Result</th><th>Duration</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export async function runBrowserMatrix(
  contractFile: string,
  browsers: BrowserName[],
  options: VerifyContractOptions,
): Promise<BrowserMatrixResult> {
  const id = matrixId();
  const outputDirectory = path.resolve(options.outputRoot, id);
  await mkdir(outputDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  const entries: BrowserMatrixEntry[] = [];
  const { executablePath, ...baseOptions } = options;
  for (const browser of [...new Set(browsers)]) {
    const started = Date.now();
    try {
      const result = await verifyContract(contractFile, {
        ...baseOptions,
        outputRoot: path.join(outputDirectory, browser),
        browserName: browser,
        ...(browser === "chromium" && executablePath ? { executablePath } : {}),
      });
      entries.push({
        browser,
        passed: result.verification.passed,
        durationMs: Date.now() - started,
        verificationId: result.verification.verificationId,
        reportDirectory: path.relative(outputDirectory, result.outputDirectory).split(path.sep).join("/"),
      });
    } catch (error) {
      entries.push({
        browser,
        passed: false,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const report: BrowserMatrixReport = {
    schemaVersion: "1.0",
    matrixId: id,
    contractFile: path.resolve(contractFile),
    startedAt,
    finishedAt: new Date().toISOString(),
    passed: entries.length > 0 && entries.every((entry) => entry.passed),
    entries,
  };
  await Promise.all([
    writeFile(path.join(outputDirectory, "matrix.json"), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(path.join(outputDirectory, "matrix.md"), markdown(report)),
    writeFile(path.join(outputDirectory, "matrix.html"), html(report)),
  ]);
  return { report, outputDirectory, exitCode: report.passed ? 0 : 1 };
}
