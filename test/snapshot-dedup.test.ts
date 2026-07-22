import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { writeDeduplicatedSnapshots } from "../src/report/snapshots.js";

test("snapshot artifacts use one content-addressed blob for repeated state", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "realdone-snapshot-dedup-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const state = { url: "http://127.0.0.1:3000", domHash: "same", storage: { cookies: [] } };
  const first = await writeDeduplicatedSnapshots(directory, "RD-001", { before: state, after: state });
  const second = await writeDeduplicatedSnapshots(directory, "RD-002", { before: state });

  assert.equal(first.refs.before?.sha256, first.refs.after?.sha256);
  assert.equal(first.refs.before?.sha256, second.refs.before?.sha256);
  assert.equal((await readdir(path.join(directory, "snapshots", "blobs"))).length, 1);
  const indexText = await readFile(path.join(directory, "snapshots", "RD-001.index.json"), "utf8");
  assert.doesNotMatch(indexText, /http:\/\/127\.0\.0\.1/);
});
