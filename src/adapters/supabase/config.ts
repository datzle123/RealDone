import { readFile } from "node:fs/promises";
import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_$]*$/);
const field = z.object({ target: identifier, type: z.string().optional(), nullable: z.boolean().optional() });
const resource = z.object({
  target: identifier,
  fields: z.record(identifier, field),
  primaryKey: z.array(identifier).min(1),
  softDeleteFields: z.array(identifier).default([]),
  cleanupMaxRows: z.number().int().positive().max(100).default(1),
});

export const supabaseAdapterConfigSchema = z.object({
  schemaVersion: z.literal("1.0"),
  adapter: z.literal("supabase"),
  url: z.string().url(),
  keyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
  schema: identifier.default("public"),
  allowProduction: z.boolean().default(false),
  allowCleanup: z.boolean().default(false),
  timeoutMs: z.number().int().positive().max(60_000).default(5_000),
  resources: z.record(identifier, resource),
}).superRefine((config, context) => {
  if (Object.keys(config.resources).length === 0) context.addIssue({ code: "custom", path: ["resources"], message: "At least one Supabase resource is required" });
  for (const [name, mapped] of Object.entries(config.resources)) {
    for (const key of [...mapped.primaryKey, ...mapped.softDeleteFields]) {
      if (!(key in mapped.fields)) context.addIssue({ code: "custom", path: ["resources", name], message: `Unknown mapped field: ${key}` });
    }
  }
});

export type SupabaseAdapterConfig = z.infer<typeof supabaseAdapterConfigSchema>;

export async function loadSupabaseAdapterConfig(file: string): Promise<SupabaseAdapterConfig> {
  const parsed = supabaseAdapterConfigSchema.safeParse(JSON.parse(await readFile(file, "utf8")) as unknown);
  if (!parsed.success) throw new Error(`Invalid Supabase adapter config: ${parsed.error.message}`);
  return parsed.data;
}
