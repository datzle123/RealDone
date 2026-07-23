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
  assert.deepEqual(classifyAction("Sign up", "a", "http://localhost/#/register"), {
    kind: "navigation",
    intent: "navigate",
    risk: "safe",
  });
  assert.deepEqual(classifyAction("Delete account", "a", "http://localhost/settings/delete"), {
    kind: "navigation",
    intent: "navigate",
    risk: "destructive",
  });
  assert.equal(classifyAction("Toggle details", "button").kind, "local");
});

test("classifies script-driven anchors without href as controls", () => {
  assert.deepEqual(classifyAction("Toggle details", "a"), {
    kind: "local",
    intent: "interact",
    risk: "safe",
  });
  assert.deepEqual(classifyAction("Delete customer", "a"), {
    kind: "mutation",
    intent: "delete",
    risk: "destructive",
  });
});

test("classifies external effects from observable form and provider signals before execution", () => {
  assert.deepEqual(classifyAction("Continue", "form", undefined, true, {
    pageUrl: "http://localhost:3000/billing",
    actionUrl: "http://localhost:3000/api/payment-intents",
    method: "post",
  }), {
    kind: "external",
    intent: "external",
    risk: "external",
  });
  assert.deepEqual(classifyAction("Run", "button", undefined, false, {
    semanticHints: ["stripe-provider"],
  }), {
    kind: "external",
    intent: "external",
    risk: "external",
  });
  assert.deepEqual(classifyAction("Connect", "button", undefined, false, {
    fieldTypes: ["text"],
    fieldHints: ["https://example.com"],
  }), {
    kind: "external",
    intent: "external",
    risk: "external",
  });
  assert.deepEqual(classifyAction("Continue", "form", undefined, true, {
    pageUrl: "http://localhost:3000/settings",
    actionUrl: "http://localhost:3000/api/profile",
    method: "post",
  }), {
    kind: "mutation",
    intent: "submit",
    risk: "safe",
  });
  assert.deepEqual(classifyAction("Lookup", "form", undefined, true, {
    pageUrl: "http://localhost:3000/billing",
    actionUrl: "/api/payment-intents",
    method: "get",
  }), {
    kind: "mutation",
    intent: "submit",
    risk: "safe",
  });
});

test("routes ambiguous cross-origin forms, authentication popups, and uploads to recorded flow", () => {
  const externalForm = classifyAction("Continue", "form", undefined, true, {
    pageUrl: "http://localhost:3000/checkout",
    actionUrl: "https://payments.example.test/session",
    method: "post",
  });
  assert.equal(externalForm.risk, "external");
  assert.match(externalForm.recordingRequired ?? "", /Cross-origin/);

  const upload = classifyAction("Attach receipt", "form", undefined, true, {
    pageUrl: "http://localhost:3000/receipts",
    actionUrl: "/api/receipts",
    method: "post",
    fieldTypes: ["text", "file"],
  });
  assert.equal(upload.kind, "external");
  assert.equal(upload.recordingRequired, undefined);

  const ambiguousUpload = classifyAction("Attach receipt", "input", undefined, false, {
    pageUrl: "http://localhost:3000/receipts",
    fieldTypes: ["file"],
  });
  assert.equal(ambiguousUpload.kind, "external");
  assert.match(ambiguousUpload.recordingRequired ?? "", /file upload/i);

  const oauthPopup = classifyAction("Continue with identity provider", "a", "https://identity.example.test/oauth", false, {
    pageUrl: "http://localhost:3000/login",
    target: "_blank",
  });
  assert.equal(oauthPopup.kind, "external");
  assert.match(oauthPopup.recordingRequired ?? "", /authentication popup/);
});

test("keeps correct same-origin forms and ordinary external links out of complex-flow classification", () => {
  const login = classifyAction("Sign in", "form", undefined, true, {
    pageUrl: "http://localhost:3000/login",
    actionUrl: "/api/session",
    method: "post",
    fieldTypes: ["email", "password"],
  });
  assert.deepEqual(login, { kind: "mutation", intent: "submit", risk: "safe" });
  assert.deepEqual(classifyAction("Email Password Fake login", "form", undefined, true, {
    pageUrl: "http://localhost:3000/login",
    actionUrl: "/api/session",
    method: "post",
    fieldTypes: ["email", "password"],
  }), { kind: "mutation", intent: "submit", risk: "safe" });

  const docs = classifyAction("Documentation", "a", "https://docs.example.test/guide", false, {
    pageUrl: "http://localhost:3000",
    target: "_blank",
  });
  assert.deepEqual(docs, { kind: "navigation", intent: "navigate", risk: "safe" });
});
