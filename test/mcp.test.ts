import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRealDoneMcpServer } from "../src/mcp/server.js";
import type { ManagedScanRequest } from "../src/application/managed-scan.js";
import type { ReplayOptions, ReplayResult } from "../src/replay.js";

test("MCP exposes the shared RealDone core and keeps AI scans fail-closed", async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "realdone-mcp-"));
  context.after(async () => rm(projectRoot, { recursive: true, force: true }));
  const reportDirectory = path.join(projectRoot, ".realdone", "reports", "20260722T000000Z-test");
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(path.join(reportDirectory, "summary.json"), JSON.stringify({ pagesDiscovered: 1, verdicts: { VERIFIED: 1 } }));
  await writeFile(path.join(reportDirectory, "findings.json"), JSON.stringify([{
    id: "RD-001",
    verdict: "VERIFIED",
    reason: "Observed behavior persisted.",
    action: { label: "Save" },
    detectorMatches: [],
    evidence: { canary: "must-not-be-returned" },
  }]));
  await writeFile(path.join(projectRoot, "providers.json"), JSON.stringify({
    schemaVersion: "1.0",
    providers: { "stripe-test": { adapter: "stripe", secretEnv: "RD_MCP_STRIPE_KEY" } },
    automaticChecks: [{
      provider: "stripe-test",
      kind: "payment",
      operation: "succeeded",
      resource: "payment-intent",
      match: { actionKind: "external" },
      reference: { from: "response-resource-id" },
    }],
  }));
  let observedRequest: ManagedScanRequest | undefined;
  let observedReplayOptions: ReplayOptions | undefined;
  const server = createRealDoneMcpServer({
    projectRoot,
    allowProjectActions: true,
    dependencies: {
      runManagedScan: async (request) => {
        observedRequest = request;
        return {
          reportDirectory,
          exitCode: 0,
          report: {
            schemaVersion: "1.0",
            scanId: "test",
            targetUrl: "http://127.0.0.1:3000",
            startedAt: "2026-07-22T00:00:00.000Z",
            finishedAt: "2026-07-22T00:00:01.000Z",
            options: request.scanOptions,
            summary: {
              pagesDiscovered: 1,
              visibleActions: 1,
              actionsVerified: 1,
              actionsSkipped: 0,
              verdicts: { VERIFIED: 1, CONTRADICTORY: 0, EPHEMERAL: 0, BROWSER_LOCAL: 0, BROKEN: 0, NO_EFFECT: 0, UNCERTAIN: 0, SKIPPED: 0 },
              environmentStatus: "VALID",
            },
            pages: [],
            findings: [],
          },
        };
      },
      runReplay: async (findingId, replayOptions) => {
        observedReplayOptions = replayOptions;
        return {
          reportDirectory,
          exitCode: 0,
          replay: {
            schemaVersion: "1.0",
            findingId,
            sourceScanId: "source-test",
            replayScanId: "replay-test",
            outcome: "FINDING_REPRODUCED",
            sourceVerdict: "VERIFIED",
            replayVerdict: "VERIFIED",
            sourceDetectorCodes: [],
            replayDetectorCodes: [],
            providerConfirmationRequired: true,
            providerConfirmationSatisfied: true,
            detail: "Provider-backed finding reproduced.",
          },
        } as unknown as ReplayResult;
      },
    },
  });
  const client = new Client({ name: "realdone-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  context.after(async () => {
    await client.close();
    await server.close();
  });

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ["baseline", "get_report", "record", "replay", "scan", "verify", "verify_change"],
  );

  const scan = await client.callTool({ name: "scan", arguments: { maxPages: 2, maxActions: 3 } });
  assert.equal(scan.isError, undefined);
  assert.equal((scan.structuredContent as Record<string, unknown>).passed, true);
  assert.ok(observedRequest);
  assert.equal(observedRequest.projectDirectory, projectRoot);
  assert.equal(observedRequest.manageRuntime, true);
  assert.equal(observedRequest.scanOptions.allowDestructive, false);
  assert.equal(observedRequest.scanOptions.allowExternal, false);
  assert.equal(observedRequest.scanOptions.maxPages, 2);
  assert.equal(observedRequest.scanOptions.maxActions, 3);
  assert.deepEqual(observedRequest.scanOptions.sourceAdapters, []);

  await client.callTool({ name: "scan", arguments: { url: "http://127.0.0.1:3000", maxPages: 1, maxActions: 1, sqlite: "app.db", providerConfigs: ["providers.json"], sourceSnapshotLimit: 5 } });
  assert.equal(observedRequest.manageRuntime, false);
  assert.equal((observedRequest.scanOptions.sourceAdapters as Array<{ kind: string }>)[0]?.kind, "sqlite");
  assert.equal(observedRequest.scanOptions.sourceSnapshotLimit, 5);
  assert.ok(observedRequest.scanOptions.providerVerifier);

  const replay = await client.callTool({
    name: "replay",
    arguments: { findingId: "RD-001", reportDirectory: ".realdone/reports/20260722T000000Z-test", providerConfigs: ["providers.json"] },
  });
  assert.equal(replay.isError, undefined);
  assert.deepEqual(observedReplayOptions?.providerConfigPaths, [path.join(projectRoot, "providers.json")]);
  assert.equal((replay.structuredContent as Record<string, unknown>).providerConfirmationSatisfied, true);

  const replayTraversal = await client.callTool({ name: "replay", arguments: { findingId: "RD-001", providerConfigs: ["../outside.json"] } });
  assert.equal(replayTraversal.isError, true);
  assert.match((replayTraversal.content as Array<{ type: string; text: string }>)[0]?.text ?? "", /outside the MCP project root/i);

  const report = await client.callTool({ name: "get_report", arguments: {} });
  assert.equal(report.isError, undefined);
  const reportText = JSON.stringify(report.structuredContent);
  assert.match(reportText, /Observed behavior persisted/);
  assert.doesNotMatch(reportText, /must-not-be-returned/);

  const traversal = await client.callTool({ name: "get_report", arguments: { reportDirectory: "../outside" } });
  assert.equal(traversal.isError, true);
  const traversalContent = traversal.content as Array<{ type: string; text: string }>;
  assert.match(traversalContent[0]?.text ?? "", /outside the MCP project root/i);
});

test("MCP browser actions require user authorization at server startup", async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "realdone-mcp-consent-"));
  context.after(async () => rm(projectRoot, { recursive: true, force: true }));
  let invoked = false;
  const server = createRealDoneMcpServer({
    projectRoot,
    dependencies: {
      runManagedScan: async () => {
        invoked = true;
        throw new Error("must not run");
      },
    },
  });
  const client = new Client({ name: "realdone-consent-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  context.after(async () => {
    await client.close();
    await server.close();
  });

  const result = await client.callTool({ name: "scan", arguments: { maxPages: 1, maxActions: 1 } });
  assert.equal(result.isError, true);
  assert.match((result.content as Array<{ type: string; text: string }>)[0]?.text ?? "", /--allow-project-actions/);
  assert.equal(invoked, false);
});
