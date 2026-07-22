import assert from "node:assert/strict";
import test from "node:test";
import { classifyAction } from "../src/core/classify.js";

test("classifies mutation intent and risk from user-facing labels", () => {
  assert.deepEqual(classifyAction("Save settings", "button"), {
    kind: "mutation",
    intent: "update",
    risk: "safe",
  });
  assert.deepEqual(classifyAction("Delete account", "button"), {
    kind: "mutation",
    intent: "delete",
    risk: "destructive",
  });
  assert.deepEqual(classifyAction("Send invitation", "button"), {
    kind: "external",
    intent: "external",
    risk: "external",
  });
});

test("treats links as navigation and unknown buttons as local interaction", () => {
  assert.equal(classifyAction("Customers", "a", "http://localhost/customers").kind, "navigation");
  assert.equal(classifyAction("Toggle details", "button").kind, "local");
});
