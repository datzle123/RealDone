import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateReleaseGates } from "../dist/release/gates.js";

const inputArgument = process.argv[2];
if (!inputArgument) {
  throw new Error("Usage: pnpm release:gates <release-evidence.json> [release-gates.json]");
}

const inputFile = path.resolve(inputArgument);
const outputFile = path.resolve(process.argv[3] ?? ".realdone/release/release-gates.json");
const evidence = JSON.parse(await readFile(inputFile, "utf8"));
const report = evaluateReleaseGates(evidence);
await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);

for (const gate of report.gates) {
  process.stdout.write(`${gate.passed ? "PASS" : "FAIL"} ${gate.id} ${gate.name}: ${gate.observed}\n`);
}
process.stdout.write(`\n${report.passedGates}/${report.totalGates} release gates passed.\nEvidence: ${inputFile}\nReport: ${outputFile}\n`);
if (!report.passed) process.exitCode = 1;
