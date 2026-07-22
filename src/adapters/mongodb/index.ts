import { hashText } from "../../core/redact.js";
import type {
  DiscoverableSourceAdapter,
  SourceCleanupEvidence,
  SourceCleanupTarget,
  SourceEvidence,
  SourceExpectation,
  SourceResourceSchema,
  SourceScalar,
  SourceSnapshot,
} from "../types.js";
import {
  assertPrimaryKeyCleanup,
  isLocalProviderHost,
  mappedFilters,
  mappedSchema,
  sanitizeRemoteError,
  secretEnvironmentValue,
  snapshotRows,
  type MappedResource,
} from "../remote.js";
import { loadMongoAdapterConfig, type MongoAdapterConfig } from "./config.js";

type MongoModule = typeof import("mongodb");
type MongoClient = import("mongodb").MongoClient;
type MongoFilter = Record<string, unknown>;

function resourceFor(config: MongoAdapterConfig, name: string): MappedResource {
  const resource = Object.hasOwn(config.resources, name) ? config.resources[name] : undefined;
  if (!resource) throw new Error(`MongoDB resource is not allowlisted: ${name}`);
  return resource;
}

function nestedValue(row: Record<string, unknown>, field: string): unknown {
  return field.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, row);
}

async function loadMongo(): Promise<MongoModule> {
  try {
    return await import("mongodb");
  } catch {
    throw new Error("The optional mongodb dependency is required for MongoDB verification. Install RealDone with optional dependencies enabled.");
  }
}

export class MongoSourceAdapter implements DiscoverableSourceAdapter {
  readonly kind = "mongodb" as const;
  private client: MongoClient | undefined;
  private module: MongoModule | undefined;

  constructor(readonly config: MongoAdapterConfig, client?: MongoClient) {
    this.client = client;
  }

  private connection(): { uri: string; local: boolean } {
    const uri = secretEnvironmentValue(this.config.connectionEnv);
    let parsed: URL;
    try { parsed = new URL(uri); } catch { throw new Error(`${this.config.connectionEnv} must contain a MongoDB URL.`); }
    if (parsed.protocol !== "mongodb:" && parsed.protocol !== "mongodb+srv:") throw new Error(`${this.config.connectionEnv} must use mongodb:// or mongodb+srv://.`);
    const conflicting = ["tls", "ssl", "tlsCAFile", "tlsCertificateKeyFile"].filter((key) => parsed.searchParams.has(key));
    if (conflicting.length > 0) throw new Error(`MongoDB TLS options must be declared in adapter config: ${conflicting.join(", ")}`);
    const local = isLocalProviderHost(parsed.hostname);
    if (!this.config.allowProduction && !local) throw new Error("MongoDB production access is blocked by default. Use an explicit test deployment and allowProduction.");
    if (this.config.tls.mode === "allow-local" && !local) throw new Error("MongoDB TLS can only be disabled for a local test deployment.");
    return { uri, local };
  }

  private async getClient(): Promise<MongoClient> {
    if (this.client) return this.client;
    const module = await loadMongo();
    const { uri } = this.connection();
    const caFile = this.config.tls.caFileEnv ? secretEnvironmentValue(this.config.tls.caFileEnv) : undefined;
    this.client = new module.MongoClient(uri, {
      appName: "realdone",
      maxPoolSize: 1,
      retryWrites: false,
      serverSelectionTimeoutMS: this.config.timeoutMs,
      connectTimeoutMS: this.config.timeoutMs,
      tls: this.config.tls.mode === "require",
      ...(caFile ? { tlsCAFile: caFile } : {}),
    });
    this.module = module;
    await this.client.connect();
    return this.client;
  }

  private async filter(resourceName: string, resource: MappedResource, filters: SourceExpectation["filters"]): Promise<{ query: MongoFilter; fields: string[]; values: SourceScalar[] }> {
    const mapped = mappedFilters(resourceName, resource, filters);
    const module = this.module ?? await loadMongo();
    const query: MongoFilter = {};
    for (const item of mapped) {
      const type = resource.fields[item.field]?.type;
      query[item.target] = type === "objectId" && typeof item.value === "string" ? new module.ObjectId(item.value) : item.value;
    }
    return { query, fields: mapped.map((item) => item.field), values: mapped.map((item) => item.value) };
  }

