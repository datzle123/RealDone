import { Worker } from "node:worker_threads";
import { z } from "zod";
import { redactEnvironmentText, redactText } from "../core/redact.js";
import type { ProviderEvidence, ProviderExpectation, ProviderKind, ProviderObservation } from "../providers/types.js";
import { loadPluginManifest, type ResolvedPluginManifest } from "./schema.js";

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const observationSchema = z.object({
  found: z.boolean(),
  detail: z.string().max(2_000),
  metadata: z.record(z.string(), scalarSchema).optional(),
});

const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
(async () => {
  try {
    const module = await import(pathToFileURL(workerData.entryFile).href);
    const plugin = module.default ?? module.plugin;
    if (!plugin || plugin.apiVersion !== '1.0' || plugin.name !== workerData.pluginName || typeof plugin.verifyProvider !== 'function') {
      throw new Error('Plugin module does not match its RealDone v1 manifest.');
    }
    const value = await plugin.verifyProvider(workerData.expectation);
    parentPort.postMessage({ ok: true, value });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
})();
`;

interface PluginHostOptions {
  timeoutMs?: number;
  memoryLimitMb?: number;
}

export class PluginHost {
  private readonly providers = new Map<string, { kind: ProviderKind; manifest: ResolvedPluginManifest }>();

  private constructor(
    manifests: ResolvedPluginManifest[],
    private readonly timeoutMs: number,
    private readonly memoryLimitMb: number,
  ) {
    for (const manifest of manifests) {
      for (const provider of manifest.providers) {
        if (this.providers.has(provider.name)) throw new Error(`Duplicate provider plugin registration: ${provider.name}`);
        this.providers.set(provider.name, { kind: provider.kind, manifest });
      }
    }
  }

  static async load(files: string[], options: PluginHostOptions = {}): Promise<PluginHost> {
    const timeoutMs = options.timeoutMs ?? 5_000;
    const memoryLimitMb = options.memoryLimitMb ?? 64;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Plugin timeout must be a positive integer.");
    if (!Number.isInteger(memoryLimitMb) || memoryLimitMb <= 0) throw new Error("Plugin memory limit must be a positive integer.");
    const manifests = await Promise.all(files.map(loadPluginManifest));
    return new PluginHost(manifests, timeoutMs, memoryLimitMb);
  }

  private invoke(manifest: ResolvedPluginManifest, expectation: ProviderExpectation): Promise<ProviderObservation> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerSource, {
        eval: true,
        workerData: { entryFile: manifest.entryFile, pluginName: manifest.name, expectation },
        resourceLimits: { maxOldGenerationSizeMb: this.memoryLimitMb, maxYoungGenerationSizeMb: 16 },
        stdout: true,
        stderr: true,
      });
      worker.stdout?.resume();
      worker.stderr?.resume();
      let settled = false;
      const finish = (operation: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        operation();
      };
      const timer = setTimeout(() => finish(() => reject(new Error(`Plugin timed out after ${this.timeoutMs}ms: ${manifest.name}`))), this.timeoutMs);
      timer.unref();
      worker.on("message", (message: { ok?: boolean; value?: unknown; error?: string }) => {
        if (!message.ok) {
          finish(() => reject(new Error(redactText(message.error ?? "Plugin failed without an error message."))));
          return;
        }
        const parsed = observationSchema.safeParse(message.value);
        if (!parsed.success) {
          finish(() => reject(new Error(`Plugin returned invalid provider evidence: ${parsed.error.message}`)));
          return;
        }
        finish(() => resolve(parsed.data as ProviderObservation));
      });
      worker.on("error", (error) => finish(() => reject(new Error(redactText(error.message)))));
      worker.on("exit", (code) => {
        if (!settled) {
          const detail = code === 0 ? "before returning provider evidence" : `with code ${code}`;
          finish(() => reject(new Error(`Plugin worker exited ${detail}: ${manifest.name}`)));
        }
      });
    });
  }

  async verifyProvider(expectation: ProviderExpectation): Promise<ProviderEvidence> {
    const registration = this.providers.get(expectation.provider);
    if (!registration) throw new Error(`Provider plugin is not registered: ${expectation.provider}`);
    if (registration.kind !== expectation.kind) {
      throw new Error(`Provider ${expectation.provider} is ${registration.kind}, not ${expectation.kind}.`);
    }
    const started = Date.now();
    const observation = await this.invoke(registration.manifest, expectation);
    const passed = expectation.state === "confirmed" ? observation.found : !observation.found;
    const sensitiveValues = [
      "value" in expectation.reference ? expectation.reference.value : process.env[expectation.reference.env],
      ...Object.values(expectation.parameters ?? {}),
    ].filter((value): value is string | number | boolean => value !== null && value !== undefined);
    const sanitize = (value: string): string => {
      let result = redactEnvironmentText(value, process.env);
      for (const sensitive of sensitiveValues) {
        const raw = String(sensitive);
        if (raw) result = result.replaceAll(raw, "[REDACTED_PROVIDER_VALUE]");
      }
      return result;
    };
    return {
      provider: expectation.provider,
      kind: expectation.kind,
      resource: expectation.resource,
      operation: expectation.operation,
      state: expectation.state,
      found: observation.found,
      passed,
      evidenceLevel: 6,
      durationMs: Date.now() - started,
      detail: sanitize(observation.detail),
      ...(observation.metadata ? {
        metadata: Object.fromEntries(Object.entries(observation.metadata).map(([key, value]) => [
          key,
          value !== null && sensitiveValues.some((sensitive) => String(sensitive) === String(value))
            ? "[REDACTED_PROVIDER_VALUE]"
            : typeof value === "string" ? sanitize(value) : value,
        ])),
      } : {}),
    };
  }
}
