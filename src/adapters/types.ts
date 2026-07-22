export type SourceScalar = string | number | boolean | null;

export type SourceFilter =
  | { field: string; value: SourceScalar }
  | { field: string; env: string };

export interface SourceExpectation {
  type: "source";
  adapter: "postgresql";
  resource: string;
  filters: SourceFilter[];
  state: "present" | "absent";
  maxMatches?: number;
}

export interface SourceEvidence {
  adapter: "postgresql";
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
}

export interface SourceCleanupTarget {
  adapter: "postgresql";
  resource: string;
  filters: SourceFilter[];
}

export interface SourceCleanupEvidence {
  adapter: "postgresql";
  resource: string;
  deletedRows: number;
  transaction: "read-write";
  durationMs: number;
}

export interface SourceOfTruthAdapter {
  readonly kind: "postgresql";
  verify(expectation: SourceExpectation): Promise<SourceEvidence>;
  cleanup(
    target: SourceCleanupTarget,
    confirmation: { confirmed: boolean },
  ): Promise<SourceCleanupEvidence>;
  close(): Promise<void>;
}
