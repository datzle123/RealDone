import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const pluginNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);
const environmentNameSchema = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);

export const pluginManifestSchema = z.object({
  apiVersion: z.literal("1.0"),
  name: pluginNameSchema,
  version: z.string().min(1),
  entry: z.string().min(1),
  providers: z.array(z.object({
    name: pluginNameSchema,
    kind: z.enum(["payment", "email", "storage", "oauth"]),
  })).default([]),
  sources: z.array(z.object({
    name: pluginNameSchema,
    kind: z.enum(["prisma", "custom"]),
  })).default([]),
  permissions: z.object({
    environment: z.array(environmentNameSchema).default([]),
    networkHosts: z.array(z.string().min(1)).default([]),
  }).default({ environment: [], networkHosts: [] }),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export interface ResolvedPluginManifest extends PluginManifest {
  manifestFile: string;
  entryFile: string;
}

export async function loadPluginManifest(file: string): Promise<ResolvedPluginManifest> {
  const manifestFile = path.resolve(file);
  const input = JSON.parse(await readFile(manifestFile, "utf8")) as unknown;
  const parsed = pluginManifestSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid RealDone plugin manifest: ${parsed.error.message}`);
  if (path.isAbsolute(parsed.data.entry)) throw new Error("Plugin entry must be relative to its manifest.");
  const entryFile = path.resolve(path.dirname(manifestFile), parsed.data.entry);
  const relativeEntry = path.relative(path.dirname(manifestFile), entryFile);
  if (relativeEntry.startsWith("..") || path.isAbsolute(relativeEntry)) {
    throw new Error("Plugin entry must stay within the plugin directory.");
  }
  const info = await stat(entryFile).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`Plugin entry does not exist: ${entryFile}`);
  return { ...parsed.data, manifestFile, entryFile };
}
