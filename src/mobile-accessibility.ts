import { PLUGIN_PANEL_ATTR } from "./constants";
import type { AppElement } from "./types";

export function bindMobileSidebarAccessibility(app: AppElement): () => void {
  const body: HTMLElement | null = app.querySelector(".app-body");
  const query: string = "(max-width: 768px)";
  const media: MediaQueryList | undefined = window.matchMedia?.(query);
  const update = (): void => applyMobileSidebarAccessibility(app, media?.matches ?? window.innerWidth <= 768);
  const MutationObserverCtor: typeof MutationObserver | undefined = window.MutationObserver;
  const observer: MutationObserver | undefined = body && MutationObserverCtor ? new MutationObserverCtor(update) : undefined;

  observer?.observe(app, { attributeFilter: ["data-sidebar"], attributes: true });
  observer?.observe(body as HTMLElement, { childList: true });
  media?.addEventListener?.("change", update);
  update();

  return (): void => {
    media?.removeEventListener?.("change", update);
    observer?.disconnect();
    restoreMobileSidebarAccessibility(app);
  };
}

function applyMobileSidebarAccessibility(app: AppElement, mobile: boolean): void {
  const body: HTMLElement | null = app.querySelector(".app-body");

  if (!body) {
    return;
  }

  const sidebar: HTMLElement | null = body.querySelector(`:scope > [${PLUGIN_PANEL_ATTR}]`);
  const active: boolean = mobile && !!sidebar && !sidebar.hidden && app.dataset.sidebar !== "collapsed";

  body.querySelectorAll<HTMLElement>(":scope > *").forEach((child: HTMLElement): void => {
    if (child === sidebar) {
      restoreMobileSidebarChild(child);
      return;
    }

    if (active) {
      hideMobileSidebarBackground(child);
      return;
    }

    restoreMobileSidebarChild(child);
  });
}

function hideMobileSidebarBackground(child: HTMLElement): void {
  if (child.dataset.piWebSidebarMobileAriaHidden === undefined) {
    child.dataset.piWebSidebarMobileAriaHidden = child.getAttribute("aria-hidden") ?? "";
    child.dataset.piWebSidebarMobileInert = child.hasAttribute("inert") ? "1" : "0";
  }

  child.setAttribute("aria-hidden", "true");
  child.setAttribute("inert", "");
}

function restoreMobileSidebarAccessibility(app: AppElement): void {
  app.querySelectorAll<HTMLElement>(".app-body > *").forEach(restoreMobileSidebarChild);
}

function restoreMobileSidebarChild(child: HTMLElement): void {
  const previousAriaHidden: string | undefined = child.dataset.piWebSidebarMobileAriaHidden;
  const previousInert: string | undefined = child.dataset.piWebSidebarMobileInert;

  if (previousAriaHidden !== undefined) {
    if (previousAriaHidden) {
      child.setAttribute("aria-hidden", previousAriaHidden);
    } else {
      child.removeAttribute("aria-hidden");
    }

    delete child.dataset.piWebSidebarMobileAriaHidden;
  }

  if (previousInert !== undefined) {
    child.toggleAttribute("inert", previousInert === "1");
    delete child.dataset.piWebSidebarMobileInert;
  }
}
