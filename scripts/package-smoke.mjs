import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tarballArgument = process.argv[2];
if (!tarballArgument) {
  throw new Error("Usage: pnpm smoke:package <realdone-*.tgz>");
}

const tarball = path.resolve(tarballArgument);
await access(tarball);
const directory = await mkdtemp(path.join(tmpdir(), "realdone-package-smoke-"));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: directory,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== 0 || signal) {
        reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? code})\n${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

try {
  const npmCommand = process.platform === "win32" ? process.execPath : "npm";
  const npmArguments = process.platform === "win32"
    ? [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")]
    : [];
  await run(npmCommand, [...npmArguments, "install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"]);

  const packageRoot = path.join(directory, "node_modules", "realdone");
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const sourcePackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.version, sourcePackage.version);

  for (const relative of [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/cli.js",
    "docs/README.md",
    "docs/ADVANCED.md",
    "docs/AGENT_VERIFICATION.md",
    "docs/ARCHITECTURE.md",
    "docs/CI.md",
    "docs/COMPATIBILITY.md",
    "docs/CONTRACTS.md",
    "docs/DATABASE_ADAPTERS.md",
    "docs/PERFORMANCE.md",
    "docs/PLUGIN_SDK.md",
    "docs/POSTGRESQL.md",
    "docs/PROVIDERS.md",
    "docs/PRODUCT_SPECIFICATION.md",
    "docs/PRODUCT_STATUS.md",
    "docs/ROADMAP.md",
    "docs/REAL_WORLD_VALIDATION.md",
    "docs/THREAT_MODEL.md",
    "docs/VERIFICATION_MATRIX.md",
    "docs/assets/report-preview.png",
    "examples/plugins/prisma-source/index.mjs",
    "examples/plugins/prisma-source/realdone.plugin.json",
    "examples/plugins/storage-fixture/index.mjs",
    "examples/plugins/storage-fixture/realdone.plugin.json",
    "examples/realdone.firebase.json",
    "examples/realdone.mongodb.json",
    "examples/realdone.performance.json",
    "examples/realdone.postgres.json",
    "examples/realdone.providers.json",
    "examples/realdone.supabase.json",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    await access(path.join(packageRoot, relative));
  }

  await run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import { runScan, recordFlow, verifyContract, definePlugin, inspectEnvironment, discoverProject, RuntimeManager, SqliteSourceAdapter, SupabaseSourceAdapter, FirebaseSourceAdapter, MongoSourceAdapter, BuiltinProviderHost, PluginHost } from 'realdone'; if (![runScan, recordFlow, verifyContract, definePlugin, inspectEnvironment, discoverProject, RuntimeManager, SqliteSourceAdapter, SupabaseSourceAdapter, FirebaseSourceAdapter, MongoSourceAdapter, BuiltinProviderHost, PluginHost].every(value => typeof value === 'function')) throw new Error('Public SDK export missing');",
  ]);

  const cli = await run(process.execPath, [path.join(packageRoot, "dist", "cli.js"), "--version"]);
  assert.equal(cli.stdout.trim(), packageJson.version);
  console.log(`Package smoke passed: realdone@${packageJson.version}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
