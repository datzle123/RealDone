import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BuiltinProviderHost } from "../src/providers/builtin.js";
import type { ActionSpec, ExecutionEvidence } from "../src/types.js";

test("maintained provider adapters verify only sandboxed, read-only outcomes", async (context) => {
  const requests: Array<{ method: string; url: string; authorization?: string }> = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method ?? "", url: request.url ?? "", ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) });
    if (request.method === "HEAD") {
      response.writeHead(200, { "content-length": "42", "content-type": "text/plain" });
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    if (request.url?.endsWith("/v1/payment_intents/pi_slow")) return;
    if (request.url?.startsWith("/v1/payment_intents/")) response.end(JSON.stringify({ status: "succeeded" }));
    else if (request.url === "/emails/huge") response.end(JSON.stringify({ last_event: "x".repeat(1_000_001) }));
    else if (request.url?.startsWith("/emails/")) response.end(JSON.stringify({ last_event: "delivered" }));
    else if (request.url?.startsWith("/v3/messages/")) response.end(JSON.stringify({ status: "delivered" }));
    else if (request.url?.includes("/events")) response.end(JSON.stringify({ items: [{ event: "delivered" }] }));
    else if (request.url === "/oauth/introspect") response.end(JSON.stringify({ active: true, scope: "openid oauth-token-secret" }));
    else { response.statusCode = 404; response.end("{}"); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => { server.close(); await once(server, "close"); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Provider fixture did not bind TCP.");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const directory = await mkdtemp(path.join(tmpdir(), "realdone-providers-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const configFile = path.join(directory, "providers.json");
  await writeFile(configFile, JSON.stringify({
    schemaVersion: "1.0",
    providers: {
      stripe: { adapter: "stripe", secretEnv: "RD_STRIPE_KEY", baseUrl },
      resend: { adapter: "resend", tokenEnv: "RD_RESEND_KEY", baseUrl },
      sendgrid: { adapter: "sendgrid", tokenEnv: "RD_SENDGRID_KEY", baseUrl },
      mailgun: { adapter: "mailgun", keyEnv: "RD_MAILGUN_KEY", domain: "sandbox.example.test", baseUrl },
      s3: { adapter: "s3", accessKeyEnv: "RD_AWS_ACCESS_KEY", secretKeyEnv: "RD_AWS_SECRET_KEY", region: "us-test-1", bucket: "realdone-test", endpoint: baseUrl },
      "supabase-storage": { adapter: "supabase-storage", keyEnv: "RD_SUPABASE_STORAGE_KEY", bucket: "realdone-test", baseUrl },
      oauth: { adapter: "oauth", introspectionUrl: `${baseUrl}/oauth/introspect`, clientIdEnv: "RD_OAUTH_CLIENT", clientSecretEnv: "RD_OAUTH_SECRET" },
    },
    automaticChecks: [{
      provider: "stripe",
      kind: "payment",
      operation: "succeeded",
      resource: "payment-intent",
      match: { actionLabelIncludes: "Pay invoice", requestUrlIncludes: "/api/payments" },
      reference: { from: "response-resource-id" },
    }],
  }));
  Object.assign(process.env, {
    RD_STRIPE_KEY: "sk_test_fixture",
    RD_RESEND_KEY: "resend-test-key",
    RD_SENDGRID_KEY: "sendgrid-test-key",
    RD_MAILGUN_KEY: "mailgun-test-key",
    RD_AWS_ACCESS_KEY: "AKIATEST",
    RD_AWS_SECRET_KEY: "aws-secret-test",
    RD_SUPABASE_STORAGE_KEY: "supabase-storage-test",
    RD_OAUTH_CLIENT: "oauth-client",
    RD_OAUTH_SECRET: "oauth-secret",
  });
  context.after(() => {
    for (const name of ["RD_STRIPE_KEY", "RD_RESEND_KEY", "RD_SENDGRID_KEY", "RD_MAILGUN_KEY", "RD_AWS_ACCESS_KEY", "RD_AWS_SECRET_KEY", "RD_SUPABASE_STORAGE_KEY", "RD_OAUTH_CLIENT", "RD_OAUTH_SECRET"]) delete process.env[name];
  });
  const host = await BuiltinProviderHost.load([configFile]);
  const expectations = [
    { type: "provider", provider: "stripe", kind: "payment", operation: "succeeded", resource: "payment-intent", reference: { value: "pi_test_42" }, state: "confirmed" },
    { type: "provider", provider: "resend", kind: "email", operation: "delivered", resource: "message", reference: { value: "email-42" }, state: "confirmed" },
    { type: "provider", provider: "sendgrid", kind: "email", operation: "delivered", resource: "message", reference: { value: "message-42" }, state: "confirmed" },
    { type: "provider", provider: "mailgun", kind: "email", operation: "delivered", resource: "message", reference: { value: "message-42@example.test" }, state: "confirmed" },
    { type: "provider", provider: "s3", kind: "storage", operation: "exists", resource: "object", reference: { value: "exports/customer.csv" }, state: "confirmed" },
    { type: "provider", provider: "supabase-storage", kind: "storage", operation: "exists", resource: "object", reference: { value: "exports/customer.csv" }, state: "confirmed" },
    { type: "provider", provider: "oauth", kind: "oauth", operation: "active", resource: "token", reference: { value: "oauth-token-secret" }, state: "confirmed" },
  ] as const;
  for (const expectation of expectations) {
    const evidence = await host.verifyProvider(expectation);
    assert.equal(evidence.passed, true, expectation.provider);
    assert.equal(JSON.stringify(evidence).includes(String(expectation.reference.value)), false);
  }
  assert.ok(requests.some((request) => request.authorization?.startsWith("AWS4-HMAC-SHA256 Credential=AKIATEST/")));
  assert.ok(requests.every((request) => !request.url.includes("oauth-token-secret")));
  await assert.rejects(
    host.verifyProvider({ type: "provider", provider: "resend", kind: "email", operation: "delivered", resource: "message", reference: { value: "huge" }, state: "confirmed" }),
    /exceeded the 1000000-byte limit/,
  );
  const action: ActionSpec = {
    id: "pay",
    pageUrl: baseUrl,
    kind: "external",
    intent: "external",
    risk: "external",
    label: "Pay invoice",
    fingerprint: { selector: "#pay", tag: "button", ordinal: 0 },
    fields: [],
  };
  const execution = {
    startedAt: new Date().toISOString(), durationMs: 1, canary: "RD_TEST", network: [{ id: "net-1", method: "POST", url: `${baseUrl}/api/payments`, resourceType: "fetch", startedAt: 0, status: 201, ok: true, responseResourceId: "pi_test_42" }], console: [], pageErrors: [], uiClaims: [], filledFields: [], dialogs: [], downloads: [],
  } satisfies ExecutionEvidence;
  const automatic = await host.verifyAutomatic(action, execution, { deadline: Date.now() + 5_000 });
  assert.equal(automatic.matchedChecks, 1);
  assert.equal(automatic.errors.length, 0);
  assert.equal(automatic.evidence[0]?.passed, true);
  assert.equal(automatic.evidence[0]?.automaticLinkage?.causallyLinked, true);
  assert.equal(JSON.stringify(automatic).includes("pi_test_42"), false);
  const slowStarted = Date.now();
  const slow = await host.verifyAutomatic(action, {
    ...execution,
    network: [{ ...execution.network[0]!, responseResourceId: "pi_slow" }],
  }, { deadline: Date.now() + 50 });
  assert.equal(slow.matchedChecks, 1);
  assert.equal(slow.evidence.length, 0);
  assert.equal(slow.errors.length, 1);
  assert.ok(Date.now() - slowStarted < 1_000, "automatic provider confirmation exceeded the scan deadline");
});

test("Stripe live keys and non-local provider endpoints fail closed", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "realdone-provider-guard-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const configFile = path.join(directory, "providers.json");
  await writeFile(configFile, JSON.stringify({ schemaVersion: "1.0", providers: {
    stripe: { adapter: "stripe", secretEnv: "RD_STRIPE_LIVE_KEY" },
    resend: { adapter: "resend", tokenEnv: "RD_RESEND_PROD_KEY" },
  } }));
  process.env.RD_STRIPE_LIVE_KEY = "sk_live_blocked";
  process.env.RD_RESEND_PROD_KEY = "resend-prod-key";
  context.after(() => { delete process.env.RD_STRIPE_LIVE_KEY; delete process.env.RD_RESEND_PROD_KEY; });
  const host = await BuiltinProviderHost.load([configFile]);
  await assert.rejects(host.verifyProvider({ type: "provider", provider: "stripe", kind: "payment", operation: "succeeded", resource: "payment-intent", reference: { value: "pi_live_42" }, state: "confirmed" }), /live keys are always blocked/);
  await assert.rejects(host.verifyProvider({ type: "provider", provider: "resend", kind: "email", operation: "delivered", resource: "message", reference: { value: "email-42" }, state: "confirmed" }), /production access is blocked/);

  const automaticCheck = (provider: string) => ({
    provider,
    kind: "payment",
    operation: "succeeded",
    resource: "payment-intent",
    match: { actionKind: "external" },
    reference: { from: "response-resource-id" },
  });
  const firstConfig = path.join(directory, "automatic-first.json");
  const secondConfig = path.join(directory, "automatic-second.json");
  await writeFile(firstConfig, JSON.stringify({ schemaVersion: "1.0", providers: { first: { adapter: "stripe", secretEnv: "RD_STRIPE_LIVE_KEY" } }, automaticChecks: Array.from({ length: 11 }, () => automaticCheck("first")) }));
  await writeFile(secondConfig, JSON.stringify({ schemaVersion: "1.0", providers: { second: { adapter: "stripe", secretEnv: "RD_STRIPE_LIVE_KEY" } }, automaticChecks: Array.from({ length: 10 }, () => automaticCheck("second")) }));
  await assert.rejects(BuiltinProviderHost.load([firstConfig, secondConfig]), /limited to 20 across all configuration files/);
});
