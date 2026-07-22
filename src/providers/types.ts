export type ProviderKind = "payment" | "email" | "storage" | "oauth";
export type ProviderScalar = string | number | boolean | null;

export type ProviderReference =
  | { value: ProviderScalar }
  | { env: string };

export interface ProviderExpectation {
  type: "provider";
  provider: string;
  kind: ProviderKind;
  operation: string;
  resource: string;
  reference: ProviderReference;
  state: "confirmed" | "absent";
  parameters?: Record<string, ProviderScalar>;
}

export interface ProviderObservation {
  found: boolean;
  detail: string;
  metadata?: Record<string, ProviderScalar>;
}

export interface ProviderEvidence {
  provider: string;
  kind: ProviderKind;
  resource: string;
  operation: string;
  state: "confirmed" | "absent";
  found: boolean;
  passed: boolean;
  evidenceLevel: 6;
  durationMs: number;
  detail: string;
  metadata?: Record<string, ProviderScalar>;
}
