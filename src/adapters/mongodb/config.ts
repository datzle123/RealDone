import { readFile } from "node:fs/promises";
import { z } from "zod";

const alias = z.string().regex(/^[A-Za-z_][A-Za-z0-9_$]*$/);
const target = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/);
const field = z.object({ target, type: z.enum(["string", "number", "boolean", "date", "objectId", "unknown"]).optional(), nullable: z.boolean().optional() });
const resource = z.object({
  target,
  fields: z.record(alias, field),
  primaryKey: z.array(alias).min(1),
  softDeleteFields: z.array(alias).default([]),
  cleanupMaxRows: z.number().int().positive().max(100).default(1),
});

export const mongoAdapterConfigSchema = z.object({
  schemaVersion: z.literal("1.0"),
  adapter: z.literal("mongodb"),
  connectionEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
  database: target,
  tls: z.object({ mode: z.enum(["require", "allow-local"]), caFileEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional() }).default({ mode: "require" }),
  allowProduction: z.boolean().default(false),
  allowCleanup: z.boolean().default(false),
  timeoutMs: z.number().int().positive().max(60_000).default(5_000),
  resources: z.record(alias, resource),
}).superRefine((config, context) => {
  if (Object.keys(config.resources).length === 0) context.addIssue({ code: "custom", path: ["resources"], message: "At least one MongoDB resource is required" });
  for (const [name, mapped] of Object.entries(config.resources)) {
    for (const key of [...mapped.primaryKey, ...mapped.softDeleteFields]) {
      if (!(key in mapped.fields)) context.addIssue({ code: "custom", path: ["resources", name], message: `Unknown mapped field: ${key}` });
    }
  }
});

export type MongoAdapterConfig = z.infer<typeof mongoAdapterConfigSchema>;

export async function loadMongoAdapterConfig(file: string): Promise<MongoAdapterConfig> {
  const parsed = mongoAdapterConfigSchema.safeParse(JSON.parse(await readFile(file, "utf8")) as unknown);
  if (!parsed.success) throw new Error(`Invalid MongoDB adapter config: ${parsed.error.message}`);
  return parsed.data;
}
