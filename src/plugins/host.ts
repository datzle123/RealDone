import { Worker } from "node:worker_threads";
import { z } from "zod";
import { hashText, redactEnvironmentText, redactText } from "../core/redact.js";
import { snapshotRows } from "../adapters/remote.js";
import type {
  SourceAdapterKind,
  SourceCleanupEvidence,
  SourceCleanupObservation,
  SourceCleanupTarget,
  SourceDiscoveryInput,
  SourceEvidence,
  SourceExpectation,
  SourceObservation,
  SourceResourceSchema,
  SourceSnapshot,
  SourceSnapshotInput,
  SourceSnapshotObservation,
} from "../adapters/types.js";
import type { ProviderEvidence, ProviderExpectation, ProviderKind, ProviderObservation } from "../providers/types.js";
import { loadPluginManifest, type ResolvedPluginManifest } from "./schema.js";

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const observationSchema = z.object({
  found: z.boolean(),
  detail: z.string().max(2_000),
  metadata: z.record(z.string(), scalarSchema).optional(),
});
const sourceObservationSchema = z.object({
  matchedRows: z.number().int().nonnegative(),
  matchedFields: z.array(z.string()).optional(),
  detail: z.string().max(2_000),
});
const sourceResourceSchema = z.object({
  adapter: z.enum(["prisma", "custom"]),
  resource: z.string().min(1),
  fields: z.array(z.object({ name: z.string().min(1), type: z.string().min(1), nullable: z.boolean() })).max(2_000),
  primaryKey: z.array(z.string().min(1)).max(100),
  softDeleteFields: z.array(z.string().min(1)).max(100),
  schemaHash: z.string().min(1),
});
const sourceSnapshotObservationSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).max(10_001),
  truncated: z.boolean(),
});
const sourceCleanupObservationSchema = z.object({
  deletedRows: z.number().int().nonnegative(),
  detail: z.string().max(2_000).optional(),
});

type SourcePluginKind = Extract<SourceAdapterKind, "prisma" | "custom">;
type PluginMethod = "verifyProvider" | "verifySource" | "discoverSource" | "snapshotSource" | "cleanupSource";
type PluginInput = ProviderExpectation | SourceExpectation | SourceDiscoveryInput | SourceSnapshotInput | SourceCleanupTarget;

