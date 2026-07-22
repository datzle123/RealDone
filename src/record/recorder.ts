import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type { BrowserContext, Page, Request } from "playwright";
import { launchChromium } from "../browser/runtime.js";
import { safeUrl } from "../core/redact.js";
import { writeBehaviorContract, type BehaviorContract, type BehaviorStep } from "../contracts/schema.js";
import type { SemanticFingerprint } from "../types.js";

interface RawInteraction {
  type: "click" | "fill" | "check" | "select";
  pageUrl: string;
  atMs: number;
  fingerprint: SemanticFingerprint;
  value?: string;
  secretEnv?: string;
  checked?: boolean;
}

export interface RecordOptions {
  targetUrl: string;
  name: string;
  outputFile: string;
  headed: boolean;
  timeoutMs: number;
  settleMs: number;
  executablePath?: string;
  storageStatePath?: string;
  saveStorageStatePath?: string;
  stopSignal?: Promise<void>;
}

export interface RecordResult {
  contract: BehaviorContract;
  contractFile: string;
  rrwebFile: string;
}

const require = createRequire(import.meta.url);

function rrwebBundlePath(): string {
  return path.join(path.dirname(require.resolve("rrweb")), "rrweb.umd.cjs");
}

function contractId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "flow";
  return `${slug}-${randomBytes(2).toString("hex")}`;
}

function requestPattern(input: string): string {
  try {
    const url = new URL(input);
    const escaped = `${url.pathname}${url.search}`
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\/\d+/g, "\\/[^/]+")
      .replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/gi, "[^/]+");
    return `^${escaped}$`;
  } catch {
    return input;
  }
}

function injectionSource(startedAt: number): string {
  return `(() => {
    const startedAt = ${startedAt};
    const visible = (element) => { const style=getComputedStyle(element); const rect=element.getBoundingClientRect(); return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0; };
    const cssPath = (element) => { if(element.dataset&&element.dataset.testid)return '[data-testid="'+String(element.dataset.testid).replace(/"/g,'\\\\"')+'"]'; if(element.id)return '#'+CSS.escape(element.id); const parts=[]; let current=element; while(current&&current!==document.documentElement){const tag=current.tagName.toLowerCase();const parent=current.parentElement;if(!parent){parts.unshift(tag);break;}const siblings=[...parent.children].filter(child=>child.tagName===current.tagName);parts.unshift(tag+(siblings.length>1?':nth-of-type('+(siblings.indexOf(current)+1)+')':''));current=parent;}return parts.join(' > '); };
    const nameFor = (element) => { const aria=element.getAttribute('aria-label'); if(aria)return aria.trim(); if(element.labels&&element.labels.length)return [...element.labels].map(label=>label.innerText).join(' ').trim(); return (element.innerText||element.getAttribute('title')||element.getAttribute('placeholder')||element.getAttribute('name')||'').replace(/\\s+/g,' ').trim(); };
    const roleFor = (element) => { const explicit=element.getAttribute('role'); if(explicit)return explicit; const tag=element.tagName.toLowerCase(); const type=(element.type||'').toLowerCase(); if(tag==='a')return 'link'; if(tag==='button'||['submit','button'].includes(type))return 'button'; if(type==='checkbox')return 'checkbox'; if(type==='radio')return 'radio'; if(tag==='select')return 'combobox'; if(tag==='textarea'||tag==='input')return 'textbox'; return undefined; };
    const fingerprint = (element) => { const tag=element.tagName.toLowerCase(); const selector=cssPath(element); const accessibleName=nameFor(element); const testId=element.getAttribute('data-testid')||undefined; const id=element.id||undefined; const role=roleFor(element); const href=element.href||undefined; const text=(element.innerText||'').replace(/\\s+/g,' ').trim().slice(0,240)||undefined; const ordinal=[...document.querySelectorAll(tag)].indexOf(element); const candidates=[]; if(testId)candidates.push({strategy:'testid',weight:100,value:testId,exact:true}); if(role&&accessibleName){candidates.push({strategy:'role',weight:92,role,name:accessibleName,exact:true});candidates.push({strategy:'role',weight:82,role,name:accessibleName,exact:false});} if(id)candidates.push({strategy:'id',weight:80,selector}); if(href)candidates.push({strategy:'href',weight:72,value:href}); if(text)candidates.push({strategy:'text',weight:60,value:text,exact:true}); candidates.push({strategy:'css',weight:35,selector}); return {selector,tag,ordinal,candidates,...(role?{role}:{}),...(accessibleName?{accessibleName}:{}),...(text?{text}:{}),...(testId?{testId}:{}),...(id?{id}:{}),...(href?{href}:{}),...(element.type?{type:element.type}:{})}; };
    const emit = (payload) => window.__realdoneInteraction(payload);
    const rrwebQueue=[];
    const flushRrweb=()=>{if(!rrwebQueue.length)return;const batch=rrwebQueue.splice(0,rrwebQueue.length);void window.__realdoneRrwebBatch(batch);};
    window.__realdoneFlushRrweb=flushRrweb;
    window.__realdoneStartRrweb=()=>{if(window.__realdoneRrwebStarted||!window.rrweb||!window.rrweb.record)return false;window.__realdoneRrwebStarted=true;window.rrweb.record({emit:event=>rrwebQueue.push(event),maskAllInputs:true,blockSelector:'[data-realdone-block]'});setInterval(flushRrweb,1000);window.addEventListener('beforeunload',flushRrweb);return true;};
    document.addEventListener('click',event=>{const element=event.target&&event.target.closest?event.target.closest('a,button,input[type=submit],input[type=button],[role=button]'):null;if(!element||!visible(element))return;emit({type:'click',pageUrl:location.href,atMs:Date.now()-startedAt,fingerprint:fingerprint(element)});},true);
    document.addEventListener('change',event=>{const element=event.target;if(!(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement||element instanceof HTMLSelectElement)||!visible(element)||element.type==='file')return;const hint=(element.name||nameFor(element)||'SECRET').trim();const sensitive=element.type==='password'||/password|passwd|secret|token|api.?key/i.test(hint);const secretEnv=sensitive?'REALDONE_'+(hint||'SECRET').toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_|_$/g,''):undefined;const type=element instanceof HTMLSelectElement?'select':(['checkbox','radio'].includes(element.type)?'check':'fill');emit({type,pageUrl:location.href,atMs:Date.now()-startedAt,fingerprint:fingerprint(element),...(type==='check'?{checked:element.checked}:{value:sensitive?'[REDACTED]':element.value}),...(secretEnv?{secretEnv}:{})});},true);
  })();`;
}

