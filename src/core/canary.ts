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
    return { value: `rd-${canary.toLowerCase()}@example.test`, redacted: false };
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
    return { value: "2026", redacted: false };
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
  return { value: canary, redacted: false };
}
