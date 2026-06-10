import { PLUGIN_PANEL_ATTR, SIDEBAR_COLLAPSED_KEY, SIDEBAR_WIDTH_KEY } from "./constants";
import { storeString } from "./storage";
import type { AppElement, SidebarBridge } from "./types";

export function routePicker(app: AppElement): void {
  app.dataset.route = "picker";
  app.querySelector('[data-view="picker"]')?.removeAttribute("hidden");
  app.querySelector('[data-view="workspace"]')?.setAttribute("hidden", "");
}

export function routeWorkspace(app: AppElement): void {
  app.dataset.route = "workspace";
  app.querySelector('[data-view="workspace"]')?.removeAttribute("hidden");
  app.querySelector('[data-view="picker"]')?.setAttribute("hidden", "");
}

export function restoreSidebarLayout(app: AppElement): void {
  const width: number | undefined = readStoredSidebarWidth();

  if (width) {
    app.dataset.sidebarWidth = String(width);
  }

  try {
    collapseSidebarLayout(app, localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
  } catch {
    applySidebarGrid(app, width);
  }
}

export function bindHeaderSidebarToggle(app: AppElement): () => void {
  syncSidebarToggleButton(app);

  return (): void => {
    findSidebarToggleButton(app)?.remove();
  };
}

export function collapseSidebarLayout(app: AppElement, collapsed: boolean): void {
  app.dataset.sidebar = collapsed ? "collapsed" : "open";
  app.querySelector(`[${PLUGIN_PANEL_ATTR}]`)?.toggleAttribute("hidden", collapsed);

  syncSidebarToggleButton(app);
  storeString(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  applySidebarGrid(app);
}

function syncSidebarToggleButton(app: AppElement): void {
  const collapsed: boolean = app.dataset.sidebar === "collapsed";
  const expand: HTMLElement = ensureSidebarExpandButton(app);
  const label: string = collapsed ? "expand sidebar" : "collapse sidebar";
  const text: string = collapsed ? "›" : "‹";
  expand.setAttribute("aria-label", label);
  expand.title = label;

  if (expand.textContent !== text) {
    expand.textContent = text;
  }

  expand.style.display = "inline-flex";
}

function ensureSidebarExpandButton(app: AppElement): HTMLElement {
  const host: HTMLElement = findHeaderToggleHost(app);
  const existing: HTMLElement | null = findSidebarToggleButton(app);

  if (existing) {
    mountSidebarToggleButton(existing, host);
    return existing;
  }

  const expand: HTMLButtonElement = document.createElement("button");
  expand.type = "button";
  expand.className = "iconbtn pi-web-sidebar-toggle";
  expand.dataset.piWebSidebarToggle = "";
  expand.style.display = "none";
  expand.addEventListener("click", (): void => collapseSidebarLayout(app, app.dataset.sidebar !== "collapsed"));
  mountSidebarToggleButton(expand, host);
  return expand;
}

function mountSidebarToggleButton(button: HTMLElement, host: HTMLElement): void {
  if (button.parentElement === host && button === host.firstElementChild) {
    return;
  }

  host.insertBefore(button, host.firstElementChild);
}

function findHeaderToggleHost(app: AppElement): HTMLElement {
  return findTopbar(app) || app;
}

export function findTopbar(app: AppElement): HTMLElement | null {
  return headerFromToolbar(app.querySelector("[data-plugin-toolbar]"))
    || headerFromToolbar(document.querySelector("[data-plugin-toolbar]"))
    || app.querySelector("header.topbar")
    || document.querySelector<HTMLElement>("header.topbar");
}

function headerFromToolbar(toolbar: Element | null): HTMLElement | null {
  return toolbar?.closest("header.topbar") as HTMLElement | null;
}

function findSidebarToggleButton(app: AppElement): HTMLElement | null {
  return app.querySelector("[data-pi-web-sidebar-toggle]") || document.querySelector<HTMLElement>("[data-pi-web-sidebar-toggle]");
}

export function applySidebarGrid(app: AppElement, width: number = Number(app.dataset.sidebarWidth || 280)): void {
  const body: HTMLElement | null = app.querySelector(".app-body");

  if (!body) {
    return;
  }

  const tree: boolean = app.dataset.tree === "on";
  const hasSidebar: boolean = !!app.querySelector(`[${PLUGIN_PANEL_ATTR}]`);
  const collapsed: boolean = !hasSidebar || app.dataset.sidebar === "collapsed";
  const treeWidth: number = 320;
  const expandedColumns: string = tree ? `${width}px 1fr ${treeWidth}px` : `${width}px 1fr`;
  const collapsedColumns: string = tree ? `1fr ${treeWidth}px` : "1fr";
  body.style.gridTemplateColumns = collapsed ? collapsedColumns : expandedColumns;
  applyGridChildPlacement(body, collapsed, tree);
}

function applyGridChildPlacement(body: HTMLElement, collapsed: boolean, tree: boolean): void {
  body.querySelectorAll<HTMLElement>(":scope > *").forEach((child: HTMLElement): void => {
    if (child.hasAttribute(PLUGIN_PANEL_ATTR)) {
      child.style.gridColumn = collapsed ? "" : "1";
      return;
    }

    if (child.matches("[data-plugin-sidebar]")) {
      child.style.gridColumn = tree ? (collapsed ? "2" : "3") : "";
      return;
    }

    if (child.matches(".scrim")) {
      child.style.gridColumn = "";
      return;
    }

    if (isMainContentChild(child)) {
      child.style.gridColumn = collapsed ? "1" : "2";
    }
  });
}

function isMainContentChild(child: HTMLElement): boolean {
  return child.matches(
    [
      "main",
      ".main",
      ".prompt-region",
      "[data-main]",
      "[data-plugin-chat-root]",
      "[data-plugin-composer-root]",
      "[data-view='workspace']",
      "[data-view='picker']",
    ].join(","),
  );
}

export function bindResizer(wrap: HTMLElement, app: AppElement, sidebarBridge: SidebarBridge): () => void {
  const resizer: HTMLElement | null = wrap.querySelector(".sb-resizer");
  let activeCleanup: (() => void) | undefined;

  if (!resizer || resizer.dataset.piWebSidebarResizeBound === "true") {
    return (): void => undefined;
  }

  resizer.addEventListener("pointerdown", (event: PointerEvent): void => {
    activeCleanup?.();
    activeCleanup = startSidebarResize(app, event, sidebarBridge);
  });
  resizer.dataset.piWebSidebarResizeBound = "true";

  return (): void => {
    activeCleanup?.();
    activeCleanup = undefined;
  };
}

function startSidebarResize(app: AppElement, event: PointerEvent, sidebarBridge: SidebarBridge): () => void {
  event.preventDefault();
  const startX: number = event.clientX;
  const startWidth: number = Number(app.dataset.sidebarWidth || 280);
  const move = (moveEvent: PointerEvent): void => {
    const width: number = Math.min(480, Math.max(200, startWidth + moveEvent.clientX - startX));
    app.dataset.sidebarWidth = String(width);
    applySidebarGrid(app, width);
    storeSidebarWidth(width);
    sidebarBridge.emitState("resize-sidebar");
  };
  const stopResize = (): void => {
    cleanup();
    const width: number = Number(app.dataset.sidebarWidth || startWidth);
    storeSidebarWidth(width);
    sidebarBridge.emitEvent("resize-sidebar", { width });
  };
  const cleanup = (): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stopResize);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stopResize);
  return cleanup;
}

function readStoredSidebarWidth(): number | undefined {
  try {
    const storedWidthValue: string | null = localStorage.getItem(SIDEBAR_WIDTH_KEY);

    if (!storedWidthValue) {
      return undefined;
    }

    const width: number = Number(storedWidthValue);
    return Number.isFinite(width) ? Math.min(480, Math.max(200, width)) : undefined;
  } catch {
    return undefined;
  }
}

function storeSidebarWidth(width: number): void {
  storeString(SIDEBAR_WIDTH_KEY, String(width));
}