const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
(async () => {
  try {
    const originalFetch = globalThis.fetch;
    if (originalFetch) globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (!workerData.networkHosts.includes(url.hostname)) throw new Error('Plugin network host is not allowlisted: ' + url.hostname);
      return originalFetch(input, init);
    };
    const module = await import(pathToFileURL(workerData.entryFile).href);
    const plugin = module.default ?? module.plugin;
    if (!plugin || plugin.apiVersion !== '1.0' || plugin.name !== workerData.pluginName || typeof plugin[workerData.method] !== 'function') {
      throw new Error('Plugin module does not match its RealDone v1 manifest.');
    }
    const value = await plugin[workerData.method](workerData.input);
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
  private readonly sources = new Map<string, { kind: Extract<SourceAdapterKind, "prisma" | "custom">; manifest: ResolvedPluginManifest }>();

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
      for (const source of manifest.sources) {
        if (this.sources.has(source.name)) throw new Error(`Duplicate source plugin registration: ${source.name}`);
        this.sources.set(source.name, { kind: source.kind, manifest });
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

  private invoke(manifest: ResolvedPluginManifest, method: PluginMethod, input: PluginInput): Promise<unknown> {
    const environmentNames = new Set(manifest.permissions.environment);
    if ("type" in input && input.type === "provider" && "env" in input.reference) environmentNames.add(input.reference.env);
    if ("filters" in input) for (const filter of input.filters) if ("env" in filter) environmentNames.add(filter.env);
    const environment = Object.fromEntries([...environmentNames].flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]!]]));
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerSource, {
        eval: true,
        workerData: { entryFile: manifest.entryFile, pluginName: manifest.name, method, input, networkHosts: manifest.permissions.networkHosts },
        env: environment,
        argv: [],
        execArgv: [],
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
        finish(() => resolve(message.value));
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

  private sourceRegistration(adapter: SourcePluginKind, connector?: string): [string, { kind: SourcePluginKind; manifest: ResolvedPluginManifest }] {
    const candidates = connector
      ? [[connector, this.sources.get(connector)] as const]
      : [...this.sources.entries()].filter(([, registration]) => registration.kind === adapter);
    const selected = candidates.length === 1 ? candidates[0] : undefined;
    if (!selected?.[1]) {
      throw new Error(connector
        ? `Source plugin is not registered: ${connector}`
        : `Exactly one ${adapter} source plugin must be registered or connector must be specified.`);
    }
    if (selected[1].kind !== adapter) throw new Error(`Source connector ${selected[0]} is ${selected[1].kind}, not ${adapter}.`);
    return [selected[0], selected[1]];
  }

  async verifyProvider(expectation: ProviderExpectation): Promise<ProviderEvidence> {
    const registration = this.providers.get(expectation.provider);
    if (!registration) throw new Error(`Provider plugin is not registered: ${expectation.provider}`);
    if (registration.kind !== expectation.kind) {
      throw new Error(`Provider ${expectation.provider} is ${registration.kind}, not ${expectation.kind}.`);
    }
    const started = Date.now();
    const parsed = observationSchema.safeParse(await this.invoke(registration.manifest, "verifyProvider", expectation));
    if (!parsed.success) throw new Error(`Plugin returned invalid provider evidence: ${parsed.error.message}`);
    const observation = parsed.data as ProviderObservation;
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

  async verifySource(expectation: SourceExpectation): Promise<SourceEvidence> {
    if (expectation.adapter !== "prisma" && expectation.adapter !== "custom") throw new Error(`Source plugins do not handle adapter: ${expectation.adapter}`);
    const selected = this.sourceRegistration(expectation.adapter, expectation.connector);
    const started = Date.now();
    const parsed = sourceObservationSchema.safeParse(await this.invoke(selected[1].manifest, "verifySource", expectation));
    if (!parsed.success) throw new Error(`Plugin returned invalid source evidence: ${parsed.error.message}`);
    const observation = parsed.data as SourceObservation;
    const sensitiveValues = expectation.filters.map((filter) => "value" in filter ? filter.value : process.env[filter.env]);
    let detail = redactEnvironmentText(observation.detail, process.env);
    for (const value of sensitiveValues) {
      if (value === null || value === undefined) continue;
      const raw = String(value);
      if (raw) detail = detail.replaceAll(raw, "[REDACTED_SOURCE_VALUE]");
    }
    const statePassed = expectation.state === "present" ? observation.matchedRows > 0 : observation.matchedRows === 0;
    return {
      adapter: expectation.adapter,
      evidenceLevel: 6,
      resource: expectation.resource,
      state: expectation.state,
      matchedRows: observation.matchedRows,
      ...(expectation.maxMatches === undefined ? {} : { maxMatches: expectation.maxMatches }),
      matchedFields: observation.matchedFields ?? expectation.filters.map((filter) => filter.field),
      queryHash: "plugin-managed",
      transaction: "read-only",
      durationMs: Date.now() - started,
      passed: statePassed && (expectation.maxMatches === undefined || observation.matchedRows <= expectation.maxMatches),
      detail,
    };
  }

  async discoverSource(input: SourceDiscoveryInput): Promise<SourceResourceSchema[]> {
    const selected = this.sourceRegistration(input.adapter, input.connector);
    const parsed = z.array(sourceResourceSchema).max(1_000).safeParse(await this.invoke(selected[1].manifest, "discoverSource", input));
    if (!parsed.success) throw new Error(`Plugin returned invalid source schema: ${parsed.error.message}`);
    const resources = parsed.data as SourceResourceSchema[];
    if (input.resource && (resources.length !== 1 || resources[0]?.resource !== input.resource)) {
      throw new Error(`Source plugin must return exactly the requested resource schema: ${input.resource}`);
    }
    return resources.map((resource) => {
      if (resource.adapter !== input.adapter) throw new Error(`Source plugin returned ${resource.adapter} schema for ${input.adapter}.`);
      const fields = new Set(resource.fields.map((field) => field.name));
      if (fields.size !== resource.fields.length) throw new Error(`Source plugin returned duplicate fields for: ${resource.resource}`);
      for (const field of [...resource.primaryKey, ...resource.softDeleteFields]) {
        if (!fields.has(field)) throw new Error(`Source plugin schema references an unknown field for ${resource.resource}: ${field}`);
      }
      return {
        ...resource,
        schemaHash: hashText(JSON.stringify({
          adapter: resource.adapter,
          resource: resource.resource,
          fields: resource.fields,
          primaryKey: resource.primaryKey,
          softDeleteFields: resource.softDeleteFields,
        })),
      };
    });
  }

  async snapshotSource(input: SourceSnapshotInput): Promise<SourceSnapshot> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10_000) {
      throw new Error("Plugin source snapshot limit must be between 1 and 10000 rows.");
    }
    const selected = this.sourceRegistration(input.adapter, input.connector);
    const parsed = sourceSnapshotObservationSchema.safeParse(await this.invoke(selected[1].manifest, "snapshotSource", input));
    if (!parsed.success) throw new Error(`Plugin returned invalid source snapshot: ${parsed.error.message}`);
    const observation = parsed.data as SourceSnapshotObservation;
    const schema = (await this.discoverSource({
      adapter: input.adapter,
      ...(input.connector ? { connector: input.connector } : {}),
      resource: input.resource,
    }))[0];
    if (!schema) throw new Error(`Source plugin did not return a schema for: ${input.resource}`);
    const mapping = {
      target: input.resource,
      fields: Object.fromEntries(schema.fields.map((field) => [field.name, { target: field.name, type: field.type, nullable: field.nullable }])),
      primaryKey: schema.primaryKey,
      softDeleteFields: schema.softDeleteFields,
      cleanupMaxRows: 1,
    };
    return {
      adapter: input.adapter,
      resource: input.resource,
      schemaHash: schema.schemaHash,
      rows: snapshotRows(observation.rows.slice(0, input.limit), mapping),
      truncated: observation.truncated || observation.rows.length > input.limit,
    };
  }

  async cleanupSource(target: SourceCleanupTarget, confirmation: { confirmed: boolean }): Promise<SourceCleanupEvidence> {
    if (target.adapter !== "prisma" && target.adapter !== "custom") throw new Error(`Source plugins do not handle cleanup adapter: ${target.adapter}`);
    if (!confirmation.confirmed) throw new Error("Plugin source cleanup requires explicit confirmation.");
    const selected = this.sourceRegistration(target.adapter, target.connector);
    const schema = (await this.discoverSource({
      adapter: target.adapter,
      ...(target.connector ? { connector: target.connector } : {}),
      resource: target.resource,
    }))[0];
    if (!schema) throw new Error(`Source plugin did not return a schema for cleanup: ${target.resource}`);
    const actualFields = target.filters.map((filter) => filter.field).sort();
    const primaryKey = [...schema.primaryKey].sort();
    if (primaryKey.length === 0 || actualFields.join("\0") !== primaryKey.join("\0")) {
      throw new Error(`Plugin source cleanup for ${target.resource} requires exactly the primary-key fields: ${schema.primaryKey.join(", ") || "[not declared]"}`);
    }
    const started = Date.now();
    const parsed = sourceCleanupObservationSchema.safeParse(await this.invoke(selected[1].manifest, "cleanupSource", target));
    if (!parsed.success) throw new Error(`Plugin returned invalid source cleanup evidence: ${parsed.error.message}`);
    const observation = parsed.data as SourceCleanupObservation;
    if (observation.deletedRows > 1) throw new Error(`Plugin source cleanup deleted ${observation.deletedRows} rows for one primary key.`);
    return {
      adapter: target.adapter,
      resource: target.resource,
      deletedRows: observation.deletedRows,
      transaction: "read-write",
      durationMs: Date.now() - started,
    };
  }
}
