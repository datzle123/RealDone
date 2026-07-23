import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright";
import { waitForEnvironmentRender } from "../src/environment/health.js";

test("waitForEnvironmentRender honours the configured hydration settle budget", async () => {
  const waits: number[] = [];
  const page = {
    evaluate: async () => ({
      bodyTextLength: 80,
      visibleElements: 3,
      interactiveElements: 1,
      ready: true,
    }),
    waitForTimeout: async (milliseconds: number) => {
      waits.push(milliseconds);
    },
  } as unknown as Page;

  const observation = await waitForEnvironmentRender(page, 5_000, 1_200, true);

  assert.equal(observation.ready, true);
  assert.deepEqual(waits, [1_200]);
});

test("waitForEnvironmentRender keeps hydration settling bounded", async () => {
  const waits: number[] = [];
  const page = {
    evaluate: async () => ({
      bodyTextLength: 80,
      visibleElements: 3,
      interactiveElements: 1,
      ready: true,
    }),
    waitForTimeout: async (milliseconds: number) => {
      waits.push(milliseconds);
    },
  } as unknown as Page;

  await waitForEnvironmentRender(page, 5_000, 30_000, true);

  assert.deepEqual(waits, [2_000]);
});
