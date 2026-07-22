import { createHash } from "node:crypto";

const SECRET_KEY = /authorization|cookie|password|passwd|secret|token|api[-_]?key|database[-_]?url|session/i;
const BEARER = /bearer\s+[a-z0-9._~+/-]+=*/gi;

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function redactText(value: string): string {
  return value.replace(BEARER, "Bearer [REDACTED]");
}

export function redactKeyValue(key: string, value: string): string {
  return SECRET_KEY.test(key) ? "[REDACTED]" : redactText(value);
}

export function isSensitiveKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

export function safeUrl(input: string): string {
  try {
    const url = new URL(input);
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return redactText(input);
  }
}
