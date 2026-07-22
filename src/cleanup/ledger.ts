import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { request } from "playwright";
import { z } from "zod";
import { createPostgresAdapterFromFile } from "../adapters/postgres/index.js";
import { SqliteSourceAdapter } from "../adapters/sqlite/index.js";
import { createSourceAdapterFromFile } from "../adapters/registry.js";
import type { SourceAdapterKind, SourceCleanupTarget, SourceOfTruthAdapter } from "../adapters/types.js";
import type { BehaviorContract } from "../contracts/schema.js";
import { isMutationHostAllowed, validateTarget } from "../core/safety.js";
import { withRetry } from "../core/retry.js";
import { PluginHost } from "../plugins/host.js";
import type { Finding, NetworkEvidence, ScanReport } from "../types.js";

export type CleanupStatus = "pending" | "manual" | "cleaned" | "failed";

export interface CleanupResource {
  id: string;
  findingId: string;
  actionId: string;
  type: string;
  canary: string;
  createdAt: string;
  sourceUrl: string;
  cleanupUrl?: string;
  strategy?: "http" | SourceAdapterKind;
  database?: SourceCleanupTarget;
  postgres?: SourceCleanupTarget;
  resourceId?: string;
  dependsOn: string[];
  status: CleanupStatus;
  attempts: number;
  lastAttemptAt?: string;
  error?: string;
}

export interface CleanupLedger {
  schemaVersion: "1.0";
  scanId: string;
  targetUrl: string;
  resources: CleanupResource[];
}

