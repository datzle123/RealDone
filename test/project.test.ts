import assert from "node:assert/strict";
import { createServer } from "node:net";
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

test("project discovery falls back to npm when a Node web project has scripts but no lockfile or packageManager field", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "realdone-project-node-fallback-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      scripts: { dev: "node server.mjs --port 41249" },
    }));
    await writeFile(path.join(root, "server.mjs"), "export {};\n");
    const profile = await discoverProject(root);
    assert.equal(profile.packageManager, "npm");
    assert.deepEqual(profile.commands.development, {
      executable: "npm",
      args: ["run", "dev"],
      source: "package.json#scripts.dev",
    });
    assert.equal(profile.port, 41249);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project discovery accepts a start-only Node project as the development runtime", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "realdone-project-start-fallback-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { start: "node server.mjs --port 41319" } }));
    const profile = await discoverProject(root);
    assert.deepEqual(profile.commands.development?.args, ["run", "start"]);
    assert.equal(profile.port, 41319);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project discovery provides a packaged managed runtime for a static HTML project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "realdone-project-static-"));
  try {
    await mkdir(path.join(root, "about"), { recursive: true });
    await writeFile(path.join(root, "index.html"), "<!doctype html><button>Open</button>\n");
    await writeFile(path.join(root, "about", "index.html"), "<!doctype html><h1>About</h1>\n");
    const profile = await discoverProject(root);
    assert.equal(profile.framework, "Static HTML");
    assert.equal(profile.packageManager, "unknown");
    assert.equal(profile.port, 4173);
    assert.equal(profile.commands.development?.executable, process.execPath);
    assert.match(profile.commands.development?.args[0] ?? "", /runtime[\\/]static-server\.js$/);
    assert.deepEqual(profile.routes, ["/", "/about"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("static project discovery selects another local port when 4173 is occupied", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "realdone-project-static-port-"));
  const blocker = createServer();
  try {
    await writeFile(path.join(root, "index.html"), "<!doctype html><button>Open</button>\n");
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(4173, "127.0.0.1", resolve);
    });
    const profile = await discoverProject(root);
    assert.notEqual(profile.port, 4173);
    assert.equal(profile.commands.development?.args.at(-1), String(profile.port));
  } finally {
    if (blocker.listening) {
      await new Promise<void>((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve()));
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("project discovery recognizes conventional non-Node web runtimes", async () => {
  const expectedPython = process.env.VIRTUAL_ENV
    ? path.join(process.env.VIRTUAL_ENV, process.platform === "win32" ? "Scripts/python.exe" : "bin/python")
    : process.platform === "win32" ? "py" : "python3";
  const cases = [
    { files: { "manage.py": "" }, framework: "Django", executable: expectedPython, port: 8000 },
    { files: { "main.py": "from fastapi import FastAPI\napp = FastAPI()\n" }, framework: "FastAPI", executable: expectedPython, port: 8000 },
    { files: { "app.py": "from flask import Flask\napp = Flask(__name__)\n" }, framework: "Flask", executable: expectedPython, port: 5000 },
    { files: { artisan: "" }, framework: "Laravel", executable: "php", port: 8000 },
    { files: { "bin/rails": "" }, framework: "Ruby on Rails", executable: "ruby", port: 3000 },
    { files: { "Example.csproj": "<Project />" }, framework: "ASP.NET Core", executable: "dotnet", port: 5000 },
    { files: { "deno.json": "{\"tasks\":{\"dev\":\"deno run --allow-net server.ts --port 8111\"}}" }, framework: "Deno web application", executable: "deno", port: 8111 },
    { files: { "go.mod": "module example\n" }, framework: "Go web application", executable: "go", port: 8080 },
    { files: { "Cargo.toml": "[dependencies]\naxum = '1'\n" }, framework: "Axum", executable: "cargo", port: 3000 },
    { files: { "composer.json": "{\"scripts\":{\"serve\":\"php -S 127.0.0.1:8222\"}}" }, framework: "PHP web application", executable: "composer", port: 8222 },
    {
      files: { [process.platform === "win32" ? "mvnw.cmd" : "mvnw"]: "", "pom.xml": "<project />" },
      framework: "Spring Boot",
      executable: path.join("ROOT", process.platform === "win32" ? "mvnw.cmd" : "mvnw"),
      port: 8080,
      projectExecutable: true,
    },
  ];
  for (const entry of cases) {
    const root = await mkdtemp(path.join(tmpdir(), "realdone-project-runtime-"));
    try {
      for (const [relative, contents] of Object.entries(entry.files)) {
        await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
        await writeFile(path.join(root, relative), contents);
      }
      const profile = await discoverProject(root);
      assert.equal(profile.framework, entry.framework);
      assert.equal(
        profile.commands.development?.executable,
        "projectExecutable" in entry ? entry.executable.replace("ROOT", root) : entry.executable,
      );
      assert.equal(profile.port, entry.port);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("Python runtime discovery prefers a project-local virtual environment", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "realdone-project-python-venv-"));
  const interpreter = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  try {
    await mkdir(path.dirname(interpreter), { recursive: true });
    await writeFile(interpreter, "");
    await writeFile(path.join(root, "manage.py"), "");
    const profile = await discoverProject(root);
    assert.equal(profile.framework, "Django");
    assert.equal(profile.commands.development?.executable, interpreter);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
