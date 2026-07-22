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
  assertRemoteEndpoint,
  mappedFilters,
  mappedSchema,
  sanitizeRemoteError,
  secretEnvironmentValue,
  snapshotRows,
  type MappedResource,
} from "../remote.js";
import { loadFirebaseAdapterConfig, type FirebaseAdapterConfig } from "./config.js";

type FirestoreValue = Record<string, unknown>;
interface FirestoreDocument { name: string; fields?: Record<string, FirestoreValue> }

function resourceFor(config: FirebaseAdapterConfig, name: string): MappedResource {
  const resource = Object.hasOwn(config.resources, name) ? config.resources[name] : undefined;
  if (!resource) throw new Error(`Firebase resource is not allowlisted: ${name}`);
  return resource;
}

function firestoreValue(value: SourceScalar): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  return { stringValue: value };
}

function plainValue(value: FirestoreValue | undefined): unknown {
  if (!value) return undefined;
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("stringValue" in value) return value.stringValue;
  return value;
}

function documentId(value: SourceScalar): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Firebase document IDs must be safe strings.");
  return value;
}

export class FirebaseSourceAdapter implements DiscoverableSourceAdapter {
  readonly kind = "firebase" as const;
  private readonly endpoint: URL;

  constructor(readonly config: FirebaseAdapterConfig) {
    this.endpoint = assertRemoteEndpoint(config.baseUrl, config.allowProduction, "Firebase");
  }

  private rootPath(): string {
    return `/v1/projects/${encodeURIComponent(this.config.projectId)}/databases/${encodeURIComponent(this.config.databaseId)}/documents`;
  }

  private apiUrl(suffix: string): URL {
    const basePath = this.endpoint.pathname.replace(/\/$/, "");
    const normalized = basePath.endsWith("/v1") ? basePath.slice(0, -3) : basePath;
    const url = new URL(this.endpoint);
    url.pathname = `${normalized}${this.rootPath()}${suffix}`;
    url.search = "";
    return url;
  }

  private headers(): Record<string, string> {
    return {
      accept: "application/json",
      "content-type": "application/json",
      ...(this.config.tokenEnv ? { authorization: `Bearer ${secretEnvironmentValue(this.config.tokenEnv)}` } : {}),
    };
  }

  private fullDocumentName(resource: MappedResource, id: string): string {
    return `projects/${this.config.projectId}/databases/${this.config.databaseId}/documents/${resource.target}/${id}`;
  }

  private aliasDocument(document: FirestoreDocument, resource: MappedResource): Record<string, unknown> {
    return Object.fromEntries(Object.entries(resource.fields).map(([alias, field]) => [
      alias,
      field.target === "__name__" ? document.name.split("/").at(-1) : plainValue(document.fields?.[field.target]),
    ]));
  }

  async discoverSchema(resource?: string): Promise<SourceResourceSchema[]> {
    const names = resource ? [resource] : Object.keys(this.config.resources).sort();
    return names.map((name) => mappedSchema("firebase", name, resourceFor(this.config, name)));
  }

