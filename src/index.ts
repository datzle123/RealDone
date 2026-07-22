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
export { detect, findingFromEvidence } from "./detectors/index.js";
export { classifyAction } from "./core/classify.js";
export { loadActionPolicy, applyActionPolicy } from "./core/policy.js";
export { validateTarget, isMutationHostAllowed } from "./core/safety.js";
export {
  createCleanupLedger,
  readCleanupLedger,
  runCleanup,
  type CleanupLedger,
  type CleanupResource,
  type CleanupOptions,
  type CleanupResult,
} from "./cleanup/ledger.js";
export type * from "./types.js";
