import type { Frame, Page } from "playwright";

type ModalScope = Page | Frame;

const ACTIVE_MODAL_SELECTOR = 'dialog[open], [role="dialog"][aria-modal="true"], [aria-modal="true"], [class~="modal"], [class*="-modal"], [class~="pane"], [class*="onboarding"], [class*="tour"]';
const SAFE_DISMISS_NAME = /^(dismiss|close(?: tour)?|skip(?: tour)?|not now|later|got it|ok(?:ay)?|get started)$/i;

async function targetIsInsideActiveModal(scope: ModalScope, selector?: string): Promise<boolean> {
  if (!selector) return false;
  const target = scope.locator(selector).first();
  if ((await target.count()) === 0) return false;
  return target.evaluate((element, modalSelector) => {
    const modal = element.closest(modalSelector);
    const active = (candidate: Element): boolean => {
      const style = getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
    };
    if (modal && active(modal)) return true;
    for (let current = element.parentElement; current; current = current.parentElement) {
      if (!active(current)) continue;
      const style = getComputedStyle(current);
      const rect = current.getBoundingClientRect();
      const zIndex = Number.parseInt(style.zIndex, 10);
      if (style.position === "fixed" && (rect.width * rect.height >= innerWidth * innerHeight * 0.25 || zIndex >= 20)) return true;
    }
    return false;
  }, ACTIVE_MODAL_SELECTOR).catch(() => false);
}

export async function dismissOneSafeBlockingModal(
  scope: ModalScope,
  targetSelector?: string,
): Promise<string | undefined> {
  if (await targetIsInsideActiveModal(scope, targetSelector)) return undefined;
  const modals = scope.locator(ACTIVE_MODAL_SELECTOR);
  for (let modalIndex = (await modals.count()) - 1; modalIndex >= 0; modalIndex -= 1) {
    const modal = modals.nth(modalIndex);
    const active = await modal.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
    }).catch(() => false);
    if (!active) continue;
    const buttons = modal.getByRole("button", { name: SAFE_DISMISS_NAME });
    for (let buttonIndex = 0; buttonIndex < await buttons.count(); buttonIndex += 1) {
      const button = buttons.nth(buttonIndex);
      if (!(await button.isVisible().catch(() => false))) continue;
      if (!(await button.isEnabled().catch(() => false))) continue;
      const label = await button.evaluate((element) => (
        element.getAttribute("aria-label") || (element as HTMLElement).innerText || element.getAttribute("title") || "Dismiss modal"
      ).replace(/\s+/g, " ").trim()).catch(() => "Dismiss modal");
      const clicked = await button.evaluate((element) => {
        if ((element as HTMLButtonElement).disabled || element.getAttribute("aria-disabled") === "true") return false;
        (element as HTMLElement).click();
        return true;
      }).catch(() => false);
      if (!clicked) continue;
      await scope.waitForTimeout(100);
      return label.slice(0, 180);
    }
  }
  const fallbackButtons = scope.getByRole("button", { name: SAFE_DISMISS_NAME });
  for (let buttonIndex = 0; buttonIndex < await fallbackButtons.count(); buttonIndex += 1) {
    const button = fallbackButtons.nth(buttonIndex);
    if (!(await button.isVisible().catch(() => false)) || !(await button.isEnabled().catch(() => false))) continue;
    const blocksPage = await button.evaluate((element) => {
      for (let current = element.parentElement; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        const rect = current.getBoundingClientRect();
        const zIndex = Number.parseInt(style.zIndex, 10);
        const active = style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
        if (active && style.position === "fixed" && (rect.width * rect.height >= innerWidth * innerHeight * 0.25 || zIndex >= 20)) return true;
      }
      return false;
    }).catch(() => false);
    if (!blocksPage) continue;
    const label = await button.evaluate((element) => (
      element.getAttribute("aria-label") || (element as HTMLElement).innerText || element.getAttribute("title") || "Dismiss modal"
    ).replace(/\s+/g, " ").trim()).catch(() => "Dismiss modal");
    const clicked = await button.evaluate((element) => {
      if ((element as HTMLButtonElement).disabled || element.getAttribute("aria-disabled") === "true") return false;
      (element as HTMLElement).click();
      return true;
    }).catch(() => false);
    if (!clicked) continue;
    await scope.waitForTimeout(100);
    return label.slice(0, 180);
  }
  return undefined;
}

export async function dismissSafeBlockingModals(
  scope: ModalScope,
  targetSelector?: string,
): Promise<string[]> {
  const dismissed: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const label = await dismissOneSafeBlockingModal(scope, targetSelector);
    if (!label) break;
    dismissed.push(label);
  }
  return dismissed;
}
