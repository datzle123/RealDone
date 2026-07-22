import type { Pool, PoolClient, PoolConfig } from "pg";
import { hashText, redactText } from "../../core/redact.js";
import type {
  DiscoverableSourceAdapter,
  SourceCleanupEvidence,
  SourceCleanupTarget,
  SourceEvidence,
  SourceExpectation,
  SourceFilter,
  SourceResourceSchema,
  SourceScalar,
  SourceSnapshot,
} from "../types.js";
import { snapshotRows } from "../remote.js";
import {
  assertSafeIdentifier,
  loadPostgresAdapterConfig,
  type PostgresAdapterConfig,
  type PostgresResourceConfig,
} from "./config.js";

export interface CompiledPostgresTarget {
  text: string;
  values: SourceScalar[];
  fields: string[];
  resource: PostgresResourceConfig;
}

function quoteIdentifier(value: string): string {
  return `"${assertSafeIdentifier(value)}"`;
}

function sourceValue(filter: SourceFilter, environment: NodeJS.ProcessEnv): SourceScalar {
  if ("value" in filter) return filter.value;
  const value = environment[filter.env];
  if (value === undefined) throw new Error(`Missing source value environment variable: ${filter.env}`);
  return value;
}

export function compilePostgresTarget(
  config: PostgresAdapterConfig,
  resourceName: string,
  filters: SourceFilter[],
  environment: NodeJS.ProcessEnv = process.env,
): CompiledPostgresTarget {
  const resource = Object.hasOwn(config.resources, resourceName)
    ? config.resources[resourceName]
    : undefined;
  if (!resource) throw new Error(`PostgreSQL resource is not allowlisted: ${resourceName}`);
  if (filters.length === 0) throw new Error("PostgreSQL source checks require at least one filter.");
  const seen = new Set<string>();
  const values: SourceScalar[] = [];
  const predicates = filters.map((filter, index) => {
    if (seen.has(filter.field)) throw new Error(`Duplicate PostgreSQL filter field: ${filter.field}`);
    seen.add(filter.field);
    const column = Object.hasOwn(resource.columns, filter.field)
      ? resource.columns[filter.field]
      : undefined;
    if (!column) throw new Error(`PostgreSQL field is not allowlisted for ${resourceName}: ${filter.field}`);
    values.push(sourceValue(filter, environment));
    return `${quoteIdentifier(column)} IS NOT DISTINCT FROM $${index + 1}`;
  });
  const relation = `${quoteIdentifier(resource.schema)}.${quoteIdentifier(resource.table)}`;
  return {
    text: `${relation} WHERE ${predicates.join(" AND ")}`,
    values,
    fields: [...seen],
    resource,
  };
}

function redactDatabaseError(
  error: unknown,
  connectionString?: string,
  sensitiveValues: SourceScalar[] = [],
): Error {
  let message = error instanceof Error ? error.message : String(error);
  if (connectionString) message = message.replaceAll(connectionString, "[REDACTED_DATABASE_URL]");
  for (const value of sensitiveValues) {
    if (value === null) continue;
    const raw = String(value);
    if (raw) message = message.replaceAll(raw, "[REDACTED_SOURCE_VALUE]");
  }
  return new Error(redactText(message));
}

function tlsConfig(config: PostgresAdapterConfig): PoolConfig["ssl"] {
  if (config.tls.mode === "disable") return false;
  if (config.tls.mode === "require") return { rejectUnauthorized: false };
  const ca = config.tls.caEnv ? process.env[config.tls.caEnv] : undefined;
  if (config.tls.caEnv && !ca) throw new Error(`Missing PostgreSQL CA environment variable: ${config.tls.caEnv}`);
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

function validateConnectionString(value: string, config: PostgresAdapterConfig): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Environment variable ${config.connectionEnv} must contain a PostgreSQL URL.`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`Environment variable ${config.connectionEnv} must use postgres:// or postgresql://.`);
  }
  const conflicting = ["sslcert", "sslkey", "sslrootcert", "sslmode"].filter((key) => url.searchParams.has(key));
  if (conflicting.length > 0) {
    throw new Error(`TLS options must be declared in the adapter config, not the database URL: ${conflicting.join(", ")}`);
  }
}

export class PostgresSourceAdapter implements DiscoverableSourceAdapter {
  readonly kind = "postgresql" as const;
  private pool: Pool | undefined;
  private connectionString: string | undefined;

  constructor(readonly config: PostgresAdapterConfig) {}

