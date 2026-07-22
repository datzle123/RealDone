import { createHash, createHmac } from "node:crypto";
import { assertRemoteEndpoint, sanitizeRemoteError, secretEnvironmentValue } from "../adapters/remote.js";
import type { ProviderEvidence, ProviderExpectation, ProviderKind, ProviderObservation, ProviderScalar } from "./types.js";
import { loadProviderAdapterConfig, type BuiltinProviderConfig } from "./config.js";

interface Registration { name: string; config: BuiltinProviderConfig }

function reference(expectation: ProviderExpectation): ProviderScalar {
  if ("value" in expectation.reference) return expectation.reference.value;
  return secretEnvironmentValue(expectation.reference.env);
}

function stringReference(expectation: ProviderExpectation): string {
  const value = reference(expectation);
  if (typeof value !== "string" || value.length === 0) throw new Error(`Provider ${expectation.provider} requires a non-empty string reference.`);
  return value;
}

function providerKind(config: BuiltinProviderConfig): ProviderKind {
  if (config.adapter === "stripe") return "payment";
  if (["resend", "sendgrid", "mailgun"].includes(config.adapter)) return "email";
  if (config.adapter === "oauth") return "oauth";
  return "storage";
}

function endpoint(value: string, allowProduction: boolean, label: string): URL {
  return assertRemoteEndpoint(value, allowProduction, label);
}

function append(base: URL, pathname: string): URL {
  const url = new URL(base);
  url.pathname = `${base.pathname.replace(/\/$/, "")}${pathname}`;
  url.search = "";
  return url;
}

