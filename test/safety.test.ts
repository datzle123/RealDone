import assert from "node:assert/strict";
import test from "node:test";
import { actionSkipReason, isMutationHostAllowed, validateTarget } from "../src/core/safety.js";
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
