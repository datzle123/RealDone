import { createHash } from "node:crypto";
import { readFile, readdir, rm, stat, truncate } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";

export interface ArtifactSecret {
  label: string;
  value: string;
}

export type ArtifactSecretFindingKind =
  | "exact-secret"
  | "private-key"
  | "live-provider-key"
  | "access-key"
  | "github-token"
  | "bearer-token"
  | "jwt"
  | "sensitive-field"
  | "scan-limit";

export interface ArtifactSecretFinding {
  file: string;
  kind: ArtifactSecretFindingKind;
  fingerprint: string;
  detail: string;
}

export interface ArtifactSecretScan {
  schemaVersion: "1.0";
  root: string;
  scannedFiles: number;
  scannedArchives: number;
  scannedBytes: number;
  passed: boolean;
  findings: ArtifactSecretFinding[];
}

export interface ArtifactSecretScanOptions {
  secrets?: ArtifactSecret[];
  maxFileBytes?: number;
  maxArchiveEntries?: number;
  maxArchiveExpandedBytes?: number;
}

export interface TraceSuppression {
  artifact: "trace";
  reason: "secret-detected" | "inspection-failed";
  findingKinds: ArtifactSecretFindingKind[];
}

export type SecretSafeTraceRetention =
  | { retained: true }
  | { retained: false; suppression: TraceSuppression };

const binaryExtensions = new Set([".gif", ".jpeg", ".jpg", ".mp4", ".pdf", ".png", ".webm"]);
const storageSecretKey = /authorization|cookie|password|passwd|secret|token|api[-_]?key|session/i;
const genericPatterns: Array<{ kind: ArtifactSecretFindingKind; expression: RegExp; detail: string }> = [
  { kind: "private-key", expression: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/g, detail: "Private-key material appears in an artifact." },
  { kind: "live-provider-key", expression: /\b(?:rk|sk)_live_[A-Za-z0-9]{8,}\b/g, detail: "A live provider key appears in an artifact." },
  { kind: "access-key", expression: /\bAKIA[0-9A-Z]{16}\b/g, detail: "An AWS access-key identifier appears in an artifact." },
  { kind: "github-token", expression: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, detail: "A GitHub token appears in an artifact." },
  { kind: "bearer-token", expression: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}\b/g, detail: "A bearer token appears in an artifact." },
  { kind: "jwt", expression: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, detail: "A JWT-like value appears in an artifact." },
];

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function looksText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8_192));
  return !sample.includes(0);
}

