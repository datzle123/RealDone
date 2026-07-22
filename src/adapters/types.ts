export type SourceScalar = string | number | boolean | null;
export type SourceAdapterKind = "postgresql" | "sqlite" | "prisma" | "supabase" | "firebase" | "mongodb" | "custom";

export type SourceFilter =
  | { field: string; value: SourceScalar }
  | { field: string; env: string };

export interface SourceExpectation {
  type: "source";
  adapter: SourceAdapterKind;
  connector?: string;
  resource: string;
  filters: SourceFilter[];
  state: "present" | "absent";
  maxMatches?: number;
}

export interface SourceObservation {
  matchedRows: number;
  matchedFields?: string[];
  detail: string;
}

export interface SourceEvidence {
  adapter: SourceAdapterKind;
  evidenceLevel: 6;
  resource: string;
  state: "present" | "absent";
  matchedRows: number;
  maxMatches?: number;
  matchedFields: string[];
  queryHash: string;
  transaction: "read-only";
  durationMs: number;
  passed: boolean;
  detail?: string;
}

export interface SourceCleanupTarget {
  adapter: SourceAdapterKind;
  connector?: string;
  resource: string;
  filters: SourceFilter[];
}

export interface SourceCleanupEvidence {
  adapter: SourceAdapterKind;
  resource: string;
  deletedRows: number;
  transaction: "read-write";
  durationMs: number;
}

export interface SourceOfTruthAdapter {
  readonly kind: SourceAdapterKind;
  verify(expectation: SourceExpectation): Promise<SourceEvidence>;
  cleanup(
    target: SourceCleanupTarget,
    confirmation: { confirmed: boolean },
  ): Promise<SourceCleanupEvidence>;
  close(): Promise<void>;
}

export interface SourceResourceSchema {
  adapter: SourceAdapterKind;
  resource: string;
  fields: Array<{ name: string; type: string; nullable: boolean }>;
  primaryKey: string[];
  softDeleteFields: string[];
  schemaHash: string;
}

export interface SourceRowSnapshot {
  keyHash: string;
  rowHash: string;
  softDeleted: boolean;
}

export interface SourceSnapshot {
  adapter: SourceAdapterKind;
  resource: string;
  schemaHash: string;
  rows: SourceRowSnapshot[];
  truncated: boolean;
}

export interface SourceRowDiff {
  adapter: SourceAdapterKind;
  resource: string;
  added: string[];
  removed: string[];
  changed: string[];
  softDeleted: string[];
  truncated: boolean;
}

export interface SourceDiscoveryInput {
  adapter: Extract<SourceAdapterKind, "prisma" | "custom">;
  connector?: string;
  resource?: string;
}

export interface SourceSnapshotInput {
  adapter: Extract<SourceAdapterKind, "prisma" | "custom">;
  connector?: string;
  resource: string;
  limit: number;
}

export interface SourceSnapshotObservation {
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
}

export interface SourceCleanupObservation {
  deletedRows: number;
  detail?: string;
}

export interface DiscoverableSourceAdapter extends SourceOfTruthAdapter {
  discoverSchema(resource?: string): Promise<SourceResourceSchema[]>;
  snapshot(resource: string, limit?: number): Promise<SourceSnapshot>;
}

export function diffSourceSnapshots(before: SourceSnapshot, after: SourceSnapshot): SourceRowDiff {
  if (before.adapter !== after.adapter || before.resource !== after.resource) {
    throw new Error("Source snapshots must use the same adapter and resource.");
  }
  const beforeRows = new Map(before.rows.map((row) => [row.keyHash, row]));
  const afterRows = new Map(after.rows.map((row) => [row.keyHash, row]));
  const added = [...afterRows.keys()].filter((key) => !beforeRows.has(key)).sort();
  const removed = [...beforeRows.keys()].filter((key) => !afterRows.has(key)).sort();
  const changed = [...afterRows.entries()]
    .filter(([key, row]) => beforeRows.has(key) && beforeRows.get(key)?.rowHash !== row.rowHash)
    .map(([key]) => key)
    .sort();
  const softDeleted = [...afterRows.entries()]
    .filter(([key, row]) => row.softDeleted && !beforeRows.get(key)?.softDeleted)
    .map(([key]) => key)
    .sort();
  return {
    adapter: before.adapter,
    resource: before.resource,
    added,
    removed,
    changed,
    softDeleted,
    truncated: before.truncated || after.truncated,
  };
}
