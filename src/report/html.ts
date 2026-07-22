import type { Finding, ScanReport, Verdict } from "../types.js";

const verdictOrder: Verdict[] = [
  "VERIFIED",
  "CONTRADICTORY",
  "EPHEMERAL",
  "BROWSER_LOCAL",
  "BROKEN",
  "NO_EFFECT",
  "UNCERTAIN",
  "SKIPPED",
];

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function verdictClass(verdict: Verdict): string {
  return verdict.toLowerCase().replaceAll("_", "-");
}

function findingTimeline(finding: Finding): string {
  const items: Array<{ at: number; text: string }> = [];
  const evidence = finding.evidence;
  if (evidence.before) items.push({ at: evidence.before.at, text: `Opened ${evidence.before.url}` });
  if (evidence.locatorResolution?.chosenStrategy) {
    items.push({
      at: evidence.before?.at ?? 0,
      text: `Resolved action via ${evidence.locatorResolution.chosenStrategy} fingerprint (weight ${evidence.locatorResolution.chosenWeight ?? 0}, retries ${evidence.locatorResolution.retryCount})`,
    });
  }
  for (const field of evidence.filledFields) {
    items.push({ at: evidence.before?.at ?? 0, text: `Filled ${field.name}: ${field.value}` });
  }
  for (const request of evidence.network) {
    items.push({
      at: request.startedAt,
      text: `${request.method} ${request.url}${request.status ? ` → ${request.status}` : request.failure ? ` → ${request.failure}` : ""}`,
    });
  }
  for (const claim of evidence.uiClaims) items.push({ at: claim.at, text: `UI ${claim.kind}: ${claim.text}` });
  for (const upload of evidence.uploads ?? []) items.push({ at: evidence.beforeAction?.at ?? evidence.before?.at ?? 0, text: `Prepared upload ${upload.fileName} (${upload.size} bytes, ${upload.contentType})` });
  for (const download of evidence.downloadEvidence ?? []) items.push({ at: evidence.after?.at ?? evidence.durationMs, text: `Downloaded ${download.fileName} (${download.size ?? 0} bytes)${download.failure ? `; ${download.failure}` : ""}` });
  for (const popup of evidence.popupUrls ?? []) items.push({ at: evidence.after?.at ?? evidence.durationMs, text: `Opened popup ${popup}` });
  for (const socket of evidence.webSockets ?? []) items.push({ at: socket.openedAt, text: `WebSocket ${socket.url}: ${socket.sentFrames} sent, ${socket.receivedFrames} received` });
  if (evidence.afterRefresh) items.push({ at: evidence.afterRefresh.at, text: `Reloaded; canary present: ${evidence.afterRefresh.canaryPresent}` });
  if (evidence.afterHardRefresh) items.push({ at: evidence.afterHardRefresh.at, text: `Hard reloaded without cache; canary present: ${evidence.afterHardRefresh.canaryPresent}` });
  if (evidence.afterNewTab) items.push({ at: evidence.afterNewTab.at, text: `Opened a new tab; canary present: ${evidence.afterNewTab.canaryPresent}` });
  if (evidence.afterNewContext) items.push({ at: evidence.afterNewContext.at, text: `Fresh browser context; canary present: ${evidence.afterNewContext.canaryPresent}` });
  if (evidence.afterAppRestart) items.push({ at: evidence.afterAppRestart.at, text: `Restarted the managed application; canary present: ${evidence.afterAppRestart.canaryPresent}` });
  if (evidence.apiReadBack) items.push({ at: evidence.after?.at ?? evidence.durationMs, text: `API read-back ${evidence.apiReadBack.url} â†’ ${evidence.apiReadBack.status ?? "error"}; canary present: ${evidence.apiReadBack.canaryPresent}` });
  if (evidence.executionError) items.push({ at: evidence.durationMs, text: `Execution error: ${evidence.executionError}` });
  return items
    .sort((a, b) => a.at - b.at)
    .map((item) => `<li><time>${(item.at / 1000).toFixed(2)}s</time><span>${escapeHtml(item.text)}</span></li>`)
    .join("");
}

