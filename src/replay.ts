import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { runScan, type ScanProgress, type ScanResult } from "./scan.js";
import type { Reproduction, ScanOptions } from "./types.js";

async function findReproduction(findingId: string, reportDirectory?: string): Promise<string> {
  if (reportDirectory) {
    const candidate = path.resolve(reportDirectory, "reproductions", `${findingId}.json`);
    await access(candidate);
    return candidate;
  }
  const root = path.resolve(".realdone", "reports");
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
    const candidate = path.join(root, entry.name, "reproductions", `${findingId}.json`);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through older scans.
    }
  }
  throw new Error(`No reproduction found for ${findingId}. Pass --report-dir explicitly.`);
}

export interface ReplayOptions {
  reportDirectory?: string;
  outputRoot: string;
  headed: boolean;
  executablePath?: string;
  storageStatePath?: string;
}

export async function runReplay(
  findingId: string,
  replayOptions: ReplayOptions,
  onProgress: (progress: ScanProgress) => void = () => undefined,
): Promise<ScanResult> {
  const reproductionPath = await findReproduction(findingId, replayOptions.reportDirectory);
  const reproduction = JSON.parse(await readFile(reproductionPath, "utf8")) as Reproduction;
  const options: ScanOptions = {
    targetUrl: reproduction.targetUrl,
    outputRoot: replayOptions.outputRoot,
    headed: replayOptions.headed,
    allowHosts: [new URL(reproduction.targetUrl).hostname],
    maxPages: 1,
    maxActions: 1,
    mutationAllowed: true,
    replayAction: reproduction.action,
    ...reproduction.options,
    ...(replayOptions.executablePath ? { executablePath: replayOptions.executablePath } : {}),
    ...(replayOptions.storageStatePath ? { storageStatePath: replayOptions.storageStatePath } : {}),
  };
  return runScan(options, onProgress);
}