  private async getPool(): Promise<Pool> {
    if (this.pool) return this.pool;
    const connectionString = process.env[this.config.connectionEnv];
    if (!connectionString) throw new Error(`Missing PostgreSQL connection environment variable: ${this.config.connectionEnv}`);
    validateConnectionString(connectionString, this.config);
    this.connectionString = connectionString;
    let module: typeof import("pg");
    try {
      module = await import("pg");
    } catch {
      throw new Error("The optional pg dependency is required for the PostgreSQL adapter. Install realdone with optional dependencies enabled.");
    }
    this.pool = new module.Pool({
      connectionString,
      ssl: tlsConfig(this.config),
      application_name: "realdone",
      max: 1,
      connectionTimeoutMillis: this.config.connectionTimeoutMs,
      idleTimeoutMillis: 1_000,
    });
    this.pool.on("error", () => undefined);
    return this.pool;
  }

  private async transaction<T>(
    readOnly: boolean,
    sensitiveValues: SourceScalar[],
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const pool = await this.getPool();
    const client = await pool.connect().catch((error: unknown) => {
      throw redactDatabaseError(error, this.connectionString, sensitiveValues);
    });
    try {
      await client.query(readOnly ? "BEGIN TRANSACTION READ ONLY" : "BEGIN");
      await client.query("SELECT set_config('statement_timeout', $1, true)", [`${this.config.statementTimeoutMs}ms`]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw redactDatabaseError(error, this.connectionString, sensitiveValues);
    } finally {
      client.release();
    }
  }

  async verify(expectation: SourceExpectation): Promise<SourceEvidence> {
    if (expectation.adapter !== "postgresql") throw new Error(`Unsupported source adapter: ${expectation.adapter}`);
    const startedAt = Date.now();
    const query = compilePostgresTarget(this.config, expectation.resource, expectation.filters);
    const result = await this.transaction(true, query.values, async (client) =>
      client.query<{ count: string }>({
        text: `SELECT COUNT(*)::text AS count FROM ${query.text}`,
        values: query.values,
      }),
    );
    const matchedRows = Number.parseInt(result.rows[0]?.count ?? "0", 10);
    const statePassed = expectation.state === "present" ? matchedRows > 0 : matchedRows === 0;
    const passed = statePassed && (expectation.maxMatches === undefined || matchedRows <= expectation.maxMatches);
    return {
      adapter: "postgresql",
      evidenceLevel: 6,
      resource: expectation.resource,
      state: expectation.state,
      matchedRows,
      ...(expectation.maxMatches === undefined ? {} : { maxMatches: expectation.maxMatches }),
      matchedFields: query.fields,
      queryHash: hashText(`SELECT COUNT(*) FROM ${query.text}`),
      transaction: "read-only",
      durationMs: Date.now() - startedAt,
      passed,
    };
  }

  private resource(name: string): PostgresResourceConfig {
    const resource = Object.hasOwn(this.config.resources, name) ? this.config.resources[name] : undefined;
    if (!resource) throw new Error(`PostgreSQL resource is not allowlisted: ${name}`);
    return resource;
  }

  async discoverSchema(resourceName?: string): Promise<SourceResourceSchema[]> {
    const names = resourceName ? [resourceName] : Object.keys(this.config.resources).sort();
    return this.transaction(true, [], async (client) => Promise.all(names.map(async (name) => {
      const resource = this.resource(name);
      const columns = await client.query<{ column_name: string; data_type: string; is_nullable: "YES" | "NO" }>({
        text: `SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position`,
        values: [resource.schema, resource.table],
      });
      if (columns.rows.length === 0) throw new Error(`PostgreSQL resource table does not exist: ${name}`);
      const primaryKeys = await client.query<{ column_name: string }>({
        text: `SELECT attribute.attname AS column_name
          FROM pg_catalog.pg_index AS index
          JOIN pg_catalog.pg_class AS relation ON relation.oid = index.indrelid
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          JOIN pg_catalog.pg_attribute AS attribute
            ON attribute.attrelid = relation.oid AND attribute.attnum = ANY(index.indkey)
          WHERE index.indisprimary AND namespace.nspname = $1 AND relation.relname = $2
          ORDER BY array_position(index.indkey, attribute.attnum)`,
        values: [resource.schema, resource.table],
      });
      const byTarget = new Map(Object.entries(resource.columns).map(([alias, target]) => [target, alias]));
      const columnByName = new Map(columns.rows.map((column) => [column.column_name, column]));
      const fields = Object.entries(resource.columns).map(([name, target]) => {
        const column = columnByName.get(target);
        if (!column) throw new Error(`PostgreSQL mapped column does not exist for ${name}: ${target}`);
        return { name, type: column.data_type, nullable: column.is_nullable === "YES" };
      });
      const primaryKey = primaryKeys.rows.flatMap((column) => {
        const alias = byTarget.get(column.column_name);
        return alias ? [alias] : [];
      });
      const softDeletePattern = /^(?:deleted|removed|archived)(?:_?(?:at|on))?$/i;
      const softDeleteFields = Object.entries(resource.columns)
        .filter(([alias, target]) => softDeletePattern.test(alias) || softDeletePattern.test(target))
        .map(([alias]) => alias);
      return {
        adapter: "postgresql" as const,
        resource: name,
        fields,
        primaryKey,
        softDeleteFields,
        schemaHash: hashText(JSON.stringify({ adapter: "postgresql", resource: name, fields, primaryKey, softDeleteFields })),
      };
    })));
  }

  async snapshot(resourceName: string, limit = 1_000): Promise<SourceSnapshot> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error("PostgreSQL snapshot limit must be between 1 and 10000 rows.");
    const resource = this.resource(resourceName);
    const schema = (await this.discoverSchema(resourceName))[0];
    if (!schema) throw new Error(`PostgreSQL resource table does not exist: ${resourceName}`);
    const aliases = Object.keys(resource.columns);
    const selection = Object.entries(resource.columns)
      .map(([alias, column]) => `${quoteIdentifier(column)} AS ${quoteIdentifier(alias)}`)
      .join(", ");
    const relation = `${quoteIdentifier(resource.schema)}.${quoteIdentifier(resource.table)}`;
    const order = schema.primaryKey.length > 0
      ? ` ORDER BY ${schema.primaryKey.map((field) => quoteIdentifier(field)).join(", ")}`
      : "";
    const rows = await this.transaction(true, [], async (client) => client.query<Record<string, unknown>>({
      text: `SELECT ${selection} FROM ${relation}${order} LIMIT $1`,
      values: [limit + 1],
    }));
    const mapping = {
      target: resource.table,
      fields: Object.fromEntries(aliases.map((name) => [name, { target: name }])),
      primaryKey: schema.primaryKey,
      softDeleteFields: schema.softDeleteFields,
      cleanupMaxRows: resource.cleanupMaxRows,
    };
    return {
      adapter: "postgresql",
      resource: resourceName,
      schemaHash: schema.schemaHash,
      rows: snapshotRows(rows.rows.slice(0, limit), mapping),
      truncated: rows.rows.length > limit,
    };
  }

