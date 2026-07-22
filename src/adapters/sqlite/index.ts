import { access } from "node:fs/promises";
import path from "node:path";
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

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const softDeletePattern = /^(?:deleted|deleted_at|is_deleted|archived|archived_at|removed|removed_at)$/i;

interface SqliteColumn {
  name: string;
  type: string;
  notnull: 0 | 1;
  pk: number;
}

interface CountRow {
  count: number;
}

export interface SqliteAdapterOptions {
  allowCleanup?: boolean;
  busyTimeoutMs?: number;
  cleanupMaxRows?: number;
}

export interface CompiledSqliteTarget {
  where: string;
  values: SourceScalar[];
  fields: string[];
}

type SqliteDatabase = import("better-sqlite3").Database;
type SqliteConstructor = typeof import("better-sqlite3");

function quoteIdentifier(value: string): string {
  if (!identifierPattern.test(value)) throw new Error(`Unsafe SQLite identifier: ${value}`);
  return `"${value}"`;
}

function sourceValue(filter: SourceFilter, environment: NodeJS.ProcessEnv): SourceScalar {
  if ("value" in filter) return filter.value;
  const value = environment[filter.env];
  if (value === undefined) throw new Error(`Missing source value environment variable: ${filter.env}`);
  return value;
}

export function compileSqliteTarget(
  filters: SourceFilter[],
  allowedFields: Set<string>,
  environment: NodeJS.ProcessEnv = process.env,
): CompiledSqliteTarget {
  if (filters.length === 0) throw new Error("SQLite source checks require at least one filter.");
  const seen = new Set<string>();
  const values: SourceScalar[] = [];
  const predicates = filters.map((filter) => {
    if (seen.has(filter.field)) throw new Error(`Duplicate SQLite filter field: ${filter.field}`);
    if (!allowedFields.has(filter.field)) throw new Error(`SQLite field does not exist: ${filter.field}`);
    seen.add(filter.field);
    values.push(sourceValue(filter, environment));
    return `${quoteIdentifier(filter.field)} IS ?`;
  });
  return { where: predicates.join(" AND "), values, fields: [...seen] };
}

function stableValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return { blobHash: hashText(Buffer.from(value).toString("base64")) };
  if (typeof value === "bigint") return value.toString();
  return value;
}

function stableRow(row: Record<string, unknown>, fields?: string[]): string {
  const keys = fields ?? Object.keys(row).sort();
  return JSON.stringify(keys.map((key) => [key, stableValue(row[key])]));
}

function isSoftDeleted(row: Record<string, unknown>, fields: string[]): boolean {
  return fields.some((field) => {
    const value = row[field];
    return value !== null && value !== undefined && value !== false && value !== 0 && value !== "0" && value !== "";
  });
}

async function loadSqlite(): Promise<SqliteConstructor> {
  try {
    const module = await import("better-sqlite3");
    return module.default;
  } catch {
    throw new Error("The optional better-sqlite3 dependency is required for SQLite verification. Install RealDone with optional dependencies enabled.");
  }
}

export class SqliteSourceAdapter implements DiscoverableSourceAdapter {
  readonly kind = "sqlite" as const;
  readonly file: string;
  readonly options: Required<SqliteAdapterOptions>;
  private database: SqliteDatabase | undefined;

  constructor(file: string, options: SqliteAdapterOptions = {}) {
    this.file = path.resolve(file);
    this.options = {
      allowCleanup: options.allowCleanup ?? false,
      busyTimeoutMs: options.busyTimeoutMs ?? 5_000,
      cleanupMaxRows: options.cleanupMaxRows ?? 1,
    };
    if (this.options.busyTimeoutMs < 1 || this.options.busyTimeoutMs > 60_000) throw new Error("SQLite busy timeout must be between 1 and 60000ms.");
    if (this.options.cleanupMaxRows < 1 || this.options.cleanupMaxRows > 100) throw new Error("SQLite cleanup maximum must be between 1 and 100 rows.");
  }

  private async getDatabase(): Promise<SqliteDatabase> {
    if (this.database) return this.database;
    await access(this.file).catch(() => { throw new Error("SQLite database file does not exist or is not readable."); });
    const Database = await loadSqlite();
    try {
      this.database = new Database(this.file, {
        readonly: true,
        fileMustExist: true,
        timeout: this.options.busyTimeoutMs,
      });
      this.database.pragma("query_only = ON");
      this.database.pragma("trusted_schema = OFF");
      return this.database;
    } catch (error) {
      throw new Error(redactText(`Unable to open SQLite database: ${error instanceof Error ? error.message.replaceAll(this.file, "[REDACTED_SQLITE_PATH]") : String(error)}`));
    }
  }

  private async columns(resource: string): Promise<SqliteColumn[]> {
    const database = await this.getDatabase();
    const table = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ? AND name NOT LIKE 'sqlite_%'").get(resource);
    if (!table) throw new Error(`SQLite resource does not exist: ${resource}`);
    return database.prepare(`PRAGMA table_info(${quoteIdentifier(resource)})`).all() as SqliteColumn[];
  }

