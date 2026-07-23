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

export type EvidenceLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

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
  | "RD004"
  | "RD005"
  | "RD006"
  | "RD007"
  | "RD008"
  | "RD101"
  | "RD102"
  | "RD103"
  | "RD104"
  | "RD105"
  | "RD201"
  | "RD202"
  | "RD203"
  | "RD204"
  | "RD205"
  | "RD301"
  | "RD302"
  | "RD303"
  | "RD304"
  | "RD305"
  | "RD401"
  | "RD402"
  | "RD403"
  | "RD404"
  | "RD405"
  | "RD501"
  | "RD502"
  | "RD503"
  | "RD504"
  | "RD505"
  | "RD601"
  | "RD602"
  | "RD603"
  | "RD604"
  | "RD605"
  | "RD701"
  | "RD702"
  | "RD703"
  | "RD704"
  | "RD705"
  | "RD801"
  | "RD802"
  | "RD803"
  | "RD804"
  | "RD805"
  | "RD901"
  | "RD902"
  | "RD903"
  | "RD904"
  | "RD905"
  | "RD1001"
  | "RD1002"
  | "RD1003"
  | "RD1004"
  | "RD1005";

export type EnvironmentStatus = "VALID" | "ENVIRONMENT_INVALID" | "BLOCKED";

export interface EnvironmentFinding {
  code: Extract<DetectorCode, "RD1001" | "RD1002" | "RD1003" | "RD1004" | "RD1005">;
  title: string;
  detail: string;
  url?: string;
}

export interface EnvironmentHealth {
  status: EnvironmentStatus;
  checkedAt: string;
  durationMs: number;
  targetUrl: string;
  routesChecked?: number;
  invalidRoutes?: number;
  mainDocument?: {
    status?: number;
    contentType?: string;
  };
  assets: {
    checked: number;
    scripts: number;
    stylesheets: number;
    failed: number;
  };
  render: {
    bodyTextLength: number;
    visibleElements: number;
    interactiveElements: number;
    ready: boolean;
  };
  findings: EnvironmentFinding[];
  acceptedRisk: boolean;
}

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
  target?: string;
  download?: string;
  frameUrl?: string;
  ordinal: number;
  candidates?: LocatorCandidate[];
}

export type LocatorStrategy = "testid" | "role" | "id" | "href" | "text" | "css" | "ordinal";

export interface LocatorCandidate {
  strategy: LocatorStrategy;
  weight: number;
  selector?: string;
  role?: string;
  name?: string;
  value?: string;
  exact?: boolean;
}

export interface LocatorAttempt {
  strategy: LocatorStrategy;
  weight: number;
  matchCount: number;
  visibleCount: number;
  elapsedMs: number;
  error?: string;
}

export interface LocatorResolution {
  attempts: LocatorAttempt[];
  chosenStrategy?: LocatorStrategy;
  chosenWeight?: number;
  retryCount: number;
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
  min?: string;
  max?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  step?: string;
  multiple?: boolean;
}

export interface ActionSpec {
  id: string;
  pageUrl: string;
  activation?: "click" | "submit" | "enter" | "check" | "select" | "hover" | "contextmenu" | "record";
  kind: ActionKind;
  intent: ActionIntent;
  risk: RiskLevel;
  label: string;
  fingerprint: SemanticFingerprint;
  fields: FormFieldSpec[];
  recordingRequired?: string;
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
  location?: string;
  responseResourceId?: string;
  resourceTypeHint?: string;
}

export interface ConsoleEvidence {
  type: string;
  text: string;
  at: number;
}

export interface WebSocketEvidence {
  url: string;
  openedAt: number;
  closedAt?: number;
  sentFrames: number;
  receivedFrames: number;
  errors: string[];
}

