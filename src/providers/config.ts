import { readFile } from "node:fs/promises";
import { z } from "zod";

const envName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);
const providerName = z.string().regex(/^[a-z][a-z0-9-]*$/);
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

const automaticCheck = z.object({
  provider: providerName,
  kind: z.enum(["payment", "email", "storage", "oauth"]),
  operation: z.string().min(1).max(100),
  resource: z.string().min(1).max(100),
  state: z.enum(["confirmed", "absent"]).default("confirmed"),
  match: z.object({
    actionLabelIncludes: z.string().min(1).max(200).optional(),
    actionKind: z.enum(["navigation", "local", "mutation", "external"]).optional(),
    actionIntent: z.enum(["create", "update", "delete", "submit", "navigate", "interact", "external", "unknown"]).optional(),
    requestUrlIncludes: z.string().min(1).max(500).optional(),
  }).refine((match) => Object.values(match).some((value) => value !== undefined), {
    message: "Automatic provider checks require at least one action or request matcher",
  }),
  reference: z.discriminatedUnion("from", [
    z.object({ from: z.literal("response-resource-id") }),
    z.object({ from: z.literal("upload-file-name") }),
    z.object({ from: z.literal("download-file-name") }),
    z.object({ from: z.literal("environment"), env: envName }),
  ]),
});

export const providerAdapterConfigSchema = z.object({
  schemaVersion: z.literal("1.0"),
  providers: z.record(providerName, provider),
  automaticChecks: z.array(automaticCheck).max(20).default([]),
}).superRefine((config, context) => {
  if (Object.keys(config.providers).length === 0) context.addIssue({ code: "custom", path: ["providers"], message: "At least one provider adapter is required" });
  for (const [name, providerConfig] of Object.entries(config.providers)) {
    if (providerConfig.adapter === "oauth" && Boolean(providerConfig.clientIdEnv) !== Boolean(providerConfig.clientSecretEnv)) {
      context.addIssue({ code: "custom", path: ["providers", name], message: "OAuth clientIdEnv and clientSecretEnv must be configured together" });
    }
  }
  for (const [index, check] of config.automaticChecks.entries()) {
    if (!config.providers[check.provider]) {
      context.addIssue({ code: "custom", path: ["automaticChecks", index, "provider"], message: "Automatic check references an unconfigured provider" });
    }
  }
});

export type ProviderAdapterConfig = z.infer<typeof providerAdapterConfigSchema>;
export type BuiltinProviderConfig = ProviderAdapterConfig["providers"][string];
export type AutomaticProviderCheck = ProviderAdapterConfig["automaticChecks"][number];

export async function loadProviderAdapterConfig(file: string): Promise<ProviderAdapterConfig> {
  const parsed = providerAdapterConfigSchema.safeParse(JSON.parse(await readFile(file, "utf8")) as unknown);
  if (!parsed.success) throw new Error(`Invalid provider adapter config: ${parsed.error.message}`);
  return parsed.data;
}
