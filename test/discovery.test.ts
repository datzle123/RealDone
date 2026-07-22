import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCrawlUrl } from "../src/browser/discover.js";

test("preserves hash-router paths while dropping ordinary document fragments", () => {
  assert.equal(normalizeCrawlUrl("http://localhost:3000/#/login"), "http://localhost:3000/#/login");
  assert.equal(normalizeCrawlUrl("http://localhost:3000/#!/settings"), "http://localhost:3000/#!/settings");
  assert.equal(normalizeCrawlUrl("http://localhost:3000/#/"), "http://localhost:3000/");
  assert.equal(normalizeCrawlUrl("http://localhost:3000/docs#install"), "http://localhost:3000/docs");
});
