import { loadPiStatus, loadWorkspaces, saveWorkspaceCache } from "./api";
import { bindWorkspaceActions } from "./actions";
import { createSidebarBridge } from "./bridge";
import { animateMovedSiblings, measureTops, movableSiblings } from "./drag";
import { cssEscape, ensureSessionDragHandles, ensureWorkspaceDragHandles } from "./dom";
import { createSidebar, installFallbackDragStyles, resetHostSidebarRenderState } from "./dom";
import { applySidebarGrid, bindHeaderSidebarToggle, bindResizer, restoreSidebarLayout } from "./layout";
import { bindOpenWorkspace } from "./picker";
import { renderPluginWorkspaceList } from "./render";
import { readStoredObject, storeJson } from "./storage";
import { ACTIVE_SESSION_KEY, ACTIVE_WORKSPACE_KEY, PLUGIN_PANEL_ATTR, WORKSPACE_CACHE_KEY } from "./constants";
import type { AppElement, DragItem, PluginContext, SidebarController, SidebarSession, SidebarWorkspace, SubscriptionLike } from "./types";

type RefreshOptions = { allowEmpty?: boolean; emptySessionsForWorkspaceId?: string };

type ActiveStatePayload = {
  active?: boolean;
  sessionId?: string;
  sessionIds?: unknown;
  source?: string;
  status?: string;
  workspaceId?: string;
};

const HOST_WORKSPACE_RECHECK_INTERVAL_MS = 100;
const HOST_WORKSPACE_RECHECK_MAX_ATTEMPTS = 30;

