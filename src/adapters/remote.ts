import { hashText, redactEnvironmentText, redactText } from "../core/redact.js";
import type { SourceFilter, SourceResourceSchema, SourceRowSnapshot, SourceScalar } from "./types.js";

export interface MappedField {
  target: string;
  type?: string | undefined;
  nullable?: boolean | undefined;
}

export interface MappedResource {
  target: string;
  fields: Record<string, MappedField>;
  primaryKey: string[];
  softDeleteFields: string[];
  cleanupMaxRows: number;
}

export function isLocalProviderHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".test") || hostname.endsWith(".local");
}

export function assertRemoteEndpoint(value: string, allowProduction: boolean, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} endpoint must be a valid URL.`);
  }
  if (url.username || url.password) throw new Error(`${label} credentials must use environment variables, not the endpoint URL.`);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalProviderHost(url.hostname))) {
    throw new Error(`${label} endpoint must use HTTPS outside localhost/test environments.`);
  }
  if (!allowProduction && !isLocalProviderHost(url.hostname)) {
    throw new Error(`${label} production access is blocked by default. Set allowProduction only for an explicit test/sandbox project.`);
  }
  return url;
}

export function sourceValue(filter: SourceFilter, environment: NodeJS.ProcessEnv = process.env): SourceScalar {
  if ("value" in filter) return filter.value;
  const value = environment[filter.env];
  if (value === undefined) throw new Error(`Missing source value environment variable: ${filter.env}`);
  return value;
}

export function mappedFilters(
  resourceName: string,
  resource: MappedResource,
  filters: SourceFilter[],
  environment: NodeJS.ProcessEnv = process.env,
): Array<{ field: string; target: string; value: SourceScalar }> {
  if (filters.length === 0) throw new Error(`${resourceName} source checks require at least one filter.`);
  const seen = new Set<string>();
  return filters.map((filter) => {
    if (seen.has(filter.field)) throw new Error(`Duplicate source filter field: ${filter.field}`);
    seen.add(filter.field);
    const field = Object.hasOwn(resource.fields, filter.field) ? resource.fields[filter.field] : undefined;
    if (!field) throw new Error(`Source field is not allowlisted for ${resourceName}: ${filter.field}`);
    return { field: filter.field, target: field.target, value: sourceValue(filter, environment) };
  });
}

export function mappedSchema(adapter: SourceResourceSchema["adapter"], resourceName: string, resource: MappedResource): SourceResourceSchema {
  const fields = Object.entries(resource.fields).map(([name, field]) => ({ name, type: field.type ?? "unknown", nullable: field.nullable ?? true }));
  return {
    adapter,
    resource: resourceName,
    fields,
    primaryKey: resource.primaryKey,
    softDeleteFields: resource.softDeleteFields,
    schemaHash: hashText(JSON.stringify({ adapter, resourceName, fields, primaryKey: resource.primaryKey, softDeleteFields: resource.softDeleteFields })),
  };
}

function stableValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return { blobHash: hashText(Buffer.from(value).toString("base64")) };
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value === "object" && "toHexString" in value && typeof value.toHexString === "function") {
    return String(value.toHexString());
  }
  return value;
}

function stableRow(row: Record<string, unknown>, fields?: string[]): string {
  const keys = fields ?? Object.keys(row).sort();
  return JSON.stringify(keys.map((key) => [key, stableValue(row[key])]));
}

export function snapshotRows(rows: Array<Record<string, unknown>>, resource: MappedResource): SourceRowSnapshot[] {
  return rows.map((row) => ({
    keyHash: hashText(stableRow(row, resource.primaryKey.length > 0 ? resource.primaryKey : undefined)),
    rowHash: hashText(stableRow(row)),
    softDeleted: resource.softDeleteFields.some((field) => {
      const value = row[field];
      return value !== null && value !== undefined && value !== false && value !== 0 && value !== "0" && value !== "";
    }),
  }));
}

export function assertPrimaryKeyCleanup(resourceName: string, resource: MappedResource, fields: string[]): void {
  const actual = [...fields].sort();
  const expected = [...resource.primaryKey].sort();
  if (expected.length === 0 || actual.join("\0") !== expected.join("\0")) {
    throw new Error(`${resourceName} cleanup requires exactly the primary-key fields: ${resource.primaryKey.join(", ") || "[not configured]"}`);
  }
}

export function secretEnvironmentValue(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function sanitizeRemoteError(error: unknown, sensitive: unknown[] = []): Error {
  let message = redactEnvironmentText(error instanceof Error ? error.message : String(error), process.env);
  for (const value of sensitive) {
    if (value === null || value === undefined) continue;
    const raw = String(value);
    if (raw) message = message.replaceAll(raw, "[REDACTED_SOURCE_VALUE]");
  }
  return new Error(redactText(message));
}
