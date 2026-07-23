import { createHash } from "node:crypto";
import path from "node:path";
import type { Download, Frame, Page, Request, Response, WebSocket } from "playwright";
import { hashText, redactText, safeUrl } from "../core/redact.js";
import type {
  ConsoleEvidence,
  DownloadEvidence,
  FilledField,
  NetworkEvidence,
  StateSnapshot,
  StorageEntryDigest,
  UiClaim,
  WebSocketEvidence,
} from "../types.js";

export interface EvidenceSink {
  network: NetworkEvidence[];
  console: ConsoleEvidence[];
  pageErrors: string[];
  dialogs: string[];
  downloads: string[];
  downloadEvidence?: DownloadEvidence[];
  canary?: string;
  filledFields?: FilledField[];
  webSockets?: WebSocketEvidence[];
  popupUrls?: string[];
}

export interface AttachedEvidence {
  detach: () => void;
  flush: () => Promise<void>;
  waitForIdle: (timeoutMs: number) => Promise<boolean>;
}

export function attachEvidence(page: Page, startedAt: number, sink: EvidenceSink): AttachedEvidence {
  const requests = new WeakMap<Request, NetworkEvidence>();
  const active = new Set<Request>();
  const pending: Promise<void>[] = [];
  let sequence = 0;
  const now = (): number => Date.now() - startedAt;

  const onRequest = (request: Request): void => {
    const entry: NetworkEvidence = {
      id: `net-${++sequence}`,
      method: request.method(),
      url: safeUrl(request.url()),
      resourceType: request.resourceType(),
      startedAt: now(),
    };
    requests.set(request, entry);
    active.add(request);
    sink.network.push(entry);
  };
  const onResponse = (response: Response): void => {
    const entry = requests.get(response.request());
    if (!entry) return;
    entry.status = response.status();
    entry.ok = response.ok();
    const enrichment = (async () => {
      const [contentType, location] = await Promise.all([
        response.headerValue("content-type"),
        response.headerValue("location"),
      ]);
      if (contentType) entry.contentType = contentType.split(";")[0] ?? contentType;
      if (location) entry.location = safeUrl(new URL(location, response.url()).toString());
      if (["POST", "PUT", "PATCH"].includes(entry.method) && contentType?.includes("json")) {
        const value = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined;
        const resourceId = value?.id ?? value?._id ?? value?.uuid ?? value?.data;
        if (typeof resourceId === "string" || typeof resourceId === "number") {
          entry.responseResourceId = String(resourceId);
        } else if (resourceId && typeof resourceId === "object") {
          const nested = resourceId as Record<string, unknown>;
          const nestedId = nested.id ?? nested._id ?? nested.uuid;
          if (typeof nestedId === "string" || typeof nestedId === "number") entry.responseResourceId = String(nestedId);
        }
      }
      try {
        const parts = new URL(entry.url).pathname.split("/").filter(Boolean);
        const tail = parts.at(-1) ?? "resource";
        entry.resourceTypeHint = /^\d+$|^[0-9a-f-]{8,}$/i.test(tail) ? parts.at(-2) ?? "resource" : tail;
      } catch {
        // URL has already been redacted; resource hint is optional.
      }
    })();
    pending.push(enrichment);
  };
  const onFinished = (request: Request): void => {
    const entry = requests.get(request);
    if (entry) entry.finishedAt = now();
    active.delete(request);
  };
  const onFailed = (request: Request): void => {
    const entry = requests.get(request);
    if (!entry) return;
    entry.finishedAt = now();
    entry.ok = false;
    entry.failure = redactText(request.failure()?.errorText ?? "Request failed");
    active.delete(request);
  };
  const onConsole = (message: { type(): string; text(): string }): void => {
    if (["error", "warning", "warn"].includes(message.type())) {
      sink.console.push({ type: message.type(), text: redactText(message.text()).slice(0, 1_000), at: now() });
    }
  };
  const onPageError = (error: Error): void => {
    sink.pageErrors.push(redactText(error.message).slice(0, 1_000));
  };
  const onDialog = (dialog: { type(): string; message(): string; accept(promptText?: string): Promise<void> }): void => {
    sink.dialogs.push(`${dialog.type()}: ${redactText(dialog.message()).slice(0, 500)}`);
    void dialog.accept("RD_TEST");
  };
  const onDownload = (download: Download): void => {
    const fileName = download.suggestedFilename();
    sink.downloads.push(fileName);
    sink.downloadEvidence ??= [];
    const entry: DownloadEvidence = { fileName };
    sink.downloadEvidence.push(entry);
    const inspect = (async () => {
      const failure = await download.failure().catch(() => "Download inspection failed.");
      if (failure) {
        entry.failure = redactText(failure).slice(0, 500);
        return;
      }
      const stream = await download.createReadStream().catch(() => undefined);
      if (!stream) {
        entry.failure = "The browser did not expose the downloaded content.";
        return;
      }
      const chunks: Buffer[] = [];
      let captured = 0;
      let size = 0;
      for await (const chunk of stream) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += value.length;
        if (captured < 5_000_000) {
          const bounded = value.subarray(0, 5_000_000 - captured);
          chunks.push(bounded);
          captured += bounded.length;
        }
      }
      const content = Buffer.concat(chunks);
      const textContent = content.toString("utf8");
      const expectedValues = (sink.filledFields ?? []).filter((field) => !field.redacted && !["true", "false"].includes(field.value));
      entry.size = size;
      entry.contentHash = createHash("sha256").update(content).digest("hex");
      entry.containsCanary = Boolean(sink.canary && textContent.toLowerCase().includes(sink.canary.toLowerCase()));
      entry.expectedFieldValues = expectedValues.length;
      entry.matchedFieldValues = expectedValues.filter((field) => textContent.includes(field.value)).length;
      const contentType = new Map([
        [".csv", "text/csv"], [".json", "application/json"], [".pdf", "application/pdf"], [".txt", "text/plain"], [".zip", "application/zip"],
      ]).get(path.extname(fileName).toLowerCase());
      if (contentType) entry.contentType = contentType;
    })();
    pending.push(inspect);
  };
  const onWebSocket = (socket: WebSocket): void => {
    const entry: WebSocketEvidence = {
      url: safeUrl(socket.url()),
      openedAt: now(),
      sentFrames: 0,
      receivedFrames: 0,
      errors: [],
    };
    sink.webSockets ??= [];
    sink.webSockets.push(entry);
    socket.on("framesent", () => { entry.sentFrames += 1; });
    socket.on("framereceived", () => { entry.receivedFrames += 1; });
    socket.on("socketerror", (error) => entry.errors.push(redactText(error).slice(0, 500)));
    socket.on("close", () => { entry.closedAt = now(); });
  };
  const onPopup = (popup: Page): void => {
    sink.popupUrls ??= [];
    const capture = popup.waitForLoadState("domcontentloaded", { timeout: 3_000 })
      .catch(() => undefined)
      .then(() => { sink.popupUrls?.push(safeUrl(popup.url())); });
    pending.push(capture);
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("dialog", onDialog);
  page.on("download", onDownload);
  page.on("websocket", onWebSocket);
  page.on("popup", onPopup);

  return {
    waitForIdle: async (timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      let quietSince = active.size === 0 ? Date.now() : undefined;
      while (Date.now() < deadline) {
        if (active.size === 0) {
          quietSince ??= Date.now();
          if (Date.now() - quietSince >= 100) return true;
        } else {
          quietSince = undefined;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return active.size === 0;
    },
    flush: async () => {
      await Promise.allSettled(pending);
    },
    detach: () => {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("dialog", onDialog);
      page.off("download", onDownload);
      page.off("websocket", onWebSocket);
      page.off("popup", onPopup);
    },
  };
}

function digestStorage(
  entries: Array<[string, string]>,
  canary: string,
): StorageEntryDigest[] {
  return entries.map(([key, value]) => ({
    key,
    valueHash: hashText(value),
    containsCanary: value.toLowerCase().includes(canary.toLowerCase()),
  }));
}

export async function captureState(
  page: Page | Frame,
  canary: string,
  startedAt: number,
): Promise<StateSnapshot> {
  const state = await page.evaluate(async (needle) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const bodyText = normalize(document.body?.innerText ?? "").slice(0, 100_000);
    const jwtExpired = (value: string): boolean => {
      const parts = value.split(".");
      if (parts.length !== 3) return false;
      try {
        const payload = JSON.parse(atob((parts[1] ?? "").replaceAll("-", "+").replaceAll("_", "/"))) as { exp?: number };
        return typeof payload.exp === "number" && payload.exp * 1_000 <= Date.now();
      } catch {
        return false;
      }
    };
    const controls = [...document.querySelectorAll("input, textarea, select, button")]
      .slice(0, 2_000)
      .map((element) => {
        const input = element as HTMLInputElement;
        const type = input.type?.toLowerCase() ?? element.tagName.toLowerCase();
        const sensitive = type === "password" || /password|token|secret|api.?key/i.test(input.name || input.id || "");
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          type,
          name: input.name || undefined,
          value: sensitive ? "[REDACTED]" : input.value,
          checked: input.checked,
          disabled: input.disabled,
          visible: style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0,
          expanded: element.getAttribute("aria-expanded"),
          pressed: element.getAttribute("aria-pressed"),
          selected: element.getAttribute("aria-selected"),
          busy: element.getAttribute("aria-busy"),
        };
      });
    const controlText = JSON.stringify(controls);
    const visualState = [...document.querySelectorAll('dialog, [role="dialog"], [aria-modal], [class~="pane"], [class*="modal"], [class*="tour"], [class*="onboarding"], [hidden], [aria-hidden], button, a, input, textarea, select, [role="tab"], [role="menuitem"]')]
      .slice(0, 2_000)
      .map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          visible: style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0,
          pointer: style.pointerEvents !== "none",
          hidden: element.hasAttribute("hidden"),
          ariaHidden: element.getAttribute("aria-hidden"),
          open: element.hasAttribute("open"),
        };
      });
    const visualText = JSON.stringify(visualState);
    const storageEntries = [...Object.entries(localStorage), ...Object.entries(sessionStorage)];
    const authStorage = storageEntries.filter(([key, value]) => /auth|session|token|jwt|credential/i.test(key) || value.split(".").length === 3);
    const normalizedText = bodyText.toLowerCase();
    const authEvidenceText = [...document.querySelectorAll("body *")]
      .filter((element) => element.childElementCount === 0 && !element.closest("nav, a, form") && !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true")
      .map((element) => element.textContent?.trim().toLowerCase() ?? "")
      .filter(Boolean)
      .join(" ");
    const indexedDb: Array<{ name: string; version: number; stores: Array<{ name: string; count: number }> }> = [];
    if (globalThis.indexedDB && typeof indexedDB.databases === "function") {
      const databases = await indexedDB.databases().catch(() => []);
      for (const info of databases.slice(0, 20)) {
        if (!info.name) continue;
        const database = await new Promise<IDBDatabase | undefined>((resolve) => {
          const request = indexedDB.open(info.name as string);
          const timer = setTimeout(() => resolve(undefined), 500);
          request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
          request.onerror = () => { clearTimeout(timer); resolve(undefined); };
          request.onblocked = () => { clearTimeout(timer); resolve(undefined); };
        });
        if (!database) continue;
        const stores: Array<{ name: string; count: number }> = [];
        for (const name of [...database.objectStoreNames].slice(0, 30)) {
          const count = await new Promise<number>((resolve) => {
            const transaction = database.transaction(name, "readonly");
            const request = transaction.objectStore(name).count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(-1);
          });
          stores.push({ name, count });
        }
        indexedDb.push({ name: info.name, version: database.version, stores });
        database.close();
      }
    }
    return {
      url: location.href,
      title: document.title,
      bodyText,
      controlText,
      visualText,
      controls,
      canaryPresent: `${bodyText}\n${controlText}`.toLowerCase().includes(needle.toLowerCase()),
      bodyCanaryPresent: bodyText.toLowerCase().includes(needle.toLowerCase()),
      temporaryBlobUrls: [...document.querySelectorAll("a[href], img[src], video[src], audio[src], source[src]")]
        .filter((element) => (element.getAttribute("href") ?? element.getAttribute("src") ?? "").startsWith("blob:"))
        .length,
      auth: {
        storageArtifacts: authStorage.length,
        expiredStorageArtifacts: authStorage.filter(([, value]) => jwtExpired(value)).length,
        privateContent: /\b(private account|account dashboard|account settings|profile settings|member dashboard|tenant dashboard|billing dashboard|signed in as|sign out|log out|logout)\b/.test(authEvidenceText),
        adminContent: /\b(admin dashboard|admin panel|administration|signed in as admin)\b/.test(authEvidenceText),
        accessDenied: /\b(unauthorized|forbidden|access denied|sign in required|login required)\b/.test(normalizedText),
      },
      busyControls: controls.filter((control) => control.busy === "true").length,
      disabledControls: controls.filter((control) => control.disabled).length,
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
      indexedDb,
    };
  }, canary);
  const cookies = await ("context" in page ? page.context() : page.page().context()).cookies(page.url());
  return {
    at: Date.now() - startedAt,
    url: safeUrl(state.url),
    title: state.title.slice(0, 300),
    domHash: hashText(`${state.bodyText}\n${state.controlText}\n${state.visualText}`),
    canaryPresent: state.canaryPresent,
    bodyCanaryPresent: state.bodyCanaryPresent,
    temporaryBlobUrls: state.temporaryBlobUrls,
    auth: {
      artifacts: state.auth.storageArtifacts + cookies.filter((cookie) => /auth|session|token|jwt|credential/i.test(cookie.name)).length,
      expiredArtifacts: state.auth.expiredStorageArtifacts + cookies.filter((cookie) => cookie.expires > 0 && cookie.expires * 1_000 <= Date.now()).length,
      privateContent: state.auth.privateContent,
      adminContent: state.auth.adminContent,
      accessDenied: state.auth.accessDenied,
    },
    semanticDom: {
      textHash: hashText(state.bodyText),
      visualHash: hashText(state.visualText),
      text: redactText(state.bodyText).slice(0, 20_000),
      controls: state.controls.map((control) => ({
        tag: control.tag,
        type: control.type,
        ...(control.name ? { name: control.name } : {}),
        valueHash: hashText(control.value),
        checked: control.checked,
        disabled: control.disabled,
        visible: control.visible,
        ...(control.expanded === null ? {} : { expanded: control.expanded }),
        ...(control.pressed === null ? {} : { pressed: control.pressed }),
        ...(control.selected === null ? {} : { selected: control.selected }),
        ...(control.busy === null ? {} : { busy: control.busy }),
      })),
    },
    busyControls: state.busyControls,
    disabledControls: state.disabledControls,
    storage: {
      local: digestStorage(state.local, canary),
      session: digestStorage(state.session, canary),
      cookieNames: [...new Set(cookies.map((cookie) => cookie.name))].sort(),
      cookies: cookies.map((cookie) => ({
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        valueHash: hashText(cookie.value),
        containsCanary: cookie.value.toLowerCase().includes(canary.toLowerCase()),
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
      })),
      indexedDb: state.indexedDb,
    },
  };
}

export async function collectUiClaims(page: Page | Frame, startedAt: number): Promise<UiClaim[]> {
  const candidates = await page
    .locator('[role="status"], [role="alert"], .toast, .notification, .alert, [data-toast], [data-notification]')
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const node = element as HTMLElement;
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        })
        .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 20),
    );
  const success = /success|saved|created|updated|deleted|complete|done|thành công|đã lưu|đã tạo|đã cập nhật|đã xóa/i;
  const failure = /error|failed|failure|invalid|unable|could not|lỗi|thất bại|không thể/i;
  return candidates.flatMap((text): UiClaim[] => {
    if (success.test(text)) return [{ kind: "success", text: redactText(text).slice(0, 500), at: Date.now() - startedAt }];
    if (failure.test(text)) return [{ kind: "error", text: redactText(text).slice(0, 500), at: Date.now() - startedAt }];
    return [];
  });
}
