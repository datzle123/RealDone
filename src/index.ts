export { runScan, type ScanProgress, type ScanResult } from "./scan.js";
export { runReplay, type ReplayOptions } from "./replay.js";
export { recordFlow, type RecordOptions, type RecordResult } from "./record/recorder.js";
export {
  behaviorContractSchema,
  loadBehaviorContract,
  writeBehaviorContract,
  type BehaviorContract,
  type BehaviorStep,
  type ContractExpectation,
  type ContractVerification,
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
export type * from "./adapters/types.js";
export { detect, findingFromEvidence } from "./detectors/index.js";
export { classifyAction } from "./core/classify.js";
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
