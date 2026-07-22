import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const valueTypeSchema = z.enum(["array", "boolean", "null", "number", "object", "string"]);
const baselineSchema = z.object({
  schemaVersion: z.literal("1.0"),
  artifacts: z.array(z.object({
    name: z.string().min(1),
    optional: z.boolean().default(false),
    required: z.record(z.string().min(1), z.array(valueTypeSchema).min(1)),
  })).min(1),
});

export type ArtifactValueType = z.infer<typeof valueTypeSchema>;
export interface ArtifactSchemaIssue {
  artifact: string;
  file?: string;
  path?: string;
  kind: "missing-artifact" | "invalid-json" | "missing-path" | "type-mismatch" | "scan-limit";
  expected?: ArtifactValueType[];
  actual?: ArtifactValueType;
}

export interface ArtifactSchemaCompatibility {
  schemaVersion: "1.0";
  baselineFile: string;
  root: string;
  checkedFiles: number;
  passed: boolean;
  issues: ArtifactSchemaIssue[];
}

function valueType(value: unknown): ArtifactValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as Exclude<ArtifactValueType, "array" | "null">;
}

function valueAt(input: unknown, pointer: string): { found: boolean; value?: unknown } {
  let value = input;
  for (const part of pointer.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, part)) return { found: false };
    value = (value as Record<string, unknown>)[part];
  }
  return { found: true, value };
}

async function filesUnder(root: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) output.push(file);
    }
  };
  await visit(root);
  return output.sort();
}

export async function checkArtifactSchemaCompatibility(
  root: string,
  baselineFile: string,
  maxJsonBytes = 20 * 1024 * 1024,
): Promise<ArtifactSchemaCompatibility> {
  const absoluteRoot = path.resolve(root);
  const rootInfo = await stat(absoluteRoot).catch(() => undefined);
  if (!rootInfo?.isDirectory()) throw new Error(`Artifact schema root is not a directory: ${absoluteRoot}`);
  const absoluteBaseline = path.resolve(baselineFile);
  const parsed = baselineSchema.safeParse(JSON.parse(await readFile(absoluteBaseline, "utf8")) as unknown);
  if (!parsed.success) throw new Error(`Invalid artifact schema baseline: ${parsed.error.message}`);
  const files = await filesUnder(absoluteRoot);
  const issues: ArtifactSchemaIssue[] = [];
  let checkedFiles = 0;
  for (const artifact of parsed.data.artifacts) {
    const matches = files.filter((file) => path.basename(file) === artifact.name);
    if (matches.length === 0) {
      if (!artifact.optional) issues.push({ artifact: artifact.name, kind: "missing-artifact" });
      continue;
    }
    for (const file of matches) {
      const relative = path.relative(absoluteRoot, file).split(path.sep).join("/");
      const info = await stat(file);
      if (info.size > maxJsonBytes) {
        issues.push({ artifact: artifact.name, file: relative, kind: "scan-limit" });
        continue;
      }
      let input: unknown;
      try {
        input = JSON.parse(await readFile(file, "utf8")) as unknown;
      } catch {
        issues.push({ artifact: artifact.name, file: relative, kind: "invalid-json" });
        continue;
      }
      checkedFiles += 1;
      for (const [pointer, expected] of Object.entries(artifact.required)) {
        const observed = valueAt(input, pointer);
        if (!observed.found) {
          issues.push({ artifact: artifact.name, file: relative, path: pointer, kind: "missing-path", expected });
          continue;
        }
        const actual = valueType(observed.value);
        if (!expected.includes(actual)) {
          issues.push({ artifact: artifact.name, file: relative, path: pointer, kind: "type-mismatch", expected, actual });
        }
      }
    }
  }
  return {
    schemaVersion: "1.0",
    baselineFile: absoluteBaseline,
    root: absoluteRoot,
    checkedFiles,
    passed: issues.length === 0,
    issues,
  };
}
