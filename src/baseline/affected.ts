import path from "node:path";
import type { BehaviorManifest, ManifestContract } from "./manifest.js";

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((item) => item.length >= 3 && !["src", "app", "api", "test", "page", "index"].includes(item)),
  );
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("**", "::DOUBLE::").replaceAll("*", "[^/]*").replaceAll("::DOUBLE::", ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function contractAffected(contract: ManifestContract, changedFile: string): boolean {
  const normalized = changedFile.split(path.sep).join("/");
  if (contract.sourceFiles.some((glob) => globToRegExp(glob).test(normalized))) return true;
  const fileTokens = tokens(normalized);
  const behaviorTokens = tokens(
    [contract.name, ...contract.routes, ...contract.endpoints.map((endpoint) => endpoint.pattern)].join(" "),
  );
  return [...fileTokens].some((token) => behaviorTokens.has(token));
}

export function selectAffectedContracts(
  manifest: BehaviorManifest,
  changedFiles: string[],
): ManifestContract[] {
  if (changedFiles.length === 0) return manifest.contracts;
  const selected = manifest.contracts.filter(
    (contract) =>
      contract.tags.includes("critical") ||
      changedFiles.some((file) => contractAffected(contract, file)),
  );
  // A zero-match result is not proof that product behavior is unaffected. This
  // commonly occurs for a newly recorded contract with no sourceFiles mapping.
  // Fail closed by verifying the full manifest instead of reporting a 0-flow pass.
  return selected.length > 0 ? selected : manifest.contracts;
}
