import { pathToFileURL } from "node:url";

async function loadBridge() {
  const bridgeFile = process.env.REALDONE_PRISMA_BRIDGE_MODULE;
  if (!bridgeFile) throw new Error("Set REALDONE_PRISMA_BRIDGE_MODULE to a reviewed project-owned bridge module.");
  return import(pathToFileURL(bridgeFile).href);
}

export default {
  apiVersion: "1.0",
  name: "prisma-source",
  async verifySource(expectation) {
    const bridge = await loadBridge();
    const matchedRows = await bridge.count(expectation.resource, expectation.filters);
    return {
      matchedRows,
      matchedFields: expectation.filters.map((filter) => filter.field),
      detail: "Project-owned Prisma Client bridge completed a count query."
    };
  },
  async discoverSource(input) {
    const bridge = await loadBridge();
    return bridge.discover(input.resource);
  },
  async snapshotSource(input) {
    const bridge = await loadBridge();
    return bridge.snapshot(input.resource, input.limit);
  },
  async cleanupSource(target) {
    const bridge = await loadBridge();
    const deletedRows = await bridge.cleanup(target.resource, target.filters);
    return { deletedRows, detail: "Project-owned Prisma Client bridge completed primary-key cleanup." };
  }
};
