import assert from "node:assert/strict";
import test from "node:test";
import { createCanary, valueForField } from "../src/core/canary.js";
import type { FormFieldSpec } from "../src/types.js";

function field(overrides: Partial<FormFieldSpec>): FormFieldSpec {
  return {
    selector: "input",
    tag: "input",
    type: "text",
    required: true,
    disabled: false,
    ...overrides,
  };
}

test("creates unique, searchable test canaries", () => {
  const first = createCanary();
  const second = createCanary();
  assert.match(first, /^RD_TEST_[A-F0-9]{6}$/);
  assert.notEqual(first, second);
});

test("generates safe values by field semantics", () => {
  assert.equal(valueForField(field({ type: "email" }), "RD_TEST_ABC123").value, "rd-rd_test_abc123@example.test");
  assert.equal(valueForField(field({ type: "password" }), "RD_TEST_ABC123").redacted, true);
  assert.equal(valueForField(field({ tag: "select", type: "select-one" }), "RD_TEST_ABC123").selectFirstUsable, true);
});
