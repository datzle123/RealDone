import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverProject, loadProjectProfile, writeProjectProfile } from "../src/project/discovery.js";

test("project discovery finds runtime, framework, routes, database, auth, and test environment without reading secrets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "realdone-project-"));
  try {
    await mkdir(path.join(root, "app", "customers", "[id]"), { recursive: true });
    await mkdir(path.join(root, "data"), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, "package.json"), JSON.stringify({
        packageManager: "pnpm@10.34.5",
        scripts: {
          dev: "next dev --port 4312",
          build: "next build",
          start: "next start --port 4312",
          test: "vitest",
        },
        dependencies: {
          next: "1.0.0",
          react: "1.0.0",
          "better-sqlite3": "1.0.0",
          "@supabase/supabase-js": "1.0.0",
        },
        devDependencies: { "@playwright/test": "1.0.0", vitest: "1.0.0" },
      })),
      writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n"),
      writeFile(path.join(root, ".env.example"), "DATABASE_URL=never-copy-this-value\n"),
      writeFile(path.join(root, "data", "application.sqlite"), ""),
      writeFile(path.join(root, "Dockerfile"), "FROM scratch\n"),
      writeFile(path.join(root, "app", "customers", "[id]", "page.tsx"), "export default function Page() { return null }\n"),
    ]);
    const profile = await discoverProject(root);
    assert.equal(profile.framework, "Next.js");
    assert.equal(profile.packageManager, "pnpm");
    assert.equal(profile.port, 4312);
    assert.equal(profile.commands.development?.executable, "pnpm");
    assert.deepEqual(profile.commands.development?.args, ["dev"]);
    assert.deepEqual(profile.commands.build?.args, ["build"]);
    assert.ok(profile.routes.includes("/customers/:param"));
    assert.deepEqual(profile.databases, ["SQLite", "Supabase"]);
    assert.deepEqual(profile.databaseFiles, ["data/application.sqlite"]);
    assert.deepEqual(profile.authProviders, ["Supabase Auth"]);
    assert.deepEqual(profile.testFrameworks, ["Playwright", "Vitest"]);
    assert.deepEqual(profile.environmentFiles, [".env.example"]);
    assert.equal(profile.docker, true);
    assert.equal(JSON.stringify(profile).includes("never-copy-this-value"), false);

    const profileFile = await writeProjectProfile(profile, path.join(root, ".realdone", "project.json"));
    assert.deepEqual(await loadProjectProfile(profileFile), profile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
