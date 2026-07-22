import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  throw new Error("Usage: pnpm capture-report <report.html> <preview.png>");
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.REALDONE_BROWSER_PATH ? { executablePath: process.env.REALDONE_BROWSER_PATH } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.resolve(source)).href, { waitUntil: "load" });
  await page.screenshot({ path: path.resolve(destination), fullPage: false });
} finally {
  await browser.close();
}
