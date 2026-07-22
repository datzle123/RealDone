import type { ContractVerification } from "./schema.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderContractVerification(result: ContractVerification): string {
  const rows = result.steps
    .map(
      (step) => `<details class="step ${step.status}" ${step.status === "failed" ? "open" : ""}>
        <summary><span>${escapeHtml(step.status.toUpperCase())}</span><strong>${escapeHtml(step.stepId)} · ${escapeHtml(step.type)}</strong><time>${step.durationMs}ms</time></summary>
        <div><p>${escapeHtml(step.reason)}</p>${step.locatorResolution?.chosenStrategy ? `<p>Locator: <code>${escapeHtml(step.locatorResolution.chosenStrategy)}</code> · weight ${step.locatorResolution.chosenWeight ?? 0} · retries ${step.locatorResolution.retryCount}</p>` : ""}
        <ul>${step.assertions.map((assertion) => `<li class="${assertion.passed ? "ok" : "bad"}">${assertion.passed ? "✓" : "✗"} <small>LEVEL ${assertion.evidenceLevel}</small> ${escapeHtml(assertion.detail)}</li>`).join("")}</ul></div>
      </details>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RealDone verify · ${escapeHtml(result.contractName)}</title><style>body{margin:0;background:#0a0e12;color:#eef3f6;font:15px/1.5 system-ui}.wrap{width:min(980px,calc(100% - 32px));margin:0 auto;padding:52px 0}header{margin-bottom:34px}.eyebrow{color:#39d98a;font:700 12px ui-monospace,monospace;letter-spacing:.14em}h1{font-size:42px;letter-spacing:-.04em;margin:14px 0}.summary{color:#96a4b2}.badge{display:inline-block;padding:7px 11px;border-radius:99px;font:700 12px ui-monospace,monospace;background:${result.passed ? "#123424;color:#67e6a8" : "#3a1720;color:#ff8798"}}.step{border:1px solid #27313c;border-radius:12px;background:#11171e;margin:10px 0;overflow:hidden}.step summary{display:grid;grid-template-columns:96px 1fr auto;gap:12px;padding:15px;cursor:pointer}.step summary span{font:700 11px ui-monospace,monospace}.step.passed summary span,.ok{color:#39d98a}.step.failed summary span,.bad{color:#ff647c}.step.skipped summary span{color:#ffbf69}.step>div{border-top:1px solid #27313c;padding:4px 15px 15px}.step time{color:#96a4b2}ul{list-style:none;padding:0}li{padding:4px 0}li small{display:inline-block;margin-right:7px;color:#7bc5ff;font:700 10px ui-monospace,monospace;letter-spacing:.08em}code{color:#7bc5ff}</style></head><body><main class="wrap"><header><div class="eyebrow">REALDONE / RECORDED VERIFICATION</div><h1>${escapeHtml(result.contractName)}</h1><span class="badge">${result.passed ? "PASSED" : "FAILED"}</span><p class="summary">${escapeHtml(result.verificationId)} · ${escapeHtml(result.startedAt)} · ${result.steps.length} steps</p></header>${rows}</main></body></html>`;
}
