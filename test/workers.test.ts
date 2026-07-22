import assert from "node:assert/strict";
import test from "node:test";
import { mapWithConcurrency } from "../src/core/workers.js";

test("bounded worker map preserves order and never exceeds its worker limit", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapWithConcurrency([5, 4, 3, 2, 1], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(result, [10, 8, 6, 4, 2]);
  assert.equal(peak, 2);
});

test("worker limits fail closed", async () => {
  await assert.rejects(() => mapWithConcurrency([1], 0, async (value) => value));
  await assert.rejects(() => mapWithConcurrency([1], 17, async (value) => value));
});