  async verify(expectation: SourceExpectation): Promise<SourceEvidence> {
    if (expectation.adapter !== "firebase") throw new Error(`Unsupported source adapter: ${expectation.adapter}`);
    const startedAt = Date.now();
    const resource = resourceFor(this.config, expectation.resource);
    const filters = mappedFilters(expectation.resource, resource, expectation.filters);
    const queryFilters = filters.map((filter) => filter.value === null
      ? { unaryFilter: { field: { fieldPath: filter.target }, op: "IS_NULL" } }
      : { fieldFilter: {
          field: { fieldPath: filter.target },
          op: "EQUAL",
          value: filter.target === "__name__"
            ? { referenceValue: this.fullDocumentName(resource, documentId(filter.value)) }
            : firestoreValue(filter.value),
        } });
    const where = queryFilters.length === 1 ? queryFilters[0] : { compositeFilter: { op: "AND", filters: queryFilters } };
    const limit = Math.max(2, (expectation.maxMatches ?? 1) + 1);
    const body = { structuredQuery: { from: [{ collectionId: resource.target }], where, limit } };
    try {
      const response = await fetch(this.apiUrl(":runQuery"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (!response.ok) throw new Error(`Firebase query returned HTTP ${response.status}.`);
      const results = await response.json() as Array<{ document?: FirestoreDocument }>;
      const matchedRows = results.filter((result) => result.document).length;
      const statePassed = expectation.state === "present" ? matchedRows > 0 : matchedRows === 0;
      return {
        adapter: "firebase",
        evidenceLevel: 6,
        resource: expectation.resource,
        state: expectation.state,
        matchedRows,
        ...(expectation.maxMatches === undefined ? {} : { maxMatches: expectation.maxMatches }),
        matchedFields: filters.map((filter) => filter.field),
        queryHash: hashText(`POST ${this.apiUrl(":runQuery").pathname}:${filters.map((filter) => filter.target).sort().join(",")}`),
        transaction: "read-only",
        durationMs: Date.now() - startedAt,
        passed: statePassed && (expectation.maxMatches === undefined || matchedRows <= expectation.maxMatches),
      };
    } catch (error) {
      throw sanitizeRemoteError(error, filters.map((filter) => filter.value));
    }
  }

  async snapshot(resourceName: string, limit = 1_000): Promise<SourceSnapshot> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error("Firebase snapshot limit must be between 1 and 10000 rows.");
    const resource = resourceFor(this.config, resourceName);
    const schema = mappedSchema("firebase", resourceName, resource);
    const url = this.apiUrl(`/${resource.target}`);
    url.searchParams.set("pageSize", String(Math.min(limit + 1, 1_000)));
    try {
      const response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(this.config.timeoutMs) });
      if (!response.ok) throw new Error(`Firebase snapshot returned HTTP ${response.status}.`);
      const payload = await response.json() as { documents?: FirestoreDocument[]; nextPageToken?: string };
      const documents = payload.documents ?? [];
      return {
        adapter: "firebase",
        resource: resourceName,
        schemaHash: schema.schemaHash,
        rows: snapshotRows(documents.slice(0, limit).map((document) => this.aliasDocument(document, resource)), resource),
        truncated: documents.length > limit || Boolean(payload.nextPageToken),
      };
    } catch (error) {
      throw sanitizeRemoteError(error);
    }
  }

  async cleanup(target: SourceCleanupTarget, confirmation: { confirmed: boolean }): Promise<SourceCleanupEvidence> {
    if (target.adapter !== "firebase") throw new Error(`Unsupported cleanup adapter: ${target.adapter}`);
    if (!confirmation.confirmed) throw new Error("Firebase cleanup requires explicit confirmation.");
    if (!this.config.allowCleanup) throw new Error("Firebase cleanup is disabled by adapter config.");
    const startedAt = Date.now();
    const resource = resourceFor(this.config, target.resource);
    const filters = mappedFilters(target.resource, resource, target.filters);
    assertPrimaryKeyCleanup(target.resource, resource, filters.map((filter) => filter.field));
    const id = documentId(filters[0]?.value ?? null);
    try {
      const response = await fetch(this.apiUrl(`/${resource.target}/${id}`), {
        method: "DELETE",
        headers: this.headers(),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (!response.ok && response.status !== 404) throw new Error(`Firebase cleanup returned HTTP ${response.status}.`);
      return { adapter: "firebase", resource: target.resource, deletedRows: response.status === 404 ? 0 : 1, transaction: "read-write", durationMs: Date.now() - startedAt };
    } catch (error) {
      throw sanitizeRemoteError(error, filters.map((filter) => filter.value));
    }
  }

  async close(): Promise<void> {}
}

export async function createFirebaseAdapterFromFile(file: string): Promise<FirebaseSourceAdapter> {
  return new FirebaseSourceAdapter(await loadFirebaseAdapterConfig(file));
}
