import { randomBytes } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { create } from "jsondiffpatch";
import type { VerifyContractOptions } from "../contracts/verifier.js";
import type { DetectorCode } from "../types.js";
import { buildBehaviorManifest, collectContractFiles, loadBehaviorManifest, type BehaviorManifest, type ManifestContract } from "./manifest.js";
import { selectAffectedContracts } from "./affected.js";

export type ChangeKind = "passed" | "regression" | "expected-change" | "improvement" | "baseline-failure" | "missing";

export interface ContractChange {
  contractId: string;
  name: string;
  kind: ChangeKind;
  detail: string;
  baselinePassed?: boolean | undefined;
  currentPassed?: boolean | undefined;
  hashChanged: boolean;
  outcome: "VERIFIED" | "EXPECTED_CHANGE" | "REGRESSION" | "UNCERTAIN";
  detectorCodes: Array<Extract<DetectorCode, "RD901" | "RD902" | "RD903" | "RD904" | "RD905">>;
}

export interface RegressionReport {
  schemaVersion: "1.0";
  runId: string;
  baselineFile: string;
  generatedAt: string;
  passed: boolean;
  selectedContracts: number;
  regressions: number;
  expectedChanges: number;
  improvements: number;
  changes: ContractChange[];
  delta?: unknown;
}

export interface RegressionGateOptions {
  baselineFile: string;
  contractInputs: string[];
  changedFiles: string[];
  outputRoot: string;
  verifyOptions: VerifyContractOptions;
}

export interface RegressionGateResult {
  report: RegressionReport;
  currentManifest: BehaviorManifest;
  outputDirectory: string;
  exitCode: number;
}

function runId(): string {
  return `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${randomBytes(2).toString("hex")}`;
}

function failedAssertionTypes(contract: ManifestContract): Set<string> {
  return new Set(
    (contract.baseline?.steps ?? []).flatMap((step) =>
      step.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.type),
    ),
  );
}

export function classifyContractChange(baseline: ManifestContract | undefined, current: ManifestContract | undefined): ContractChange {
  const source = current ?? baseline;
  if (!source) throw new Error("Cannot classify an empty contract change.");
  if (!current) {
    return { contractId: source.id, name: source.name, kind: "missing", outcome: "REGRESSION", detectorCodes: ["RD902"], detail: "The baseline contract is missing from the current contract set.", baselinePassed: baseline?.baseline?.passed, hashChanged: false };
  }
  if (!baseline) {
    return { contractId: source.id, name: source.name, kind: "expected-change", outcome: "EXPECTED_CHANGE", detectorCodes: [], detail: "A new behavior contract was added.", currentPassed: current.baseline?.passed, hashChanged: true };
  }
  const baselinePassed = baseline.baseline?.passed;
  const currentPassed = current.baseline?.passed;
  const hashChanged = baseline.hash !== current.hash;
  if (baselinePassed === true && currentPassed === false) {
    const assertionTypes = failedAssertionTypes(current);
    const detectorCodes: ContractChange["detectorCodes"] = [];
    if (current.baseline?.performancePassed === false) detectorCodes.push("RD905");
    if (assertionTypes.has("persistence")) detectorCodes.push("RD903");
    if (assertionTypes.has("request")) detectorCodes.push("RD904");
    if (detectorCodes.length === 0) detectorCodes.push("RD901");
    return { contractId: source.id, name: source.name, kind: "regression", outcome: "REGRESSION", detectorCodes, detail: "A behavior that passed at baseline now fails.", baselinePassed, currentPassed, hashChanged };
  }
  if (baselinePassed === false && currentPassed === true) {
    return { contractId: source.id, name: source.name, kind: "improvement", outcome: "EXPECTED_CHANGE", detectorCodes: [], detail: "A baseline failure now passes.", baselinePassed, currentPassed, hashChanged };
  }
  if (currentPassed === false) {
    return { contractId: source.id, name: source.name, kind: "baseline-failure", outcome: "UNCERTAIN", detectorCodes: [], detail: "The behavior is still failing; the baseline was not green.", baselinePassed, currentPassed, hashChanged };
  }
  if (hashChanged) {
    return { contractId: source.id, name: source.name, kind: "expected-change", outcome: "EXPECTED_CHANGE", detectorCodes: [], detail: "The contract changed and its current behavior passes.", baselinePassed, currentPassed, hashChanged };
  }
  return { contractId: source.id, name: source.name, kind: "passed", outcome: "VERIFIED", detectorCodes: [], detail: "Behavior matches the passing baseline.", baselinePassed, currentPassed, hashChanged };
}

