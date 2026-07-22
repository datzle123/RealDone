import { chromium, type Browser } from "playwright";

export interface BrowserRuntimeOptions {
  headed: boolean;
  executablePath?: string;
}

export async function launchChromium(options: BrowserRuntimeOptions): Promise<Browser> {
  try {
    return await chromium.launch({
      headless: !options.headed,
      ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Chromium could not start. Run \"pnpm exec playwright install chromium\" or pass --browser-path.\n${message}`,
    );
  }
}
