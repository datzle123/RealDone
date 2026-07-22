import { chromium, firefox, webkit, type Browser, type BrowserType } from "playwright";

export type BrowserName = "chromium" | "firefox" | "webkit";

export interface BrowserRuntimeOptions {
  headed: boolean;
  executablePath?: string;
  browserName?: BrowserName;
}

function browserType(name: BrowserName): BrowserType {
  switch (name) {
    case "chromium": return chromium;
    case "firefox": return firefox;
    case "webkit": return webkit;
  }
}

export async function launchBrowser(options: BrowserRuntimeOptions): Promise<Browser> {
  const name = options.browserName ?? "chromium";
  if (options.executablePath && name !== "chromium") {
    throw new Error("--browser-path can only be used with Chromium.");
  }
  try {
    return await browserType(name).launch({
      headless: !options.headed,
      ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${name} could not start. Run "pnpm exec playwright install ${name}"${name === "chromium" ? " or pass --browser-path" : ""}.\n${message}`,
    );
  }
}

export async function launchChromium(options: BrowserRuntimeOptions): Promise<Browser> {
  return launchBrowser({ ...options, browserName: "chromium" });
}