function markdown(report: RegressionReport): string {
  const icon: Record<ChangeKind, string> = {
    passed: "✅",
    regression: "❌",
    "expected-change": "📝",
    improvement: "🎉",
    "baseline-failure": "⚠️",
    missing: "❌",
  };
  const rows = report.changes
    .map((change) => `| ${icon[change.kind]} ${change.name} | ${change.outcome} | ${change.detectorCodes.join(", ") || "—"} | ${change.detail} |`)
    .join("\n");
  return `## RealDone Behavioral Verification\n\n**${report.passed ? "Passed" : "Failed"}** · ${report.selectedContracts} selected · ${report.regressions} regressions · ${report.expectedChanges} expected changes\n\n| Contract | Outcome | Detectors | Detail |\n| --- | --- | --- | --- |\n${rows || "| — | VERIFIED | — | No affected contracts. |"}\n`;
}

export async function runRegressionGate(options: RegressionGateOptions): Promise<RegressionGateResult> {
  const baselineFile = path.resolve(options.baselineFile);
  const baseline = await loadBehaviorManifest(baselineFile);
  const selectedBaseline = selectAffectedContracts(baseline, options.changedFiles);
  const selectedIds = new Set(selectedBaseline.map((contract) => contract.id));
  const contractFiles = options.contractInputs.length > 0
    ? await collectContractFiles(options.contractInputs)
    : selectedBaseline.map((contract) => path.resolve(path.dirname(baselineFile), contract.file));
  const id = runId();
  const outputDirectory = path.resolve(options.outputRoot, id);
  await mkdir(outputDirectory, { recursive: true });
  const current = contractFiles.length > 0
    ? await buildBehaviorManifest(contractFiles, {
        manifestFile: baselineFile,
        verify: true,
        verifyOptions: options.verifyOptions,
        verificationOutputRoot: path.join(outputDirectory, "runs"),
      })
    : { schemaVersion: "1.0" as const, generatedAt: new Date().toISOString(), contracts: [] };
  const currentSelected = options.changedFiles.length === 0
    ? current.contracts
    : current.contracts.filter((contract) => selectedIds.has(contract.id));
  const baselineById = new Map(selectedBaseline.map((contract) => [contract.id, contract]));
  const currentById = new Map(currentSelected.map((contract) => [contract.id, contract]));
  const ids = [...new Set([...baselineById.keys(), ...currentById.keys()])].sort();
  const changes = ids.map((contractId) => classifyContractChange(baselineById.get(contractId), currentById.get(contractId)));
  const differ = create({ objectHash: (object: { id?: string }) => object.id ?? JSON.stringify(object) });
  const delta = differ.diff(
    { contracts: selectedBaseline },
    { contracts: currentSelected },
  );
  const regressions = changes.filter((change) => change.kind === "regression" || change.kind === "missing").length;
  const report: RegressionReport = {
    schemaVersion: "1.0",
    runId: id,
    baselineFile,
    generatedAt: new Date().toISOString(),
    passed: regressions === 0,
    selectedContracts: ids.length,
    regressions,
    expectedChanges: changes.filter((change) => change.kind === "expected-change").length,
    improvements: changes.filter((change) => change.kind === "improvement").length,
    changes,
    ...(delta ? { delta } : {}),
  };
  const summary = markdown(report);
  await Promise.all([
    writeFile(path.join(outputDirectory, "regression.json"), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(path.join(outputDirectory, "current-manifest.json"), `${JSON.stringify(current, null, 2)}\n`),
    writeFile(path.join(outputDirectory, "summary.md"), summary),
  ]);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n${summary}\n`);
  }
  return { report, currentManifest: current, outputDirectory, exitCode: report.passed ? 0 : 1 };
}
