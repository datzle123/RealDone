import type {
  ActionSpec,
  DetectorMatch,
  ExecutionEvidence,
  Finding,
  Verdict,
} from "../types.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function storageHash(evidence: ExecutionEvidence["before"]): string {
  if (!evidence) return "";
  return JSON.stringify(evidence.storage);
}

function hasObservableEffect(evidence: ExecutionEvidence): boolean {
  if (!evidence.before || !evidence.after) return false;
  return (
    evidence.before.domHash !== evidence.after.domHash ||
    evidence.before.url !== evidence.after.url ||
    storageHash(evidence.before) !== storageHash(evidence.after) ||
    evidence.network.length > 0 ||
    evidence.dialogs.length > 0 ||
    evidence.downloads.length > 0
  );
}

function duplicateWrites(evidence: ExecutionEvidence): string | undefined {
  const counts = new Map<string, number>();
  for (const request of evidence.network.filter((entry) => WRITE_METHODS.has(entry.method))) {
    let pathname = request.url;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      // Keep the safe URL as-is.
    }
    const key = `${request.method} ${pathname}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].find(([, count]) => count > 1)?.[0];
}

function match(code: DetectorMatch["code"], title: string, detail: string): DetectorMatch {
  return { code, title, detail };
}

interface DetectionResult {
  verdict: Verdict;
  evidenceLevel: number;
  reason: string;
  detectorMatches: DetectorMatch[];
}

export function detect(action: ActionSpec, evidence: ExecutionEvidence): DetectionResult {
  const matches: DetectorMatch[] = [];
  const writeRequests = evidence.network.filter((request) => WRITE_METHODS.has(request.method));
  const failedWrites = writeRequests.filter((request) => request.failure || (request.status ?? 0) >= 400);
  const hardFailures = evidence.network.filter(
    (request) =>
      (request.failure || (request.status ?? 0) >= 400) &&
      ["document", "xhr", "fetch"].includes(request.resourceType),
  );
  const successClaim = evidence.uiClaims.find((claim) => claim.kind === "success");
  const errorClaim = evidence.uiClaims.find((claim) => claim.kind === "error");
  const authenticationAttempt = /\b(log[ -]?in|sign[ -]?in)\b/i.test(action.label) &&
    action.fields.some((field) => field.type === "password" || /password|email/i.test(`${field.name ?? ""} ${field.label ?? ""}`));
  const generatedCredentialRejection = authenticationAttempt &&
    failedWrites.length > 0 &&
    failedWrites.every((request) => (request.status ?? 0) >= 400 && (request.status ?? 0) < 500) &&
    !successClaim;
  const duplicate = duplicateWrites(evidence);
  const effect = hasObservableEffect(evidence);

  if ((evidence.executionError && !evidence.targetNotFound) || evidence.pageErrors.length > 0 || (hardFailures.length > 0 && !generatedCredentialRejection)) {
    matches.push(
      match(
        "RD001",
        "Broken action",
        evidence.executionError ??
          evidence.pageErrors[0] ??
          `${hardFailures[0]?.method} ${hardFailures[0]?.url} returned ${hardFailures[0]?.status ?? "a transport error"}.`,
      ),
    );
  }
  if (failedWrites.length > 0 && successClaim) {
    matches.push(
      match(
        "RD302",
        "Success despite failure",
        `UI reported success but ${failedWrites[0]?.method} ${failedWrites[0]?.url} returned ${failedWrites[0]?.status ?? "a transport error"}.`,
      ),
    );
  } else if (failedWrites.length > 0 && !errorClaim && !generatedCredentialRejection) {
    matches.push(match("RD303", "Silent failure", "A write request failed without a visible error state."));
  }
  if (duplicate) {
    matches.push(match("RD003", "Duplicate submission", `One action produced multiple ${duplicate} requests.`));
  }
  if (!effect && !evidence.executionError) {
    matches.push(match("RD002", "No observable effect", "No DOM, URL, network, storage, dialog, or download effect was observed."));
  }

  const canaryAppeared = evidence.after?.canaryPresent === true;
  const canarySurvived = evidence.afterRefresh?.canaryPresent === true;
  const browserLocalCanary =
    action.kind === "mutation" &&
    canarySurvived &&
    evidence.afterNewContext !== undefined &&
    !evidence.afterNewContext.canaryPresent;
  const browserLocalDelete =
    action.intent === "delete" &&
    evidence.targetVisibleAfter === false &&
    evidence.targetVisibleAfterRefresh === false &&
    evidence.targetVisibleAfterNewContext === true;
  if (action.kind === "mutation" && failedWrites.length === 0 && canaryAppeared && evidence.afterRefresh && !canarySurvived) {
    matches.push(match("RD101", "Refresh disappearance", "The generated canary appeared after the action and disappeared after reload."));
    if (action.intent === "create") matches.push(match("RD201", "Fake create", "The created resource was not persistent."));
    if (action.intent === "update") matches.push(match("RD202", "Fake update", "The updated value was not persistent."));
  }
  if (
    action.intent === "delete" &&
    evidence.targetVisibleAfter === false &&
    evidence.targetVisibleAfterRefresh === true
  ) {
    matches.push(match("RD203", "Fake delete", "The resource disappeared from the current DOM and returned after reload."));
  }
  if (browserLocalCanary || browserLocalDelete) {
    matches.push(match("RD102", "New-session disappearance", "The result survived reload in the current browser context but was absent in a fresh context."));
  }
  if (successClaim && writeRequests.length === 0 && action.kind === "mutation" && !browserLocalCanary && !browserLocalDelete) {
    matches.push(match("RD301", "Success before proof", "The interface reported success without an observed write request."));
  }

  const first = matches[0];
  if (matches.some((item) => item.code === "RD302" || item.code === "RD301")) {
    return { verdict: "CONTRADICTORY", evidenceLevel: canarySurvived ? 5 : 1, reason: matches.find((item) => item.code === "RD302")?.detail ?? matches.find((item) => item.code === "RD301")?.detail ?? first?.detail ?? "Contradictory evidence", detectorMatches: matches };
  }
  if (matches.some((item) => item.code === "RD001" || item.code === "RD303" || item.code === "RD003")) {
    return { verdict: "BROKEN", evidenceLevel: writeRequests.length > 0 ? 2 : 1, reason: first?.detail ?? "Broken action", detectorMatches: matches };
  }
  if (matches.some((item) => ["RD101", "RD201", "RD202", "RD203"].includes(item.code))) {
    return { verdict: "EPHEMERAL", evidenceLevel: writeRequests.length > 0 ? 3 : 1, reason: matches.find((item) => item.code === "RD101")?.detail ?? matches.find((item) => item.code === "RD203")?.detail ?? first?.detail ?? "Ephemeral state", detectorMatches: matches };
  }
  if (matches.some((item) => item.code === "RD102")) {
    return { verdict: "BROWSER_LOCAL", evidenceLevel: 5, reason: matches.find((item) => item.code === "RD102")?.detail ?? "Browser-local persistence", detectorMatches: matches };
  }
  if (generatedCredentialRejection) {
    return { verdict: "UNCERTAIN", evidenceLevel: 2, reason: "The server rejected generated login credentials; a disposable authenticated test account is required to verify this action.", detectorMatches: matches };
  }
  if (evidence.targetNotFound) {
    return { verdict: "UNCERTAIN", evidenceLevel: 0, reason: "The discovered semantic target was not present in a fresh execution context, so no substitute element was executed.", detectorMatches: matches };
  }
  if (matches.some((item) => item.code === "RD002")) {
    return { verdict: "NO_EFFECT", evidenceLevel: 1, reason: first?.detail ?? "No observable effect", detectorMatches: matches };
  }
  if (action.kind === "mutation") {
    if (canarySurvived) return { verdict: "VERIFIED", evidenceLevel: 5, reason: "The generated canary remained after page reload.", detectorMatches: matches };
    const accepted = writeRequests.some((request) => request.ok);
    if (accepted) return { verdict: "UNCERTAIN", evidenceLevel: 3, reason: "The backend accepted a write, but the canary could not be read back from the UI.", detectorMatches: matches };
    return { verdict: "UNCERTAIN", evidenceLevel: effect ? 1 : 0, reason: "An effect was observed, but persistence could not be established.", detectorMatches: matches };
  }
  if (effect) return { verdict: "VERIFIED", evidenceLevel: evidence.network.length > 0 ? 2 : 1, reason: "The action produced an observable effect.", detectorMatches: matches };
  return { verdict: "UNCERTAIN", evidenceLevel: 0, reason: "There was not enough evidence to classify the action.", detectorMatches: matches };
}

export function findingFromEvidence(
  id: string,
  action: ActionSpec,
  evidence: ExecutionEvidence,
): Finding {
  return { id, action, evidence, ...detect(action, evidence) };
}
