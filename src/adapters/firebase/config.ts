import { readFile } from "node:fs/promises";
import { z } from "zod";

const alias = z.string().regex(/^[A-Za-z_][A-Za-z0-9_$]*$/);
const fieldPath = z.string().regex(/^(?:__name__|[A-Za-z_][A-Za-z0-9_.]*)$/);
const collectionPath = z.string().regex(/^[A-Za-z0-9_-]+$/);
const field = z.object({ target: fieldPath, type: z.string().optional(), nullable: z.boolean().optional() });
const resource = z.object({
  target: collectionPath,
  fields: z.record(alias, field),
  primaryKey: z.array(alias).length(1),
  softDeleteFields: z.array(alias).default([]),
  cleanupMaxRows: z.literal(1).default(1),
});

export const firebaseAdapterConfigSchema = z.object({
  schemaVersion: z.literal("1.0"),
  adapter: z.literal("firebase"),
  projectId: z.string().min(1),
  databaseId: z.string().min(1).default("(default)"),
  baseUrl: z.string().url().default("https://firestore.googleapis.com/v1"),
  tokenEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(),
  allowProduction: z.boolean().default(false),
  allowCleanup: z.boolean().default(false),
  timeoutMs: z.number().int().positive().max(60_000).default(5_000),
  resources: z.record(alias, resource),
}).superRefine((config, context) => {
  if (Object.keys(config.resources).length === 0) context.addIssue({ code: "custom", path: ["resources"], message: "At least one Firebase resource is required" });
  for (const [name, mapped] of Object.entries(config.resources)) {
    for (const key of [...mapped.primaryKey, ...mapped.softDeleteFields]) {
      if (!(key in mapped.fields)) context.addIssue({ code: "custom", path: ["resources", name], message: `Unknown mapped field: ${key}` });
    }
    const primary = mapped.fields[mapped.primaryKey[0] ?? ""];
    if (primary?.target !== "__name__") context.addIssue({ code: "custom", path: ["resources", name, "primaryKey"], message: "Firebase cleanup requires a primary key mapped to __name__" });
  }
});

export type FirebaseAdapterConfig = z.infer<typeof firebaseAdapterConfigSchema>;

export async function loadFirebaseAdapterConfig(file: string): Promise<FirebaseAdapterConfig> {
  const parsed = firebaseAdapterConfigSchema.safeParse(JSON.parse(await readFile(file, "utf8")) as unknown);
  if (!parsed.success) throw new Error(`Invalid Firebase adapter config: ${parsed.error.message}`);
  return parsed.data;
}