function findingCard(finding: Finding): string {
  const detectors = finding.detectorMatches
    .map(
      (item) =>
        `<li><code>${escapeHtml(item.code)}</code><span><strong>${escapeHtml(item.title)}</strong><br>${escapeHtml(item.detail)}</span></li>`,
    )
    .join("");
  const screenshot = finding.evidence.screenshot
    ? `<a class="shot" href="${escapeHtml(finding.evidence.screenshot)}"><img src="${escapeHtml(finding.evidence.screenshot)}" alt="Evidence screenshot for ${escapeHtml(finding.id)}"></a>`
    : "";
  const artifacts = [
    finding.evidence.trace ? `<a href="${escapeHtml(finding.evidence.trace)}">Playwright trace</a>` : "",
    finding.evidence.video ? `<a href="${escapeHtml(finding.evidence.video)}">Browser video</a>` : "",
    `<a href="network/${escapeHtml(finding.id)}.json">Network JSON</a>`,
    `<a href="snapshots/${escapeHtml(finding.id)}.json">Snapshots JSON</a>`,
    `<a href="console/${escapeHtml(finding.id)}.json">Console JSON</a>`,
    `<a href="websockets/${escapeHtml(finding.id)}.json">WebSocket JSON</a>`,
    `<a href="uploads/${escapeHtml(finding.id)}.json">Upload JSON</a>`,
    `<a href="downloads/${escapeHtml(finding.id)}.json">Download JSON</a>`,
    `<a href="contracts/${escapeHtml(finding.id)}.json">Replay contract</a>`,
  ].filter(Boolean).join(" · ");
  return `<details class="finding ${verdictClass(finding.verdict)}" ${finding.verdict === "VERIFIED" || finding.verdict === "SKIPPED" ? "" : "open"}>
    <summary>
      <span class="verdict">${escapeHtml(finding.verdict)}</span>
      <span class="finding-title"><strong>${escapeHtml(finding.id)} · ${escapeHtml(finding.action.label)}</strong><small>${escapeHtml(finding.action.pageUrl)}</small></span>
      <span class="level">L${finding.evidenceLevel}</span>
    </summary>
    <div class="finding-body">
      <p class="reason">${escapeHtml(finding.reason)}</p>
      ${finding.skippedReason ? `<p class="skip-note">${escapeHtml(finding.skippedReason)}</p>` : ""}
      ${detectors ? `<h4>Detector matches</h4><ul class="detectors">${detectors}</ul>` : ""}
      ${finding.evidence.startedAt ? `<h4>Timeline</h4><ol class="timeline">${findingTimeline(finding)}</ol>` : ""}
      ${artifacts ? `<h4>Full evidence</h4><p>${artifacts}</p>` : ""}
      ${screenshot}
    </div>
  </details>`;
}