  async cleanup(
    target: SourceCleanupTarget,
    confirmation: { confirmed: boolean },
  ): Promise<SourceCleanupEvidence> {
    if (target.adapter !== "postgresql") throw new Error(`Unsupported cleanup adapter: ${target.adapter}`);
    if (!confirmation.confirmed) throw new Error("PostgreSQL cleanup requires explicit confirmation.");
    if (!this.config.allowCleanup) throw new Error("PostgreSQL cleanup is disabled by adapter config.");
    const startedAt = Date.now();
    const query = compilePostgresTarget(this.config, target.resource, target.filters);
    const cleanupKey = query.resource.cleanupKey;
    if (!cleanupKey) throw new Error(`PostgreSQL cleanup is not allowlisted for resource: ${target.resource}`);
    const fields = new Set(query.fields);
    if (cleanupKey.some((field) => !fields.has(field))) {
      throw new Error(`PostgreSQL cleanup for ${target.resource} requires key fields: ${cleanupKey.join(", ")}`);
    }
    if (query.fields.some((field) => !cleanupKey.includes(field))) {
      throw new Error(`PostgreSQL cleanup for ${target.resource} only allows key fields: ${cleanupKey.join(", ")}`);
    }
    const result = await this.transaction(false, query.values, async (client) => {
      const deleted = await client.query({ text: `DELETE FROM ${query.text} RETURNING 1`, values: query.values });
      if ((deleted.rowCount ?? 0) > query.resource.cleanupMaxRows) {
        throw new Error(
          `PostgreSQL cleanup matched ${deleted.rowCount ?? 0} rows; configured maximum is ${query.resource.cleanupMaxRows}. Transaction rolled back.`,
        );
      }
      return deleted;
    });
    return {
      adapter: "postgresql",
      resource: target.resource,
      deletedRows: result.rowCount ?? 0,
      transaction: "read-write",
      durationMs: Date.now() - startedAt,
    };
  }

  async close(): Promise<void> {
    const pool = this.pool;
    this.pool = undefined;
    this.connectionString = undefined;
    if (pool) await pool.end();
  }
}

export async function createPostgresAdapterFromFile(file: string): Promise<PostgresSourceAdapter> {
  return new PostgresSourceAdapter(await loadPostgresAdapterConfig(file));
}
