import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SnapshotReference {
  sha256: string;
  file: string;
}

export interface SnapshotIndex {
  schemaVersion: "1.0";
  findingId: string;
  refs: Record<string, SnapshotReference>;
}

export async function writeDeduplicatedSnapshots(
  reportDirectory: string,
  findingId: string,
  snapshots: Record<string, unknown>,
): Promise<SnapshotIndex> {
  const blobDirectory = path.join(reportDirectory, "snapshots", "blobs");
  await mkdir(blobDirectory, { recursive: true });
  const refs: Record<string, SnapshotReference> = {};
  for (const [name, value] of Object.entries(snapshots)) {
    if (value === undefined) continue;
    const text = `${JSON.stringify(value, null, 2)}\n`;
    const sha256 = createHash("sha256").update(text).digest("hex");
    const file = path.join(blobDirectory, `${sha256}.json`);
    await writeFile(file, text, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    refs[name] = { sha256, file: `blobs/${sha256}.json` };
  }
  const index: SnapshotIndex = { schemaVersion: "1.0", findingId, refs };
  await writeFile(path.join(reportDirectory, "snapshots", `${findingId}.index.json`), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}
