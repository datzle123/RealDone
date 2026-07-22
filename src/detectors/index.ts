import type {
  ActionSpec,
  DetectorMatch,
  EvidenceLevel,
  ExecutionEvidence,
  Finding,
  Verdict,
} from "../types.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function actionNetwork(evidence: ExecutionEvidence): ExecutionEvidence["network"] {
  const actionFinishedAt = evidence.after?.at;
  return actionFinishedAt === undefined
    ? evidence.network
    : evidence.network.filter((request) => request.startedAt <= actionFinishedAt);
}

function storageHash(evidence: ExecutionEvidence["before"]): string {
  if (!evidence) return "";
  return JSON.stringify(evidence.storage);
}

function hasObservableEffect(evidence: ExecutionEvidence): boolean {
  const before = evidence.beforeAction ?? evidence.before;
  if (!before || !evidence.after) return false;
  return (
    before.domHash !== evidence.after.domHash ||
    before.url !== evidence.after.url ||
    storageHash(before) !== storageHash(evidence.after) ||
    actionNetwork(evidence).length > 0 ||
    evidence.dialogs.length > 0 ||
    evidence.downloads.length > 0 ||
    (evidence.webSockets?.length ?? 0) > 0 ||
    (evidence.popupUrls?.length ?? 0) > 0
  );
}

