import assert from "node:assert/strict";
import test from "node:test";
import { selectAffectedContracts } from "../src/baseline/affected.js";
import { renderPlaywrightTest } from "../src/export/playwright.js";
import type { BehaviorManifest } from "../src/baseline/manifest.js";
import type { BehaviorContract } from "../src/contracts/schema.js";

test("affected-flow selection uses explicit source scope and route tokens", () => {
  const manifest: BehaviorManifest = {
    schemaVersion: "1.0",
    generatedAt: "2026-07-22T00:00:00.000Z",
    contracts: [
      { id: "customer", name: "Create customer", file: "flows/customer.json", hash: "a", tags: [], routes: ["/customers"], endpoints: [{ method: "POST", pattern: "^/api/customers$" }], sourceFiles: ["src/features/customers/**"], stepCount: 2 },
      { id: "invoice", name: "Create invoice", file: "flows/invoice.json", hash: "b", tags: [], routes: ["/invoices"], endpoints: [], sourceFiles: [], stepCount: 2 },
      { id: "critical", name: "Login", file: "flows/login.json", hash: "c", tags: ["critical"], routes: ["/login"], endpoints: [], sourceFiles: [], stepCount: 2 },
    ],
  };
  const selected = selectAffectedContracts(manifest, ["src/features/customers/form.tsx"]);
  assert.deepEqual(selected.map((item) => item.id), ["customer", "critical"]);
});

test("Playwright export preserves semantic locators and secret references", () => {
  const contract: BehaviorContract = {
    schemaVersion: "1.0",
    id: "login",
    name: "Login",
    baseUrl: "http://localhost:3000",
    createdAt: "2026-07-22T00:00:00.000Z",
    tags: [],
    cleanup: [],
    source: { browser: "Chromium", recordedBy: "realdone" },
    steps: [
      { id: "S001", type: "navigate", pageUrl: "http://localhost:3000/login", url: "http://localhost:3000/login", atMs: 0, expected: [] },
      { id: "S002", type: "fill", pageUrl: "http://localhost:3000/login", atMs: 100, secretEnv: "REALDONE_PASSWORD", fingerprint: { selector: "#password", tag: "input", role: "textbox", accessibleName: "Password", ordinal: 0, candidates: [{ strategy: "role", weight: 92, role: "textbox", name: "Password", exact: true }] }, expected: [] },
    ],
  };
  const source = renderPlaywrightTest(contract);
  assert.match(source, /getByRole/);
  assert.match(source, /REALDONE_PASSWORD/);
  assert.doesNotMatch(source, /super-secret/);
});
