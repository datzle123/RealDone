import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

  const packageJson = JSON.parse(packageText) as { version?: string; files?: string[]; scripts?: Record<string, string> };
  assert.match(packageJson.version ?? "", /^\d+\.\d+\.\d+$/);

  assert.match(specification, /Trạng thái: NORMATIVE/);
  assert.match(specification, /# 29\. Release Gates/);
  assert.match(specification, /# 32\. Định nghĩa hoàn thành full project/);
  assert.ok(status.includes(`Released full product:** **IMPLEMENTED in \`v${packageJson.version}\``));
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
  for (const message of ["Prove that a web app works", "## Try it", "npx realdone scan", "does **not** score visual design"]) {
    assert.ok(readmeOpening.includes(message), `README opening is missing: ${message}`);
  }
  assert.doesNotMatch(readmeOpening, /git clone|installed from source|not published/i, "README opening must keep the npm quick start truthful and one-command");
  assert.match(readme, /npmjs\.com\/package\/realdone/);

  assert.equal(packageJson.scripts?.realdone, "node dist/cli.js");
  for (const file of ["docs/PRODUCT_SPECIFICATION.md", "docs/PRODUCT_STATUS.md", "docs/ROADMAP.md"]) {
    const shipped = packageJson.files?.some((entry) => file === entry || file.startsWith(`${entry.replace(/\/$/, "")}/`));
    assert.ok(shipped, `${file} must ship in the package`);
  }
  assert.match(workflow, /pnpm smoke:package/);
});

test("repository governance rejects a weakened policy and accepts the protected-main control", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "realdone-governance-"));
  const script = fileURLToPath(new URL("../scripts/check-repository-governance.mjs", import.meta.url));
  const workflow = fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url));
  const actualManifest = JSON.parse(await read(".github/repository-governance.json")) as Record<string, unknown>;
  const brokenManifest = path.join(directory, "broken.json");

  try {
    await writeFile(brokenManifest, JSON.stringify({ ...actualManifest, strict: false, enforceAdmins: false }));
    const broken = spawnSync(process.execPath, [script, "--manifest", brokenManifest, "--workflow", workflow], { encoding: "utf8" });
    assert.equal(broken.status, 1);
    assert.match(broken.stdout, /GOV006/);
    assert.match(broken.stdout, /GOV007/);

    const control = spawnSync(process.execPath, [script], { cwd: fileURLToPath(root), encoding: "utf8" });
    assert.equal(control.status, 0, control.stderr || control.stdout);
    assert.match(control.stdout, /"passed": true/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("aggregate release prerequisite guard fails closed and accepts the all-success control", () => {
  const script = fileURLToPath(new URL("../scripts/check-release-prerequisites.mjs", import.meta.url));
  const broken = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, REALDONE_CHECK_RESULT: "failure", REALDONE_COMPATIBILITY_RESULT: "success" },
  });
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /"passed":false/);

  const control = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, REALDONE_CHECK_RESULT: "success", REALDONE_COMPATIBILITY_RESULT: "success" },
  });
  assert.equal(control.status, 0, control.stderr || control.stdout);
  assert.match(control.stdout, /"passed":true/);
});