  async discoverSchema(resource?: string): Promise<SourceResourceSchema[]> {
    const names = resource ? [resource] : Object.keys(this.config.resources).sort();
    return names.map((name) => mappedSchema("mongodb", name, resourceFor(this.config, name)));
  }

  async verify(expectation: SourceExpectation): Promise<SourceEvidence> {
    if (expectation.adapter !== "mongodb") throw new Error(`Unsupported source adapter: ${expectation.adapter}`);
    const startedAt = Date.now();
    const resource = resourceFor(this.config, expectation.resource);
    const compiled = await this.filter(expectation.resource, resource, expectation.filters);
    try {
      const client = await this.getClient();
      const matchedRows = await client.db(this.config.database).collection(resource.target).countDocuments(compiled.query, { maxTimeMS: this.config.timeoutMs });
      const statePassed = expectation.state === "present" ? matchedRows > 0 : matchedRows === 0;
      return {
        adapter: "mongodb",
        evidenceLevel: 6,
        resource: expectation.resource,
        state: expectation.state,
        matchedRows,
        ...(expectation.maxMatches === undefined ? {} : { maxMatches: expectation.maxMatches }),
        matchedFields: compiled.fields,
        queryHash: hashText(`count:${resource.target}:${compiled.fields.sort().join(",")}`),
        transaction: "read-only",
        durationMs: Date.now() - startedAt,
        passed: statePassed && (expectation.maxMatches === undefined || matchedRows <= expectation.maxMatches),
      };
    } catch (error) {
      throw sanitizeRemoteError(error, compiled.values);
    }
  }

  async snapshot(resourceName: string, limit = 1_000): Promise<SourceSnapshot> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error("MongoDB snapshot limit must be between 1 and 10000 rows.");
    const resource = resourceFor(this.config, resourceName);
    const schema = mappedSchema("mongodb", resourceName, resource);
    try {
      const client = await this.getClient();
      const projection = Object.fromEntries(Object.values(resource.fields).map((field) => [field.target, 1]));
      const sort = resource.primaryKey.map((key) => [resource.fields[key]?.target ?? key, 1] as const);
      const rows = await client.db(this.config.database).collection(resource.target).find({}, { projection, maxTimeMS: this.config.timeoutMs }).sort(sort).limit(limit + 1).toArray();
      const aliased = rows.slice(0, limit).map((row) => Object.fromEntries(Object.entries(resource.fields).map(([alias, field]) => [alias, nestedValue(row, field.target)])));
      return { adapter: "mongodb", resource: resourceName, schemaHash: schema.schemaHash, rows: snapshotRows(aliased, resource), truncated: rows.length > limit };
    } catch (error) {
      throw sanitizeRemoteError(error);
    }
  }

  async cleanup(target: SourceCleanupTarget, confirmation: { confirmed: boolean }): Promise<SourceCleanupEvidence> {
    if (target.adapter !== "mongodb") throw new Error(`Unsupported cleanup adapter: ${target.adapter}`);
    if (!confirmation.confirmed) throw new Error("MongoDB cleanup requires explicit confirmation.");
    if (!this.config.allowCleanup) throw new Error("MongoDB cleanup is disabled by adapter config.");
    const startedAt = Date.now();
    const resource = resourceFor(this.config, target.resource);
    const compiled = await this.filter(target.resource, resource, target.filters);
    assertPrimaryKeyCleanup(target.resource, resource, compiled.fields);
    try {
      const client = await this.getClient();
      const collection = client.db(this.config.database).collection(resource.target);
      const matched = await collection.countDocuments(compiled.query, { maxTimeMS: this.config.timeoutMs });
      if (matched > resource.cleanupMaxRows) throw new Error(`MongoDB cleanup matched ${matched} rows; configured maximum is ${resource.cleanupMaxRows}.`);
      const deleted = await collection.deleteMany(compiled.query);
      return { adapter: "mongodb", resource: target.resource, deletedRows: deleted.deletedCount, transaction: "read-write", durationMs: Date.now() - startedAt };
    } catch (error) {
      throw sanitizeRemoteError(error, compiled.values);
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (client) await client.close();
  }
}

export async function createMongoAdapterFromFile(file: string): Promise<MongoSourceAdapter> {
  return new MongoSourceAdapter(await loadMongoAdapterConfig(file));
}
