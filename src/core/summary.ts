import type { Finding, ScanSummary, Verdict } from "../types.js";

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

export function summarize(
  findings: Finding[],
  pagesDiscovered: number,
  visibleActions: number,
): ScanSummary {
  const verdicts = Object.fromEntries(verdictOrder.map((verdict) => [verdict, 0])) as Record<
    Verdict,
    number
  >;
  for (const finding of findings) verdicts[finding.verdict] += 1;
  return {
    pagesDiscovered,
    visibleActions,
    actionsVerified: findings.length - verdicts.SKIPPED,
    actionsSkipped: verdicts.SKIPPED,
    verdicts,
  };
}