export function renderHtml(report: ScanReport): string {
  const counts = verdictOrder
    .map(
      (verdict) =>
        `<div class="metric ${verdictClass(verdict)}"><span>${escapeHtml(verdict)}</span><strong>${report.summary.verdicts[verdict]}</strong></div>`,
    )
    .join("");
  const pages = report.pages
    .map(
      (page) =>
        `<li><span>${escapeHtml(page.title || "Untitled")}</span><code>${escapeHtml(page.url)}</code><b>${page.actions.length} actions</b></li>`,
    )
    .join("");
  const environment = report.environment
    ? `<section><h2>Environment health</h2><div class="environment ${verdictClass(report.environment.status === "VALID" ? "VERIFIED" : "BROKEN")}"><strong>${escapeHtml(report.environment.status)}</strong><span>${report.environment.render.interactiveElements} interactive elements Â· ${report.environment.assets.checked} critical assets checked Â· ${report.environment.durationMs}ms</span>${report.environment.findings.length > 0 ? `<ul>${report.environment.findings.map((finding) => `<li><code>${escapeHtml(finding.code)}</code><span><b>${escapeHtml(finding.title)}</b><br>${escapeHtml(finding.detail)}${finding.url ? `<br><small>${escapeHtml(finding.url)}</small>` : ""}</span></li>`).join("")}</ul>` : ""}</div></section>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>RealDone · ${escapeHtml(report.scanId)}</title>
  <style>
    :root{color-scheme:dark;--bg:#090c10;--panel:#11161d;--line:#27303b;--text:#f3f6f8;--muted:#97a4b3;--green:#39d98a;--red:#ff647c;--amber:#ffbf69;--blue:#67b7ff;--violet:#ad8cff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% 0,#17242d 0,transparent 30%),var(--bg);color:var(--text);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}.wrap{width:min(1180px,calc(100% - 32px));margin:0 auto;padding:56px 0 80px}.eyebrow{color:var(--green);font:700 12px/1 ui-monospace,monospace;letter-spacing:.16em}.hero h1{font-size:clamp(36px,7vw,76px);line-height:.95;letter-spacing:-.055em;margin:18px 0}.hero p{max-width:800px;color:var(--muted);font-size:18px}.target{display:inline-block;max-width:100%;overflow:auto;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:#0b1117;color:#d6e2eb}.meta{display:flex;gap:18px;flex-wrap:wrap;color:var(--muted);margin:22px 0 34px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}.metric{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}.metric span{display:block;color:var(--muted);font:650 11px/1.2 ui-monospace,monospace}.metric strong{display:block;margin-top:9px;font-size:27px}.metric.verified strong{color:var(--green)}.metric.broken strong,.metric.contradictory strong{color:var(--red)}.metric.ephemeral strong,.metric.uncertain strong{color:var(--amber)}section{margin-top:44px}h2{font-size:22px;letter-spacing:-.02em}.environment{display:grid;gap:8px;border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:16px}.environment.verified strong{color:var(--green)}.environment.broken strong{color:var(--red)}.environment>span,.environment small{color:var(--muted)}.environment ul{list-style:none;padding:0}.environment li{display:flex;gap:12px;padding:8px 0;border-top:1px solid var(--line)}.environment code{color:var(--violet)}.pages{list-style:none;padding:0;border:1px solid var(--line);border-radius:12px;overflow:hidden}.pages li{display:grid;grid-template-columns:180px 1fr auto;gap:18px;padding:12px 14px;border-top:1px solid var(--line);align-items:center}.pages li:first-child{border-top:0}.pages code{color:var(--muted);overflow:auto}.pages b{font-size:12px}.finding{margin:12px 0;border:1px solid var(--line);border-radius:14px;background:rgba(17,22,29,.9);overflow:hidden}.finding summary{display:grid;grid-template-columns:132px 1fr 42px;gap:16px;align-items:center;cursor:pointer;padding:16px 18px}.verdict{font:750 11px/1 ui-monospace,monospace;letter-spacing:.05em}.verified .verdict{color:var(--green)}.broken .verdict,.contradictory .verdict{color:var(--red)}.ephemeral .verdict,.uncertain .verdict{color:var(--amber)}.no-effect .verdict,.browser-local .verdict{color:var(--blue)}.skipped .verdict{color:var(--muted)}.finding-title{min-width:0}.finding-title small{display:block;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.level{font:700 12px/1 ui-monospace,monospace;border:1px solid var(--line);border-radius:100px;padding:7px;text-align:center}.finding-body{padding:0 18px 20px;border-top:1px solid var(--line)}.reason{font-size:17px}.skip-note{color:var(--amber)}h4{margin:22px 0 8px}.detectors,.timeline{list-style:none;padding:0;margin:0}.detectors li,.timeline li{display:flex;gap:12px;padding:8px 0;border-bottom:1px solid rgba(39,48,59,.55)}.detectors code{color:var(--violet)}.timeline time{flex:0 0 54px;color:var(--muted);font:12px ui-monospace,monospace}.shot{display:block;margin-top:20px}.shot img{max-width:100%;border:1px solid var(--line);border-radius:10px}.footer{margin-top:54px;color:var(--muted);font-size:13px}@media(max-width:700px){.pages li{grid-template-columns:1fr}.finding summary{grid-template-columns:110px 1fr}.level{display:none}.wrap{padding-top:32px}}
  </style>
</head>
<body><main class="wrap">
  <header class="hero"><div class="eyebrow">REALDONE / BEHAVIORAL VERIFICATION</div><h1>Your app looks done.<br>Prove it works.</h1><p>Runtime evidence for visible actions, observable effects, and persistence.</p><code class="target">${escapeHtml(report.targetUrl)}</code><div class="meta"><span>Scan ${escapeHtml(report.scanId)}</span><span>${escapeHtml(report.startedAt)}</span><span>${report.summary.pagesDiscovered} pages · ${report.summary.visibleActions} actions</span></div></header>
  <div class="metrics">${counts}</div>
  ${environment}
  <section><h2>Discovered pages</h2><ul class="pages">${pages || "<li>No page could be discovered.</li>"}</ul></section>
  <section><h2>Evidence-backed findings</h2>${report.findings.map(findingCard).join("") || "<p>No actions were executed.</p>"}</section>
  <p class="footer">Generated locally by RealDone. Secrets and credential-like fields are redacted.</p>
</main></body></html>`;
}
