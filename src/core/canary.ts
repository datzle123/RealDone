import { randomBytes } from "node:crypto";
import type { FormFieldSpec } from "../types.js";

export function createCanary(prefix = "RD_TEST"): string {
  return `${prefix}_${randomBytes(3).toString("hex").toUpperCase()}`;
}

export interface FieldValue {
  value?: string;
  check?: boolean;
  selectFirstUsable?: boolean;
  redacted: boolean;
}

function boundedText(value: string, field: FormFieldSpec): string {
  const minimum = field.minLength ?? 0;
  const maximum = field.maxLength && field.maxLength > 0 ? field.maxLength : Number.POSITIVE_INFINITY;
  let result = value;
  if (result.length < minimum) result = `${result}${"X".repeat(minimum - result.length)}`;
  return result.slice(0, maximum);
}

function patternValue(pattern: string, canary: string): string | undefined {
  const digits = pattern.match(/^\^?\\d\{(\d+)\}\$?$/);
  if (digits?.[1]) return canary.replace(/\D/g, "").padEnd(Number(digits[1]), "7").slice(0, Number(digits[1]));
  const upper = pattern.match(/^\^?\[A-Z\]\{(\d+)\}\$?$/);
  if (upper?.[1]) return canary.replace(/[^A-Z]/g, "X").padEnd(Number(upper[1]), "X").slice(0, Number(upper[1]));
  const alphaNumeric = pattern.match(/^\^?\[A-Za-z0-9_-\]\{(\d+)(?:,(\d+))?\}\$?$/);
  if (alphaNumeric?.[1]) {
    const length = Math.min(Number(alphaNumeric[2] ?? alphaNumeric[1]), Math.max(Number(alphaNumeric[1]), canary.length));
    return canary.replace(/[^A-Za-z0-9_-]/g, "_").padEnd(length, "X").slice(0, length);
  }
  return undefined;
}

export function valueForField(field: FormFieldSpec, canary: string): FieldValue {
  const hint = `${field.name ?? ""} ${field.label ?? ""} ${field.placeholder ?? ""}`.toLowerCase();
  const type = field.type.toLowerCase();

  if (type === "checkbox" || type === "radio") {
    return { check: true, redacted: false };
  }
  if (field.tag === "select") {
    return { selectFirstUsable: true, redacted: false };
  }
  if (["submit", "button", "reset", "hidden", "file"].includes(type)) {
    return { redacted: false };
  }
  if (type === "email" || hint.includes("email")) {
    return { value: boundedText(`rd-${canary.toLowerCase()}@example.test`, field), redacted: false };
  }
  if (type === "password" || hint.includes("password") || hint.includes("mật khẩu")) {
    return { value: `RD-${canary}-Safe!`, redacted: true };
  }
  if (type === "url" || hint.includes("website") || hint.includes("url")) {
    return { value: `https://example.test/${canary.toLowerCase()}`, redacted: false };
  }
  if (type === "tel" || hint.includes("phone") || hint.includes("điện thoại")) {
    return { value: "+15550102026", redacted: false };
  }
  if (type === "number" || type === "range") {
    const minimum = Number.isFinite(Number(field.min)) ? Number(field.min) : 0;
    const maximum = Number.isFinite(Number(field.max)) ? Number(field.max) : minimum + 1_000_000;
    const step = Number.isFinite(Number(field.step)) && Number(field.step) > 0 ? Number(field.step) : 1;
    const seed = Number.parseInt(canary.replace(/\D/g, "").slice(-6) || "2026", 10);
    const steps = Math.max(0, Math.floor((maximum - minimum) / step));
    const value = minimum + (steps > 0 ? seed % (steps + 1) : 0) * step;
    return { value: String(value), redacted: false };
  }
  if (type === "date") {
    return { value: "2026-07-22", redacted: false };
  }
  if (type === "datetime-local") {
    return { value: "2026-07-22T10:00", redacted: false };
  }
  if (type === "time") {
    return { value: "10:00", redacted: false };
  }
  const constrained = field.pattern ? patternValue(field.pattern, canary) : undefined;
  return { value: boundedText(constrained ?? canary, field), redacted: false };
}