export function createSidebarController(app: AppElement, context: PluginContext = {}): SidebarController {
  let wrap: HTMLElement | null = null;
  let draggedItem: DragItem | null = null;
  let resizeCleanup: (() => void) | undefined;
  let sidebarToggleCleanup: (() => void) | undefined;
  let sidebarSessionEventsCleanup: (() => void) | undefined;
  let pluginEventsCleanup: (() => void) | undefined;
  let refreshSequence: number = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let hostWorkspaceRecheckTimer: ReturnType<typeof setTimeout> | undefined;
  let hostWorkspaceRecheckAttempts: number = 0;
  let channelSubscriptions: SubscriptionLike[] = [];
  let optimisticSessionsByWorkspace: Record<string, SidebarSession[]> = {};
  const clearedSessionWorkspaceIds: Set<string> = new Set();
  let workspaces: SidebarWorkspace[] = Array.isArray(context.initialWorkspaces) ? context.initialWorkspaces : [];
  const sidebarBridge = createSidebarBridge(app, context, () => workspaces, () => wrap, () => refreshCurrentWorkspaces());

  function mount(): void {
    const body: HTMLElement | null = app.querySelector(".app-body");

    installFallbackDragStyles();

    if (!body) {
      throw new Error("pi-web-sidebar requires .app-body");
    }

    wrap = validPluginSidebar(app.querySelector(`[${PLUGIN_PANEL_ATTR}]`)) || createSidebar();
    if (!wrap.isConnected) {
      body.insertBefore(wrap, body.firstElementChild);
    }

    bindMountedSidebar();
  }

  function bindMountedSidebar(): void {
    if (!wrap) {
      return;
    }

    app.dataset.sidebar = app.dataset.sidebar || "open";
    restorePersistedSelection();
    restoreSidebarLayout(app);
    resizeCleanup = bindResizer(wrap, app, sidebarBridge);
    bindOpenWorkspace(wrap, app, context, refreshCurrentWorkspaces);
    bindFallbackDrag(wrap);
    bindWorkspaceActions(wrap, app, context, refreshCurrentWorkspaces, sidebarBridge);
    bindSidebarSessionEvents();
    bindPluginEventChannels();
    bindPiWebChannels();
    renderCurrentWorkspaces();
    sidebarToggleCleanup?.();
    sidebarToggleCleanup = bindHeaderSidebarToggle(app);
    sidebarBridge.emitState("mounted");
    hostWorkspaceRecheckAttempts = 0;
    void refreshPiStatus();
    void refreshCurrentWorkspaces();
    scheduleHostWorkspaceRecheck(HOST_WORKSPACE_RECHECK_INTERVAL_MS);
  }

  function dispose(): void {
    resetHostSidebarRenderState(app);
    resizeCleanup?.();
    resizeCleanup = undefined;
    sidebarToggleCleanup?.();
    sidebarToggleCleanup = undefined;
    sidebarSessionEventsCleanup?.();
    sidebarSessionEventsCleanup = undefined;
    pluginEventsCleanup?.();
    pluginEventsCleanup = undefined;
    channelSubscriptions.forEach((subscription: SubscriptionLike): void => subscription.unsubscribe());
    channelSubscriptions = [];
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
    }
    clearHostWorkspaceRecheck();
    app.querySelector("[data-pi-web-sidebar-picker]")?.remove();
    wrap?.remove();

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

  function restorePersistedSelection(): void {
    app.dataset.activeSessionId = app.dataset.activeSessionId || localStorage.getItem(ACTIVE_SESSION_KEY) || "";
    app.dataset.activeWorkspaceId = app.dataset.activeWorkspaceId || localStorage.getItem(ACTIVE_WORKSPACE_KEY) || "";
  }

  function bindSidebarSessionEvents(): void {
    if (sidebarSessionEventsCleanup) {
      return;
    }

    const handleCreated = (event: Event): void => {
      const detail: ActiveStatePayload | undefined = (event as CustomEvent<ActiveStatePayload>).detail;
      applySessionCreated(stringValue(detail?.workspaceId), stringValue(detail?.sessionId));
    };
    const handleDeleted = (event: Event): void => {
      const detail: ActiveStatePayload | undefined = (event as CustomEvent<ActiveStatePayload>).detail;
      applyActiveEnd(stringValue(detail?.workspaceId), stringValue(detail?.sessionId), stringListValue(detail?.sessionIds));
    };
    const handleWorkspaceCleared = (event: Event): void => {
      const detail: ActiveStatePayload | undefined = (event as CustomEvent<ActiveStatePayload>).detail;
      applyWorkspaceSessionsCleared(stringValue(detail?.workspaceId));
    };

    app.addEventListener("pi-web-sidebar:session-created", handleCreated);
    app.addEventListener("pi-web-sidebar:session-deleted", handleDeleted);
    app.addEventListener("pi-web-sidebar:workspace-sessions-cleared", handleWorkspaceCleared);
    sidebarSessionEventsCleanup = (): void => {
      app.removeEventListener("pi-web-sidebar:session-created", handleCreated);
      app.removeEventListener("pi-web-sidebar:session-deleted", handleDeleted);
      app.removeEventListener("pi-web-sidebar:workspace-sessions-cleared", handleWorkspaceCleared);
    };
  }

  function bindPluginEventChannels(): void {
    if (pluginEventsCleanup || !context.events) {
      return;
    }

    pluginEventsCleanup = context.events.subscribe("active-state", ["active.start", "active.end"], (event): void => {
      const payload: ActiveStatePayload | undefined = isRecord(event.payload) ? event.payload as ActiveStatePayload : undefined;

      if (event.type === "active.start") {
        applyActiveStart(stringValue(payload?.workspaceId), stringValue(payload?.sessionId), stringValue(payload?.status) || "active");
      }

      if (event.type === "active.end") {
        applyActiveEnd(stringValue(payload?.workspaceId), stringValue(payload?.sessionId), stringListValue(payload?.sessionIds));
      }
    });
  }

  function bindPiWebChannels(): void {
    if (channelSubscriptions.length > 0 || !globalThis.piWeb) {
      return;
    }

    channelSubscriptions = [
      globalThis.piWeb.behaviorSubject<string | null>("session.activeId", app.dataset.activeSessionId || null)
        .subscribe((sessionId: string | null): void => applyActiveSession(sessionId)),
      globalThis.piWeb.subject<Record<string, unknown>>("session.changed")
        .subscribe((change: Record<string, unknown>): void => applySessionChange(change)),
      globalThis.piWeb.subject("chat.input.submitted").subscribe((): void => scheduleRefresh()),
    ];
  }

  function applyActiveSession(sessionId: string | null): void {
    app.dataset.activeSessionId = sessionId || "";
    reconcileActiveWorkspace();
    storePersistedSelection(app.dataset.activeSessionId || "", app.dataset.activeWorkspaceId || "");
    renderCurrentWorkspaces();
  }

  function applySessionCreated(workspaceId: string, sessionId: string): void {
    if (!workspaceId || !sessionId) {
      return;
    }

    clearedSessionWorkspaceIds.delete(workspaceId);
    const session: SidebarSession = { id: sessionId, title: "New chat", active: false, status: "idle" };
    optimisticSessionsByWorkspace = {
      ...optimisticSessionsByWorkspace,
      [workspaceId]: [session, ...(optimisticSessionsByWorkspace[workspaceId] || []).filter((item): boolean => item.id !== sessionId)],
    };
    workspaces = upsertWorkspaceSession(workspaces, workspaceId, session);
    app.dataset.activeSessionId = sessionId;
    app.dataset.activeWorkspaceId = workspaceId;
    app.sidebarOpenWorkspaceId = workspaceId;
    storePersistedSelection(sessionId, workspaceId);
    globalThis.piWeb?.behaviorSubject<string | null>("session.activeId", sessionId).next(sessionId);
    renderCurrentWorkspaces();
    sidebarBridge.emitEvent("session.created", { sessionId, workspaceId });
    sidebarBridge.emitState("session.created");
  }

  function applyActiveStart(workspaceId: string, sessionId: string, status: string): void {
    if (!workspaceId || !sessionId) {
      return;
    }

    clearedSessionWorkspaceIds.delete(workspaceId);
    const session: SidebarSession = { id: sessionId, title: "New chat", active: true, status };
    optimisticSessionsByWorkspace = {
      ...optimisticSessionsByWorkspace,
      [workspaceId]: [session, ...(optimisticSessionsByWorkspace[workspaceId] || []).filter((item): boolean => item.id !== sessionId)],
    };
    workspaces = upsertWorkspaceSession(workspaces, workspaceId, session);
    app.dataset.activeSessionId = sessionId;
    app.dataset.activeWorkspaceId = workspaceId;
    app.sidebarOpenWorkspaceId = workspaceId;
    storePersistedSelection(sessionId, workspaceId);
    globalThis.piWeb?.behaviorSubject<string | null>("session.activeId", sessionId).next(sessionId);
    renderCurrentWorkspaces();
    sidebarBridge.emitEvent("active.start", { sessionId, workspaceId });
    sidebarBridge.emitState("active.start");
  }

  function applyActiveEnd(workspaceId: string, sessionId: string, sessionIds: string[] = []): void {
    const deletedSessionIds: string[] = sessionIds.length > 0 ? sessionIds : [sessionId].filter(Boolean);
    if (deletedSessionIds.length === 0) {
      return;
    }

    for (const deletedSessionId of deletedSessionIds) {
      optimisticSessionsByWorkspace = removeOptimisticSession(optimisticSessionsByWorkspace, deletedSessionId);
      workspaces = removeWorkspaceSession(workspaces, workspaceId, deletedSessionId);
    }

    if (deletedSessionIds.includes(app.dataset.activeSessionId || "")) {
      app.dataset.activeSessionId = "";
      storePersistedSelection("", app.dataset.activeWorkspaceId || "");
      globalThis.piWeb?.behaviorSubject<string | null>("session.activeId", null).next(null);
    }

    renderCurrentWorkspaces();
    sidebarBridge.emitEvent("active.end", { sessionId, sessionIds: deletedSessionIds, workspaceId });
    sidebarBridge.emitState("active.end");
  }

  function applyWorkspaceSessionsCleared(workspaceId: string): void {
    if (!workspaceId) {
      return;
    }

    clearedSessionWorkspaceIds.add(workspaceId);
    optimisticSessionsByWorkspace = { ...optimisticSessionsByWorkspace, [workspaceId]: [] };
    workspaces = withoutWorkspaceSessions(workspaces, app, workspaceId);
    app.workspaceList = withoutWorkspaceSessions(app.workspaceList || [], app, workspaceId);
    persistWorkspaceCache(workspaces);
    renderCurrentWorkspaces();
  }

  function reconcileActiveWorkspace(): void {
    const sessionId: string = app.dataset.activeSessionId || "";
    const workspaceId: string = findWorkspaceIdForSession(workspaces, sessionId);

    if (workspaceId) {
      app.dataset.activeWorkspaceId = workspaceId;
      storePersistedSelection(sessionId, workspaceId);
      return;
    }

    if (sessionId) {
      app.dataset.activeSessionId = "";
      storePersistedSelection("", app.dataset.activeWorkspaceId || "");
    }
  }

  function applySessionChange(change: Record<string, unknown>): void {
    const sessionId: string = stringValue(change.sessionId) || stringValue(change.id);
    const title: string = stringValue(change.title) || stringValue(change.name);

    if (!sessionId || !title) {
      return;
    }

    workspaces = renameWorkspaceSession(workspaces, sessionId, title);
    renderCurrentWorkspaces();
  }

  function scheduleRefresh(delayMs: number = 50): void {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout((): void => {
      refreshTimer = undefined;
      void refreshCurrentWorkspaces();
    }, delayMs);
  }

  function scheduleHostWorkspaceRecheck(delayMs: number): void {
    if (hostWorkspaceRecheckTimer) {
      clearTimeout(hostWorkspaceRecheckTimer);
    }

    hostWorkspaceRecheckTimer = setTimeout((): void => {
      hostWorkspaceRecheckTimer = undefined;

      if (!wrap) {
        return;
      }

      const directWorkspaces: SidebarWorkspace[] = directWorkspaceList();
      if (directWorkspaces.length > 0 && workspaceContentSignature(directWorkspaces) !== workspaceContentSignature(workspaces)) {
        hostWorkspaceRecheckAttempts = 0;
        void refreshCurrentWorkspaces();
      }

      if (hostWorkspaceRecheckAttempts < HOST_WORKSPACE_RECHECK_MAX_ATTEMPTS) {
        hostWorkspaceRecheckAttempts += 1;
        scheduleHostWorkspaceRecheck(HOST_WORKSPACE_RECHECK_INTERVAL_MS);
      }
    }, delayMs);
  }

  function clearHostWorkspaceRecheck(): void {
    if (hostWorkspaceRecheckTimer) {
      clearTimeout(hostWorkspaceRecheckTimer);
      hostWorkspaceRecheckTimer = undefined;
    }
  }

  function directWorkspaceList(): SidebarWorkspace[] {
    const source: unknown = Array.isArray(app.workspaceList) ? app.workspaceList : context.initialWorkspaces;
    return Array.isArray(source) ? source.filter(isSidebarWorkspace) : [];
  }

  async function refreshPiStatus(): Promise<void> {
    try {
      sidebarBridge.updatePiStatus(await loadPiStatus(context), "pi-status");
    } catch (error) {
      sidebarBridge.updatePiStatus({ available: false, checkedAt: new Date().toISOString(), error: String(error) }, "pi-status");
    }
  }

  async function refreshCurrentWorkspaces(options: RefreshOptions = {}): Promise<SidebarWorkspace[]> {
    const sequence: number = ++refreshSequence;

    if (options.emptySessionsForWorkspaceId) {
      workspaces = withoutWorkspaceSessions(workspaces, app, options.emptySessionsForWorkspaceId);
      renderCurrentWorkspaces();
    }

    try {
      const nextWorkspaces: SidebarWorkspace[] = await loadWorkspaces(context, app);

      if (sequence !== refreshSequence) {
        return workspaces;
      }

      if (!options.allowEmpty && nextWorkspaces.length === 0 && workspaces.length > 0) {
        console.warn("pi-web-sidebar skipped transient empty workspace refresh");
        sidebarBridge.emitEvent("refresh-workspaces-empty-skipped", { workspaceCount: workspaces.length });
        return workspaces;
      }

      const refreshedWorkspaces: SidebarWorkspace[] = options.emptySessionsForWorkspaceId
        ? withoutWorkspaceSessions(nextWorkspaces, app, options.emptySessionsForWorkspaceId)
        : nextWorkspaces;
      workspaces = clearWorkspaceSessionsById(
        mergeOptimisticSessions(refreshedWorkspaces, optimisticSessionsByWorkspace),
        clearedSessionWorkspaceIds,
        app,
      );
      if (clearedSessionWorkspaceIds.size > 0) {
        persistWorkspaceCache(workspaces);
      }
      if (options.emptySessionsForWorkspaceId) {
        clearedSessionWorkspaceIds.delete(options.emptySessionsForWorkspaceId);
      }
      reconcileActiveWorkspace();
      renderCurrentWorkspaces();
      sidebarBridge.emitEvent("refresh-workspaces", { workspaceCount: workspaces.length });
    } catch (error) {
      console.warn("pi-web-sidebar failed to refresh workspaces", error);
    }

    return workspaces;
  }

  function persistWorkspaceCache(nextWorkspaces: SidebarWorkspace[]): void {
    storeJson(WORKSPACE_CACHE_KEY, { workspaces: nextWorkspaces });
    void saveWorkspaceCache(context, nextWorkspaces).catch((error: unknown): void => {
      console.warn("pi-web-sidebar failed to persist workspace cache", error);
    });
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

function clearWorkspaceSessionsById(
  workspaces: SidebarWorkspace[],
  workspaceIds: Set<string>,
  app: AppElement,
): SidebarWorkspace[] {
  if (workspaceIds.size === 0) {
    return workspaces;
  }

  return workspaces.reduce((nextWorkspaces: SidebarWorkspace[], workspace: SidebarWorkspace): SidebarWorkspace[] => {
    return workspaceIds.has(workspace.id) ? withoutWorkspaceSessions(nextWorkspaces, app, workspace.id) : nextWorkspaces;
  }, workspaces);
}

function withoutWorkspaceSessions(
  workspaces: SidebarWorkspace[],
  app: AppElement,
  workspaceId: string,
): SidebarWorkspace[] {
  let activeSessionCleared: boolean = false;
  const nextWorkspaces: SidebarWorkspace[] = workspaces.map((workspace: SidebarWorkspace): SidebarWorkspace => {
    if (workspace.id !== workspaceId) {
      return workspace;
    }

    activeSessionCleared = (workspace.sessions || []).some(
      (session: SidebarSession): boolean => session.id === app.dataset.activeSessionId,
    );
    return { ...workspace, sessions: [], sessionCount: 0, live: false };
  });

  if (activeSessionCleared) {
    app.dataset.activeSessionId = "";
  }

  return nextWorkspaces;
}

function renameWorkspaceSession(workspaces: SidebarWorkspace[], sessionId: string, title: string): SidebarWorkspace[] {
  return workspaces.map((workspace: SidebarWorkspace): SidebarWorkspace => ({
    ...workspace,
    sessions: (workspace.sessions || []).map((session: SidebarSession): SidebarSession => {
      return session.id === sessionId ? { ...session, title: normalizeSessionTitle(title), name: normalizeSessionTitle(title) } : session;
    }),
  }));
}

function normalizeSessionTitle(title: string): string {
  return title.length > 12 ? `${title.slice(0, 12)}...` : title;
}

function findWorkspaceIdForSession(workspaces: SidebarWorkspace[], sessionId: string): string {
  return workspaces.find((workspace: SidebarWorkspace): boolean => {
    return (workspace.sessions || []).some((session: SidebarSession): boolean => session.id === sessionId);
  })?.id || "";
}

function upsertWorkspaceSession(workspaces: SidebarWorkspace[], workspaceId: string, session: SidebarSession): SidebarWorkspace[] {
  const liveSessionId: string = workspaceHasLiveSession([{ ...session, status: session.status || "" }]) ? session.id : "";
  return workspaces.map((workspace: SidebarWorkspace): SidebarWorkspace => {
    if (workspace.id !== workspaceId) {
      return { ...workspace, sessions: markSessionListActive(workspace.sessions || [], liveSessionId) };
    }

    const existingSessions: SidebarSession[] = (workspace.sessions || []).filter((item): boolean => item.id !== session.id);
    const sessions: SidebarSession[] = [session, ...markSessionListActive(existingSessions, "")];
    return { ...workspace, live: workspaceHasLiveSession(sessions), sessionCount: sessions.length, sessions };
  });
}

function removeWorkspaceSession(workspaces: SidebarWorkspace[], workspaceId: string, sessionId: string): SidebarWorkspace[] {
  return workspaces.map((workspace: SidebarWorkspace): SidebarWorkspace => {
    if (workspaceId && workspace.id !== workspaceId) {
      return workspace;
    }

    const sessions: SidebarSession[] = (workspace.sessions || []).filter((session): boolean => session.id !== sessionId);
    return { ...workspace, live: workspaceHasLiveSession(sessions), sessionCount: sessions.length, sessions };
  });
}

function mergeOptimisticSessions(
  workspaces: SidebarWorkspace[],
  optimisticSessionsByWorkspace: Record<string, SidebarSession[]>,
): SidebarWorkspace[] {
  return workspaces.map((workspace: SidebarWorkspace): SidebarWorkspace => {
    const optimisticSessions: SidebarSession[] = optimisticSessionsByWorkspace[workspace.id] || [];

    if (optimisticSessions.length === 0) {
      return workspace;
    }

    const existingIds: Set<string> = new Set((workspace.sessions || []).map((session): string => session.id));
    const missingSessions: SidebarSession[] = optimisticSessions.filter((session): boolean => !existingIds.has(session.id));
    const sessions: SidebarSession[] = [...missingSessions, ...(workspace.sessions || [])];
    return { ...workspace, live: workspaceHasLiveSession(sessions), sessionCount: sessions.length, sessions };
  });
}

function removeOptimisticSession(
  optimisticSessionsByWorkspace: Record<string, SidebarSession[]>,
  sessionId: string,
): Record<string, SidebarSession[]> {
  const next: Record<string, SidebarSession[]> = {};

  for (const [workspaceId, sessions] of Object.entries(optimisticSessionsByWorkspace)) {
    const remainingSessions: SidebarSession[] = sessions.filter((session): boolean => session.id !== sessionId);

    if (remainingSessions.length > 0) {
      next[workspaceId] = remainingSessions;
    }
  }

  return next;
}

function markSessionListActive(sessions: SidebarSession[], activeSessionId: string): SidebarSession[] {
  return sessions.map((session): SidebarSession => {
    return { ...session, active: !!activeSessionId && session.id === activeSessionId };
  });
}

function workspaceHasLiveSession(sessions: SidebarSession[]): boolean {
  return sessions.some((session): boolean => {
    const status: string = (session.status || "").toLowerCase();

    if (session.unreadCompleted || ["complete", "completed", "done", "failed", "success"].includes(status)) {
      return false;
    }

    return !!(session.active || session.live || ["active", "live", "running", "thinking"].includes(status));
  });
}

function workspaceContentSignature(workspaces: SidebarWorkspace[]): string {
  return workspaces.map((workspace: SidebarWorkspace): string => {
    const sessions: string = (workspace.sessions || []).map((session: SidebarSession): string => {
      return [session.id, session.title || "", session.name || "", session.status || "", session.kind || ""].join("/");
    }).join(",");

    return [workspace.id, workspace.name || "", workspace.path || "", workspace.sessionCount || 0, sessions].join(":");
  }).join("|");
}

function storePersistedSelection(sessionId: string, workspaceId: string): void {
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
  } catch {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringListValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item: unknown): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSidebarWorkspace(value: unknown): value is SidebarWorkspace {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string";
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
