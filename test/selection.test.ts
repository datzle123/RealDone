import assert from "node:assert/strict";
import test from "node:test";
import { selectActionsForExecution } from "../src/core/selection.js";
import type { ActionSpec } from "../src/types.js";

function action(
  id: string,
  pageUrl: string,
  kind: ActionSpec["kind"],
  intent: ActionSpec["intent"],
  activation: NonNullable<ActionSpec["activation"]>,
  options: { label?: string; risk?: ActionSpec["risk"] } = {},
): ActionSpec {
  return {
    id,
    pageUrl,
    kind,
    intent,
    activation,
    risk: options.risk ?? "safe",
    label: options.label ?? id,
    fingerprint: { selector: `#${id}`, tag: "button", ordinal: 0 },
    fields: [],
  };
}

test("balances a finite action budget across routes, kinds, intents, and activation paths", () => {
  const result = selectActionsForExecution([
    action("nav-1", "http://app.local/one", "navigation", "navigate", "click"),
    action("nav-2", "http://app.local/one", "navigation", "navigate", "click"),
    action("nav-3", "http://app.local/one", "navigation", "navigate", "click"),
    action("create", "http://app.local/two", "mutation", "create", "submit"),
    action("enter", "http://app.local/three", "local", "interact", "enter"),
  ], 3);

  assert.deepEqual(result.selected.map((item) => item.id), ["create", "enter", "nav-1"]);
  assert.equal(new Set(result.selected.map((item) => item.pageUrl)).size, 3);
  assert.deepEqual(result.telemetry.selectedKinds, ["mutation", "local", "navigation"]);
  assert.equal(result.telemetry.eligiblePages, 3);
  assert.equal(result.telemetry.selectedPages, 3);
  assert.equal(result.telemetry.omittedActions, 2);
});

test("known denials do not starve runnable actions and destructive/session-ending controls remain last", () => {
  const actions = [
    action("denied", "http://app.local/settings", "mutation", "create", "submit"),
    action("safe", "http://app.local/settings", "mutation", "update", "submit"),
    action("delete", "http://app.local/settings", "mutation", "delete", "click", { risk: "destructive" }),
    action("logout", "http://app.local/settings", "local", "submit", "click", { label: "Log out" }),
  ];
  const result = selectActionsForExecution(actions, 4, new Set(["denied"]));

  assert.deepEqual(result.selected.map((item) => item.id), ["safe", "delete", "logout", "denied"]);
  assert.equal(result.telemetry.deniedEligibleActions, 1);
  assert.equal(result.telemetry.deniedSelectedActions, 1);

  const bounded = selectActionsForExecution(actions, 2, new Set(["denied"]));
  assert.deepEqual(bounded.selected.map((item) => item.id), ["safe", "delete"]);
  assert.equal(bounded.telemetry.deniedSelectedActions, 0);
});

test("selection is deterministic and never duplicates an action", () => {
  const actions = [
    action("a", "http://app.local/a", "local", "interact", "click"),
    action("b", "http://app.local/b", "mutation", "update", "submit"),
    action("c", "http://app.local/c", "external", "external", "click", { risk: "external" }),
  ];
  const first = selectActionsForExecution(actions, 99);
  const second = selectActionsForExecution(actions, 99);

  assert.deepEqual(first.selected.map((item) => item.id), second.selected.map((item) => item.id));
  assert.equal(new Set(first.selected.map((item) => item.id)).size, actions.length);
  assert.equal(first.telemetry.selectedActions, actions.length);
  assert.equal(first.telemetry.omittedActions, 0);
});