async function jsonOrEmpty(response: Response): Promise<Record<string, unknown>> {
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

function statusConfirmed(operation: string, payload: Record<string, unknown>): boolean {
  if (["exists", "retrieved", "sent", "created", "active"].includes(operation)) return true;
  const observed = String(payload.status ?? payload.last_event ?? payload.payment_status ?? "").toLowerCase();
  return observed === operation.toLowerCase() || (operation === "delivered" && ["delivered", "opened", "clicked"].includes(observed));
}

async function stripe(expectation: ProviderExpectation, config: Extract<BuiltinProviderConfig, { adapter: "stripe" }>): Promise<ProviderObservation> {
  const key = secretEnvironmentValue(config.secretEnv);
  if (!/^(?:sk|rk)_test_/.test(key)) throw new Error("Stripe adapter accepts test-mode secret/restricted keys only; live keys are always blocked.");
  const id = stringReference(expectation);
  const resources: Record<string, string> = { "payment-intent": "payment_intents", charge: "charges", refund: "refunds", "checkout-session": "checkout/sessions" };
  const target = resources[expectation.resource];
  if (!target || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Unsupported Stripe resource or reference: ${expectation.resource}`);
  const response = await fetch(append(endpoint(config.baseUrl, true, "Stripe test"), `/v1/${target}/${id}`), { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(config.timeoutMs) });
  if (response.status === 404) return { found: false, detail: "Stripe test resource was not found." };
  if (!response.ok) throw new Error(`Stripe test lookup returned HTTP ${response.status}.`);
  const payload = await jsonOrEmpty(response);
  return { found: statusConfirmed(expectation.operation, payload), detail: "Stripe test resource was observed in the requested state.", metadata: { status: typeof payload.status === "string" ? payload.status : null } };
}

async function bearerLookup(expectation: ProviderExpectation, config: Extract<BuiltinProviderConfig, { adapter: "resend" | "sendgrid" }>): Promise<ProviderObservation> {
  const id = stringReference(expectation);
  if (!/^[A-Za-z0-9_.@-]+$/.test(id)) throw new Error(`${config.adapter} reference contains unsupported characters.`);
  const base = endpoint(config.baseUrl, config.allowProduction, config.adapter);
  const pathname = config.adapter === "resend" ? `/emails/${encodeURIComponent(id)}` : `/v3/messages/${encodeURIComponent(id)}`;
  const response = await fetch(append(base, pathname), { headers: { authorization: `Bearer ${secretEnvironmentValue(config.tokenEnv)}` }, signal: AbortSignal.timeout(config.timeoutMs) });
  if (response.status === 404) return { found: false, detail: `${config.adapter} message was not found.` };
  if (!response.ok) throw new Error(`${config.adapter} lookup returned HTTP ${response.status}.`);
  const payload = await jsonOrEmpty(response);
  return { found: statusConfirmed(expectation.operation, payload), detail: `${config.adapter} message was observed in the requested state.`, metadata: { status: String(payload.last_event ?? payload.status ?? "observed") } };
}

async function mailgun(expectation: ProviderExpectation, config: Extract<BuiltinProviderConfig, { adapter: "mailgun" }>): Promise<ProviderObservation> {
  const id = stringReference(expectation);
  const url = append(endpoint(config.baseUrl, config.allowProduction, "Mailgun"), `/v3/${encodeURIComponent(config.domain)}/events`);
  url.searchParams.set("message-id", id);
  const auth = Buffer.from(`api:${secretEnvironmentValue(config.keyEnv)}`).toString("base64");
  const response = await fetch(url, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(config.timeoutMs) });
  if (!response.ok) throw new Error(`Mailgun lookup returned HTTP ${response.status}.`);
  const payload = await jsonOrEmpty(response);
  const items = Array.isArray(payload.items) ? payload.items as Array<Record<string, unknown>> : [];
  const found = items.some((item) => expectation.operation === "exists" || String(item.event ?? "").toLowerCase() === expectation.operation.toLowerCase());
  return { found, detail: "Mailgun test event search completed.", metadata: { matches: items.length } };
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function hmac(key: Buffer | string, value: string): Buffer { return createHmac("sha256", key).update(value).digest(); }
function awsDate(date: Date): { timestamp: string; day: string } {
  const timestamp = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { timestamp, day: timestamp.slice(0, 8) };
}

async function s3(expectation: ProviderExpectation, config: Extract<BuiltinProviderConfig, { adapter: "s3" }>): Promise<ProviderObservation> {
  const key = stringReference(expectation);
  const accessKey = secretEnvironmentValue(config.accessKeyEnv);
  const secretKey = secretEnvironmentValue(config.secretKeyEnv);
  const baseUrl = config.endpoint ?? `https://s3.${config.region}.amazonaws.com`;
  const base = endpoint(baseUrl, config.allowProduction, "S3");
  const objectPath = `/${encodeURIComponent(config.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const url = append(base, objectPath);
  const now = awsDate(new Date());
  const payloadHash = sha256("");
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${now.timestamp}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = `HEAD\n${url.pathname}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${now.day}/${config.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${now.timestamp}\n${scope}\n${sha256(canonicalRequest)}`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, now.day), config.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const headers: Record<string, string> = {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": now.timestamp,
    ...(config.sessionTokenEnv ? { "x-amz-security-token": secretEnvironmentValue(config.sessionTokenEnv) } : {}),
  };
  const response = await fetch(url, { method: "HEAD", headers, signal: AbortSignal.timeout(config.timeoutMs) });
  if (response.status === 404) return { found: false, detail: "S3 object was not found." };
  if (!response.ok) throw new Error(`S3 object lookup returned HTTP ${response.status}.`);
  return { found: true, detail: "S3 object exists.", metadata: { contentLength: Number(response.headers.get("content-length") ?? 0), contentType: response.headers.get("content-type") } };
}

async function supabaseStorage(expectation: ProviderExpectation, config: Extract<BuiltinProviderConfig, { adapter: "supabase-storage" }>): Promise<ProviderObservation> {
  const key = stringReference(expectation);
  const url = append(endpoint(config.baseUrl, config.allowProduction, "Supabase Storage"), `/storage/v1/object/${encodeURIComponent(config.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`);
  const token = secretEnvironmentValue(config.keyEnv);
  const response = await fetch(url, { method: "HEAD", headers: { apikey: token, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(config.timeoutMs) });
  if (response.status === 404) return { found: false, detail: "Supabase Storage object was not found." };
  if (!response.ok) throw new Error(`Supabase Storage lookup returned HTTP ${response.status}.`);
  return { found: true, detail: "Supabase Storage object exists.", metadata: { contentLength: Number(response.headers.get("content-length") ?? 0), contentType: response.headers.get("content-type") } };
}

async function oauth(expectation: ProviderExpectation, config: Extract<BuiltinProviderConfig, { adapter: "oauth" }>): Promise<ProviderObservation> {
  const token = stringReference(expectation);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (config.clientIdEnv && config.clientSecretEnv) {
    headers.authorization = `Basic ${Buffer.from(`${secretEnvironmentValue(config.clientIdEnv)}:${secretEnvironmentValue(config.clientSecretEnv)}`).toString("base64")}`;
  }
  const response = await fetch(endpoint(config.introspectionUrl, config.allowProduction, "OAuth introspection"), {
    method: "POST",
    headers,
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw new Error(`OAuth introspection returned HTTP ${response.status}.`);
  const payload = await jsonOrEmpty(response);
  return { found: payload.active === true, detail: "OAuth token introspection completed.", metadata: { active: payload.active === true, scope: typeof payload.scope === "string" ? payload.scope : null } };
}

async function observe(expectation: ProviderExpectation, config: BuiltinProviderConfig): Promise<ProviderObservation> {
  switch (config.adapter) {
    case "stripe": return stripe(expectation, config);
    case "resend":
    case "sendgrid": return bearerLookup(expectation, config);
    case "mailgun": return mailgun(expectation, config);
    case "s3": return s3(expectation, config);
    case "supabase-storage": return supabaseStorage(expectation, config);
    case "oauth": return oauth(expectation, config);
  }
}

export class BuiltinProviderHost {
  private constructor(private readonly registrations: Map<string, Registration>) {}

  static async load(files: string[]): Promise<BuiltinProviderHost> {
    const registrations = new Map<string, Registration>();
    for (const file of files) {
      const loaded = await loadProviderAdapterConfig(file);
      for (const [name, config] of Object.entries(loaded.providers)) {
        if (registrations.has(name)) throw new Error(`Duplicate built-in provider registration: ${name}`);
        registrations.set(name, { name, config });
      }
    }
    return new BuiltinProviderHost(registrations);
  }

  has(name: string): boolean { return this.registrations.has(name); }

  async verifyProvider(expectation: ProviderExpectation): Promise<ProviderEvidence> {
    const registration = this.registrations.get(expectation.provider);
    if (!registration) throw new Error(`Built-in provider is not registered: ${expectation.provider}`);
    const kind = providerKind(registration.config);
    if (kind !== expectation.kind) {
      throw new Error(`Provider ${expectation.provider} is ${kind}, not ${expectation.kind}.`);
    }
    const startedAt = Date.now();
    try {
      const observation = await observe(expectation, registration.config);
      const passed = expectation.state === "confirmed" ? observation.found : !observation.found;
      return { provider: expectation.provider, kind: expectation.kind, resource: expectation.resource, operation: expectation.operation, state: expectation.state, found: observation.found, passed, evidenceLevel: 6, durationMs: Date.now() - startedAt, detail: observation.detail, ...(observation.metadata ? { metadata: observation.metadata } : {}) };
    } catch (error) {
      throw sanitizeRemoteError(error, [reference(expectation), ...Object.values(expectation.parameters ?? {})]);
    }
  }
}
