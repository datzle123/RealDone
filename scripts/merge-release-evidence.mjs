import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mergeReleaseGateEvidence, releaseRunAttestationSchema } from "../dist/release/gates.js";

const [attestationArgument, externalCaseArgument, outputArgument] = process.argv.slice(2);
if (!attestationArgument || !externalCaseArgument) {
  throw new Error("Usage: pnpm release:merge <attestation-directory> <external-cases.json> [release-evidence.json]");
}

async function filesUnder(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(file));
    else if (entry.isFile() && entry.name.endsWith(".json")) output.push(file);
  }
  return output;
}

const attestationRoot = path.resolve(attestationArgument);
const attestations = [];
for (const file of await filesUnder(attestationRoot)) {
  const parsed = releaseRunAttestationSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (parsed.success) attestations.push(parsed.data);
}
if (attestations.length === 0) throw new Error(`No valid release attestations were found in ${attestationRoot}.`);

const externalCaseFile = path.resolve(externalCaseArgument);
const externalCases = JSON.parse(await readFile(externalCaseFile, "utf8"));
const evidence = mergeReleaseGateEvidence(attestations, externalCases);
const outputFile = path.resolve(outputArgument ?? ".realdone/release/release-evidence.json");
await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`Merged ${attestations.length} attestations across ${evidence.platforms.join(", ")}.\nEvidence: ${outputFile}\n`);
