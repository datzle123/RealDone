import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("GitHub Action forwards every source and provider adapter input", async () => {
  const action = await readFile(new URL("../action.yml", import.meta.url), "utf8");
  for (const input of ["postgres-config", "sqlite", "database-configs", "provider-configs", "plugins"]) {
    assert.match(action, new RegExp(`^  ${input}:`, "m"), `action input is missing ${input}`);
  }
  for (const environment of ["RD_POSTGRES_CONFIG", "RD_SQLITE", "RD_DATABASE_CONFIGS", "RD_PROVIDER_CONFIGS", "RD_PLUGINS"]) {
    assert.ok(action.includes(environment), `action environment forwarding is missing ${environment}`);
  }
  for (const option of ["--postgres-config", "--sqlite", "--database-config", "--provider-config", "--plugin"]) {
    assert.ok(action.includes(option), `action command forwarding is missing ${option}`);
  }
});
