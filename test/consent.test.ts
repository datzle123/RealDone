import assert from "node:assert/strict";
import test from "node:test";
import { consentPrompt, requireProjectActionConsent } from "../src/core/consent.js";

test("project action consent asks once and accepts only an explicit yes", async () => {
  let questions = 0;
  await requireProjectActionConsent({ project: "fixture", confirmed: false, interactive: true }, async (message) => {
    questions += 1;
    assert.equal(message, consentPrompt("fixture"));
    return "yes";
  });
  assert.equal(questions, 1);

  await assert.rejects(
    () => requireProjectActionConsent({ project: "fixture", confirmed: false, interactive: true }, async () => "no"),
    /not confirmed/,
  );
});

test("pre-confirmed automation proceeds without prompting and non-interactive use fails closed", async () => {
  await requireProjectActionConsent({ project: "fixture", confirmed: true, interactive: false }, async () => {
    throw new Error("pre-confirmed execution must not prompt");
  });
  await assert.rejects(
    () => requireProjectActionConsent({ project: "fixture", confirmed: false, interactive: false }),
    /--yes/,
  );
});