function duplicateWrites(evidence: ExecutionEvidence): string | undefined {
  const counts = new Map<string, number>();
  for (const request of actionNetwork(evidence).filter((entry) => WRITE_METHODS.has(entry.method))) {
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
  evidenceLevel: EvidenceLevel;
  reason: string;
  detectorMatches: DetectorMatch[];
}

export function detect(action: ActionSpec, evidence: ExecutionEvidence): DetectionResult {
  const matches: DetectorMatch[] = [];
  const observedActionNetwork = actionNetwork(evidence);
  const writeRequests = observedActionNetwork.filter((request) => WRITE_METHODS.has(request.method));
  const failedWrites = writeRequests.filter((request) => request.failure || (request.status ?? 0) >= 400);
  const hardFailures = observedActionNetwork.filter(
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
  const authenticatedSessionPersisted = authenticationAttempt &&
    writeRequests.some((request) => request.ok) &&
    (evidence.afterRefresh?.auth?.artifacts ?? 0) > 0 &&
    evidence.afterRefresh?.auth?.privateContent === true;
  const duplicate = duplicateWrites(evidence);
  const effect = hasObservableEffect(evidence);
  const afterText = evidence.after?.semanticDom?.text ?? "";
  const actionContext = `${action.label} ${action.pageUrl} ${evidence.after?.url ?? ""}`;
  const successfulWrites = writeRequests.filter((request) => request.ok);
  const successfulReads = observedActionNetwork.filter((request) => request.method === "GET" && request.ok && ["xhr", "fetch"].includes(request.resourceType));
  const storageChanged = storageHash(evidence.beforeAction ?? evidence.before) !== storageHash(evidence.after);
  const searchAttempt = /\b(search|find|query|filter)\b/i.test(action.label) || action.fields.some((field) => field.type === "search" || /search|query/i.test(`${field.name ?? ""} ${field.label ?? ""}`));
  const logoutAttempt = /\b(log[ -]?out|sign[ -]?out)\b/i.test(action.label);
  const uploadAttempt = action.fields.some((field) => field.type === "file") || /\bupload\b/i.test(action.label);
  const downloadAttempt = Boolean(action.fingerprint.download) || /\b(download|export)\b/i.test(action.label);
  const paymentAttempt = /\b(pay|payment|purchase|checkout|subscribe)\b/i.test(action.label);

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
  if (action.kind === "navigation" && ((evidence.executionError && !evidence.targetNotFound) || hardFailures.some((request) => request.resourceType === "document"))) {
    matches.push(match("RD005", "Broken navigation", "The navigation target failed to load successfully."));
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
    if (evidence.targetDisabledAfter === false) {
      matches.push(match("RD006", "Disabled-after-click failure", "The action remained enabled while duplicate writes were submitted."));
    }
  }
  if (effect && !storageChanged && observedActionNetwork.length === 0 && /\b(demo|sample)\s+(data|records?|customers?|orders?)\b/i.test(action.label)) {
    matches.push(match("RD401", "Static demo data", "The action displayed demo-like records without an observed data request or persisted state."));
  }
  if (effect && !storageChanged && observedActionNetwork.length === 0 && /\b(frontend fixture|mock data|fixture data)\b/i.test(action.label)) {
    matches.push(match("RD402", "Frontend fixture data", "The action displayed fixture-like records entirely in the browser with no observable source read."));
  }
  if (searchAttempt && effect && evidence.after?.bodyCanaryPresent === false && successfulReads.length === 0) {
    matches.push(match("RD403", "Static search", "Generated search input changed the interface, but neither the query nor a data request appeared in the result evidence."));
  }
  if (/\bdashboard\b/i.test(actionContext) && /\brefresh\b/i.test(action.label) && successfulReads.length === 0) {
    matches.push(match("RD404", "Static dashboard", "A dashboard refresh/load action performed no observable data read."));
  }
  if (
    action.kind === "navigation" &&
    /\/(detail|customers?|orders?|invoices?|items?)\/[^/]+/i.test(evidence.after?.url ?? action.fingerprint.href ?? "") &&
    /\b(coming soon|placeholder|not implemented|lorem ipsum)\b/i.test(afterText)
  ) {
    matches.push(match("RD405", "Placeholder detail page", "A detail-like route rendered placeholder content instead of resource evidence."));
  }
  if (
    evidence.targetBusyAfter === true ||
    ((evidence.after?.busyControls ?? 0) > ((evidence.beforeAction ?? evidence.before)?.busyControls ?? 0) && evidence.networkSettled === false)
  ) {
    matches.push(match("RD004", "Stuck loading", "The action remained busy after the configured settle/network-idle window."));
  }
  if (!effect && !evidence.executionError) {
    matches.push(match("RD002", "No observable effect", "No DOM, URL, network, storage, dialog, or download effect was observed."));
    if (action.activation === "enter") {
      matches.push(match("RD007", "Keyboard action missed", "The discovered Enter action produced no observable effect."));
    }
  }

  const canaryAppeared = evidence.after?.canaryPresent === true;
  const canarySurvived = evidence.afterRefresh?.canaryPresent === true;
  const browserLocalCanary =
    action.kind === "mutation" &&
    canarySurvived &&
    evidence.afterNewContext !== undefined &&
    !evidence.afterNewContext.canaryPresent &&
    !(evidence.apiReadBack?.ok && evidence.apiReadBack.canaryPresent);
  const browserLocalDelete =
    action.intent === "delete" &&
    evidence.targetVisibleAfter === false &&
    evidence.targetVisibleAfterRefresh === false &&
    evidence.targetVisibleAfterNewContext === true;
  if (action.kind === "mutation" && !authenticatedSessionPersisted && effect && failedWrites.length === 0 && canaryAppeared && evidence.afterRefresh && !canarySurvived) {
    matches.push(match("RD101", "Refresh disappearance", "The generated canary appeared after the action and disappeared after reload."));
    matches.push(match("RD104", "Memory-only state", "The result existed immediately after the action but not after reload."));
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
    matches.push(match("RD102", "Browser-local persistence", "The result survived reload in the current browser context but was absent in a fresh context."));
    matches.push(match("RD103", "New-session disappearance", "A new browser session could not observe the result confirmed in the original session."));
  }
  if (
    action.kind === "mutation" &&
    evidence.afterAppRestart &&
    (evidence.afterHardRefresh?.canaryPresent || evidence.afterRefresh?.canaryPresent) &&
    !evidence.afterAppRestart.canaryPresent
  ) {
    matches.push(match("RD105", "App-restart disappearance", "The result survived browser reloads but disappeared after the managed application restarted."));
  }
  if (
    action.intent === "update" &&
    evidence.apiReadBack?.ok &&
    (evidence.apiReadBack.expectedFieldValues ?? 0) > 1 &&
    (evidence.apiReadBack.matchedFieldValues ?? 0) > 0 &&
    (evidence.apiReadBack.matchedFieldValues ?? 0) < (evidence.apiReadBack.expectedFieldValues ?? 0)
  ) {
    matches.push(match("RD204", "Partial update", "API read-back confirmed only part of the generated multi-field update."));
  }
  if (
    action.intent === "update" &&
    evidence.apiReadBack?.ok &&
    (evidence.apiReadBack.expectedFieldValues ?? 0) > 0 &&
    evidence.apiReadBack.matchedFieldValues === 0 &&
    canaryAppeared
  ) {
    matches.push(match("RD205", "Wrong resource update", "The UI showed the generated update but API read-back returned none of its field values."));
  }
  const redirectedToSuccess = action.kind === "mutation" &&
    evidence.before && evidence.after && evidence.before.url !== evidence.after.url &&
    /\b(success|complete|completed|done)\b/i.test(new URL(evidence.after.url).pathname);
  if (redirectedToSuccess && writeRequests.length === 0) {
    matches.push(match("RD304", "False success redirect", "The action navigated to a success-like route without an observed write."));
    matches.push(match("RD305", "Hard-coded success endpoint", "A success endpoint was reachable without backend mutation evidence."));
  }
  if (authenticationAttempt && effect && successfulWrites.length === 0 && (evidence.after?.auth?.privateContent || successClaim) && (evidence.after?.auth?.artifacts ?? 0) === 0) {
    matches.push(match("RD501", "Fake login", "The interface entered an authenticated-looking state without a successful authentication write or session artifact."));
  }
  if (logoutAttempt && (evidence.before?.auth?.artifacts ?? 0) > 0 && (evidence.after?.auth?.artifacts ?? 0) >= (evidence.before?.auth?.artifacts ?? 0) && evidence.after?.auth?.privateContent && !evidence.after.auth.accessDenied) {
    matches.push(match("RD502", "Logout does not revoke", "Logout left the prior session artifact and private content active."));
  }
  if (authenticationAttempt && evidence.after?.auth?.privateContent && evidence.afterRefresh && !evidence.afterRefresh.auth?.privateContent && (evidence.afterRefresh.auth?.artifacts ?? 0) === 0) {
    matches.push(match("RD503", "Session not persistent", "The authenticated state disappeared after reload."));
  }
  if ((evidence.after?.auth?.expiredArtifacts ?? 0) > 0 && evidence.after?.auth?.privateContent && !evidence.after.auth.accessDenied) {
    matches.push(match("RD504", "Expired session accepted", "Private content remained accessible while an expired authentication artifact was present."));
  }
  if (
    action.kind === "navigation" &&
    /\/(private|account|settings|admin)(\/|$)/i.test(evidence.after?.url ?? action.fingerprint.href ?? "") &&
    (evidence.before?.auth?.artifacts ?? 0) === 0 &&
    (evidence.after?.auth?.privateContent || evidence.after?.auth?.adminContent) &&
    !evidence.after?.auth?.accessDenied
  ) {
    matches.push(match("RD505", "Direct private route access", "A private-looking route rendered protected content without an authentication artifact."));
  }
  if (uploadAttempt && effect && successfulWrites.length === 0) {
    matches.push(match("RD701", "Fake upload", "The upload changed the interface without a successful write request."));
  }
  if (uploadAttempt && (evidence.after?.temporaryBlobUrls ?? 0) > (evidence.beforeAction?.temporaryBlobUrls ?? evidence.before?.temporaryBlobUrls ?? 0)) {
    matches.push(match("RD702", "Temporary blob upload", "The uploaded resource was represented only by a browser blob URL."));
  }
  if (downloadAttempt && (evidence.downloads.length === 0 || evidence.downloadEvidence?.some((download) => download.failure || download.size === 0))) {
    matches.push(match("RD703", "Broken download", "The download action produced no usable non-empty browser download."));
  }
  if (downloadAttempt && evidence.downloadEvidence?.some((download) => (download.expectedFieldValues ?? 0) > 0 && download.matchedFieldValues === 0)) {
    matches.push(match("RD704", "Static export", "The exported content contained none of the generated field values used for the export."));
  }
  if (downloadAttempt && evidence.downloadEvidence?.some((download) => (download.expectedFieldValues ?? 0) > 1 && (download.matchedFieldValues ?? 0) > 0 && (download.matchedFieldValues ?? 0) < (download.expectedFieldValues ?? 0))) {
    matches.push(match("RD705", "Incomplete export", "The exported content contained only part of the generated multi-field data."));
  }
  if (paymentAttempt && (successClaim || /\b(success(?:ful)?|paid|complete)\b/i.test(afterText)) && successfulWrites.length === 0) {
    matches.push(match("RD801", "Fake payment success", "Payment success appeared without an observed successful payment write."));
  }
  if (action.kind === "navigation" && /\b(success|complete|paid)\b/i.test(new URL(evidence.after?.url ?? action.fingerprint.href ?? action.pageUrl).pathname) && /\b(payment|order|checkout|success(?:ful)?|complete)\b/i.test(afterText) && writeRequests.length === 0) {
    matches.push(match("RD802", "Direct success route", "A payment/order success route rendered directly without prior write evidence."));
  }
  if (paymentAttempt && duplicate) {
    matches.push(match("RD803", "Duplicate payment", "One payment action submitted the same payment endpoint multiple times."));
  }
  if (paymentAttempt && successfulWrites.length > 0 && (successClaim || /\b(success(?:ful)?|paid|complete)\b/i.test(afterText))) {
    matches.push(match("RD804", "Missing provider confirmation", "The application reported payment success, but this scan had no independent provider confirmation."));
  }
  if (/\bwebhook\b/i.test(action.label) && successfulWrites.length > 0 && !evidence.after?.bodyCanaryPresent && !successClaim) {
    matches.push(match("RD805", "Webhook outcome missing", "A webhook-like write was accepted without an observable application outcome."));
  }
  if (successClaim && writeRequests.length === 0 && action.kind === "mutation" && !browserLocalCanary && !browserLocalDelete) {
    matches.push(match("RD301", "Success before proof", "The interface reported success without an observed write request."));
  }

  const first = matches[0];
  if (matches.some((item) => ["RD301", "RD302", "RD304", "RD305", "RD401", "RD402", "RD403", "RD404", "RD405", "RD501", "RD701", "RD702", "RD704", "RD705", "RD801", "RD802", "RD805"].includes(item.code))) {
    return { verdict: "CONTRADICTORY", evidenceLevel: canarySurvived ? 5 : 1, reason: matches.find((item) => item.code === "RD302")?.detail ?? matches.find((item) => item.code === "RD301")?.detail ?? first?.detail ?? "Contradictory evidence", detectorMatches: matches };
  }
  if (matches.some((item) => ["RD001", "RD003", "RD004", "RD005", "RD006", "RD007", "RD205", "RD303", "RD502", "RD504", "RD505", "RD703", "RD803"].includes(item.code))) {
    return { verdict: "BROKEN", evidenceLevel: writeRequests.length > 0 ? 2 : 1, reason: first?.detail ?? "Broken action", detectorMatches: matches };
  }
  if (matches.some((item) => ["RD101", "RD104", "RD105", "RD201", "RD202", "RD203", "RD204", "RD503"].includes(item.code))) {
    return { verdict: "EPHEMERAL", evidenceLevel: writeRequests.length > 0 ? 3 : 1, reason: matches.find((item) => item.code === "RD101")?.detail ?? matches.find((item) => item.code === "RD203")?.detail ?? first?.detail ?? "Ephemeral state", detectorMatches: matches };
  }
  if (matches.some((item) => item.code === "RD102")) {
    return { verdict: "BROWSER_LOCAL", evidenceLevel: 5, reason: matches.find((item) => item.code === "RD102")?.detail ?? "Browser-local persistence", detectorMatches: matches };
  }
  if (generatedCredentialRejection) {
    return { verdict: "UNCERTAIN", evidenceLevel: 2, reason: "The server rejected generated login credentials; a disposable authenticated test account is required to verify this action.", detectorMatches: matches };
  }
  if (matches.some((item) => item.code === "RD804")) {
    return { verdict: "UNCERTAIN", evidenceLevel: 3, reason: matches.find((item) => item.code === "RD804")?.detail ?? "Provider confirmation is required.", detectorMatches: matches };
  }
  if (evidence.targetNotFound) {
    return { verdict: "UNCERTAIN", evidenceLevel: 0, reason: "The discovered semantic target was not present in a fresh execution context, so no substitute element was executed.", detectorMatches: matches };
  }
  if (authenticationAttempt && successfulWrites.length > 0 && (evidence.afterRefresh?.auth?.artifacts ?? 0) > 0 && evidence.afterRefresh?.auth?.privateContent) {
    return { verdict: "VERIFIED", evidenceLevel: 5, reason: "Authentication produced a session artifact and private state that survived reload.", detectorMatches: matches };
  }
  if (logoutAttempt && (evidence.before?.auth?.artifacts ?? 0) > 0 && (evidence.after?.auth?.artifacts ?? 0) === 0 && (!evidence.after?.auth?.privateContent || evidence.after.auth.accessDenied)) {
    return { verdict: "VERIFIED", evidenceLevel: evidence.afterRefresh && (evidence.afterRefresh.auth?.artifacts ?? 0) === 0 ? 5 : 1, reason: "Logout removed the session artifact and blocked the prior private state.", detectorMatches: matches };
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
  if (effect) return { verdict: "VERIFIED", evidenceLevel: observedActionNetwork.length > 0 ? 2 : 1, reason: "The action produced an observable effect.", detectorMatches: matches };
  return { verdict: "UNCERTAIN", evidenceLevel: 0, reason: "There was not enough evidence to classify the action.", detectorMatches: matches };
}

export function findingFromEvidence(
  id: string,
  action: ActionSpec,
  evidence: ExecutionEvidence,
): Finding {
  return { id, action, evidence, ...detect(action, evidence) };
}
