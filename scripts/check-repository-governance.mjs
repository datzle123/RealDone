import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

const manifestPath = path.resolve(root, option("--manifest", ".github/repository-governance.json"));
const workflowPath = path.resolve(root, option("--workflow", ".github/workflows/ci.yml"));
const remote = args.includes("--remote");

const [manifestText, workflow] = await Promise.all([
  readFile(manifestPath, "utf8"),
  readFile(workflowPath, "utf8"),
]);
const policy = JSON.parse(manifestText);
const violations = [];

function requireValue(condition, code, message) {
  if (!condition) violations.push(`${code}: ${message}`);
}

requireValue(policy.schemaVersion === "1.0", "GOV001", "schemaVersion must be 1.0");
requireValue(typeof policy.repository === "string" && /^[^/]+\/[^/]+$/.test(policy.repository), "GOV002", "repository must be owner/name");
requireValue(typeof policy.branch === "string" && policy.branch.length > 0, "GOV003", "branch is required");
requireValue(policy.requiredPullRequest === true, "GOV004", "pull requests must be required");
requireValue(Number.isInteger(policy.requiredApprovingReviewCount) && policy.requiredApprovingReviewCount >= 0, "GOV005", "requiredApprovingReviewCount must be a non-negative integer");
requireValue(policy.strict === true, "GOV006", "required checks must be strict/up-to-date");
requireValue(policy.enforceAdmins === true, "GOV007", "administrator enforcement must be enabled");
requireValue(policy.requiredConversationResolution === true, "GOV008", "conversation resolution must be required");
requireValue(policy.allowForcePushes === false, "GOV009", "force pushes must be disabled");
requireValue(policy.allowDeletions === false, "GOV010", "branch deletion must be disabled");
requireValue(Array.isArray(policy.requiredStatusChecks) && policy.requiredStatusChecks.length > 0, "GOV011", "at least one required status check is required");

const requiredStatusChecks = Array.isArray(policy.requiredStatusChecks) ? policy.requiredStatusChecks : [];
const workflowLines = workflow.split(/\r?\n/).map((line) => line.trim());
for (const check of requiredStatusChecks) {
  requireValue(typeof check.context === "string" && check.context.length > 0, "GOV012", "status-check context is required");
  requireValue(Number.isInteger(check.appId) && check.appId > 0, "GOV013", "status-check appId must be a positive integer");
  requireValue(workflowLines.includes(`name: ${check.context}`), "GOV014", `workflow job is missing required context ${check.context}`);
}
requireValue(workflow.includes("name: Require successful prerequisite jobs"), "GOV015", "aggregate job must reject unsuccessful prerequisites");
requireValue(workflow.split(/\r?\n/).includes("    if: ${{ always() }}"), "GOV016", "aggregate job must run even when a prerequisite fails or is cancelled");

let protection;
if (remote) {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN is required for --remote.");
  const repository = option("--repository", policy.repository);
  const response = await fetch(`https://api.github.com/repos/${repository}/branches/${encodeURIComponent(policy.branch)}/protection`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "realdone-governance-check",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub branch-protection query failed with HTTP ${response.status}.`);
  protection = await response.json();

  requireValue(protection.required_status_checks?.strict === policy.strict, "GOV101", "remote strict status-check setting differs from policy");
  for (const check of requiredStatusChecks) {
    const match = protection.required_status_checks?.checks?.some((remoteCheck) =>
      remoteCheck.context === check.context && remoteCheck.app_id === check.appId);
    requireValue(match === true, "GOV102", `remote required check differs from policy: ${check.context}`);
  }
  requireValue((protection.required_pull_request_reviews != null) === policy.requiredPullRequest, "GOV103", "remote pull-request requirement differs from policy");
  requireValue(protection.required_pull_request_reviews?.required_approving_review_count === policy.requiredApprovingReviewCount, "GOV104", "remote approving-review count differs from policy");
  requireValue(protection.enforce_admins?.enabled === policy.enforceAdmins, "GOV105", "remote administrator enforcement differs from policy");
  requireValue(protection.required_conversation_resolution?.enabled === policy.requiredConversationResolution, "GOV106", "remote conversation-resolution setting differs from policy");
  requireValue(protection.allow_force_pushes?.enabled === policy.allowForcePushes, "GOV107", "remote force-push setting differs from policy");
  requireValue(protection.allow_deletions?.enabled === policy.allowDeletions, "GOV108", "remote deletion setting differs from policy");
}

const result = {
  passed: violations.length === 0,
  remote,
  repository: policy.repository,
  branch: policy.branch,
  requiredStatusChecks: policy.requiredStatusChecks,
  violations,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (violations.length > 0) process.exitCode = 1;
