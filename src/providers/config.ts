import { readFile } from "node:fs/promises";
import { z } from "zod";

const envName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);
const common = {
  timeoutMs: z.number().int().positive().max(60_000).default(5_000),
  allowProduction: z.boolean().default(false),
};

const provider = z.discriminatedUnion("adapter", [
  z.object({ adapter: z.literal("stripe"), secretEnv: envName, baseUrl: z.string().url().default("https://api.stripe.com"), timeoutMs: common.timeoutMs }),
  z.object({ adapter: z.literal("resend"), tokenEnv: envName, baseUrl: z.string().url().default("https://api.resend.com"), ...common }),
  z.object({ adapter: z.literal("sendgrid"), tokenEnv: envName, baseUrl: z.string().url().default("https://api.sendgrid.com"), ...common }),
  z.object({ adapter: z.literal("mailgun"), keyEnv: envName, domain: z.string().min(1), baseUrl: z.string().url().default("https://api.mailgun.net"), ...common }),
  z.object({ adapter: z.literal("s3"), accessKeyEnv: envName, secretKeyEnv: envName, sessionTokenEnv: envName.optional(), region: z.string().min(1), bucket: z.string().min(1), endpoint: z.string().url().optional(), ...common }),
  z.object({ adapter: z.literal("supabase-storage"), keyEnv: envName, bucket: z.string().min(1), baseUrl: z.string().url(), ...common }),
  z.object({ adapter: z.literal("oauth"), introspectionUrl: z.string().url(), clientIdEnv: envName.optional(), clientSecretEnv: envName.optional(), ...common }),
]);

export const providerAdapterConfigSchema = z.object({
  schemaVersion: z.literal("1.0"),
  providers: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), provider),
}).superRefine((config, context) => {
  if (Object.keys(config.providers).length === 0) context.addIssue({ code: "custom", path: ["providers"], message: "At least one provider adapter is required" });
  for (const [name, providerConfig] of Object.entries(config.providers)) {
    if (providerConfig.adapter === "oauth" && Boolean(providerConfig.clientIdEnv) !== Boolean(providerConfig.clientSecretEnv)) {
      context.addIssue({ code: "custom", path: ["providers", name], message: "OAuth clientIdEnv and clientSecretEnv must be configured together" });
    }
  }
});

export type ProviderAdapterConfig = z.infer<typeof providerAdapterConfigSchema>;
export type BuiltinProviderConfig = ProviderAdapterConfig["providers"][string];

export async function loadProviderAdapterConfig(file: string): Promise<ProviderAdapterConfig> {
  const parsed = providerAdapterConfigSchema.safeParse(JSON.parse(await readFile(file, "utf8")) as unknown);
  if (!parsed.success) throw new Error(`Invalid provider adapter config: ${parsed.error.message}`);
  return parsed.data;
}
