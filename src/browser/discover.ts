import { createHash } from "node:crypto";
import type { Browser, Page } from "playwright";
import { classifyAction } from "../core/classify.js";
import { isTransientBrowserError, withRetry } from "../core/retry.js";
import type {
  ActionSpec,
  DiscoveredPage,
  FormFieldSpec,
  SemanticFingerprint,
} from "../types.js";

interface RawField {
  selector: string;
  tag: "input" | "textarea" | "select";
  type: string;
  name?: string;
  label?: string;
  placeholder?: string;
  required: boolean;
  disabled: boolean;
}

interface RawAction {
  selector: string;
  tag: string;
  role?: string;
  accessibleName?: string;
  text?: string;
  testId?: string;
  id?: string;
  href?: string;
  type?: string;
  ordinal: number;
  isForm: boolean;
  activation: "click" | "submit" | "enter";
  fields: RawField[];
}

function stableActionId(url: string, raw: RawAction): string {
  return createHash("sha256")
    .update(`${url}|${raw.selector}|${raw.accessibleName ?? raw.text ?? ""}`)
    .digest("hex")
    .slice(0, 12);
}

function toAction(pageUrl: string, raw: RawAction): ActionSpec {
  const label = (
    raw.accessibleName ??
    raw.text ??
    raw.href ??
    `${raw.tag} action`
  ).trim();
  const initialClassification = classifyAction(label, raw.tag, raw.href, raw.isForm);
  const hasExternalTargetField = raw.fields.some((field) =>
    field.type === "url" || /^https?:\/\//i.test(field.placeholder ?? ""),
  );
  const classification = hasExternalTargetField && /\b(connect|sync|server|endpoint|webhook)\b/i.test(label)
    ? { kind: "external" as const, intent: "external" as const, risk: "external" as const }
    : initialClassification;
  const fingerprint: SemanticFingerprint = {
    selector: raw.selector,
    tag: raw.tag,
    ordinal: raw.ordinal,
    ...(raw.role ? { role: raw.role } : {}),
    ...(raw.accessibleName ? { accessibleName: raw.accessibleName } : {}),
    ...(raw.text ? { text: raw.text } : {}),
    ...(raw.testId ? { testId: raw.testId } : {}),
    ...(raw.id ? { id: raw.id } : {}),
    ...(raw.href ? { href: raw.href } : {}),
    ...(raw.type ? { type: raw.type } : {}),
    candidates: [
      ...(raw.testId ? [{ strategy: "testid" as const, weight: 100, value: raw.testId, exact: true }] : []),
      ...(raw.role && raw.accessibleName
        ? [
            { strategy: "role" as const, weight: 92, role: raw.role, name: raw.accessibleName, exact: true },
            { strategy: "role" as const, weight: 82, role: raw.role, name: raw.accessibleName, exact: false },
          ]
        : []),
      ...(raw.id ? [{ strategy: "id" as const, weight: 80, selector: raw.selector }] : []),
      ...(raw.href ? [{ strategy: "href" as const, weight: 72, value: raw.href }] : []),
      ...(raw.text ? [{ strategy: "text" as const, weight: 60, value: raw.text, exact: true }] : []),
      { strategy: "css" as const, weight: 35, selector: raw.selector },
    ],
  };
  return {
    id: stableActionId(pageUrl, raw),
    pageUrl,
    label: label.slice(0, 180),
    activation: raw.activation,
    ...classification,
    fingerprint,
    fields: raw.fields.map((field): FormFieldSpec => ({ ...field })),
  };
}

