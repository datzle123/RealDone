import type { BehaviorManifest } from "../baseline/manifest.js";
import type { RegressionReport } from "../baseline/regression.js";
import type { CommandResult } from "./command.js";

export interface FollowUpInput {
  task: string;
  agent?: CommandResult;
  build?: CommandResult;
  regression?: RegressionReport;
  currentManifest?: BehaviorManifest;
  baselineTampered?: boolean;
  contractFilesChanged?: string[];
  verificationError?: string;
}

function tail(value: string, limit = 2_000): string {
  const trimmed = value.trim();
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(-limit)}`;
}

export function renderFollowUpPrompt(input: FollowUpInput): string {
  const observed: string[] = [];
  if (input.baselineTampered) observed.push("- The coding-agent run modified or removed the sealed pre-agent baseline.");
  if ((input.contractFilesChanged?.length ?? 0) > 0) {
    observed.push(`- Behavior contracts changed during the agent run: ${input.contractFilesChanged?.join(", ")}`);
  }
  if (input.verificationError) observed.push(`- Independent verification could not complete: ${input.verificationError}`);
  if (input.agent && (input.agent.exitCode !== 0 || input.agent.timedOut || input.agent.spawnError)) {
    observed.push(`- Agent command did not complete successfully (exit ${input.agent.exitCode ?? "none"}${input.agent.timedOut ? ", timed out" : ""}).`);
  }
  if (input.build && input.build.exitCode !== 0) {
    observed.push(`- Rebuild failed (exit ${input.build.exitCode ?? "none"}).`);
    const diagnostic = tail(input.build.stderr || input.build.stdout);
    if (diagnostic) observed.push(`\nBuild diagnostic:\n\n\`\`\`text\n${diagnostic}\n\`\`\``);
  }
  for (const change of input.regression?.changes ?? []) {
    if (change.kind === "regression" || change.kind === "missing") {
      observed.push(`- ${change.name}: ${change.detail}`);
    }
  }
  for (const contract of input.currentManifest?.contracts ?? []) {
    if (contract.baseline?.passed !== false) continue;
    for (const step of contract.baseline.steps.filter((item) => item.status === "failed")) {
      const failures = step.assertions.filter((assertion) => !assertion.passed);
      if (failures.length === 0) observed.push(`- ${contract.name} / ${step.id}: step failed.`);
      for (const assertion of failures) observed.push(`- ${contract.name} / ${step.id}: ${assertion.detail}`);
    }
  }
  return `The implementation is not behaviorally complete.

Original task:
${input.task}

Observed by independent build and RealDone verification:
${observed.join("\n") || "- Verification did not produce a passing result."}

Required correction:
- Fix the implementation, not the test evidence.
- Preserve behavior contracts that still pass.
- Rebuild the application and rerun the affected RealDone flows.
- Do not treat an agent success message, UI toast, or HTTP success alone as proof.

Completion requires the independent behavioral verification gate to pass.
`;
}
