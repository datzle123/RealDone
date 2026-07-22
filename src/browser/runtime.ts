import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit, type Browser, type BrowserType } from "playwright";

export type BrowserName = "chromium" | "firefox" | "webkit";

export interface BrowserRuntimeOptions {
  headed: boolean;
  executablePath?: string;
  browserName?: BrowserName;
  autoInstall?: boolean;
}

export interface BrowserRuntimeDependencies {
  launch?: (name: BrowserName, options: { headless: boolean; executablePath?: string }) => Promise<Browser>;
  install?: (name: BrowserName) => Promise<void>;
}

const installs = new Map<BrowserName, Promise<void>>();

function browserType(name: BrowserName): BrowserType {
  switch (name) {
    case "chromium": return chromium;
    case "firefox": return firefox;
    case "webkit": return webkit;
  }
}

function missingBrowserExecutable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Executable doesn't exist|browser.*not found|playwright install/i.test(message);
}

async function installPlaywrightBrowser(name: BrowserName): Promise<void> {
  const existing = installs.get(name);
  if (existing) return existing;
  const operation = new Promise<void>((resolve, reject) => {
    const playwrightEntry = fileURLToPath(import.meta.resolve("playwright"));
    const cli = path.join(path.dirname(playwrightEntry), "cli.js");
    const child = spawn(process.execPath, [cli, "install", name], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout?.pipe(process.stderr);
    child.stderr?.pipe(process.stderr);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out installing ${name} after 10 minutes.`));
    }, 10 * 60_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Playwright browser installation exited with ${code ?? signal ?? "an unknown error"}.`));
    });
  }).finally(() => installs.delete(name));
  installs.set(name, operation);
  return operation;
}

function startupError(name: BrowserName, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    `${name} could not start. Run "npx playwright install ${name}"${name === "chromium" ? " or pass --browser-path" : ""}.\n${message}`,
  );
}

export async function launchBrowser(
  options: BrowserRuntimeOptions,
  dependencies: BrowserRuntimeDependencies = {},
): Promise<Browser> {
  const name = options.browserName ?? "chromium";
  if (options.executablePath && name !== "chromium") {
    throw new Error("--browser-path can only be used with Chromium.");
  }
  const launch = dependencies.launch ?? ((browserName, launchOptions) => browserType(browserName).launch(launchOptions));
  const launchOptions = {
    headless: !options.headed,
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  };
  try {
    return await launch(name, launchOptions);
  } catch (error) {
    const autoInstall = options.autoInstall ?? process.env.REALDONE_SKIP_BROWSER_INSTALL !== "1";
    if (!options.executablePath && autoInstall && missingBrowserExecutable(error)) {
      process.stderr.write(`realdone browser  Installing Playwright ${name} for first use (one time)\n`);
      try {
        await (dependencies.install ?? installPlaywrightBrowser)(name);
        return await launch(name, launchOptions);
      } catch (installError) {
        throw startupError(name, installError);
      }
    }
    throw startupError(name, error);
  }
}

export async function launchChromium(options: BrowserRuntimeOptions): Promise<Browser> {
  return launchBrowser({ ...options, browserName: "chromium" });
}
