import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

test("normative product truth is linked and shipped", async () => {
  const [specification, status, roadmap, readme, docsIndex, contributing, agents, pullRequest, packageText, workflow] = await Promise.all([
    read("docs/PRODUCT_SPECIFICATION.md"),
    read("docs/PRODUCT_STATUS.md"),
    read("docs/ROADMAP.md"),
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
  assert.match(status, /Full product:\*\* \*\*CHƯA HOÀN THÀNH/);
  assert.match(roadmap, /PRODUCT_SPECIFICATION\.md/);

  for (const surface of [readme, docsIndex, contributing, agents, pullRequest]) {
    assert.match(surface, /PRODUCT_SPECIFICATION\.md/);
  }

  const packageJson = JSON.parse(packageText) as { files?: string[] };
  for (const file of ["docs/PRODUCT_SPECIFICATION.md", "docs/PRODUCT_STATUS.md", "docs/ROADMAP.md"]) {
    assert.ok(packageJson.files?.includes(file), `${file} must ship in the package`);
  }
  assert.match(workflow, /pnpm smoke:package/);
});