function isRedacted(value: string): boolean {
  return /^\[(?:REDACTED|MASKED|SECRET)/i.test(value) || value === "***";
}

function inspectText(file: string, text: string, secrets: ArtifactSecret[], findings: ArtifactSecretFinding[]): void {
  for (const secret of secrets) {
    if (secret.value.length < 4 || !text.includes(secret.value)) continue;
    findings.push({
      file,
      kind: "exact-secret",
      fingerprint: fingerprint(secret.value),
      detail: `Configured secret was found: ${secret.label}.`,
    });
  }
  for (const pattern of genericPatterns) {
    pattern.expression.lastIndex = 0;
    for (const match of text.matchAll(pattern.expression)) {
      const value = match[0];
      if (!value || isRedacted(value)) continue;
      findings.push({ file, kind: pattern.kind, fingerprint: fingerprint(value), detail: pattern.detail });
    }
  }
  const sensitiveField = /["'](?:api[_-]?key|authorization|client[_-]?secret|password|private[_-]?key|secret|token)["']\s*[:=]\s*["']([^"'\r\n]{8,})["']/gi;
  for (const match of text.matchAll(sensitiveField)) {
    const value = match[1];
    if (!value || isRedacted(value) || /^[A-Z_][A-Z0-9_]*$/.test(value)) continue;
    findings.push({
      file,
      kind: "sensitive-field",
      fingerprint: fingerprint(value),
      detail: "A sensitive field contains an unredacted value.",
    });
  }
}

async function filesUnder(root: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) output.push(file);
    }
  };
  await visit(root);
  return output.sort();
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export async function storageStateArtifactSecrets(file: string, maxBytes = 5 * 1024 * 1024): Promise<ArtifactSecret[]> {
  const absoluteFile = path.resolve(file);
  const info = await stat(absoluteFile).catch(() => undefined);
  if (!info?.isFile() || info.size > maxBytes) throw new Error("Browser storage state could not be inspected safely for trace retention.");
  let input: unknown;
  try {
    input = JSON.parse(await readFile(absoluteFile, "utf8")) as unknown;
  } catch {
    throw new Error("Browser storage state could not be inspected safely for trace retention.");
  }
  const root = objectValue(input);
  if (!root) throw new Error("Browser storage state could not be inspected safely for trace retention.");
  const values: ArtifactSecret[] = [];
  for (const [index, value] of (Array.isArray(root.cookies) ? root.cookies : []).entries()) {
    const cookie = objectValue(value);
    if (typeof cookie?.value === "string" && cookie.value.length >= 4) {
      values.push({ label: `storage-state cookie ${index + 1}`, value: cookie.value });
    }
  }
  for (const origin of Array.isArray(root.origins) ? root.origins : []) {
    const storage = objectValue(origin)?.localStorage;
    for (const item of Array.isArray(storage) ? storage : []) {
      const entry = objectValue(item);
      if (typeof entry?.name === "string" && storageSecretKey.test(entry.name) && typeof entry.value === "string" && entry.value.length >= 4) {
        values.push({ label: "storage-state sensitive value", value: entry.value });
      }
    }
  }
  return [...new Map(values.map((secret) => [secret.value, secret])).values()];
}

function createArtifactScanner(options: ArtifactSecretScanOptions) {
  const secrets = (options.secrets ?? []).filter((secret) => secret.value.length >= 4);
  const maxFileBytes = options.maxFileBytes ?? 50 * 1024 * 1024;
  const maxArchiveEntries = options.maxArchiveEntries ?? 5_000;
  const maxArchiveExpandedBytes = options.maxArchiveExpandedBytes ?? 100 * 1024 * 1024;
  const findings: ArtifactSecretFinding[] = [];
  let scannedFiles = 0;
  let scannedArchives = 0;
  let scannedBytes = 0;

  const inspectBytes = (file: string, bytes: Uint8Array, archive = false): void => {
    if (bytes.byteLength > maxFileBytes) {
      findings.push({ file, kind: "scan-limit", fingerprint: fingerprint(file), detail: `Artifact exceeds the ${maxFileBytes}-byte scan limit.` });
      return;
    }
    scannedBytes += bytes.byteLength;
    if (archive || path.extname(file).toLowerCase() === ".zip") {
      scannedArchives += 1;
      let entries: Record<string, Uint8Array>;
      let archiveEntries = 0;
      let declaredExpandedBytes = 0;
      let archiveLimitExceeded = false;
      try {
        entries = unzipSync(bytes, {
          filter: (entry) => {
            archiveEntries += 1;
            declaredExpandedBytes += entry.originalSize;
            if (archiveEntries > maxArchiveEntries || declaredExpandedBytes > maxArchiveExpandedBytes) {
              archiveLimitExceeded = true;
              return false;
            }
            return true;
          },
        });
      } catch {
        findings.push({ file, kind: "scan-limit", fingerprint: fingerprint(file), detail: "ZIP artifact could not be inspected." });
        return;
      }
      if (archiveLimitExceeded) {
        findings.push({ file, kind: "scan-limit", fingerprint: fingerprint(file), detail: "ZIP artifact exceeds bounded entry or expanded-size limits." });
        return;
      }
      const names = Object.keys(entries);
      for (const name of names.sort()) {
        const value = entries[name];
        if (!value || !looksText(value)) continue;
        inspectText(`${file}!${name}`, new TextDecoder().decode(value), secrets, findings);
      }
      return;
    }
    if (binaryExtensions.has(path.extname(file).toLowerCase()) || !looksText(bytes)) return;
    inspectText(file, new TextDecoder().decode(bytes), secrets, findings);
  };

  const inspectFile = async (file: string, label: string): Promise<void> => {
    const info = await stat(file);
    scannedFiles += 1;
    if (info.size > maxFileBytes) {
      findings.push({ file: label, kind: "scan-limit", fingerprint: fingerprint(label), detail: `Artifact exceeds the ${maxFileBytes}-byte scan limit.` });
      return;
    }
    const bytes = await readFile(file);
    inspectBytes(label, bytes);
  };

  const result = (root: string): ArtifactSecretScan => {
    const unique = [...new Map(findings.map((finding) => [`${finding.file}\0${finding.kind}\0${finding.fingerprint}`, finding])).values()]
      .sort((left, right) => `${left.file}:${left.kind}`.localeCompare(`${right.file}:${right.kind}`));
    return {
      schemaVersion: "1.0",
      root,
      scannedFiles,
      scannedArchives,
      scannedBytes,
      passed: unique.length === 0,
      findings: unique,
    };
  };

  return { inspectFile, result };
}

export async function scanArtifactSecrets(
  root: string,
  options: ArtifactSecretScanOptions = {},
): Promise<ArtifactSecretScan> {
  const absoluteRoot = path.resolve(root);
  const rootInfo = await stat(absoluteRoot).catch(() => undefined);
  if (!rootInfo?.isDirectory()) throw new Error(`Artifact scan root is not a directory: ${absoluteRoot}`);
  const scanner = createArtifactScanner(options);
  for (const file of await filesUnder(absoluteRoot)) {
    const relative = path.relative(absoluteRoot, file).split(path.sep).join("/");
    await scanner.inspectFile(file, relative);
  }
  return scanner.result(absoluteRoot);
}

export async function scanArtifactFileSecrets(
  file: string,
  options: ArtifactSecretScanOptions = {},
): Promise<ArtifactSecretScan> {
  const absoluteFile = path.resolve(file);
  const fileInfo = await stat(absoluteFile).catch(() => undefined);
  if (!fileInfo?.isFile()) throw new Error(`Artifact scan target is not a file: ${absoluteFile}`);
  const scanner = createArtifactScanner(options);
  await scanner.inspectFile(absoluteFile, path.basename(absoluteFile));
  return scanner.result(absoluteFile);
}

async function removeRejectedTrace(file: string): Promise<void> {
  await rm(file, { force: true }).catch(async () => {
    await truncate(file, 0);
    await rm(file, { force: true });
  });
  if (await stat(file).catch(() => undefined)) throw new Error("Rejected trace artifact could not be removed.");
}

export async function retainSecretSafeTrace(
  file: string,
  options: ArtifactSecretScanOptions = {},
): Promise<SecretSafeTraceRetention> {
  let scan: ArtifactSecretScan;
  try {
    scan = await scanArtifactFileSecrets(file, options);
  } catch {
    await removeRejectedTrace(file);
    return {
      retained: false,
      suppression: { artifact: "trace", reason: "inspection-failed", findingKinds: ["scan-limit"] },
    };
  }
  if (scan.passed) return { retained: true };
  await removeRejectedTrace(file);
  const findingKinds = [...new Set(scan.findings.map((finding) => finding.kind))].sort();
  return {
    retained: false,
    suppression: {
      artifact: "trace",
      reason: findingKinds.every((kind) => kind === "scan-limit") ? "inspection-failed" : "secret-detected",
      findingKinds,
    },
  };
}
