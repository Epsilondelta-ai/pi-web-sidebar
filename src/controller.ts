import { loadWorkspaces } from "./api";
import { bindWorkspaceActions } from "./actions";
import { createSidebarBridge } from "./bridge";
import { animateMovedSiblings, measureTops, movableSiblings } from "./drag";
import { cssEscape, ensureSessionDragHandles, ensureWorkspaceDragHandles } from "./dom";
import { createSidebar, findNativeSidebar, installFallbackDragStyles, resetHostSidebarRenderState } from "./dom";
import { applySidebarGrid, bindResizer, restoreSidebarLayout } from "./layout";
import { bindOpenWorkspace } from "./picker";
import { renderPluginWorkspaceList } from "./render";
import { readStoredObject, storeJson } from "./storage";
import { ORIGINAL_PLACEHOLDER_ATTR, PLUGIN_PANEL_ATTR } from "./constants";
import type { AppElement, DragItem, PluginContext, SidebarController, SidebarWorkspace } from "./types";

type RefreshOptions = { allowEmpty?: boolean };

export function createSidebarController(app: AppElement, context: PluginContext = {}): SidebarController {
  let wrap: HTMLElement | null = null;
  let nativeSidebar: HTMLElement | null = null;
  let nativePlaceholder: HTMLTemplateElement | null = null;
  let draggedItem: DragItem | null = null;
  let resizeCleanup: (() => void) | undefined;
  let refreshSequence: number = 0;
  let workspaces: SidebarWorkspace[] = Array.isArray(context.initialWorkspaces) ? context.initialWorkspaces : [];
  const sidebarBridge = createSidebarBridge(app, context, () => workspaces, () => wrap, () => refreshCurrentWorkspaces());

  function mount(): void {
    const body: HTMLElement | null = app.querySelector(".app-body");

    if (!body) {
      throw new Error("pi-web-sidebar requires .app-body");
    }

    wrap = validPluginSidebar(app.querySelector(`[${PLUGIN_PANEL_ATTR}]`)) || createSidebar();
    const foundNativeSidebar: HTMLElement | undefined = findNativeSidebar(body, wrap);
    nativeSidebar = nativeSidebar || foundNativeSidebar || null;

    if (!nativePlaceholder && foundNativeSidebar) {
      detachNativeSidebar(foundNativeSidebar);
    }

    if (!wrap.isConnected) {
      body.insertBefore(wrap, body.firstElementChild);
    }

    bindMountedSidebar();
  }

  function detachNativeSidebar(foundNativeSidebar: HTMLElement): void {
    resetHostSidebarRenderState(app);
    nativePlaceholder = document.createElement("template");
    nativePlaceholder.setAttribute(ORIGINAL_PLACEHOLDER_ATTR, "");
    foundNativeSidebar.replaceWith(nativePlaceholder);
  }
  function bindMountedSidebar(): void {
    if (!wrap) {
      return;
    }

    installFallbackDragStyles();
    app.dataset.sidebar = app.dataset.sidebar || "open";
    resizeCleanup = bindResizer(wrap, app, sidebarBridge);
    bindOpenWorkspace(wrap, app, context, refreshCurrentWorkspaces);
    bindFallbackDrag(wrap);
    bindWorkspaceActions(wrap, app, context, refreshCurrentWorkspaces, sidebarBridge);
    renderCurrentWorkspaces();
    restoreSidebarLayout(app);
    sidebarBridge.emitState("mounted");
    void refreshCurrentWorkspaces();
  }

  function dispose(): void {
    resetHostSidebarRenderState(app);
    resizeCleanup?.();
    resizeCleanup = undefined;
    app.querySelector("[data-pi-web-sidebar-picker]")?.remove();
    wrap?.remove();

    if (nativePlaceholder?.isConnected && nativeSidebar) {
      nativePlaceholder.replaceWith(nativeSidebar);
      nativeSidebar.toggleAttribute("hidden", app.dataset.sidebar === "collapsed");
    }

    nativePlaceholder = null;
    nativeSidebar = null;
    wrap = null;
    applySidebarGrid(app);
    sidebarBridge.dispose();
  }

  function renderCurrentWorkspaces(): void {
    renderPluginWorkspaceList(wrap, app, workspaces);
    ensureWorkspaceDragHandles(wrap);
    ensureSessionDragHandles(wrap);
    sidebarBridge.emitState("render-workspaces");
  }

  async function refreshCurrentWorkspaces(options: RefreshOptions = {}): Promise<SidebarWorkspace[]> {
    const sequence: number = ++refreshSequence;

    try {
      const nextWorkspaces: SidebarWorkspace[] = await loadWorkspaces(context);

      if (sequence !== refreshSequence) {
        return workspaces;
      }

      if (!options.allowEmpty && nextWorkspaces.length === 0 && workspaces.length > 0) {
        console.warn("pi-web-sidebar skipped transient empty workspace refresh");
        sidebarBridge.emitEvent("refresh-workspaces-empty-skipped", { workspaceCount: workspaces.length });
        return workspaces;
      }

      workspaces = nextWorkspaces;
      renderCurrentWorkspaces();
      sidebarBridge.emitEvent("refresh-workspaces", { workspaceCount: workspaces.length });
    } catch (error) {
      console.warn("pi-web-sidebar failed to refresh workspaces", error);
    }

    return workspaces;
  }

  function startDrag(item: DragItem): void {
    draggedItem = item;
    wrap?.classList.add("pi-web-sidebar-dragging", `pi-web-sidebar-dragging-${item.type}`);
    item.element.classList.add("pi-web-sidebar-drag-source");

    if (item.type === "workspace") {
      collapseAllSessionsForWorkspaceDrag();
    }
  }

  function clearDragState(): void {
    restoreSessionsAfterWorkspaceDrag();
    wrap?.classList.remove("pi-web-sidebar-dragging", "pi-web-sidebar-dragging-workspace", "pi-web-sidebar-dragging-session");
    wrap?.querySelectorAll(".pi-web-sidebar-drag-source, .pi-web-sidebar-drop-target").forEach((node: Element): void => {
      node.classList.remove("pi-web-sidebar-drag-source", "pi-web-sidebar-drop-target");
    });
    draggedItem = null;
  }

  function collapseAllSessionsForWorkspaceDrag(): void {
    wrap?.querySelectorAll<HTMLElement>(".workspace-group > .sessions").forEach((sessions: HTMLElement): void => {
      sessions.dataset.piWebSidebarWasHidden = sessions.hidden ? "true" : "false";
      sessions.hidden = true;
    });
  }
  function restoreSessionsAfterWorkspaceDrag(): void {
    wrap?.querySelectorAll<HTMLElement>(".workspace-group > .sessions[data-pi-web-sidebar-was-hidden]").forEach(
      (sessions: HTMLElement): void => {
        sessions.hidden = sessions.dataset.piWebSidebarWasHidden === "true";
        delete sessions.dataset.piWebSidebarWasHidden;
      },
    );
  }

  function previewDrag(target: HTMLElement | null, event: DragEvent): void {
    if (!draggedItem || !target) {
      return;
    }

    if (draggedItem.type === "workspace") {
      moveWorkspaceNear(draggedItem.element, target.closest(".workspace-group"), event);
    }

    if (draggedItem.type === "session") {
      moveSessionNear(draggedItem.element, target.closest(".session-row[data-session]"), event);
    }
  }

  function finishDrag(): void {
    if (!draggedItem) {
      clearDragState();
      return;
    }

    if (draggedItem.type === "workspace") {
      persistWorkspaceOrder();
    }

    if (draggedItem.type === "session") {
      persistSessionOrder(draggedItem.element.dataset.workspace);
    }

    clearDragState();
  }

  function insertNear(source: HTMLElement | null, target: Element | null, event: DragEvent): boolean {
    if (!source || !target || source === target || !target.parentElement || !wrap) {
      return false;
    }

    const htmlTarget: HTMLElement = target as HTMLElement;
    const rect: DOMRect | undefined = htmlTarget.getBoundingClientRect?.();
    const after: boolean = rect && Number.isFinite(rect.top) ? event.clientY > rect.top + rect.height / 2 : false;
    const anchor: ChildNode | null = after ? htmlTarget.nextSibling : htmlTarget;

    if (anchor === source) {
      return false;
    }

    const siblings: HTMLElement[] = movableSiblings(source);
    const before: Map<HTMLElement, number> = measureTops(siblings);
    wrap.querySelectorAll(".pi-web-sidebar-drop-target").forEach((node: Element): void => {
      node.classList.remove("pi-web-sidebar-drop-target");
    });
    htmlTarget.parentElement?.insertBefore(source, anchor);
    htmlTarget.classList.add("pi-web-sidebar-drop-target");
    animateMovedSiblings(siblings, before);
    return true;
  }

  function moveWorkspaceNear(source: HTMLElement | null, target: Element | null, event: DragEvent): void {
    if (insertNear(source, target, event)) {
      persistWorkspaceOrder();
      sidebarBridge.emitEvent("workspace-order-preview", { ids: currentWorkspaceOrder() });
    }
  }

  function moveSessionNear(source: HTMLElement | null, target: Element | null, event: DragEvent): void {
    if (!source || !target || source.dataset.workspace !== (target as HTMLElement).dataset.workspace) {
      return;
    }

    if (insertNear(source, target, event)) {
      persistSessionOrder(source.dataset.workspace);
      sidebarBridge.emitEvent("session-order-preview", {
        workspaceId: source.dataset.workspace,
        ids: currentSessionOrder(source.dataset.workspace),
      });
    }
  }
  function currentWorkspaceOrder(): string[] {
    return [...wrap?.querySelectorAll<HTMLElement>(".workspace-group[data-workspace-group]") || []]
      .map((group: HTMLElement): string => group.dataset.workspaceGroup || "")
      .filter(Boolean);
  }

  function currentSessionOrder(workspaceId?: string): string[] {
    if (!workspaceId || !wrap) {
      return [];
    }

    const group: HTMLElement | null = wrap.querySelector(`.workspace-group[data-workspace-group='${cssEscape(workspaceId)}']`);
    return [...group?.querySelectorAll<HTMLElement>(".session-row[data-session]") || []]
      .map((row: HTMLElement): string => row.dataset.session || "")
      .filter(Boolean);
  }

  function persistWorkspaceOrder(): void {
    storeJson("pi.workspaceOrder", currentWorkspaceOrder());
  }

  function persistSessionOrder(workspaceId?: string): void {
    if (!workspaceId) {
      return;
    }

    const orders: Record<string, string[]> = readStoredObject("pi.sessionOrder");
    orders[workspaceId] = currentSessionOrder(workspaceId);
    storeJson("pi.sessionOrder", orders);
  }

  function bindFallbackDrag(panel: HTMLElement): void {
    if (panel.dataset.piWebSidebarFallbackDragBound === "true") {
      return;
    }

    panel.addEventListener("dragstart", (event: DragEvent): void => {
      const handle: HTMLElement | null = eventTarget(event)?.closest("[data-pi-web-sidebar-drag-handle]") || null;

      if (!handle) {
        return;
      }

      const workspace: HTMLElement | null = handle.closest(".workspace-group");
      const session: HTMLElement | null = handle.closest(".session-row[data-session]");

      if (session) {
        startDrag({ type: "session", element: session });
      } else if (workspace) {
        startDrag({ type: "workspace", element: workspace });
      }

      event.dataTransfer?.setData("text/plain", "pi-web-sidebar-drag");
      event.dataTransfer?.setDragImage?.(handle, 6, 6);
    });
    panel.addEventListener("dragover", (event: DragEvent): void => {
      if (draggedItem && eventTarget(event)?.closest(".workspace-group, .session-row[data-session]")) {
        event.preventDefault();
        previewDrag(eventTarget(event), event);
      }
    });
    panel.addEventListener("drop", (event: DragEvent): void => {
      event.preventDefault();
      finishDrag();
    });
    panel.addEventListener("dragend", clearDragState);
    panel.dataset.piWebSidebarFallbackDragBound = "true";
  }

  function render(nextWorkspaces?: SidebarWorkspace[]): void {
    if (Array.isArray(nextWorkspaces)) {
      workspaces = nextWorkspaces;
    }

    renderCurrentWorkspaces();
  }

  return { mount, dispose, render, refresh: refreshCurrentWorkspaces, get element(): HTMLElement | null { return wrap; } };
}

function validPluginSidebar(candidate: Element | null): HTMLElement | null {
  if (!candidate || typeof (candidate as HTMLElement).querySelector !== "function") {
    return null;
  }

  const sidebar: HTMLElement = candidate as HTMLElement;

  if (!sidebar.querySelector(".sidebar .sb-section .sb-head")) {
    sidebar.remove();
    return null;
  }

  return sidebar;
}

function eventTarget(event: Event): HTMLElement | null {
  const target: EventTarget | null = event.target;
  return target && typeof (target as Element).closest === "function" ? target as HTMLElement : null;
}
