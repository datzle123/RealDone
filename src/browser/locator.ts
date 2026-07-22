import type { Frame, Locator, Page } from "playwright";
import type {
  LocatorAttempt,
  LocatorCandidate,
  LocatorResolution,
  SemanticFingerprint,
} from "../types.js";
import { withRetry } from "../core/retry.js";

function inferredCandidates(fingerprint: SemanticFingerprint): LocatorCandidate[] {
  const candidates: LocatorCandidate[] = [];
  if (fingerprint.testId) candidates.push({ strategy: "testid", weight: 100, value: fingerprint.testId, exact: true });
  if (fingerprint.role && fingerprint.accessibleName) {
    candidates.push({ strategy: "role", weight: 92, role: fingerprint.role, name: fingerprint.accessibleName, exact: true });
    candidates.push({ strategy: "role", weight: 82, role: fingerprint.role, name: fingerprint.accessibleName, exact: false });
  }
  if (fingerprint.id) candidates.push({ strategy: "id", weight: 80, selector: `#${fingerprint.id}` });
  if (fingerprint.href) candidates.push({ strategy: "href", weight: 72, value: fingerprint.href });
  if (fingerprint.text) candidates.push({ strategy: "text", weight: 60, value: fingerprint.text, exact: true });
  candidates.push({ strategy: "css", weight: 35, selector: fingerprint.selector });
  return candidates;
}

type LocatorScope = Page | Frame;

function locatorFor(page: LocatorScope, candidate: LocatorCandidate, fingerprint: SemanticFingerprint): Locator {
  switch (candidate.strategy) {
    case "testid":
      return page.getByTestId(candidate.value ?? fingerprint.testId ?? "");
    case "role":
      {
        const name = candidate.name ?? fingerprint.accessibleName;
        return page.getByRole((candidate.role ?? fingerprint.role) as never, {
          ...(name ? { name } : {}),
          exact: candidate.exact ?? true,
        });
      }
    case "id":
    case "css":
      return page.locator(candidate.selector ?? fingerprint.selector);
    case "href":
      {
        const absolute = candidate.value ?? fingerprint.href ?? "";
        const values = [absolute];
        try {
          const parsed = new URL(absolute);
          values.push(`${parsed.pathname}${parsed.search}${parsed.hash}`);
        } catch {
          // Keep the original value only.
        }
        const selector = [...new Set(values)]
          .map((value) => `a[href="${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"]`)
          .join(", ");
        return page.locator(selector || "a[href]");
      }
    case "text":
      return page.getByText(candidate.value ?? fingerprint.text ?? "", { exact: candidate.exact ?? true });
    case "ordinal":
      return page.locator(candidate.value ?? fingerprint.tag).nth(fingerprint.ordinal);
  }
}

async function visibleMatches(locator: Locator): Promise<{ count: number; visible: number[] }> {
  const count = await locator.count();
  const visible: number[] = [];
  for (let index = 0; index < Math.min(count, 20); index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) visible.push(index);
  }
  return { count, visible };
}

export interface ResolvedLocator {
  locator: Locator;
  diagnostics: LocatorResolution;
}

export class SemanticTargetNotFoundError extends Error {
  constructor(public readonly diagnostics: LocatorResolution) {
    super("No visible element matched the semantic fingerprint. The action was not executed.");
    this.name = "SemanticTargetNotFoundError";
  }
}

export async function resolveSemanticLocator(
  page: LocatorScope,
  fingerprint: SemanticFingerprint,
  retries: number,
): Promise<ResolvedLocator> {
  const attempts: LocatorAttempt[] = [];
  const provided = fingerprint.candidates?.filter((candidate) => candidate.strategy !== "ordinal") ?? [];
  const candidates = [...(provided.length > 0 ? provided : inferredCandidates(fingerprint))].sort(
    (a, b) => b.weight - a.weight,
  );
  let fallback: { locator: Locator; candidate: LocatorCandidate } | undefined;
  let retryCount = 0;

  return withRetry(
    async (retry) => {
      retryCount = retry;
      fallback = undefined;
      for (const candidate of candidates) {
        const startedAt = Date.now();
        try {
          const locator = locatorFor(page, candidate, fingerprint);
          const result = await visibleMatches(locator);
          attempts.push({
            strategy: candidate.strategy,
            weight: candidate.weight,
            matchCount: result.count,
            visibleCount: result.visible.length,
            elapsedMs: Date.now() - startedAt,
          });
          if (result.visible.length === 1) {
            return {
              locator: locator.nth(result.visible[0] ?? 0),
              diagnostics: {
                attempts,
                chosenStrategy: candidate.strategy,
                chosenWeight: candidate.weight,
                retryCount,
              },
            };
          }
          if (result.visible.length > 0 && !fallback) {
            fallback = { locator: locator.nth(result.visible[0] ?? 0), candidate };
          }
        } catch (error) {
          attempts.push({
            strategy: candidate.strategy,
            weight: candidate.weight,
            matchCount: 0,
            visibleCount: 0,
            elapsedMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (fallback) {
        return {
          locator: fallback.locator,
          diagnostics: {
            attempts,
            chosenStrategy: fallback.candidate.strategy,
            chosenWeight: fallback.candidate.weight,
            retryCount,
          },
        };
      }
      throw new SemanticTargetNotFoundError({ attempts, retryCount });
    },
    { retries, baseDelayMs: 160 },
  );
}
