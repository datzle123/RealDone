import assert from "node:assert/strict";
import test from "node:test";
import type { Browser } from "playwright";
import { launchBrowser } from "../src/browser/runtime.js";

const browser = {} as Browser;

test("installs a missing Playwright browser once and retries launch", async () => {
  let launches = 0;
  let installs = 0;
  const result = await launchBrowser({ headed: false, browserName: "chromium" }, {
    launch: async () => {
      launches += 1;
      if (launches === 1) throw new Error("Executable doesn't exist at /missing/chromium");
      return browser;
    },
    install: async (name) => {
      installs += 1;
      assert.equal(name, "chromium");
    },
  });

  assert.equal(result, browser);
  assert.equal(launches, 2);
  assert.equal(installs, 1);
});

test("browser bootstrap remains opt-out and never replaces an explicit executable", async () => {
  let installs = 0;
  const dependencies = {
    launch: async () => { throw new Error("Executable doesn't exist at /missing/chromium"); },
    install: async () => { installs += 1; },
  };
  await assert.rejects(() => launchBrowser({ headed: false, autoInstall: false }, dependencies), /could not start/);
  await assert.rejects(() => launchBrowser({ headed: false, executablePath: "/explicit/chrome" }, dependencies), /could not start/);
  assert.equal(installs, 0);
});

test("does not install for unrelated browser startup failures", async () => {
  let installs = 0;
  await assert.rejects(() => launchBrowser({ headed: false }, {
    launch: async () => { throw new Error("Browser crashed during startup"); },
    install: async () => { installs += 1; },
  }), /Browser crashed during startup/);
  assert.equal(installs, 0);
});
