import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const testDirectory = new URL("../test/", import.meta.url);
const files = (await readdir(testDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
  .map((entry) => fileURLToPath(new URL(entry.name, testDirectory)))
  .sort();

if (files.length === 0) throw new Error("No RealDone test files were found.");

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files], {
    shell: false,
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) {
      reject(new Error(`Test runner exited after signal ${signal}.`));
      return;
    }
    resolve(code ?? 1);
  });
});

process.exitCode = exitCode;