function stepId(index: number): string {
  return `S${String(index + 1).padStart(3, "0")}`;
}

function relativeArtifact(contractFile: string, artifactFile: string): string {
  return path.relative(path.dirname(contractFile), artifactFile).split(path.sep).join("/");
}

export async function recordFlow(
  options: RecordOptions,
  drive?: (page: Page) => Promise<void>,
): Promise<RecordResult> {
  const debug = (message: string): void => {
    if (process.env.REALDONE_DEBUG) process.stderr.write(`realdone recorder  ${message}\n`);
  };
  const contractFile = path.resolve(options.outputFile);
  const rrwebFile = contractFile.replace(/\.json$/i, ".rrweb.json");
  await mkdir(path.dirname(contractFile), { recursive: true });
  if (options.saveStorageStatePath) await mkdir(path.dirname(path.resolve(options.saveStorageStatePath)), { recursive: true });
  const startedAt = Date.now();
  const steps: BehaviorStep[] = [];
  const rrwebEvents: unknown[] = [];
  const pendingOutcomes: Promise<void>[] = [];
  const currentStep = new WeakMap<Page, BehaviorStep>();
  const requestSteps = new WeakMap<Request, BehaviorStep>();
  const rrwebInstalls: Promise<void>[] = [];
  const browser = await launchChromium({
    headed: options.headed,
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  });
  debug("Chromium started");
  const context = await browser.newContext(
    options.storageStatePath ? { storageState: options.storageStatePath } : {},
  );
  debug("Browser context created");

  const appendStep = (step: Omit<BehaviorStep, "id">): BehaviorStep => {
    const previous = steps.at(-1);
    if (
      step.type === "fill" &&
      previous?.type === "fill" &&
      previous.fingerprint?.selector === step.fingerprint?.selector
    ) {
      if (step.value !== undefined) previous.value = step.value;
      else delete previous.value;
      if (step.secretEnv !== undefined) previous.secretEnv = step.secretEnv;
      else delete previous.secretEnv;
      previous.atMs = step.atMs;
      return previous;
    }
    const created: BehaviorStep = { id: stepId(steps.length), ...step };
    steps.push(created);
    return created;
  };

  await context.exposeBinding("__realdoneRrwebBatch", (_source, events: unknown[]) => {
    rrwebEvents.push(...events);
  });
  await context.exposeBinding("__realdoneInteraction", (source, raw: RawInteraction) => {
    const step = appendStep({
      type: raw.type,
      pageUrl: safeUrl(raw.pageUrl),
      atMs: raw.atMs,
      fingerprint: raw.fingerprint,
      expected: [],
      ...(raw.value !== undefined ? { value: raw.value } : {}),
      ...(raw.secretEnv ? { secretEnv: raw.secretEnv } : {}),
      ...(raw.checked !== undefined ? { checked: raw.checked } : {}),
    });
    currentStep.set(source.page, step);
    if (raw.type === "click") {
      const outcome = (async () => {
        await source.page.waitForTimeout(Math.max(options.settleMs, 300)).catch(() => undefined);
        const claim = await source.page
          .locator('[role="status"], [role="alert"], .toast, .notification, .alert')
          .filter({ visible: true })
          .last()
          .innerText({ timeout: Math.max(options.settleMs, 1_000) })
          .catch(() => "");
        const value = claim.replace(/\s+/g, " ").trim();
        if (value && !step.expected.some((item) => item.type === "text" && item.value === value)) {
          step.expected.push({ type: "text", value: value.slice(0, 500) });
        }
      })();
      pendingOutcomes.push(outcome);
    }
  });

  const installRrweb = async (page: Page): Promise<void> => {
    const alreadyStarted = await page
      .evaluate(() => Boolean((window as Window & { __realdoneRrwebStarted?: boolean }).__realdoneRrwebStarted))
      .catch(() => true);
    if (alreadyStarted) return;
    await page.addScriptTag({ path: rrwebBundlePath() });
    await page.evaluate(() => {
      const target = window as Window & { __realdoneStartRrweb?: () => boolean };
      target.__realdoneStartRrweb?.();
    });
  };

  let initialRecorderReady = false;

  const attachPage = (page: Page): void => {
    page.on("request", (request) => {
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) return;
      const step = currentStep.get(page);
      if (step) requestSteps.set(request, step);
    });
    page.on("response", (response) => {
      const step = requestSteps.get(response.request());
      if (!step) return;
      const expectation = {
        type: "request" as const,
        method: response.request().method(),
        urlPattern: requestPattern(response.url()),
        status: response.status(),
      };
      if (!step.expected.some((item) => item.type === "request" && item.method === expectation.method && item.urlPattern === expectation.urlPattern)) {
        step.expected.push(expectation);
      }
    });
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame() || frame.url() === "about:blank") return;
      const url = safeUrl(frame.url());
      const last = steps.at(-1);
      if (last?.type === "navigate" && last.url === url) return;
      appendStep({ type: "navigate", pageUrl: url, url, atMs: Date.now() - startedAt, expected: [] });
      const triggering = currentStep.get(page);
      if (triggering && triggering.type === "click") {
        const pattern = `^${new URL(url).pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
        if (!triggering.expected.some((item) => item.type === "url" && item.pattern === pattern)) {
          triggering.expected.push({ type: "url", pattern });
        }
      }
      if (initialRecorderReady) {
        const install = page
          .waitForLoadState("domcontentloaded", { timeout: options.timeoutMs })
          .then(() => installRrweb(page))
          .catch(() => undefined);
        rrwebInstalls.push(install);
      }
    });
  };

  context.on("page", attachPage);
  await context.addInitScript({ content: injectionSource(startedAt) });
  debug("Recorder init script installed");
  const page = await context.newPage();
  debug("Page created");
  try {
    await page.goto(options.targetUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    await installRrweb(page);
    initialRecorderReady = true;
    debug("Target loaded");
    if (drive) await drive(page);
    else if (options.stopSignal) await options.stopSignal;
    else await page.waitForTimeout(30_000);
    debug("Recording stop condition reached");
    await page.waitForTimeout(options.settleMs);
    await Promise.allSettled(rrwebInstalls);
    await Promise.allSettled(
      context.pages().map((openPage) =>
        openPage.evaluate(() => {
          const target = window as Window & { __realdoneFlushRrweb?: () => void };
          target.__realdoneFlushRrweb?.();
        }),
      ),
    );
    await page.waitForTimeout(100);
    await Promise.allSettled(pendingOutcomes);
    debug(`Evidence drained (${rrwebEvents.length} rrweb events, ${steps.length} steps)`);
    if (options.saveStorageStatePath) {
      await context.storageState({ path: path.resolve(options.saveStorageStatePath) });
    }
    await writeFile(rrwebFile, `${JSON.stringify({ schemaVersion: "1.0", events: rrwebEvents })}\n`);
    const contract: BehaviorContract = {
      schemaVersion: "1.0",
      id: contractId(options.name),
      name: options.name,
      baseUrl: new URL(options.targetUrl).origin,
      createdAt: new Date(startedAt).toISOString(),
      tags: [],
      steps,
      ...(options.saveStorageStatePath
        ? { authState: { path: relativeArtifact(contractFile, path.resolve(options.saveStorageStatePath)) } }
        : {}),
      artifacts: { rrweb: relativeArtifact(contractFile, rrwebFile), rrwebEventCount: rrwebEvents.length },
      cleanup: [{ type: "ledger", value: "scan cleanup-ledger.json" }],
      source: { browser: await browser.version(), recordedBy: "realdone" },
    };
    await writeBehaviorContract(contractFile, contract);
    debug("Contract written");
    return { contract, contractFile, rrwebFile };
  } finally {
    await context.close();
    await browser.close();
  }
}
