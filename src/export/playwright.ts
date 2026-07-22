import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadBehaviorContract, type BehaviorContract, type BehaviorStep, type ContractExpectation } from "../contracts/schema.js";
import type { LocatorCandidate, SemanticFingerprint } from "../types.js";

function literal(value: string): string {
  return JSON.stringify(value);
}

function locatorExpression(fingerprint: SemanticFingerprint): string {
  const candidates = [...(fingerprint.candidates ?? [])].sort((a, b) => b.weight - a.weight);
  const preferred = candidates.find((item) => ["testid", "role", "id", "text", "css"].includes(item.strategy));
  const candidate: LocatorCandidate = preferred ?? { strategy: "css", weight: 0, selector: fingerprint.selector };
  switch (candidate.strategy) {
    case "testid":
      return `page.getByTestId(${literal(candidate.value ?? fingerprint.testId ?? "")})`;
    case "role":
      return `page.getByRole(${literal(candidate.role ?? fingerprint.role ?? "button")} as never, { name: ${literal(candidate.name ?? fingerprint.accessibleName ?? "")}, exact: ${candidate.exact ?? true} })`;
    case "id":
    case "css":
      return `page.locator(${literal(candidate.selector ?? fingerprint.selector)})`;
    case "text":
      return `page.getByText(${literal(candidate.value ?? fingerprint.text ?? "")}, { exact: ${candidate.exact ?? true} })`;
    default:
      return `page.locator(${literal(fingerprint.selector)})`;
  }
}

function requestExpectation(step: BehaviorStep): Extract<ContractExpectation, { type: "request" }> | undefined {
  return step.expected.find((item): item is Extract<ContractExpectation, { type: "request" }> => item.type === "request");
}

function assertionLines(step: BehaviorStep): string[] {
  return step.expected.flatMap((expectation): string[] => {
    if (expectation.type === "text") {
      return [`  await expect(page.getByText(${literal(expectation.value)}, { exact: true }).last()).toBeVisible();`];
    }
    if (expectation.type === "url") {
      return [`  await expect.poll(() => new URL(page.url()).pathname).toMatch(new RegExp(${literal(expectation.pattern)}));`];
    }
    if (expectation.type === "persistence") {
      return [
        "  await page.reload({ waitUntil: 'domcontentloaded' });",
        `  await expect(page.getByText(${literal(expectation.value)}, { exact: false }).last()).toBeVisible();`,
      ];
    }
    if (expectation.type === "source") {
      return [`  // Level 6 PostgreSQL assertion remains in the RealDone contract (${expectation.resource}).`];
    }
    if (expectation.type === "provider") {
      return [`  // Provider assertion remains in the RealDone contract (${expectation.provider}/${expectation.kind}).`];
    }
    if (expectation.type === "cross-role") {
      return [`  // Level 7 cross-role assertion remains in the RealDone contract (${expectation.role}).`];
    }
    return [];
  });
}

function stepLines(step: BehaviorStep, baseUrl: string): string[] {
  const roleComment = step.role ? [`  // RealDone role: ${step.role}`] : [];
  if (step.type === "navigate") {
    let pathname = step.url ?? step.pageUrl;
    try {
      const parsed = new URL(pathname);
      pathname = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      // Keep recorded value.
    }
    return [...roleComment, `  await page.goto(new URL(${literal(pathname)}, baseURL).toString(), { waitUntil: 'domcontentloaded' });`];
  }
  if (!step.fingerprint) return [...roleComment, `  // ${step.id}: missing fingerprint`];
  const locator = locatorExpression(step.fingerprint);
  const lines = [...roleComment, `  const ${step.id} = ${locator};`];
  const request = requestExpectation(step);
  if (request) {
    lines.push(
      `  const ${step.id}Response = page.waitForResponse(response => response.request().method() === ${literal(request.method)} && new RegExp(${literal(request.urlPattern)}).test(new URL(response.url()).pathname + new URL(response.url()).search));`,
    );
  }
  if (step.type === "fill") {
    if (step.secretEnv) {
      lines.push(
        `  const ${step.id}Value = process.env[${literal(step.secretEnv)}];`,
        `  expect(${step.id}Value, ${literal(`Set ${step.secretEnv} before running this test`)}).toBeTruthy();`,
        `  await ${step.id}.fill(${step.id}Value!);`,
      );
    } else {
      lines.push(`  await ${step.id}.fill(${literal(step.value ?? "")});`);
    }
  } else if (step.type === "check") {
    lines.push(`  await ${step.id}.${step.checked === false ? "uncheck" : "check"}();`);
  } else if (step.type === "select") {
    lines.push(`  await ${step.id}.selectOption(${literal(step.value ?? "")});`);
  } else if (step.type === "click") {
    lines.push(`  await ${step.id}.click();`);
  }
  if (request) {
    lines.push(`  const ${step.id}ObservedResponse = await ${step.id}Response;`);
    if (request.status !== undefined) lines.push(`  expect(${step.id}ObservedResponse.status()).toBe(${request.status});`);
  }
  lines.push(...assertionLines(step));
  return lines;
}

export function renderPlaywrightTest(contract: BehaviorContract): string {
  const lines = contract.steps.flatMap((step) => [...stepLines(step, contract.baseUrl), ""]);
  return `import { test, expect } from '@playwright/test';

test(${literal(contract.name)}, async ({ page }) => {
  const baseURL = process.env.REALDONE_BASE_URL ?? ${literal(contract.baseUrl)};

${lines.join("\n").trimEnd()}
});
`;
}

export async function exportPlaywrightTest(contractFile: string, outputFile: string): Promise<string> {
  const contract = await loadBehaviorContract(path.resolve(contractFile));
  const output = path.resolve(outputFile);
  await mkdir(path.dirname(output), { recursive: true });
  const source = renderPlaywrightTest(contract);
  await writeFile(output, source);
  return output;
}
