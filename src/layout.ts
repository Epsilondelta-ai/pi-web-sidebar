import { PLUGIN_PANEL_ATTR, SIDEBAR_COLLAPSED_KEY, SIDEBAR_WIDTH_KEY } from "./constants";
import { storeString } from "./storage";
import type { AppElement, SidebarBridge } from "./types";

const MOBILE_SIDEBAR_QUERY = "(max-width: 768px)";

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

export function bindSidebarToggleViewport(app: AppElement): () => void {
  const media: MediaQueryList | undefined = window.matchMedia?.(MOBILE_SIDEBAR_QUERY);
  const update = (): void => syncSidebarToggleButton(app);
  media?.addEventListener?.("change", update);
  window.addEventListener("resize", update);
  update();

  return (): void => {
    media?.removeEventListener?.("change", update);
    window.removeEventListener("resize", update);
    app.querySelector(".sb-expand-btn")?.remove();
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
  expand.setAttribute("aria-label", label);
  expand.title = label;
  expand.textContent = collapsed ? "›" : "‹";
  expand.style.display = collapsed || isMobileSidebarViewport() ? "inline-flex" : "none";
}

function ensureSidebarExpandButton(app: AppElement): HTMLElement {
  const existing: HTMLElement | null = app.querySelector(".sb-expand-btn");

  if (existing) {
    return existing;
  }

  const expand: HTMLButtonElement = document.createElement("button");
  expand.type = "button";
  expand.className = "sb-expand-btn";
  expand.style.display = "none";
  expand.addEventListener("click", (): void => collapseSidebarLayout(app, app.dataset.sidebar !== "collapsed"));
  app.append(expand);
  return expand;
}

function isMobileSidebarViewport(): boolean {
  return window.matchMedia?.(MOBILE_SIDEBAR_QUERY).matches || false;
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