  async discoverSchema(resource?: string): Promise<SourceResourceSchema[]> {
    const database = await this.getDatabase();
    const names = resource
      ? [resource]
      : (database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
    const schemas: SourceResourceSchema[] = [];
    for (const name of names) {
      const columns = await this.columns(name);
      const fields = columns.map((column) => ({ name: column.name, type: column.type || "ANY", nullable: column.notnull === 0 && column.pk === 0 }));
      const primaryKey = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
      const softDeleteFields = columns.map((column) => column.name).filter((field) => softDeletePattern.test(field));
      schemas.push({
        adapter: "sqlite",
        resource: name,
        fields,
        primaryKey,
        softDeleteFields,
        schemaHash: hashText(JSON.stringify({ name, fields, primaryKey, softDeleteFields })),
      });
    }
    return schemas;
  }

  async verify(expectation: SourceExpectation): Promise<SourceEvidence> {
    if (expectation.adapter !== "sqlite") throw new Error(`Unsupported source adapter: ${expectation.adapter}`);
    const startedAt = Date.now();
    const schema = (await this.discoverSchema(expectation.resource))[0];
    if (!schema) throw new Error(`SQLite resource does not exist: ${expectation.resource}`);
    const target = compileSqliteTarget(expectation.filters, new Set(schema.fields.map((field) => field.name)));
    const database = await this.getDatabase();
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(expectation.resource)} WHERE ${target.where}`).get(...target.values) as CountRow | undefined;
    const matchedRows = Number(row?.count ?? 0);
    const statePassed = expectation.state === "present" ? matchedRows > 0 : matchedRows === 0;
    return {
      adapter: "sqlite",
      evidenceLevel: 6,
      resource: expectation.resource,
      state: expectation.state,
      matchedRows,
      ...(expectation.maxMatches === undefined ? {} : { maxMatches: expectation.maxMatches }),
      matchedFields: target.fields,
      queryHash: hashText(`SELECT COUNT(*) FROM ${quoteIdentifier(expectation.resource)} WHERE ${target.where}`),
      transaction: "read-only",
      durationMs: Date.now() - startedAt,
      passed: statePassed && (expectation.maxMatches === undefined || matchedRows <= expectation.maxMatches),
    };
  }

  async snapshot(resource: string, limit = 1_000): Promise<SourceSnapshot> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error("SQLite snapshot limit must be between 1 and 10000 rows.");
    const schema = (await this.discoverSchema(resource))[0];
    if (!schema) throw new Error(`SQLite resource does not exist: ${resource}`);
    const database = await this.getDatabase();
    const order = schema.primaryKey.length > 0 ? ` ORDER BY ${schema.primaryKey.map(quoteIdentifier).join(", ")}` : "";
    const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(resource)}${order} LIMIT ?`).all(limit + 1) as Array<Record<string, unknown>>;
    return {
      adapter: "sqlite",
      resource,
      schemaHash: schema.schemaHash,
      rows: rows.slice(0, limit).map((row) => ({
        keyHash: hashText(stableRow(row, schema.primaryKey.length > 0 ? schema.primaryKey : undefined)),
        rowHash: hashText(stableRow(row)),
        softDeleted: isSoftDeleted(row, schema.softDeleteFields),
      })),
      truncated: rows.length > limit,
    };
  }

  async cleanup(target: SourceCleanupTarget, confirmation: { confirmed: boolean }): Promise<SourceCleanupEvidence> {
    if (target.adapter !== "sqlite") throw new Error(`Unsupported cleanup adapter: ${target.adapter}`);
    if (!confirmation.confirmed) throw new Error("SQLite cleanup requires explicit confirmation.");
    if (!this.options.allowCleanup) throw new Error("SQLite cleanup is disabled by default.");
    const startedAt = Date.now();
    const schema = (await this.discoverSchema(target.resource))[0];
    if (!schema) throw new Error(`SQLite resource does not exist: ${target.resource}`);
    if (schema.primaryKey.length === 0) throw new Error(`SQLite cleanup requires a primary key: ${target.resource}`);
    const targetFields = target.filters.map((filter) => filter.field).sort();
    if (targetFields.join("\0") !== [...schema.primaryKey].sort().join("\0")) {
      throw new Error(`SQLite cleanup for ${target.resource} requires exactly the primary-key fields: ${schema.primaryKey.join(", ")}`);
    }
    const compiled = compileSqliteTarget(target.filters, new Set(schema.fields.map((field) => field.name)));
    const Database = await loadSqlite();
    const writable = new Database(this.file, { fileMustExist: true, timeout: this.options.busyTimeoutMs });
    try {
      writable.pragma("foreign_keys = ON");
      writable.pragma("trusted_schema = OFF");
      const remove = writable.transaction(() => {
        const count = writable.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(target.resource)} WHERE ${compiled.where}`).get(...compiled.values) as CountRow;
        if (count.count > this.options.cleanupMaxRows) {
          throw new Error(`SQLite cleanup matched ${count.count} rows; configured maximum is ${this.options.cleanupMaxRows}.`);
        }
        return writable.prepare(`DELETE FROM ${quoteIdentifier(target.resource)} WHERE ${compiled.where}`).run(...compiled.values).changes;
      });
      const deletedRows = remove();
      return { adapter: "sqlite", resource: target.resource, deletedRows, transaction: "read-write", durationMs: Date.now() - startedAt };
    } finally {
      writable.close();
    }
  }

  async close(): Promise<void> {
    this.database?.close();
    this.database = undefined;
  }
}
