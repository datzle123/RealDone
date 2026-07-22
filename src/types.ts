export type ActionKind = "navigation" | "local" | "mutation" | "external";
export type ActionIntent =
  | "create"
  | "update"
  | "delete"
  | "submit"
  | "navigate"
  | "interact"
  | "external"
  | "unknown";
export type RiskLevel = "safe" | "external" | "destructive";

export type Verdict =
  | "VERIFIED"
  | "CONTRADICTORY"
  | "EPHEMERAL"
  | "BROWSER_LOCAL"
  | "BROKEN"
  | "NO_EFFECT"
  | "UNCERTAIN"
  | "SKIPPED";

export type DetectorCode =
  | "RD001"
  | "RD002"
  | "RD003"
  | "RD101"
  | "RD102"
  | "RD201"
  | "RD202"
  | "RD203"
  | "RD301"
  | "RD302"
  | "RD303";

export interface SemanticFingerprint {
  selector: string;
  tag: string;
  role?: string;
  accessibleName?: string;
  text?: string;
  testId?: string;
  id?: string;
  href?: string;
  type?: string;
  ordinal: number;
}

export interface FormFieldSpec {
  selector: string;
  tag: "input" | "textarea" | "select";
  type: string;
  name?: string;
  label?: string;
  placeholder?: string;
  required: boolean;
  disabled: boolean;
}

export interface ActionSpec {
  id: string;
  pageUrl: string;
  kind: ActionKind;
  intent: ActionIntent;
  risk: RiskLevel;
  label: string;
  fingerprint: SemanticFingerprint;
  fields: FormFieldSpec[];
}

export interface DiscoveredPage {
  url: string;
  title: string;
  actions: ActionSpec[];
  error?: string;
}

export interface NetworkEvidence {
  id: string;
  method: string;
  url: string;
  resourceType: string;
  startedAt: number;
  finishedAt?: number;
  status?: number;
  ok?: boolean;
  failure?: string;
  contentType?: string;
}

export interface ConsoleEvidence {
  type: string;
  text: string;
  at: number;
}

export interface UiClaim {
  kind: "success" | "error";
  text: string;
  at: number;
}

export interface StorageEntryDigest {
  key: string;
  valueHash: string;
  containsCanary: boolean;
}

export interface StateSnapshot {
  at: number;
  url: string;
  domHash: string;
  title: string;
  canaryPresent: boolean;
  storage: {
    local: StorageEntryDigest[];
    session: StorageEntryDigest[];
    cookieNames: string[];
  };
}

export interface FilledField {
  selector: string;
  name: string;
  type: string;
  value: string;
  redacted: boolean;
}

export interface ExecutionEvidence {
  startedAt: string;
  durationMs: number;
  canary: string;
  before?: StateSnapshot;
  after?: StateSnapshot;
  afterRefresh?: StateSnapshot;
  network: NetworkEvidence[];
  console: ConsoleEvidence[];
  pageErrors: string[];
  uiClaims: UiClaim[];
  filledFields: FilledField[];
  dialogs: string[];
  downloads: string[];
  targetText?: string;
  targetVisibleAfter?: boolean;
  targetVisibleAfterRefresh?: boolean;
  screenshot?: string;
  refreshScreenshot?: string;
  executionError?: string;
}

export interface DetectorMatch {
  code: DetectorCode;
  title: string;
  detail: string;
}

export interface Finding {
  id: string;
  action: ActionSpec;
  verdict: Verdict;
  evidenceLevel: number;
  reason: string;
  detectorMatches: DetectorMatch[];
  evidence: ExecutionEvidence;
  skippedReason?: string;
}

export interface ScanSummary {
  pagesDiscovered: number;
  visibleActions: number;
  actionsVerified: number;
  actionsSkipped: number;
  verdicts: Record<Verdict, number>;
}

export interface ScanReport {
  schemaVersion: "1.0";
  scanId: string;
  targetUrl: string;
  startedAt: string;
  finishedAt: string;
  options: PublicScanOptions;
  summary: ScanSummary;
  pages: DiscoveredPage[];
  findings: Finding[];
}

export interface PublicScanOptions {
  maxPages: number;
  maxActions: number;
  timeoutMs: number;
  settleMs: number;
  allowDestructive: boolean;
  allowExternal: boolean;
  mutationAllowed: boolean;
}

export interface ScanOptions extends PublicScanOptions {
  targetUrl: string;
  outputRoot: string;
  headed: boolean;
  allowHosts: string[];
  storageStatePath?: string;
  executablePath?: string;
  onlyActionId?: string;
  replayAction?: ActionSpec;
}

export interface Reproduction {
  schemaVersion: "1.0";
  findingId: string;
  sourceScanId: string;
  targetUrl: string;
  action: ActionSpec;
  options: Pick<
    ScanOptions,
    "timeoutMs" | "settleMs" | "allowDestructive" | "allowExternal"
  >;
}
