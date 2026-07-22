import type { Page, Request, Response } from "playwright";
import { hashText, redactText, safeUrl } from "../core/redact.js";
import type {
  ConsoleEvidence,
  NetworkEvidence,
  StateSnapshot,
  StorageEntryDigest,
  UiClaim,
} from "../types.js";

export interface EvidenceSink {
  network: NetworkEvidence[];
  console: ConsoleEvidence[];
  pageErrors: string[];
  dialogs: string[];
  downloads: string[];
}

export interface AttachedEvidence {
  detach: () => void;
}

export function attachEvidence(page: Page, startedAt: number, sink: EvidenceSink): AttachedEvidence {
  const requests = new WeakMap<Request, NetworkEvidence>();
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
    sink.network.push(entry);
  };
  const onResponse = (response: Response): void => {
    const entry = requests.get(response.request());
    if (!entry) return;
    entry.status = response.status();
    entry.ok = response.ok();
    void response.headerValue("content-type").then((value) => {
      if (value) entry.contentType = value.split(";")[0] ?? value;
    });
  };
  const onFinished = (request: Request): void => {
    const entry = requests.get(request);
    if (entry) entry.finishedAt = now();
  };
  const onFailed = (request: Request): void => {
    const entry = requests.get(request);
    if (!entry) return;
    entry.finishedAt = now();
    entry.ok = false;
    entry.failure = redactText(request.failure()?.errorText ?? "Request failed");
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
  const onDownload = (download: { suggestedFilename(): string }): void => {
    sink.downloads.push(download.suggestedFilename());
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("dialog", onDialog);
  page.on("download", onDownload);

  return {
    detach: () => {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("dialog", onDialog);
      page.off("download", onDownload);
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
  page: Page,
  canary: string,
  startedAt: number,
): Promise<StateSnapshot> {
  const state = await page.evaluate((needle) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const bodyText = normalize(document.body?.innerText ?? "").slice(0, 100_000);
    return {
      url: location.href,
      title: document.title,
      bodyText,
      canaryPresent: bodyText.toLowerCase().includes(needle.toLowerCase()),
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
    };
  }, canary);
  const cookies = await page.context().cookies(page.url());
  return {
    at: Date.now() - startedAt,
    url: safeUrl(state.url),
    title: state.title.slice(0, 300),
    domHash: hashText(state.bodyText),
    canaryPresent: state.canaryPresent,
    storage: {
      local: digestStorage(state.local, canary),
      session: digestStorage(state.session, canary),
      cookieNames: [...new Set(cookies.map((cookie) => cookie.name))].sort(),
    },
  };
}

export async function collectUiClaims(page: Page, startedAt: number): Promise<UiClaim[]> {
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
