import { readFile } from "node:fs/promises";
import { z } from "zod";

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const identifierSchema = z.string().regex(identifierPattern, "Expected a safe PostgreSQL identifier");

const resourceSchema = z.object({
  schema: identifierSchema.default("public"),
  table: identifierSchema,
  columns: z.record(identifierSchema, identifierSchema),
  cleanupKey: z.array(identifierSchema).min(1).optional(),
  cleanupMaxRows: z.number().int().positive().max(100).default(1),
});

export const postgresAdapterConfigSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    adapter: z.literal("postgresql"),
    connectionEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/, "Expected an environment variable name"),
    tls: z
      .object({
        mode: z.enum(["disable", "require", "verify-full"]).default("verify-full"),
        caEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(),
      })
      .default({ mode: "verify-full" }),
    connectionTimeoutMs: z.number().int().positive().max(60_000).default(5_000),
    statementTimeoutMs: z.number().int().positive().max(60_000).default(5_000),
    allowCleanup: z.boolean().default(false),
    resources: z.record(identifierSchema, resourceSchema),
  })
  .superRefine((config, context) => {
    if (Object.keys(config.resources).length === 0) {
      context.addIssue({ code: "custom", path: ["resources"], message: "At least one resource mapping is required" });
    }
    for (const [resourceName, resource] of Object.entries(config.resources)) {
      if (Object.keys(resource.columns).length === 0) {
        context.addIssue({ code: "custom", path: ["resources", resourceName, "columns"], message: "At least one column mapping is required" });
      }
      for (const key of resource.cleanupKey ?? []) {
        if (!(key in resource.columns)) {
          context.addIssue({
            code: "custom",
            path: ["resources", resourceName, "cleanupKey"],
            message: `Cleanup key ${key} is not a mapped field`,
          });
        }
      }
    }
  });

export type PostgresAdapterConfig = z.infer<typeof postgresAdapterConfigSchema>;
export type PostgresResourceConfig = PostgresAdapterConfig["resources"][string];

export async function loadPostgresAdapterConfig(file: string): Promise<PostgresAdapterConfig> {
  const input = JSON.parse(await readFile(file, "utf8")) as unknown;
  const parsed = postgresAdapterConfigSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid PostgreSQL adapter config: ${parsed.error.message}`);
  return parsed.data;
}

export function assertSafeIdentifier(value: string): string {
  if (!identifierPattern.test(value)) throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  return value;
}
