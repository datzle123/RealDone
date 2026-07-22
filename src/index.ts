export { runScan, type ScanProgress, type ScanResult } from "./scan.js";
export {
  inspectEnvironment,
  waitForEnvironmentRender,
  type EnvironmentHealthOptions,
  type EnvironmentRenderObservation,
} from "./environment/health.js";
export {
  discoverProject,
  loadProjectProfile,
  writeProjectProfile,
  type ProjectProfile,
  type RuntimeCommand,
} from "./project/discovery.js";
export {
  RuntimeManager,
  runBuildCommand,
  type ManagedRuntimeOptions,
  type RuntimeSnapshot,
} from "./runtime/manager.js";
export { launchBrowser, launchChromium, type BrowserName, type BrowserRuntimeOptions } from "./browser/runtime.js";
export { prepareDynamicActions } from "./browser/discover.js";
export {
  runBrowserMatrix,
  type BrowserMatrixEntry,
  type BrowserMatrixReport,
  type BrowserMatrixResult,
} from "./browser/matrix.js";
export { runReplay, type ReplayOptions } from "./replay.js";
export { recordFlow, type RecordOptions, type RecordResult } from "./record/recorder.js";
export {
  behaviorContractSchema,
  loadBehaviorContract,
  writeBehaviorContract,
  type BehaviorContract,
  type BehaviorRole,
  type BehaviorStep,
  type ContractExpectation,
  type ContractVerification,
  type CrossRoleExpectation,
  type StepVerification,
} from "./contracts/schema.js";
export {
  verifyContract,
  type VerifyContractOptions,
  type VerifyContractResult,
} from "./contracts/verifier.js";
export {
  evaluateReport,
  loadBenchmarkExpectations,
  runBenchmark,
  type BenchmarkExpectation,
  type BenchmarkMetrics,
  type BenchmarkResult,
  type RunBenchmarkOptions,
} from "./benchmark/evaluate.js";
export {
  buildBehaviorManifest,
  captureBaseline,
  collectContractFiles,
  loadBehaviorManifest,
  type BehaviorManifest,
  type ManifestContract,
} from "./baseline/manifest.js";
export { selectAffectedContracts } from "./baseline/affected.js";
export {
  runRegressionGate,
  type ContractChange,
  type RegressionGateOptions,
  type RegressionGateResult,
  type RegressionReport,
} from "./baseline/regression.js";
export { exportPlaywrightTest, renderPlaywrightTest } from "./export/playwright.js";
export { definePlugin, type RealDonePlugin } from "./plugins/sdk.js";
export { PluginHost } from "./plugins/host.js";
export {
  loadPluginManifest,
  pluginManifestSchema,
  type PluginManifest,
  type ResolvedPluginManifest,
} from "./plugins/schema.js";
export type * from "./providers/types.js";
export { BuiltinProviderHost } from "./providers/builtin.js";
export { providerAdapterConfigSchema, loadProviderAdapterConfig, type ProviderAdapterConfig, type BuiltinProviderConfig } from "./providers/config.js";
export {
  evaluatePerformance,
  loadPerformanceBudget,
  performanceBudgetSchema,
  type PerformanceBudget,
  type PerformanceEvaluation,
  type PerformanceMeasurement,
} from "./performance/budget.js";
export { renderBenchmarkDashboard, renderBenchmarkMarkdown } from "./benchmark/dashboard.js";
export { runCommand, commandPassed, type CommandResult, type CommandSpec } from "./agent/command.js";
export { createAgentCommand, parseAgentPreset, type AgentPreset, type AgentCommandOptions } from "./agent/presets.js";
export { renderFollowUpPrompt, type FollowUpInput } from "./agent/followup.js";
export {
  loadTask,
  parseGitStatus,
  runAgentVerification,
  type AgentVerificationOptions,
  type AgentVerificationReport,
  type AgentVerificationResult,
  type CommandSummary,
} from "./agent/pipeline.js";
export {
  PostgresSourceAdapter,
  compilePostgresTarget,
  createPostgresAdapterFromFile,
  type CompiledPostgresTarget,
} from "./adapters/postgres/index.js";
export {
  assertSafeIdentifier,
  loadPostgresAdapterConfig,
  postgresAdapterConfigSchema,
  type PostgresAdapterConfig,
  type PostgresResourceConfig,
} from "./adapters/postgres/config.js";
export {
  SqliteSourceAdapter,
  compileSqliteTarget,
  type CompiledSqliteTarget,
  type SqliteAdapterOptions,
} from "./adapters/sqlite/index.js";
export { createSourceAdapterFromFile } from "./adapters/registry.js";
export { SupabaseSourceAdapter, createSupabaseAdapterFromFile } from "./adapters/supabase/index.js";
export { supabaseAdapterConfigSchema, loadSupabaseAdapterConfig, type SupabaseAdapterConfig } from "./adapters/supabase/config.js";
export { FirebaseSourceAdapter, createFirebaseAdapterFromFile } from "./adapters/firebase/index.js";
export { firebaseAdapterConfigSchema, loadFirebaseAdapterConfig, type FirebaseAdapterConfig } from "./adapters/firebase/config.js";
export { MongoSourceAdapter, createMongoAdapterFromFile } from "./adapters/mongodb/index.js";
export { mongoAdapterConfigSchema, loadMongoAdapterConfig, type MongoAdapterConfig } from "./adapters/mongodb/config.js";
export type * from "./adapters/types.js";
export { detect, findingFromEvidence } from "./detectors/index.js";
export { runManagedScan, type ManagedScanRequest, type RuntimeMode } from "./application/managed-scan.js";
export { createRealDoneMcpServer, runRealDoneMcpServer, type RealDoneMcpDependencies, type RealDoneMcpServerOptions } from "./mcp/server.js";
export {
  scanArtifactSecrets,
  type ArtifactSecret,
  type ArtifactSecretFinding,
  type ArtifactSecretFindingKind,
  type ArtifactSecretScan,
  type ArtifactSecretScanOptions,
} from "./release/artifacts.js";
export {
  checkArtifactSchemaCompatibility,
  type ArtifactSchemaCompatibility,
  type ArtifactSchemaIssue,
  type ArtifactValueType,
} from "./release/schema.js";
export {
  evaluateReleaseGates,
  mergeReleaseGateEvidence,
  releaseGateEvidenceSchema,
  releaseRunAttestationSchema,
  releaseExternalCaseSchema,
  type ReleaseExternalCase,
  type ReleaseGateEvidence,
  type ReleaseGateReport,
  type ReleaseGateResult,
  type ReleaseGateThresholds,
  type ReleasePlatform,
  type ReleaseRunAttestation,
} from "./release/gates.js";
export { classifyAction } from "./core/classify.js";
export { mapWithConcurrency } from "./core/workers.js";
export { writeDeduplicatedSnapshots, type SnapshotIndex, type SnapshotReference } from "./report/snapshots.js";
export { loadActionPolicy, applyActionPolicy } from "./core/policy.js";
export { validateTarget, isMutationHostAllowed } from "./core/safety.js";
export {
  createCleanupLedger,
  createContractCleanupLedger,
  readCleanupLedger,
  runCleanup,
  type CleanupLedger,
  type CleanupResource,
  type CleanupOptions,
  type CleanupResult,
} from "./cleanup/ledger.js";
export type * from "./types.js";
