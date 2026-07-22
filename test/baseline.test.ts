import assert from "node:assert/strict";
import test from "node:test";
import { selectAffectedContracts } from "../src/baseline/affected.js";
import { classifyContractChange } from "../src/baseline/regression.js";
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

test("affected-flow selection falls back to every contract when no mapping is safe", () => {
  const manifest: BehaviorManifest = {
    schemaVersion: "1.0",
    generatedAt: "2026-07-22T00:00:00.000Z",
    contracts: [
      { id: "increment", name: "Increment counter", file: "flows/increment.json", hash: "a", tags: [], routes: ["/"], endpoints: [{ method: "POST", pattern: "^/api/counter/increment$" }], sourceFiles: [], stepCount: 2 },
      { id: "upload", name: "Upload receipt", file: "flows/upload.json", hash: "b", tags: [], routes: ["/"], endpoints: [{ method: "POST", pattern: "^/api/receipts$" }], sourceFiles: [], stepCount: 2 },
    ],
  };
  assert.deepEqual(
    selectAffectedContracts(manifest, ["server.mjs", "public/app.js"]).map((contract) => contract.id),
    ["increment", "upload"],
  );
});

test("regression classification emits evidence-specific RD901-RD905 outcomes", () => {
  const baseline = {
    id: "customer",
    name: "Create customer",
    file: "customer.json",
    hash: "before",
    tags: [],
    routes: ["/customers"],
    endpoints: [{ method: "POST", pattern: "^/api/customers$" }],
    sourceFiles: [],
    stepCount: 2,
    baseline: { passed: true, verificationId: "before", performancePassed: true, steps: [] },
  } satisfies BehaviorManifest["contracts"][number];
  const current = {
    ...baseline,
    hash: "after",
    baseline: {
      passed: false,
      verificationId: "after",
      performancePassed: false,
      steps: [{ id: "save", status: "failed" as const, assertions: [
        { type: "request", passed: false, detail: "status changed" },
        { type: "persistence", passed: false, detail: "resource disappeared" },
      ] }],
    },
  } satisfies BehaviorManifest["contracts"][number];
  const regression = classifyContractChange(baseline, current);
  assert.equal(regression.outcome, "REGRESSION");
  assert.deepEqual(regression.detectorCodes, ["RD905", "RD903", "RD904"]);
  assert.deepEqual(classifyContractChange(baseline, undefined).detectorCodes, ["RD902"]);
  assert.equal(classifyContractChange(undefined, current).outcome, "EXPECTED_CHANGE");
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

test("Playwright export preserves hash-router navigation and pathname URL assertions", () => {
  const contract: BehaviorContract = {
    schemaVersion: "1.0",
    id: "hash-login",
    name: "Hash login",
    baseUrl: "http://localhost:3000",
    createdAt: "2026-07-22T00:00:00.000Z",
    tags: [],
    cleanup: [],
    source: { browser: "Chromium", recordedBy: "realdone" },
    steps: [
      { id: "S001", type: "navigate", pageUrl: "http://localhost:3000/#/login", url: "http://localhost:3000/#/login", atMs: 0, expected: [] },
      { id: "S002", type: "click", pageUrl: "http://localhost:3000/#/login", atMs: 100, fingerprint: { selector: "button", tag: "button", role: "button", accessibleName: "Login", ordinal: 0 }, expected: [{ type: "url", pattern: "^/$" }] },
    ],
  };
  const source = renderPlaywrightTest(contract);
  assert.match(source, /\/#\/login/);
  assert.match(source, /expect\.poll\(\(\) => new URL\(page\.url\(\)\)\.pathname\)/);
});

test("Playwright export preserves complex semantic actions and browser outcomes", () => {
  const fingerprint = { selector: "#source", tag: "div", ordinal: 0 };
  const contract: BehaviorContract = {
    schemaVersion: "1.0",
    id: "complex-flow",
    name: "Complex flow",
    baseUrl: "http://localhost:3000",
    createdAt: "2026-07-22T00:00:00.000Z",
    tags: [],
    cleanup: [],
    source: { browser: "Chromium", recordedBy: "realdone" },
    steps: [
      { id: "S001", type: "upload", pageUrl: "http://localhost:3000", atMs: 0, fingerprint, fileEnv: "REALDONE_UPLOAD_FILE", expected: [] },
      { id: "S002", type: "richtext", pageUrl: "http://localhost:3000", atMs: 1, fingerprint, value: "Description", expected: [] },
      { id: "S003", type: "press", pageUrl: "http://localhost:3000", atMs: 2, fingerprint, key: "Enter", expected: [] },
      { id: "S004", type: "drag", pageUrl: "http://localhost:3000", atMs: 3, fingerprint, targetFingerprint: { selector: "#target", tag: "div", ordinal: 1 }, expected: [] },
      { id: "S005", type: "click", pageUrl: "http://localhost:3000", atMs: 4, fingerprint, expected: [{ type: "download", fileNamePattern: "^result\\.csv$", nonEmpty: true }] },
      { id: "S006", type: "click", pageUrl: "http://localhost:3000", atMs: 5, fingerprint, expected: [{ type: "popup", urlPattern: "^/result$" }] },
    ],
  };
  const source = renderPlaywrightTest(contract);
  assert.match(source, /REALDONE_UPLOAD_FILE/);
  assert.match(source, /setInputFiles/);
  assert.match(source, /\.fill\("Description"\)/);
  assert.match(source, /\.press\("Enter"\)/);
  assert.match(source, /\.dragTo\(/);
  assert.match(source, /waitForEvent\('download'\)/);
  assert.match(source, /suggestedFilename/);
  assert.match(source, /await stat/);
  assert.match(source, /waitForEvent\('popup'\)/);
  assert.match(source, /ObservedPopup\.url\(\)\)\.pathname/);
});
