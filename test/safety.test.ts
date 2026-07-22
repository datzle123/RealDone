import assert from "node:assert/strict";
import test from "node:test";
import { actionSkipReason, isMutationHostAllowed, isSafetyEscalation, validateTarget } from "../src/core/safety.js";
import type { ActionSpec } from "../src/types.js";

const action: ActionSpec = {
  id: "action-1",
  pageUrl: "https://example.com",
  kind: "mutation",
  intent: "update",
  risk: "safe",
  label: "Save",
  fingerprint: { selector: "#save", tag: "button", ordinal: 0 },
  fields: [],
};

test("allows local and explicit staging mutation hosts", () => {
  assert.equal(isMutationHostAllowed(new URL("http://localhost:3000"), []), true);
  assert.equal(isMutationHostAllowed(new URL("https://preview.test"), []), true);
  assert.equal(isMutationHostAllowed(new URL("https://staging.example.com"), ["staging.example.com"]), true);
  assert.equal(isMutationHostAllowed(new URL("https://example.com"), []), false);
});

test("blocks production-like, destructive, and external actions by default", () => {
  assert.match(
    actionSkipReason(action, {
      target: new URL("https://example.com"),
      allowHosts: [],
      allowDestructive: false,
      allowExternal: false,
    }) ?? "",
    /Production-like/,
  );
  const destructive: ActionSpec = { ...action, risk: "destructive", intent: "delete" };
  assert.match(
    actionSkipReason(destructive, {
      target: new URL("http://localhost"),
      allowHosts: [],
      allowDestructive: false,
      allowExternal: false,
    }) ?? "",
    /Destructive/,
  );
  const external: ActionSpec = { ...action, kind: "external", intent: "external", risk: "external", label: "Send email" };
  const productionPolicy = {
    target: new URL("https://example.com"),
    allowHosts: [],
    allowDestructive: false,
    allowExternal: true,
  };
  assert.match(actionSkipReason(external, productionPolicy) ?? "", /Production-like/);
  assert.equal(actionSkipReason(external, {
    ...productionPolicy,
    allowHosts: ["example.com"],
    allowExternal: true,
  }), undefined);
});

test("recorded-flow boundaries cannot be bypassed by broad external opt-in", () => {
  const ambiguous: ActionSpec = {
    ...action,
    pageUrl: "http://localhost:3000",
    kind: "external",
    intent: "external",
    risk: "external",
    label: "Continue",
    recordingRequired: "Cross-origin form submission needs a recorded flow.",
  };
  assert.match(actionSkipReason(ambiguous, {
    target: new URL(ambiguous.pageUrl),
    allowHosts: [],
    allowDestructive: true,
    allowExternal: true,
  }) ?? "", /Recorded flow required/);
});

test("live safe-risk reclassification still escalates when the action kind becomes state-changing", () => {
  const discovered: ActionSpec = {
    ...action,
    kind: "navigation",
    intent: "navigate",
    risk: "safe",
  };
  assert.equal(isSafetyEscalation(discovered, { kind: "mutation", intent: "submit", risk: "safe" }), true);
  assert.equal(isSafetyEscalation(discovered, { kind: "external", intent: "external", risk: "external" }), true);
  assert.equal(isSafetyEscalation(discovered, { kind: "navigation", intent: "navigate", risk: "safe" }), false);
});

test("live reclassification never treats a lower-risk classification as an escalation", () => {
  const discoveredExternal: ActionSpec = {
    ...action,
    kind: "external",
    intent: "external",
    risk: "external",
  };
  const discoveredDestructive: ActionSpec = {
    ...action,
    intent: "delete",
    risk: "destructive",
  };
  assert.equal(isSafetyEscalation(discoveredExternal, { kind: "mutation", intent: "submit", risk: "safe" }), false);
  assert.equal(isSafetyEscalation(discoveredDestructive, { kind: "external", intent: "external", risk: "external" }), false);
});

test("rejects unsupported target protocols", () => {
  assert.throws(() => validateTarget("file:///tmp/app"), /http/);
});

test("blocks cross-origin navigation unless external actions are explicitly allowed", () => {
  const action = {
    id: "external-docs",
    pageUrl: "http://localhost:3000",
    activation: "click" as const,
    kind: "navigation" as const,
    intent: "navigate" as const,
    risk: "safe" as const,
    label: "Project website",
    fingerprint: { selector: "a", tag: "a", href: "https://example.com", ordinal: 0 },
    fields: [],
  };
  const policy = { target: new URL(action.pageUrl), allowHosts: [], allowDestructive: false, allowExternal: false };
  assert.match(actionSkipReason(action, policy) ?? "", /Cross-origin navigation blocked/);
  assert.equal(actionSkipReason(action, { ...policy, allowExternal: true }), undefined);
});

test("skips an idempotent link to the current route", () => {
  const action = {
    id: "current-login",
    pageUrl: "http://localhost:3000/#/login",
    activation: "click" as const,
    kind: "navigation" as const,
    intent: "navigate" as const,
    risk: "safe" as const,
    label: "Login",
    fingerprint: { selector: "a", tag: "a", href: "http://localhost:3000/#/login", ordinal: 0 },
    fields: [],
  };
  const policy = { target: new URL(action.pageUrl), allowHosts: [], allowDestructive: false, allowExternal: false };
  assert.match(actionSkipReason(action, policy) ?? "", /already the current page/);
});
