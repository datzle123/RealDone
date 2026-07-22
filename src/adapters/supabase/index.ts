import { hashText } from "../../core/redact.js";
import type {
  DiscoverableSourceAdapter,
  SourceCleanupEvidence,
  SourceCleanupTarget,
  SourceEvidence,
  SourceExpectation,
  SourceResourceSchema,
  SourceSnapshot,
} from "../types.js";
import {
  assertPrimaryKeyCleanup,
  assertRemoteEndpoint,
  mappedFilters,
  mappedSchema,
  sanitizeRemoteError,
  secretEnvironmentValue,
  snapshotRows,
  type MappedResource,
} from "../remote.js";
import { loadSupabaseAdapterConfig, type SupabaseAdapterConfig } from "./config.js";

function resourceFor(config: SupabaseAdapterConfig, name: string): MappedResource {
  const resource = Object.hasOwn(config.resources, name) ? config.resources[name] : undefined;
  if (!resource) throw new Error(`Supabase resource is not allowlisted: ${name}`);
  return resource;
}

function postgrestValue(value: string | number | boolean | null): string {
  if (value === null) return "is.null";
  return `eq.${String(value)}`;
}

function aliasRow(row: Record<string, unknown>, resource: MappedResource): Record<string, unknown> {
  return Object.fromEntries(Object.entries(resource.fields).map(([alias, field]) => [alias, row[field.target]]));
}

export class SupabaseSourceAdapter implements DiscoverableSourceAdapter {
  readonly kind = "supabase" as const;
  private readonly endpoint: URL;

  constructor(readonly config: SupabaseAdapterConfig) {
    this.endpoint = assertRemoteEndpoint(config.url, config.allowProduction, "Supabase");
  }

  private url(resource: MappedResource): URL {
    return new URL(`/rest/v1/${encodeURIComponent(resource.target)}`, this.endpoint);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const key = secretEnvironmentValue(this.config.keyEnv);
    return {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: "application/json",
      "accept-profile": this.config.schema,
      ...extra,
    };
  }

  private addFilters(url: URL, resourceName: string, resource: MappedResource, filters: SourceExpectation["filters"]): string[] {
    const mapped = mappedFilters(resourceName, resource, filters);
    for (const filter of mapped) url.searchParams.set(filter.target, postgrestValue(filter.value));
    return mapped.map((filter) => filter.field);
  }

  async discoverSchema(resource?: string): Promise<SourceResourceSchema[]> {
    const names = resource ? [resource] : Object.keys(this.config.resources).sort();
    return names.map((name) => mappedSchema("supabase", name, resourceFor(this.config, name)));
  }

  async verify(expectation: SourceExpectation): Promise<SourceEvidence> {
    if (expectation.adapter !== "supabase") throw new Error(`Unsupported source adapter: ${expectation.adapter}`);
    const startedAt = Date.now();
    const resource = resourceFor(this.config, expectation.resource);
    const url = this.url(resource);
    url.searchParams.set("select", resource.primaryKey.map((field) => resource.fields[field]?.target).filter(Boolean).join(",") || "*");
    url.searchParams.set("limit", "1");
    const fields = this.addFilters(url, expectation.resource, resource, expectation.filters);
    try {
      const response = await fetch(url, {
        headers: this.headers({ prefer: "count=exact", range: "0-0", "range-unit": "items" }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (!response.ok) throw new Error(`Supabase read returned HTTP ${response.status}.`);
      const rows = await response.json() as unknown[];
      const totalText = response.headers.get("content-range")?.split("/").at(-1);
      const parsedTotal = totalText && totalText !== "*" ? Number(totalText) : Number.NaN;
      const matchedRows = Number.isFinite(parsedTotal) ? parsedTotal : rows.length;
      const statePassed = expectation.state === "present" ? matchedRows > 0 : matchedRows === 0;
      return {
        adapter: "supabase",
        evidenceLevel: 6,
        resource: expectation.resource,
        state: expectation.state,
        matchedRows,
        ...(expectation.maxMatches === undefined ? {} : { maxMatches: expectation.maxMatches }),
        matchedFields: fields,
        queryHash: hashText(`GET ${url.pathname}?${[...url.searchParams.keys()].sort().join("&")}`),
        transaction: "read-only",
        durationMs: Date.now() - startedAt,
        passed: statePassed && (expectation.maxMatches === undefined || matchedRows <= expectation.maxMatches),
      };
    } catch (error) {
      throw sanitizeRemoteError(error, expectation.filters.map((filter) => "value" in filter ? filter.value : process.env[filter.env]));
    }
  }

  async snapshot(resourceName: string, limit = 1_000): Promise<SourceSnapshot> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error("Supabase snapshot limit must be between 1 and 10000 rows.");
    const resource = resourceFor(this.config, resourceName);
    const schema = mappedSchema("supabase", resourceName, resource);
    const url = this.url(resource);
    url.searchParams.set("select", Object.values(resource.fields).map((field) => field.target).join(","));
    url.searchParams.set("limit", String(limit + 1));
    const order = resource.primaryKey.map((key) => resource.fields[key]?.target).filter((target): target is string => Boolean(target)).map((target) => `${target}.asc`).join(",");
    if (order) url.searchParams.set("order", order);
    try {
      const response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(this.config.timeoutMs) });
      if (!response.ok) throw new Error(`Supabase snapshot returned HTTP ${response.status}.`);
      const rows = await response.json() as Array<Record<string, unknown>>;
      return {
        adapter: "supabase",
        resource: resourceName,
        schemaHash: schema.schemaHash,
        rows: snapshotRows(rows.slice(0, limit).map((row) => aliasRow(row, resource)), resource),
        truncated: rows.length > limit,
      };
    } catch (error) {
      throw sanitizeRemoteError(error);
    }
  }

  async cleanup(target: SourceCleanupTarget, confirmation: { confirmed: boolean }): Promise<SourceCleanupEvidence> {
    if (target.adapter !== "supabase") throw new Error(`Unsupported cleanup adapter: ${target.adapter}`);
    if (!confirmation.confirmed) throw new Error("Supabase cleanup requires explicit confirmation.");
    if (!this.config.allowCleanup) throw new Error("Supabase cleanup is disabled by adapter config.");
    const startedAt = Date.now();
    const resource = resourceFor(this.config, target.resource);
    const mapped = mappedFilters(target.resource, resource, target.filters);
    assertPrimaryKeyCleanup(target.resource, resource, mapped.map((filter) => filter.field));
    const url = this.url(resource);
    for (const filter of mapped) url.searchParams.set(filter.target, postgrestValue(filter.value));
    try {
      const response = await fetch(url, {
        method: "DELETE",
        headers: this.headers({ prefer: "return=representation" }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (!response.ok) throw new Error(`Supabase cleanup returned HTTP ${response.status}.`);
      const rows = await response.json() as unknown[];
      if (rows.length > resource.cleanupMaxRows) throw new Error(`Supabase cleanup matched ${rows.length} rows; configured maximum is ${resource.cleanupMaxRows}.`);
      return { adapter: "supabase", resource: target.resource, deletedRows: rows.length, transaction: "read-write", durationMs: Date.now() - startedAt };
    } catch (error) {
      throw sanitizeRemoteError(error, mapped.map((filter) => filter.value));
    }
  }

  async close(): Promise<void> {}
}

export async function createSupabaseAdapterFromFile(file: string): Promise<SupabaseSourceAdapter> {
  return new SupabaseSourceAdapter(await loadSupabaseAdapterConfig(file));
}