export async function discoverActions(page: Page): Promise<ActionSpec[]> {
  const raw = await page
    .locator("form, a[href], button, input[type=submit], input[type=button], input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], [role=button]")
    .evaluateAll((elements): RawAction[] => {
      const visible = (element: Element): boolean => {
        const node = element as HTMLElement;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          !node.hasAttribute("disabled") &&
          node.getAttribute("aria-disabled") !== "true"
        );
      };

      const escapeCss = (value: string): string => {
        if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
        return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
      };

      const cssPath = (element: Element): string => {
        const testId = element.getAttribute("data-testid");
        if (testId) return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
        if (element.id) return `#${escapeCss(element.id)}`;
        const parts: string[] = [];
        let current: Element | null = element;
        while (current && current !== document.documentElement) {
          const tag = current.tagName.toLowerCase();
          const parent: Element | null = current.parentElement;
          if (!parent) {
            parts.unshift(tag);
            break;
          }
          const siblings = [...parent.children].filter((child) => child.tagName === current?.tagName);
          const suffix = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
          parts.unshift(`${tag}${suffix}`);
          current = parent;
        }
        return parts.join(" > ");
      };

      const accessibleName = (element: Element): string => {
        const labelledBy = element.getAttribute("aria-labelledby");
        const labelledText = labelledBy
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ");
        if (labelledText?.trim()) return labelledText.trim();
        const aria = element.getAttribute("aria-label");
        if (aria?.trim()) return aria.trim();
        if (element instanceof HTMLInputElement && element.labels?.length) {
          return [...element.labels].map((label) => label.innerText).join(" ").trim();
        }
        if (element instanceof HTMLInputElement && element.value) return element.value.trim();
        return ((element as HTMLElement).innerText || element.getAttribute("title") || "")
          .replace(/\s+/g, " ")
          .trim();
      };

      const fieldFor = (field: Element): RawField | undefined => {
        if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) {
          return undefined;
        }
        const tag = field.tagName.toLowerCase() as RawField["tag"];
        const label = accessibleName(field);
        const type = field instanceof HTMLInputElement ? field.type || "text" : tag;
        const placeholder = field.getAttribute("placeholder");
        return {
          selector: cssPath(field),
          tag,
          type,
          required: field.required,
          disabled: field.disabled,
          ...(field.name ? { name: field.name } : {}),
          ...(label ? { label } : {}),
          ...(placeholder ? { placeholder } : {}),
        };
      };

      const candidates = elements.filter((element) => {
        if (!visible(element)) return false;
        if (element.tagName.toLowerCase() !== "form" && element.closest("form")) return false;
        if (element instanceof HTMLInputElement && !["submit", "button"].includes(element.type)) {
          const metadata = [
            element.id,
            element.name,
            element.className,
            element.getAttribute("data-testid") ?? "",
            element.getAttribute("aria-label") ?? "",
            element.placeholder,
          ].join(" ");
          if (!/\b(new|add|create|save|todo|task|comment|message|search|query)\b/i.test(metadata)) return false;
        }
        return true;
      });

      return candidates.map((element, ordinal): RawAction => {
        const tag = element.tagName.toLowerCase();
        const enterInput = element instanceof HTMLInputElement && !["submit", "button"].includes(element.type);
        const inputMetadata = enterInput
          ? [element.id, element.name, element.className, element.getAttribute("data-testid") ?? "", element.getAttribute("aria-label") ?? "", element.placeholder].join(" ")
          : "";
        const isForm = tag === "form" || (enterInput && /\b(new|add|create|save|todo|task|comment|message)\b/i.test(inputMetadata));
        const form = tag === "form" ? (element as HTMLFormElement) : undefined;
        const nearbyContainer = !form && !enterInput ? element.parentElement : undefined;
        const nearbyElements = nearbyContainer
          ? [...nearbyContainer.querySelectorAll("input, textarea, select")].filter(visible)
          : [];
        const nearbyFields = nearbyElements.length <= 4
          ? nearbyElements.map(fieldFor).filter((field): field is RawField => Boolean(field))
          : [];
        const fields = form
          ? [...form.querySelectorAll("input, textarea, select")]
              .map(fieldFor)
              .filter((field): field is RawField => Boolean(field))
          : enterInput
            ? [fieldFor(element)].filter((field): field is RawField => Boolean(field))
            : nearbyFields;
        const name = accessibleName(element) || element.getAttribute("placeholder") || (form ? `Submit ${form.getAttribute("name") ?? "form"}` : "");
        const role = element.getAttribute("role") || (tag === "a" ? "link" : tag === "button" ? "button" : enterInput ? (element.type === "search" ? "searchbox" : "textbox") : undefined);
        const href = element instanceof HTMLAnchorElement ? element.href : undefined;
        const type = element instanceof HTMLInputElement || element instanceof HTMLButtonElement ? element.type : undefined;
        const testId = element.getAttribute("data-testid");
        return {
          selector: cssPath(element),
          tag,
          ordinal,
          isForm,
          activation: form ? "submit" : enterInput ? "enter" : "click",
          fields,
          ...(role ? { role } : {}),
          ...(name ? { accessibleName: name.slice(0, 240) } : {}),
          ...((element as HTMLElement).innerText
            ? { text: (element as HTMLElement).innerText.replace(/\s+/g, " ").trim().slice(0, 240) }
            : {}),
          ...(testId ? { testId } : {}),
          ...(element.id ? { id: element.id } : {}),
          ...(href ? { href } : {}),
          ...(type ? { type } : {}),
        };
      });
    });

  return raw.map((action) => toAction(page.url(), action));
}

export function normalizeCrawlUrl(input: string): string | undefined {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    if (url.hash === "#/" || url.hash === "#!/") url.hash = "";
    else if (!url.hash.startsWith("#/") && !url.hash.startsWith("#!/")) url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export interface DiscoveryOptions {
  maxPages: number;
  timeoutMs: number;
  settleMs: number;
  maxRetries: number;
  deadline: number;
  storageStatePath?: string;
}

export async function discoverSite(
  browser: Browser,
  targetUrl: string,
  options: DiscoveryOptions,
): Promise<DiscoveredPage[]> {
  const origin = new URL(targetUrl).origin;
  const context = await browser.newContext(
    options.storageStatePath ? { storageState: options.storageStatePath } : {},
  );
  const page = await context.newPage();
  const queue = [normalizeCrawlUrl(targetUrl) ?? targetUrl];
  const seen = new Set<string>();
  const pages: DiscoveredPage[] = [];

  try {
    while (queue.length > 0 && pages.length < options.maxPages && Date.now() < options.deadline) {
      const url = queue.shift();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      try {
        await withRetry(
          () => page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs }),
          { retries: options.maxRetries, shouldRetry: isTransientBrowserError },
        );
        await page.waitForTimeout(Math.min(options.settleMs, 1_000));
        const actions = await discoverActions(page);
        pages.push({ url: page.url(), title: await page.title(), actions });
        for (const action of actions) {
          const href = action.fingerprint.href;
          if (!href) continue;
          const normalized = normalizeCrawlUrl(href);
          if (normalized && new URL(normalized).origin === origin && !seen.has(normalized)) queue.push(normalized);
        }
      } catch (error) {
        pages.push({
          url,
          title: "",
          actions: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await context.close();
  }
  return pages;
}
