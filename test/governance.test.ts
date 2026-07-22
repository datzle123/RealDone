import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

test("normative product truth is linked, consistent, and shipped", async () => {
  const [specification, status, roadmap, matrix, readme, docsIndex, contributing, agents, pullRequest, packageText, workflow] = await Promise.all([
    read("docs/PRODUCT_SPECIFICATION.md"),
    read("docs/PRODUCT_STATUS.md"),
    read("docs/ROADMAP.md"),
    read("docs/VERIFICATION_MATRIX.md"),
    read("README.md"),
    read("docs/README.md"),
    read("CONTRIBUTING.md"),
    read("AGENTS.md"),
    read(".github/PULL_REQUEST_TEMPLATE.md"),
    read("package.json"),
    read(".github/workflows/ci.yml"),
  ]);

  assert.match(specification, /Trạng thái: NORMATIVE/);
  assert.match(specification, /# 29\. Release Gates/);
  assert.match(specification, /# 32\. Định nghĩa hoàn thành full project/);
  assert.match(status, /Full product:\*\* \*\*HOÀN THÀNH/);
  assert.match(roadmap, /PRODUCT_SPECIFICATION\.md/);
  assert.match(roadmap, /only area-completeness ledger/i);
  assert.doesNotMatch(roadmap, /Mapped specification:/);
  assert.match(matrix, /not a product-status ledger/i);
  assert.doesNotMatch(status, /16\/58/);

  const rows = [...status.matchAll(/^\| ([^|]+) \| (IMPLEMENTED|PARTIAL|PLANNED) \|/gm)]
    .map((match) => ({ area: match[1]?.trim() ?? "", state: match[2] ?? "" }));
  const counts = {
    IMPLEMENTED: rows.filter((row) => row.state === "IMPLEMENTED").length,
    PARTIAL: rows.filter((row) => row.state === "PARTIAL").length,
    PLANNED: rows.filter((row) => row.state === "PLANNED").length,
  };
  assert.deepEqual(counts, { IMPLEMENTED: 22, PARTIAL: 0, PLANNED: 0 });
  assert.ok(status.includes(`Area coverage:** **${counts.IMPLEMENTED}/${rows.length} \`IMPLEMENTED\``));
  assert.match(status, /Detector catalog: \*\*58\/58 production-classified and gated\*\*/);
  for (const area of ["§4 Record and verify", "§12–13 Evidence and snapshots", "§19–20 Contracts and replay", "§21 Report", "§22 Database adapters", "§23 Provider adapters", "§25 Safety", "§26 Benchmark"]) {
    assert.equal(rows.find((row) => row.area === area)?.state, "IMPLEMENTED", `${area} must agree with its completed phase gate`);
  }
  assert.equal(rows.find((row) => row.area === "§4 Coding-agent verification")?.state, "IMPLEMENTED");
  assert.equal(rows.find((row) => row.area === "§32 Full-product definition")?.state, "IMPLEMENTED");

  for (const surface of [readme, docsIndex, contributing, agents, pullRequest]) {
    assert.match(surface, /PRODUCT_SPECIFICATION\.md/);
  }
  assert.ok(readme.split(/\r?\n/).length <= 180, "GitHub README must stay scannable in under 180 lines");
  const readmeOpening = readme.split(/\r?\n/).slice(0, 45).join("\n");
  for (const message of ["Prove that a web app works", "## Try it", "pnpm realdone scan", "does **not** score visual design"]) {
    assert.ok(readmeOpening.includes(message), `README opening is missing: ${message}`);
  }
  assert.doesNotMatch(readme, /npx realdone/, "README must not advertise npm installation before the package is published");

  const packageJson = JSON.parse(packageText) as { files?: string[]; scripts?: Record<string, string> };
  assert.equal(packageJson.scripts?.realdone, "node dist/cli.js");
  for (const file of ["docs/PRODUCT_SPECIFICATION.md", "docs/PRODUCT_STATUS.md", "docs/ROADMAP.md"]) {
    const shipped = packageJson.files?.some((entry) => file === entry || file.startsWith(`${entry.replace(/\/$/, "")}/`));
    assert.ok(shipped, `${file} must ship in the package`);
  }
  assert.match(workflow, /pnpm smoke:package/);
});
