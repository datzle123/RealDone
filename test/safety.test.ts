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
