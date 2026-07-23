import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const tarballArgument = process.argv[2];
if (!tarballArgument) {
  throw new Error("Usage: pnpm smoke:package <realdone-*.tgz>");
}

const tarball = path.resolve(tarballArgument);
await access(tarball);
const directory = await mkdtemp(path.join(tmpdir(), "realdone-package-smoke-"));
let preferredPortBlocker;

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

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a package-smoke port.");
  await new Promise((resolve) => server.close(() => resolve()));
  return address.port;
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
    "docs/MCP.md",
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
    "schemas/artifacts-v1.json",
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
    "import { runScan, runManagedScan, recordFlow, verifyContract, definePlugin, inspectEnvironment, discoverProject, RuntimeManager, SqliteSourceAdapter, SupabaseSourceAdapter, FirebaseSourceAdapter, MongoSourceAdapter, BuiltinProviderHost, PluginHost, createRealDoneMcpServer, scanArtifactSecrets, checkArtifactSchemaCompatibility, evaluateReleaseGates, mergeReleaseGateEvidence } from 'realdone'; if (![runScan, runManagedScan, recordFlow, verifyContract, definePlugin, inspectEnvironment, discoverProject, RuntimeManager, SqliteSourceAdapter, SupabaseSourceAdapter, FirebaseSourceAdapter, MongoSourceAdapter, BuiltinProviderHost, PluginHost, createRealDoneMcpServer, scanArtifactSecrets, checkArtifactSchemaCompatibility, evaluateReleaseGates, mergeReleaseGateEvidence].every(value => typeof value === 'function')) throw new Error('Public SDK export missing');",
  ]);

  const cli = await run(process.execPath, [path.join(packageRoot, "dist", "cli.js"), "--version"]);
  assert.equal(cli.stdout.trim(), packageJson.version);
  const npmCli = await run(npmCommand, [
    ...npmArguments,
    "exec",
    "--offline",
    "--",
    "realdone",
    "--version",
  ]);
  assert.equal(npmCli.stdout.trim(), packageJson.version, "the installed npm bin must execute through npm exec/npx");

  const staticProject = path.join(directory, "static-project");
  await mkdir(staticProject);
  await writeFile(path.join(staticProject, "index.html"), "<!doctype html><html><head><title>Package smoke</title></head><body><button type=\"button\" onclick=\"document.querySelector('p').textContent='Opened'\">Open panel</button><p>Closed</p></body></html>");
  preferredPortBlocker = createServer((socket) => socket.end());
  await new Promise((resolve, reject) => {
    preferredPortBlocker.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        preferredPortBlocker = undefined;
        resolve();
      } else reject(error);
    });
    preferredPortBlocker.listen(4173, "127.0.0.1", resolve);
  });
  const firstScan = await run(process.execPath, [
    path.join(packageRoot, "dist", "cli.js"),
    "scan",
    "--yes",
    "--max-pages", "1",
    "--max-actions", "1",
    "--max-duration", "60000",
  ], { cwd: staticProject });
  assert.match(firstScan.stdout, /Pages discovered:\s+1/);
  assert.match(firstScan.stdout, /Actions verified:\s+1/);
  const reportRoot = path.join(staticProject, ".realdone", "reports");
  const reports = (await readdir(reportRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  assert.equal(reports.length, 1, "installed-package first scan must write exactly one report");
  const summary = JSON.parse(await readFile(path.join(reportRoot, reports[0].name, "summary.json"), "utf8"));
  const scan = JSON.parse(await readFile(path.join(reportRoot, reports[0].name, "scan.json"), "utf8"));
  assert.equal(summary.environmentStatus, "VALID");
  assert.equal(summary.actionsVerified, 1);
  assert.notEqual(new URL(scan.targetUrl).port, "4173", "static discovery must avoid an occupied preferred port");
  await assert.rejects(fetch(scan.targetUrl, { signal: AbortSignal.timeout(500) }), undefined, "managed static runtime must stop after scan");

  const nodeProject = path.join(directory, "node-project");
  const nodePort = await availablePort();
  await mkdir(nodeProject);
  await writeFile(path.join(nodeProject, "package.json"), JSON.stringify({
    private: true,
    scripts: { dev: `node server.mjs --port ${nodePort}` },
  }, null, 2));
  await writeFile(path.join(nodeProject, "server.mjs"), `import { createServer } from "node:http";
const index = process.argv.indexOf("--port");
const port = Number(process.argv[index + 1]);
createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end('<!doctype html><button type="button" onclick="document.querySelector(\\'p\\').textContent=\\'Started\\'">Start feature</button><p>Idle</p>');
}).listen(port, "127.0.0.1");
`);
  const nodeScan = await run(process.execPath, [
    path.join(packageRoot, "dist", "cli.js"),
    "scan",
    "--yes",
    "--max-pages", "1",
    "--max-actions", "1",
    "--max-duration", "60000",
  ], { cwd: nodeProject });
  assert.match(nodeScan.stdout, /Pages discovered:\s+1/);
  assert.match(nodeScan.stdout, /Actions verified:\s+1/);
  const nodeReportsRoot = path.join(nodeProject, ".realdone", "reports");
  const nodeReports = (await readdir(nodeReportsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  assert.equal(nodeReports.length, 1, "metadata-free npm project must write exactly one report");
  const nodeSummary = JSON.parse(await readFile(path.join(nodeReportsRoot, nodeReports[0].name, "summary.json"), "utf8"));
  assert.equal(nodeSummary.environmentStatus, "VALID");
  assert.equal(nodeSummary.actionsVerified, 1);
  await assert.rejects(fetch(`http://127.0.0.1:${nodePort}`, { signal: AbortSignal.timeout(500) }), undefined, "managed npm runtime must stop after scan");

  const mcpClient = new Client({ name: "realdone-package-smoke", version: "1.0.0" });
  const mcpTransport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageRoot, "dist", "cli.js"), "mcp", "--project", directory],
    cwd: directory,
    stderr: "pipe",
  });
  await mcpClient.connect(mcpTransport);
  const mcpTools = await mcpClient.listTools();
  assert.deepEqual(mcpTools.tools.map((tool) => tool.name).sort(), ["baseline", "get_report", "record", "replay", "scan", "verify", "verify_change"]);
  await mcpClient.close();
  console.log(`Package smoke passed: realdone@${packageJson.version}`);
} finally {
  if (preferredPortBlocker?.listening) {
    await new Promise((resolve) => preferredPortBlocker.close(() => resolve()));
  }
  await rm(directory, { recursive: true, force: true });
}
