import { readFile } from "node:fs/promises";
import { createFirebaseAdapterFromFile } from "./firebase/index.js";
import { createMongoAdapterFromFile } from "./mongodb/index.js";
import { createPostgresAdapterFromFile } from "./postgres/index.js";
import { createSupabaseAdapterFromFile } from "./supabase/index.js";
import type { DiscoverableSourceAdapter } from "./types.js";

export async function createSourceAdapterFromFile(file: string): Promise<DiscoverableSourceAdapter> {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Unable to read database adapter config: ${error instanceof Error ? error.message : String(error)}`);
  }
  const adapter = input && typeof input === "object" && "adapter" in input ? (input as { adapter?: unknown }).adapter : undefined;
  switch (adapter) {
    case "postgresql": return createPostgresAdapterFromFile(file);
    case "supabase": return createSupabaseAdapterFromFile(file);
    case "firebase": return createFirebaseAdapterFromFile(file);
    case "mongodb": return createMongoAdapterFromFile(file);
    case "sqlite": throw new Error("SQLite is zero-config; use --sqlite <database-file> instead of a mapping file.");
    case "prisma":
    case "custom": throw new Error(`${adapter} adapters use a versioned source plugin manifest, not a database config file.`);
    default: throw new Error(`Unsupported database adapter config: ${String(adapter ?? "missing adapter")}`);
  }
}