export interface CookieDigest {
  name: string;
  domain: string;
  path: string;
  valueHash: string;
  containsCanary: boolean;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface IndexedDbDigest {
  name: string;
  version: number;
  stores: Array<{ name: string; count: number }>;
}

export interface SemanticDomDigest {
  textHash: string;
  text: string;
  visualHash?: string;
  controls: Array<{
    tag: string;
    type: string;
    name?: string;
    valueHash: string;
    checked: boolean;
    disabled: boolean;
    visible?: boolean;
    expanded?: string;
    pressed?: string;
    selected?: string;
    busy?: string;
  }>;
}

export interface UploadEvidence {
  fileName: string;
  contentType: string;
  size: number;
  contentHash: string;
  containsCanary: boolean;
}

export interface DownloadEvidence {
  fileName: string;
  contentType?: string;
  size?: number;
  contentHash?: string;
  containsCanary?: boolean;
  expectedFieldValues?: number;
  matchedFieldValues?: number;
  failure?: string;
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
  semanticDom?: SemanticDomDigest;
  canaryPresent: boolean;
  bodyCanaryPresent?: boolean;
  temporaryBlobUrls?: number;
  auth?: {
    artifacts: number;
    expiredArtifacts: number;
    privateContent: boolean;
    adminContent: boolean;
    accessDenied: boolean;
  };
  busyControls?: number;
  disabledControls?: number;
  storage: {
    local: StorageEntryDigest[];
    session: StorageEntryDigest[];
    cookieNames: string[];
    cookies?: CookieDigest[];
    indexedDb?: IndexedDbDigest[];
  };
  sourceSnapshots?: SourceSnapshot[];
}

export interface SourceSnapshotError {
  adapter: string;
  stage: "discover" | "before" | "after";
  resource?: string;
  detail: string;
}

export type PersistenceScope =
  | "MEMORY_ONLY"
  | "TAB_PERSISTENT"
  | "BROWSER_LOCAL"
  | "SESSION_PERSISTENT"
  | "BACKEND_PERSISTENT"
  | "SOURCE_OF_TRUTH_CONFIRMED"
  | "CROSS_USER_CONFIRMED";

export interface ApiReadBackEvidence {
  url: string;
  status?: number;
  ok: boolean;
  canaryPresent: boolean;
  expectedFieldValues?: number;
  matchedFieldValues?: number;
  error?: string;
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
  beforeAction?: StateSnapshot;
  after?: StateSnapshot;
  afterRefresh?: StateSnapshot;
  afterHardRefresh?: StateSnapshot;
  afterNewTab?: StateSnapshot;
  afterNewContext?: StateSnapshot;
  afterAppRestart?: StateSnapshot;
  network: NetworkEvidence[];
  console: ConsoleEvidence[];
  pageErrors: string[];
  uiClaims: UiClaim[];
  filledFields: FilledField[];
  dialogs: string[];
  downloads: string[];
  downloadEvidence?: DownloadEvidence[];
  uploads?: UploadEvidence[];
  popupUrls?: string[];
  webSockets?: WebSocketEvidence[];
  apiReadBack?: ApiReadBackEvidence;
  sourceDiffs?: SourceRowDiff[];
  sourceSnapshotErrors?: SourceSnapshotError[];
  providerEvidence?: ProviderEvidence[];
  providerErrors?: ProviderCheckError[];
  persistenceScope?: PersistenceScope;
  targetText?: string;
  targetVisibleAfter?: boolean;
  targetVisibleAfterRefresh?: boolean;
  targetVisibleAfterNewContext?: boolean;
  screenshot?: string;
  refreshScreenshot?: string;
  trace?: string;
  video?: string;
  snapshotIndex?: string;
  executionError?: string;
  targetNotFound?: boolean;
  locatorResolution?: LocatorResolution;
  targetDisabledAfter?: boolean;
  targetBusyAfter?: boolean;
  networkSettled?: boolean;
  preparedInteractions?: string[];
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
  evidenceLevel: EvidenceLevel;
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
  environmentStatus?: EnvironmentStatus;
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
  environment?: EnvironmentHealth;
  completeness?: {
    truncated: boolean;
    reasons: Array<"max-pages" | "max-actions" | "max-duration">;
  };
}

export interface PublicScanOptions {
  maxPages: number;
  maxActions: number;
  timeoutMs: number;
  settleMs: number;
  maxDurationMs: number;
  maxRetries: number;
  allowDestructive: boolean;
  allowExternal: boolean;
  mutationAllowed: boolean;
  deep?: boolean;
  trace?: boolean;
  traceOnFailure?: boolean;
  video?: boolean;
  environmentTimeoutMs?: number;
  acceptEnvironmentRisk?: boolean;
  allowIframes?: boolean;
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
  policy?: ActionPolicy;
  healthEndpoint?: string;
  restartTarget?: () => Promise<void>;
  sourceAdapters?: DiscoverableSourceAdapter[];
  sourceSnapshotLimit?: number;
  providerVerifier?: {
    verifyAutomatic(action: ActionSpec, execution: ExecutionEvidence, options: AutomaticProviderOptions): Promise<AutomaticProviderResult>;
  };
}

export interface ActionPolicyRule {
  match: {
    url?: string;
    label?: string;
    kind?: ActionKind;
    intent?: ActionIntent;
  };
  effect?: "allow" | "deny";
  set?: {
    kind?: ActionKind;
    intent?: ActionIntent;
    risk?: RiskLevel;
  };
  reason?: string;
}

export interface ActionPolicy {
  schemaVersion: "1.0";
  allowHosts: string[];
  budgets?: {
    maxPages?: number;
    maxActions?: number;
    maxDurationMs?: number;
    maxRetries?: number;
  };
  rules: ActionPolicyRule[];
}

export interface Reproduction {
  schemaVersion: "1.0";
  findingId: string;
  sourceScanId: string;
  targetUrl: string;
  action: ActionSpec;
  sourceVerdict?: Verdict;
  sourceDetectorCodes?: DetectorCode[];
  providerRequirements?: {
    automatic: true;
    providers: Array<{
      name: string;
      kind: "payment" | "email" | "storage" | "oauth";
      resource?: string;
      operation?: string;
      state?: "confirmed" | "absent";
    }>;
  };
  options: Pick<
    ScanOptions,
    | "timeoutMs"
    | "settleMs"
    | "maxDurationMs"
    | "maxRetries"
    | "allowDestructive"
    | "allowExternal"
    | "deep"
    | "trace"
    | "traceOnFailure"
    | "video"
  >;
}

export type ReplayOutcome =
  | "FINDING_REPRODUCED"
  | "FINDING_NO_LONGER_REPRODUCED"
  | "ENVIRONMENT_CHANGED"
  | "TARGET_ACTION_NOT_FOUND"
  | "REPLAY_UNCERTAIN";

export interface ReplayEvidence {
  schemaVersion: "1.0";
  findingId: string;
  sourceScanId: string;
  replayScanId: string;
  outcome: ReplayOutcome;
  sourceVerdict: Verdict;
  replayVerdict?: Verdict;
  sourceDetectorCodes: DetectorCode[];
  replayDetectorCodes: DetectorCode[];
  providerConfirmationRequired?: boolean;
  providerConfirmationSatisfied?: boolean;
  detail: string;
}
import type { DiscoverableSourceAdapter, SourceRowDiff, SourceSnapshot } from "./adapters/types.js";
import type { AutomaticProviderOptions, AutomaticProviderResult, ProviderCheckError, ProviderEvidence } from "./providers/types.js";