const resourceSchema = z.object({
  id: z.string(),
  findingId: z.string(),
  actionId: z.string(),
  type: z.string(),
  canary: z.string(),
  createdAt: z.string(),
  sourceUrl: z.string(),
  cleanupUrl: z.string().optional(),
  strategy: z.enum(["http", "postgresql", "sqlite", "prisma", "supabase", "firebase", "mongodb", "custom"]).optional(),
  database: z
    .object({
      adapter: z.enum(["postgresql", "sqlite", "prisma", "supabase", "firebase", "mongodb", "custom"]),
      connector: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
      resource: z.string(),
      filters: z.array(
        z.union([
          z.object({ field: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
          z.object({ field: z.string(), env: z.string() }),
        ]),
      ),
    })
    .optional(),
  postgres: z
    .object({
      adapter: z.literal("postgresql"),
      resource: z.string(),
      filters: z.array(
        z.union([
          z.object({ field: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
          z.object({ field: z.string(), env: z.string() }),
        ]),
      ),
    })
    .optional(),
  resourceId: z.string().optional(),
  dependsOn: z.array(z.string()),
  status: z.enum(["pending", "manual", "cleaned", "failed"]),
  attempts: z.number().int().nonnegative(),
  lastAttemptAt: z.string().optional(),
  error: z.string().optional(),
});

const ledgerSchema = z.object({
  schemaVersion: z.literal("1.0"),
  scanId: z.string(),
  targetUrl: z.string(),
  resources: z.array(resourceSchema),
});

function ledgerId(finding: Finding, request?: NetworkEvidence, index = 0): string {
  return `cleanup-${createHash("sha256")
    .update(`${finding.id}|${finding.action.id}|${finding.evidence.canary}|${request?.id ?? index}|${request?.responseResourceId ?? "manual"}`)
    .digest("hex")
    .slice(0, 10)}`;
}

function cleanupRequests(finding: Finding): NetworkEvidence[] {
  return finding.evidence.network.filter(
    (entry) => entry.method === "POST" && entry.ok && (entry.responseResourceId || entry.location),
  );
}

function deriveCleanupUrl(requestEvidence?: NetworkEvidence): string | undefined {
  if (!requestEvidence) return undefined;
  if (requestEvidence.location) return requestEvidence.location;
  if (!requestEvidence.responseResourceId) return undefined;
  try {
    const url = new URL(requestEvidence.url);
    url.search = "";
    url.hash = "";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeURIComponent(requestEvidence.responseResourceId)}`;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function createCleanupLedger(report: ScanReport): CleanupLedger {
  const resources = report.findings.flatMap((finding): CleanupResource[] => {
    if (finding.action.kind !== "mutation" || finding.action.intent === "delete" || finding.verdict === "SKIPPED") return [];
    if (/\b(log[ -]?in|sign[ -]?in|authenticate|payment|webhook)\b/i.test(finding.action.label)) return [];
    const requests = cleanupRequests(finding);
    const wasCreated = finding.action.intent === "create" || requests.length > 0;
    if (!wasCreated && !finding.evidence.after?.canaryPresent) return [];
    const candidates: Array<NetworkEvidence | undefined> = requests.length > 0 ? requests : [undefined];
    return candidates.map((requestEvidence, index): CleanupResource => {
      const cleanupUrl = deriveCleanupUrl(requestEvidence);
      return {
        id: ledgerId(finding, requestEvidence, index),
        findingId: finding.id,
        actionId: finding.action.id,
        type: requestEvidence?.resourceTypeHint ?? finding.action.intent,
        canary: finding.evidence.canary,
        createdAt: finding.evidence.startedAt || report.startedAt,
        sourceUrl: requestEvidence?.url ?? finding.action.pageUrl,
        ...(cleanupUrl ? { cleanupUrl } : {}),
        strategy: "http",
        ...(requestEvidence?.responseResourceId ? { resourceId: requestEvidence.responseResourceId } : {}),
        dependsOn: [],
        status: cleanupUrl ? "pending" : "manual",
        attempts: 0,
      };
    });
  });
  return { schemaVersion: "1.0", scanId: report.scanId, targetUrl: report.targetUrl, resources };
}

export function createContractCleanupLedger(
  contract: BehaviorContract,
  verificationId: string,
): CleanupLedger {
  const createdAt = new Date().toISOString();
  const resources = contract.cleanup.flatMap((cleanup, index): CleanupResource[] => {
    if (!("adapter" in cleanup)) return [];
    const digest = createHash("sha256")
      .update(`${contract.id}|${cleanup.resource}|${JSON.stringify(cleanup.filters)}`)
      .digest("hex")
      .slice(0, 10);
    const canary = cleanup.filters
      .flatMap((filter) => ("value" in filter && typeof filter.value === "string" ? [filter.value] : []))
      .find((value) => /^RD_/i.test(value)) ?? "[contract cleanup]";
    return [{
      id: `cleanup-db-${digest}`,
      findingId: contract.id,
      actionId: `contract-cleanup-${index + 1}`,
      type: cleanup.resource,
      canary,
      createdAt,
      sourceUrl: `${cleanup.adapter}:${cleanup.resource}`,
      strategy: cleanup.adapter,
      database: cleanup,
      ...(cleanup.adapter === "postgresql" ? { postgres: cleanup } : {}),
      dependsOn: [],
      status: "pending",
      attempts: 0,
    }];
  });
  return {
    schemaVersion: "1.0",
    scanId: verificationId,
    targetUrl: contract.baseUrl,
    resources,
  };
}

function ledgerPath(reportDirectory: string): string {
  return path.join(reportDirectory, "cleanup-ledger.json");
}

export async function writeCleanupLedger(reportDirectory: string, ledger: CleanupLedger): Promise<void> {
  await writeFile(ledgerPath(reportDirectory), `${JSON.stringify(ledger, null, 2)}\n`);
}

export async function readCleanupLedger(reportDirectory: string): Promise<CleanupLedger> {
  const input = JSON.parse(await readFile(ledgerPath(reportDirectory), "utf8")) as unknown;
  const parsed = ledgerSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid cleanup ledger: ${parsed.error.message}`);
  return parsed.data as CleanupLedger;
}

export interface CleanupOptions {
  confirm: boolean;
  allowHosts: string[];
  retries: number;
  storageStatePath?: string;
  postgresConfigPath?: string;
  sqlitePath?: string;
  databaseConfigPaths?: string[];
  pluginManifests?: string[];
  pluginTimeoutMs?: number;
  pluginMemoryLimitMb?: number;
  confirmDatabase?: boolean;
}

export interface CleanupResult {
  ledger: CleanupLedger;
  cleaned: number;
  failed: number;
  manual: number;
  pending: number;
}

function resultFor(ledger: CleanupLedger): CleanupResult {
  return {
    ledger,
    cleaned: ledger.resources.filter((item) => item.status === "cleaned").length,
    failed: ledger.resources.filter((item) => item.status === "failed").length,
    manual: ledger.resources.filter((item) => item.status === "manual").length,
    pending: ledger.resources.filter((item) => item.status === "pending").length,
  };
}

export async function runCleanup(reportDirectory: string, options: CleanupOptions): Promise<CleanupResult> {
  const ledger = await readCleanupLedger(reportDirectory);
  if (!options.confirm) return resultFor(ledger);
  const context = await request.newContext(
    options.storageStatePath ? { storageState: options.storageStatePath } : {},
  );
  const databaseAdapters = new Map<SourceAdapterKind, SourceOfTruthAdapter>();
  if (options.confirmDatabase && options.postgresConfigPath) {
    databaseAdapters.set("postgresql", await createPostgresAdapterFromFile(options.postgresConfigPath));
  }
  if (options.confirmDatabase && options.sqlitePath) {
    databaseAdapters.set("sqlite", new SqliteSourceAdapter(options.sqlitePath, { allowCleanup: true }));
  }
  if (options.confirmDatabase) {
    for (const configFile of options.databaseConfigPaths ?? []) {
      const adapter = await createSourceAdapterFromFile(configFile);
      if (databaseAdapters.has(adapter.kind)) {
        await adapter.close();
        await Promise.all([...databaseAdapters.values()].map((configured) => configured.close()));
        throw new Error(`Duplicate cleanup adapter configuration: ${adapter.kind}`);
      }
      databaseAdapters.set(adapter.kind, adapter);
    }
  }
  const plugins = options.confirmDatabase && (options.pluginManifests?.length ?? 0) > 0
    ? await PluginHost.load(options.pluginManifests ?? [], {
        ...(options.pluginTimeoutMs === undefined ? {} : { timeoutMs: options.pluginTimeoutMs }),
        ...(options.pluginMemoryLimitMb === undefined ? {} : { memoryLimitMb: options.pluginMemoryLimitMb }),
      })
    : undefined;
  try {
    const resources = [...ledger.resources].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const resource of resources) {
      if (resource.status !== "pending") continue;
      const databaseStrategy = resource.strategy && resource.strategy !== "http" ? resource.strategy : undefined;
      if (databaseStrategy && !options.confirmDatabase) continue;
      if (!databaseStrategy && !resource.cleanupUrl) continue;
      resource.attempts += 1;
      resource.lastAttemptAt = new Date().toISOString();
      try {
        if (databaseStrategy) {
          const target = resource.database ?? resource.postgres;
          if (!target) {
            throw new Error(`${databaseStrategy} cleanup requires its adapter option and a valid database ledger target.`);
          }
          if (databaseStrategy === "prisma" || databaseStrategy === "custom") {
            if (!plugins) throw new Error(`${databaseStrategy} cleanup requires --plugin and a valid source connector.`);
            await plugins.cleanupSource(target, { confirmed: true });
          } else {
            const adapter = databaseAdapters.get(databaseStrategy);
            if (!adapter) throw new Error(`${databaseStrategy} cleanup requires its adapter option and a valid database ledger target.`);
            await adapter.cleanup(target, { confirmed: true });
          }
          resource.status = "cleaned";
          delete resource.error;
          await writeCleanupLedger(reportDirectory, ledger);
          continue;
        }
        if (!resource.cleanupUrl) throw new Error("HTTP cleanup target is missing a cleanup URL.");
        const cleanupUrl = resource.cleanupUrl;
        const target = validateTarget(cleanupUrl);
        if (!isMutationHostAllowed(target, options.allowHosts)) {
          throw new Error(`Cleanup host is not allowed: ${target.hostname}`);
        }
        await withRetry(
          async () => {
            const response = await context.delete(cleanupUrl);
            const status = response.status();
            await response.dispose();
            if ((status >= 200 && status < 300) || status === 404) return;
            throw new Error(`DELETE returned HTTP ${status}`);
          },
          { retries: options.retries },
        );
        resource.status = "cleaned";
        delete resource.error;
      } catch (error) {
        resource.status = "failed";
        resource.error = error instanceof Error ? error.message : String(error);
      }
      await writeCleanupLedger(reportDirectory, ledger);
    }
  } finally {
    await context.dispose();
    await Promise.all([...databaseAdapters.values()].map((adapter) => adapter.close()));
  }
  return resultFor(ledger);
}
