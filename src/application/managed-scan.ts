import path from "node:path";
import { discoverProject, type ProjectProfile } from "../project/discovery.js";
import { RuntimeManager, runBuildCommand } from "../runtime/manager.js";
import { runScan, type ScanProgress, type ScanResult } from "../scan.js";
import type { ScanOptions } from "../types.js";

export type RuntimeMode = "development" | "production" | "docker";

export interface ManagedScanRequest {
  url?: string;
  projectDirectory?: string;
  manageRuntime: boolean;
  runtimeMode: RuntimeMode;
  runtimeRestarts: number;
  healthEndpoint?: string;
  scanOptions: Omit<ScanOptions, "targetUrl" | "healthEndpoint" | "restartTarget">;
}

function commandForMode(profile: ProjectProfile, mode: RuntimeMode) {
  if (mode === "development") return profile.commands.development;
  if (mode === "production") return profile.commands.production;
  return profile.commands.docker;
}

export async function runManagedScan(
  request: ManagedScanRequest,
  onProgress: (progress: ScanProgress) => void = () => undefined,
): Promise<ScanResult> {
  const implicitManagedRuntime = !request.url;
  const manageRuntime = request.manageRuntime || implicitManagedRuntime;
  const projectRoot = request.projectDirectory || manageRuntime ? path.resolve(request.projectDirectory ?? ".") : undefined;
  const profile = projectRoot ? await discoverProject(projectRoot) : undefined;
  const targetUrl = request.url ?? profile?.localUrl;
  if (!targetUrl) throw new Error("No application URL could be discovered. Run from a supported project root or pass a URL.");
  const healthEndpoint = request.healthEndpoint ?? profile?.healthEndpoint;
  const options: ScanOptions = {
    ...request.scanOptions,
    targetUrl,
    ...(healthEndpoint ? { healthEndpoint } : {}),
  };
  let manager: RuntimeManager | undefined;
  if (manageRuntime) {
    if (!profile || !projectRoot) throw new Error("Managed scan requires a discoverable project.");
    const command = commandForMode(profile, request.runtimeMode);
    if (!command) {
      throw new Error(
        `No ${request.runtimeMode} runtime command was discovered in ${projectRoot}. `
        + "Use a conventional project command, select --runtime-mode docker, start the app and pass its URL, or run realdone init to inspect the detected profile.",
      );
    }
    if (request.runtimeMode === "production" && profile.commands.build) {
      onProgress({ stage: "runtime", message: "Building target project for production" });
      await runBuildCommand(profile.commands.build, projectRoot);
    }
    manager = new RuntimeManager({
      cwd: projectRoot,
      command,
      healthUrl: new URL(request.healthEndpoint ?? profile.healthEndpoint, targetUrl).toString(),
      healthTimeoutMs: options.environmentTimeoutMs ?? 10_000,
      restartLimit: request.runtimeRestarts,
      logFile: path.join(projectRoot, ".realdone", "runtime.log"),
      ...(request.runtimeMode === "docker"
        ? { stopCommand: { executable: "docker", args: ["compose", "down"], source: "managed docker cleanup" } }
        : {}),
    });
    onProgress({ stage: "runtime", message: `Starting managed ${request.runtimeMode} runtime` });
    await manager.start();
    if (options.deep) options.restartTarget = async () => manager?.restart().then(() => undefined);
  }
  return runScan(options, onProgress).finally(async () => {
    await manager?.stop();
  });
}
