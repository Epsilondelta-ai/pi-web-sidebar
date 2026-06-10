import { loadPiStatus, loadStoredWorkspaces, loadWorkspaces, saveWorkspaceCache, type WorkspaceHydrationStep } from "./api";
import { bindWorkspaceActions } from "./actions";
import { createSidebarBridge } from "./bridge";
import { animateMovedSiblings, canMoveSessionNear, measureTops, movableSiblings } from "./drag";
import { cssEscape, ensureSessionDragHandles, ensureWorkspaceDragHandles } from "./dom";
import { createSidebar, installFallbackDragStyles, resetHostSidebarRenderState } from "./dom";
import { applySidebarGrid, bindHeaderSidebarToggle, bindResizer, restoreSidebarLayout, routeWorkspace } from "./layout";
import { bindOpenWorkspace } from "./picker";
import { renderPluginWorkspaceList } from "./render";
import { sessionIsLive } from "./render-session-utils";
import { readStoredObject, storeJson } from "./storage";
import { ACTIVE_SESSION_KEY, ACTIVE_WORKSPACE_KEY, PLUGIN_PANEL_ATTR, WORKSPACE_CACHE_KEY } from "./constants";
import type { AppElement, DragItem, PluginContext, SidebarController, SidebarSession, SidebarWorkspace, SubscriptionLike } from "./types";

type RefreshOptions = { allowEmpty?: boolean; emptySessionsForWorkspaceId?: string };

type ActiveStatePayload = {
  active?: boolean;
  existingSessionIds?: unknown;
  sessionId?: string;
  sessionIds?: unknown;
  source?: string;
  status?: string;
  workspaceId?: string;
};

type OptimisticSidebarSession = SidebarSession & {
  optimisticExistingSessionIds?: string[];
};

type SelectedSidebarSession = {
  sessionId: string;
  workspaceId: string;
};

type ChatStreamingSessionSnapshot = {
  live?: boolean;
  status?: string;
};

const HOST_WORKSPACE_RECHECK_INTERVAL_MS = 100;
const HOST_WORKSPACE_RECHECK_MAX_ATTEMPTS = 30;
const CHAT_SESSION_STORAGE_KEY = "pi-web-chat.sessions.v1";
const CHAT_STREAMING_FAST_WATCH_LIMIT = 20;
const CHAT_STREAMING_WATCH_INTERVAL_MS = 250;
const SESSION_LIVE_RECHECK_INTERVAL_MS = 60_000;

export function createSidebarController(app: AppElement, context: PluginContext = {}): SidebarController {
  let wrap: HTMLElement | null = null;
  let draggedItem: DragItem | null = null;
  let resizeCleanup: (() => void) | undefined;
  let sidebarToggleCleanup: (() => void) | undefined;
  let sidebarSessionEventsCleanup: (() => void) | undefined;
  let pluginEventsCleanup: (() => void) | undefined;
  let chatStreamingCleanup: (() => void) | undefined;
  let mounted: boolean = false;
  let chatStreamingSessionId: string = "";
  let chatStreamingTimer: ReturnType<typeof setTimeout> | undefined;
  let chatStreamingWatchTimer: ReturnType<typeof setTimeout> | undefined;
  let sessionLiveRecheckTimer: ReturnType<typeof setTimeout> | undefined;
  let chatStreamingWatchAttempts: number = 0;
  let chatStreamingSnapshots: Record<string, ChatStreamingSessionSnapshot> = {};
  let storedStreamingSnapshots: Record<string, ChatStreamingSessionSnapshot> = {};
  let refreshSequence: number = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let hostWorkspaceRecheckTimer: ReturnType<typeof setTimeout> | undefined;
  let hostWorkspaceRecheckAttempts: number = 0;
  let channelSubscriptions: SubscriptionLike[] = [];
  let optimisticSessionsByWorkspace: Record<string, OptimisticSidebarSession[]> = {};
  let workspaceCacheSaveInFlight: boolean = false;
  let publishingActiveSessionId: boolean = false;
  let queuedWorkspaceCacheSave: SidebarWorkspace[] | undefined;
  const clearedSessionWorkspaceIds: Set<string> = new Set();
  let workspaces: SidebarWorkspace[] = initialWorkspaceList();
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

    mounted = true;
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
    bindChatStreamingObserver();
    recheckStoredSessionLiveState();
    renderCurrentWorkspaces();
    sidebarToggleCleanup?.();
    sidebarToggleCleanup = bindHeaderSidebarToggle(app);
    sidebarBridge.emitState("mounted");
    hostWorkspaceRecheckAttempts = 0;
    void refreshPiStatus();
    void refreshCurrentWorkspaces();
    scheduleHostWorkspaceRecheck(HOST_WORKSPACE_RECHECK_INTERVAL_MS);
    scheduleSessionLiveRecheck(SESSION_LIVE_RECHECK_INTERVAL_MS);
  }

  function dispose(): void {
    mounted = false;
    resetHostSidebarRenderState(app);
    resizeCleanup?.();
    resizeCleanup = undefined;
    sidebarToggleCleanup?.();
    sidebarToggleCleanup = undefined;
    sidebarSessionEventsCleanup?.();
    sidebarSessionEventsCleanup = undefined;
    pluginEventsCleanup?.();
    pluginEventsCleanup = undefined;
    chatStreamingCleanup?.();
    chatStreamingCleanup = undefined;
    chatStreamingSessionId = "";
    if (chatStreamingTimer) {
      clearTimeout(chatStreamingTimer);
      chatStreamingTimer = undefined;
    }
    if (chatStreamingWatchTimer) {
      clearTimeout(chatStreamingWatchTimer);
      chatStreamingWatchTimer = undefined;
    }
    if (sessionLiveRecheckTimer) {
      clearTimeout(sessionLiveRecheckTimer);
      sessionLiveRecheckTimer = undefined;
    }
    chatStreamingWatchAttempts = 0;
    chatStreamingSnapshots = {};
    storedStreamingSnapshots = {};
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
      applySessionCreated(
        stringValue(detail?.workspaceId),
        stringValue(detail?.sessionId),
        stringListValue(detail?.existingSessionIds),
      );
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
      globalThis.piWeb.subject("chat.input.submitted").subscribe((): void => {
        scheduleChatStreamingSync();
        scheduleRefresh();
      }),
    ];
  }

  function bindChatStreamingObserver(): void {
    if (chatStreamingCleanup) {
      return;
    }

    const win: (Window & typeof globalThis) | null = app.ownerDocument.defaultView;
    if (!win) {
      return;
    }

    let chatRoot: Element | null = null;
    let chatObserver: MutationObserver | undefined;
    let chatParentObserver: MutationObserver | undefined;
    const clearObservedChatRoot = (): void => {
      chatObserver?.disconnect();
      chatParentObserver?.disconnect();
      chatObserver = undefined;
      chatParentObserver = undefined;
      chatRoot = null;
      clearChatStreamingSession();
    };
    const clearDetachedChatRoot = (records: MutationRecord[]): boolean => {
      if (!chatRoot) {
        return false;
      }

      if (!chatRoot.isConnected) {
        clearObservedChatRoot();
        return true;
      }

      for (const record of records) {
        for (const removedNode of Array.from(record.removedNodes)) {
          if (nodeContainsChatRoot(removedNode, chatRoot)) {
            clearObservedChatRoot();
            return true;
          }
        }
      }

      return false;
    };
    const attachChatRoot = (): void => {
      const nextChatRoot: Element | null = app.querySelector("[data-plugin-chat-root]");

      if (!nextChatRoot) {
        clearObservedChatRoot();
        return;
      }

      if (nextChatRoot === chatRoot) {
        return;
      }

      chatObserver?.disconnect();
      chatParentObserver?.disconnect();
      chatRoot = nextChatRoot;
      const nextObserver: MutationObserver = new win.MutationObserver((): void => scheduleChatStreamingSync());
      const nextParentObserver: MutationObserver = new win.MutationObserver((records: MutationRecord[]): void => {
        clearDetachedChatRoot(records);
      });
      nextObserver.observe(nextChatRoot, {
        attributes: true,
        attributeFilter: ["data-streaming"],
        childList: true,
        subtree: true,
      });
      nextParentObserver.observe(nextChatRoot.parentNode || app, { childList: true });
      chatObserver = nextObserver;
      chatParentObserver = nextParentObserver;
      scheduleChatStreamingSync();
    };
    const appObserver: MutationObserver = new win.MutationObserver((records: MutationRecord[]): void => {
      clearDetachedChatRoot(records);
      attachChatRoot();
    });
    appObserver.observe(app, { childList: true, subtree: true });
    attachChatRoot();
    chatStreamingCleanup = (): void => {
      appObserver.disconnect();
      chatObserver?.disconnect();
      chatParentObserver?.disconnect();
    };
  }

  function scheduleChatStreamingSync(): void {
    if (chatStreamingTimer) {
      clearTimeout(chatStreamingTimer);
    }

    chatStreamingTimer = setTimeout((): void => {
      chatStreamingTimer = undefined;
      syncChatStreamingIndicator();
    }, 0);
  }

  function clearChatStreamingSession(): void {
    if (chatStreamingWatchTimer) {
      clearTimeout(chatStreamingWatchTimer);
      chatStreamingWatchTimer = undefined;
    }
    chatStreamingWatchAttempts = 0;

    if (!chatStreamingSessionId) {
      return;
    }

    restoreChatStreamingSession(chatStreamingSessionId);
    chatStreamingSessionId = "";
    renderCurrentWorkspaces();
  }

  function restoreChatStreamingSession(sessionId: string): void {
    const snapshot: ChatStreamingSessionSnapshot | undefined = chatStreamingSnapshots[sessionId];
    const patch: Partial<SidebarSession> = snapshot || { live: false, status: "idle" };

    workspaces = updateWorkspaceSession(workspaces, sessionId, patch);
    delete chatStreamingSnapshots[sessionId];
  }

  function markChatStreamingSession(sessionId: string): boolean {
    if (!chatStreamingSnapshots[sessionId]) {
      chatStreamingSnapshots = { ...chatStreamingSnapshots, [sessionId]: snapshotSession(workspaces, app.workspaceList || [], sessionId) };
    }

    if (chatStreamingSessionIsMarked(sessionId)) {
      return false;
    }

    workspaces = updateWorkspaceSession(workspaces, sessionId, { live: true, status: "streaming" });
    return true;
  }

  function chatStreamingSessionIsMarked(sessionId: string): boolean {
    const session: SidebarSession | undefined = findSessionById(workspaces, sessionId);
    return session?.live === true && session.status === "streaming";
  }

  function scheduleChatStreamingWatch(domStreaming: boolean): void {
    if (!domStreaming || !chatStreamingSessionId || chatStreamingWatchTimer) {
      return;
    }

    const delayMs: number = chatStreamingWatchAttempts < CHAT_STREAMING_FAST_WATCH_LIMIT
      ? 0
      : CHAT_STREAMING_WATCH_INTERVAL_MS;
    chatStreamingWatchTimer = setTimeout((): void => {
      chatStreamingWatchTimer = undefined;
      chatStreamingWatchAttempts += 1;
      syncChatStreamingIndicator();
    }, delayMs);
  }

  function scheduleSessionLiveRecheck(delayMs: number): void {
    if (sessionLiveRecheckTimer) {
      clearTimeout(sessionLiveRecheckTimer);
    }

    sessionLiveRecheckTimer = setTimeout((): void => {
      sessionLiveRecheckTimer = undefined;
      void refreshCurrentWorkspaces().finally((): void => {
        if (mounted) {
          scheduleSessionLiveRecheck(SESSION_LIVE_RECHECK_INTERVAL_MS);
        }
      });
    }, delayMs);
  }

  function recheckStoredSessionLiveState(sessionId?: string): boolean {
    const liveSessionIds: Set<string> = new Set(storedChatStreamingSessionIds());
    const targetIds: Set<string> = sessionId
      ? new Set([sessionId])
      : new Set([...liveSessionIds, ...Object.keys(storedStreamingSnapshots)]);
    let changed: boolean = false;

    for (const targetId of targetIds) {
      if (liveSessionIds.has(targetId)) {
        if (!storedStreamingSnapshots[targetId]) {
          storedStreamingSnapshots = {
            ...storedStreamingSnapshots,
            [targetId]: snapshotSession(workspaces, app.workspaceList || [], targetId),
          };
        }

        if (!chatStreamingSessionIsMarked(targetId)) {
          workspaces = updateWorkspaceSession(workspaces, targetId, { live: true, status: "streaming" });
          changed = true;
        }
      } else if (storedStreamingSnapshots[targetId]) {
        const snapshot: ChatStreamingSessionSnapshot = storedStreamingSnapshots[targetId] || { live: false, status: "idle" };
        workspaces = updateWorkspaceSession(workspaces, targetId, snapshot);
        delete storedStreamingSnapshots[targetId];
        changed = true;
      }
    }

    return changed;
  }

  function syncChatStreamingIndicator(): void {
    const storedStreamingSessionId: string = storedChatStreamingSessionId();
    const domStreaming: boolean = Array.from(app.querySelectorAll("[data-plugin-chat-root] [data-streaming='true']"))
      .some((element: Element): boolean => element.isConnected);
    const nextSessionId: string = domStreaming ? app.dataset.activeSessionId || storedStreamingSessionId : storedStreamingSessionId;
    const previousSessionId: string = chatStreamingSessionId;

    if (previousSessionId === nextSessionId) {
      if (nextSessionId) {
        const changed: boolean = markChatStreamingSession(nextSessionId);

        if (changed) {
          renderCurrentWorkspaces();
        }

        scheduleChatStreamingWatch(domStreaming);
      }

      return;
    }

    if (previousSessionId) {
      restoreChatStreamingSession(previousSessionId);
    }

    if (nextSessionId) {
      markChatStreamingSession(nextSessionId);
    }

    chatStreamingSessionId = nextSessionId;
    chatStreamingWatchAttempts = 0;
    renderCurrentWorkspaces();
    scheduleChatStreamingWatch(domStreaming);
  }

  function applyActiveSession(sessionId: string | null): void {
    if (publishingActiveSessionId && sessionId === app.dataset.activeSessionId) {
      return;
    }

    app.dataset.activeSessionId = sessionId || "";
    reconcileActiveWorkspace();
    storePersistedSelection(app.dataset.activeSessionId || "", app.dataset.activeWorkspaceId || "");
    recheckStoredSessionLiveState(app.dataset.activeSessionId || "");
    renderCurrentWorkspaces();
    syncChatStreamingIndicator();
    scheduleChatStreamingSync();
    if (sessionId) {
      void refreshCurrentWorkspaces();
    }
  }

  function setActiveSidebarSession(workspaceId: string, sessionId: string): void {
    app.dataset.activeSessionId = sessionId;
    app.dataset.activeWorkspaceId = workspaceId;
    app.sidebarOpenWorkspaceId = workspaceId;
    storePersistedSelection(sessionId, workspaceId);
    routeWorkspace(app);
    publishActiveSessionId(sessionId);
  }

  function publishActiveSessionId(sessionId: string): void {
    publishingActiveSessionId = true;
    try {
      globalThis.piWeb?.behaviorSubject<string | null>("session.activeId", sessionId).next(sessionId);
    } finally {
      publishingActiveSessionId = false;
    }
  }

  function applySessionCreated(workspaceId: string, sessionId: string, existingSessionIds: string[] = []): void {
    if (!workspaceId || !sessionId) {
      return;
    }

    clearedSessionWorkspaceIds.delete(workspaceId);
    const session: OptimisticSidebarSession = {
      id: sessionId,
      name: "New chat",
      active: false,
      optimisticExistingSessionIds: existingSessionIds,
      status: "idle",
    };
    optimisticSessionsByWorkspace = {
      ...optimisticSessionsByWorkspace,
      [workspaceId]: [session, ...(optimisticSessionsByWorkspace[workspaceId] || []).filter((item): boolean => item.id !== sessionId)],
    };
    workspaces = upsertWorkspaceSession(workspaces, workspaceId, session);
    setActiveSidebarSession(workspaceId, sessionId);
    renderCurrentWorkspaces();
    sidebarBridge.emitEvent("session.created", { sessionId, workspaceId });
    sidebarBridge.emitState("session.created");
  }

  function applyActiveStart(workspaceId: string, sessionId: string, status: string): void {
    if (!workspaceId || !sessionId) {
      return;
    }

    clearedSessionWorkspaceIds.delete(workspaceId);
    const session: SidebarSession = { id: sessionId, name: "New chat", active: true, live: true, status };
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
    const requestedSessionIds: string[] = sessionIds.length > 0 ? sessionIds : [sessionId].filter(Boolean);
    const deletedSessionIds: string[] = expandDeletedSessionIds(workspaces, workspaceId, requestedSessionIds);
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

    if (sessionId && !isOptimisticSessionId(sessionId)) {
      app.dataset.activeSessionId = "";
      storePersistedSelection("", app.dataset.activeWorkspaceId || "");
    }
  }

  function applySessionChange(change: Record<string, unknown>): void {
    const sessionId: string = stringValue(change.sessionId) || stringValue(change.id);
    const name: string = stringValue(change.name) || stringValue(change.title);
    const status: string = stringValue(change.status);
    const live: boolean | undefined = booleanValue(change.live);
    const patch: Partial<SidebarSession> = {};

    if (!sessionId) {
      return;
    }

    if (name) {
      patch.name = normalizeSessionName(name);
    }

    if (status) {
      patch.status = status;
    }

    if (live !== undefined) {
      patch.live = live;
    }

    if (Object.keys(patch).length === 0) {
      return;
    }

    if (sessionId === chatStreamingSessionId) {
      chatStreamingSnapshots = {
        ...chatStreamingSnapshots,
        [sessionId]: { ...chatStreamingSnapshots[sessionId], ...patch },
      };
    }

    workspaces = updateWorkspaceSession(workspaces, sessionId, patch);
    renderCurrentWorkspaces();
    syncChatStreamingIndicator();
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
      const storedStreamingSessionIds: Set<string> = new Set(storedChatStreamingSessionIds());
      if (
        directWorkspaces.length > 0 &&
        workspaceContentSignature(directWorkspaces, storedStreamingSessionIds) !==
          workspaceContentSignature(workspaces, storedStreamingSessionIds)
      ) {
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

  function initialWorkspaceList(): SidebarWorkspace[] {
    const cachedWorkspaces: SidebarWorkspace[] = loadStoredWorkspaces();

    if (cachedWorkspaces.length > 0) {
      return cachedWorkspaces;
    }

    return Array.isArray(context.initialWorkspaces) ? context.initialWorkspaces.filter(isSidebarWorkspace) : [];
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
      const nextWorkspaces: SidebarWorkspace[] = await loadWorkspaces(
        context,
        app,
        (hydratedWorkspaces: SidebarWorkspace[], step: WorkspaceHydrationStep): void => {
          applyHydratedWorkspaces(sequence, hydratedWorkspaces, options, step);
        },
      );

      if (sequence !== refreshSequence) {
        return workspaces;
      }

      applyHydratedWorkspaces(sequence, nextWorkspaces, options, "actual");
    } catch (error) {
      console.warn("pi-web-sidebar failed to refresh workspaces", error);
    }

    return workspaces;
  }

  function applyHydratedWorkspaces(
    sequence: number,
    nextWorkspaces: SidebarWorkspace[],
    options: RefreshOptions,
    step: WorkspaceHydrationStep,
  ): void {
    if (sequence !== refreshSequence) {
      return;
    }

    if (!options.allowEmpty && nextWorkspaces.length === 0 && workspaces.length > 0) {
      console.warn("pi-web-sidebar skipped transient empty workspace refresh");
      sidebarBridge.emitEvent("refresh-workspaces-empty-skipped", { workspaceCount: workspaces.length, step });
      return;
    }

    const refreshedWorkspaces: SidebarWorkspace[] = options.emptySessionsForWorkspaceId
      ? withoutWorkspaceSessions(nextWorkspaces, app, options.emptySessionsForWorkspaceId)
      : nextWorkspaces;
    const replacementSession: SelectedSidebarSession = actualSessionReplacingOptimistic(
      refreshedWorkspaces,
      optimisticSessionsByWorkspace,
      app.dataset.activeSessionId || "",
    );
    optimisticSessionsByWorkspace = retainOptimisticSessionsUntilActualAppears(
      optimisticSessionsByWorkspace,
      refreshedWorkspaces,
    );
    workspaces = clearWorkspaceSessionsById(
      mergeOptimisticSessions(refreshedWorkspaces, optimisticSessionsByWorkspace),
      clearedSessionWorkspaceIds,
      app,
    );
    recheckStoredSessionLiveState();
    if (chatStreamingSessionId) {
      chatStreamingSnapshots = {
        ...chatStreamingSnapshots,
        [chatStreamingSessionId]: snapshotSession(workspaces, refreshedWorkspaces, chatStreamingSessionId),
      };
    }
    if (step === "file") {
      storeJson(WORKSPACE_CACHE_KEY, { workspaces });
    }
    if (step === "actual" || clearedSessionWorkspaceIds.size > 0) {
      persistWorkspaceCache(workspaces);
    }
    if (options.emptySessionsForWorkspaceId) {
      clearedSessionWorkspaceIds.delete(options.emptySessionsForWorkspaceId);
    }
    if (replacementSession.sessionId) {
      setActiveSidebarSession(replacementSession.workspaceId, replacementSession.sessionId);
    }
    reconcileActiveWorkspace();
    renderCurrentWorkspaces();
    syncChatStreamingIndicator();
    sidebarBridge.emitEvent("refresh-workspaces", { step, workspaceCount: workspaces.length });
  }

  function persistWorkspaceCache(nextWorkspaces: SidebarWorkspace[]): void {
    storeJson(WORKSPACE_CACHE_KEY, { workspaces: nextWorkspaces });
    queuedWorkspaceCacheSave = nextWorkspaces;
    flushWorkspaceCacheSave();
  }

  function flushWorkspaceCacheSave(): void {
    if (workspaceCacheSaveInFlight || !queuedWorkspaceCacheSave) {
      return;
    }

    const nextWorkspaces: SidebarWorkspace[] = queuedWorkspaceCacheSave;
    queuedWorkspaceCacheSave = undefined;
    workspaceCacheSaveInFlight = true;
    void saveWorkspaceCache(context, nextWorkspaces)
      .catch((error: unknown): void => {
        console.warn("pi-web-sidebar failed to persist workspace cache", error);
      })
      .finally((): void => {
        workspaceCacheSaveInFlight = false;
        flushWorkspaceCacheSave();
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

  function insertNear(
    source: HTMLElement | null,
    target: Element | null,
    event: DragEvent,
    movedNodes: HTMLElement[] = [],
    targetNodes: HTMLElement[] = [],
  ): boolean {
    if (!source || !target || source === target || !target.parentElement || !wrap) {
      return false;
    }

    const htmlTarget: HTMLElement = target as HTMLElement;
    const nodesToMove: HTMLElement[] = movedNodes.length > 0 ? movedNodes : [source];
    const nodesAroundTarget: HTMLElement[] = targetNodes.length > 0 ? targetNodes : [htmlTarget];
    if (nodesToMove.includes(htmlTarget)) {
      return false;
    }

    const rect: DOMRect | undefined = htmlTarget.getBoundingClientRect?.();
    const after: boolean = rect && Number.isFinite(rect.top) ? event.clientY > rect.top + rect.height / 2 : false;
    const targetTail: HTMLElement = nodesAroundTarget[nodesAroundTarget.length - 1] || htmlTarget;
    const anchor: ChildNode | null = after ? targetTail.nextSibling : htmlTarget;

    if (anchor === source || nodesToMove.includes(anchor as HTMLElement)) {
      return false;
    }

    const siblings: HTMLElement[] = movableSiblings(source);
    const before: Map<HTMLElement, number> = measureTops(siblings);
    const fragment: DocumentFragment = document.createDocumentFragment();
    wrap.querySelectorAll(".pi-web-sidebar-drop-target").forEach((node: Element): void => {
      node.classList.remove("pi-web-sidebar-drop-target");
    });

    for (const node of nodesToMove) {
      fragment.append(node);
    }

    htmlTarget.parentElement?.insertBefore(fragment, anchor);
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
    if (!source || !target || !canMoveSessionNear(source, target as HTMLElement)) {
      return;
    }

    if (insertNear(source, target, event, sessionMoveRows(source), sessionMoveRows(target as HTMLElement))) {
      persistSessionOrder(source.dataset.workspace);
      sidebarBridge.emitEvent("session-order-preview", {
        workspaceId: source.dataset.workspace,
        ids: currentSessionOrder(source.dataset.workspace),
      });
    }
  }

  function sessionMoveRows(row: HTMLElement): HTMLElement[] {
    const workspaceId: string = row.dataset.workspace || "";
    const sessionId: string = row.dataset.session || "";
    if (!workspaceId || !sessionId || !wrap) {
      return [row];
    }

    const group: HTMLElement | null = wrap.querySelector(`.workspace-group[data-workspace-group='${cssEscape(workspaceId)}']`);
    const rows: HTMLElement[] = [...group?.querySelectorAll<HTMLElement>(".session-row[data-session]") || []];
    return rows.filter((candidate: HTMLElement): boolean => candidate === row || isDescendantSessionRow(candidate, sessionId, rows));
  }

  function isDescendantSessionRow(candidate: HTMLElement, parentSessionId: string, rows: HTMLElement[]): boolean {
    let parentId: string = candidate.dataset.parentSession || "";

    while (parentId) {
      if (parentId === parentSessionId) {
        return true;
      }

      parentId = rows.find((row: HTMLElement): boolean => row.dataset.session === parentId)?.dataset.parentSession || "";
    }

    return false;
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

function nodeContainsChatRoot(node: Node, chatRoot: Element): boolean {
  if (node === chatRoot) {
    return true;
  }

  return node instanceof Element && node.contains(chatRoot);
}

function snapshotSession(
  workspaces: SidebarWorkspace[],
  appWorkspaces: SidebarWorkspace[],
  sessionId: string,
): ChatStreamingSessionSnapshot {
  const session: SidebarSession | undefined = findSessionById(workspaces, sessionId) || findSessionById(appWorkspaces, sessionId);
  return { live: session?.live, status: session?.status };
}

function storedChatStreamingSessionId(): string {
  return storedChatStreamingSessionIds()[0] || "";
}

function storedChatStreamingSessionIds(): string[] {
  const storedChatSessions: unknown = readStoredChatSessions();

  if (!isRecord(storedChatSessions)) {
    return [];
  }

  const sessions: unknown = storedChatSessions.sessions;
  if (!Array.isArray(sessions)) {
    return [];
  }

  return sessions
    .filter((session: unknown): boolean => chatSessionIsStreaming(session))
    .map((session: unknown): string => isRecord(session) ? stringValue(session.id) : "")
    .filter((sessionId: string): boolean => sessionId !== "");
}

function readStoredChatSessions(): unknown {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(CHAT_SESSION_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function chatSessionIsStreaming(session: unknown): boolean {
  if (!isRecord(session)) {
    return false;
  }

  if (session.streaming === true || stringValue(session.status).toLowerCase() === "streaming") {
    return true;
  }

  const messages: unknown = session.messages;
  if (!Array.isArray(messages)) {
    return false;
  }

  return messages.some(chatMessageIsStreaming);
}

function chatMessageIsStreaming(message: unknown): boolean {
  if (!isRecord(message)) {
    return false;
  }

  if (message.streaming === true || stringValue(message.status).toLowerCase() === "streaming") {
    return true;
  }

  const toolCalls: unknown = message.toolCalls;
  return Array.isArray(toolCalls) && toolCalls.some((toolCall: unknown): boolean => {
    return isRecord(toolCall) && ["pending", "running", "streaming"].includes(stringValue(toolCall.status).toLowerCase());
  });
}

function findSessionById(workspaces: SidebarWorkspace[], sessionId: string): SidebarSession | undefined {
  for (const workspace of workspaces) {
    const session: SidebarSession | undefined = (workspace.sessions || []).find(
      (item: SidebarSession): boolean => item.id === sessionId,
    );

    if (session) {
      return session;
    }
  }

  return undefined;
}

function updateWorkspaceSession(
  workspaces: SidebarWorkspace[],
  sessionId: string,
  patch: Partial<SidebarSession>,
): SidebarWorkspace[] {
  return workspaces.map((workspace: SidebarWorkspace): SidebarWorkspace => {
    if (!(workspace.sessions || []).some((session: SidebarSession): boolean => session.id === sessionId)) {
      return workspace;
    }

    const sessions: SidebarSession[] = (workspace.sessions || []).map((session: SidebarSession): SidebarSession => {
      return session.id === sessionId ? { ...session, ...patch } : session;
    });

    const live: boolean = patch.status !== undefined || patch.live !== undefined
      ? workspaceHasLiveSession(sessions)
      : !!workspace.live || workspaceHasLiveSession(sessions);

    return { ...workspace, live, sessions };
  });
}

function normalizeSessionName(name: string): string {
  return name.length > 12 ? `${name.slice(0, 12)}...` : name;
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

function expandDeletedSessionIds(workspaces: SidebarWorkspace[], workspaceId: string, sessionIds: string[]): string[] {
  const deletedIds: string[] = [];
  const seenIds: Set<string> = new Set();
  const childIdsByParentId: Map<string, string[]> = childSessionIdsByParentId(workspaces, workspaceId);

  for (const sessionId of sessionIds) {
    appendDeletedSessionId(sessionId, childIdsByParentId, deletedIds, seenIds);
  }

  return deletedIds;
}

function childSessionIdsByParentId(workspaces: SidebarWorkspace[], workspaceId: string): Map<string, string[]> {
  const childIdsByParentId: Map<string, string[]> = new Map();
  const scopedWorkspaces: SidebarWorkspace[] = workspaceId
    ? workspaces.filter((workspace: SidebarWorkspace): boolean => workspace.id === workspaceId)
    : workspaces;

  for (const workspace of scopedWorkspaces) {
    for (const session of workspace.sessions || []) {
      if (session.parentId) {
        const childIds: string[] = childIdsByParentId.get(session.parentId) || [];
        childIds.push(session.id);
        childIdsByParentId.set(session.parentId, childIds);
      }
    }
  }

  return childIdsByParentId;
}

function appendDeletedSessionId(
  sessionId: string,
  childIdsByParentId: Map<string, string[]>,
  deletedIds: string[],
  seenIds: Set<string>,
): void {
  if (!sessionId || seenIds.has(sessionId)) {
    return;
  }

  seenIds.add(sessionId);
  deletedIds.push(sessionId);

  for (const childId of childIdsByParentId.get(sessionId) || []) {
    appendDeletedSessionId(childId, childIdsByParentId, deletedIds, seenIds);
  }
}

function mergeOptimisticSessions(
  workspaces: SidebarWorkspace[],
  optimisticSessionsByWorkspace: Record<string, OptimisticSidebarSession[]>,
): SidebarWorkspace[] {
  return workspaces.map((workspace: SidebarWorkspace): SidebarWorkspace => {
    const optimisticSessions: OptimisticSidebarSession[] = optimisticSessionsByWorkspace[workspace.id] || [];

    if (optimisticSessions.length === 0) {
      return workspace;
    }

    const existingIds: Set<string> = new Set((workspace.sessions || []).map((session): string => session.id));
    const missingSessions: SidebarSession[] = optimisticSessions.filter((session): boolean => !existingIds.has(session.id));
    const sessions: SidebarSession[] = [...missingSessions, ...(workspace.sessions || [])];
    return { ...workspace, live: workspaceHasLiveSession(sessions), sessionCount: sessions.length, sessions };
  });
}

function actualSessionReplacingOptimistic(
  workspaces: SidebarWorkspace[],
  optimisticSessionsByWorkspace: Record<string, OptimisticSidebarSession[]>,
  activeSessionId: string,
): SelectedSidebarSession {
  if (!activeSessionId) {
    return { sessionId: "", workspaceId: "" };
  }

  for (const workspace of workspaces) {
    const optimisticSession: OptimisticSidebarSession | undefined = (optimisticSessionsByWorkspace[workspace.id] || [])
      .find((session: OptimisticSidebarSession): boolean => session.id === activeSessionId);
    if (!optimisticSession) {
      continue;
    }

    const existingSessionIds: Set<string> = new Set(optimisticSession.optimisticExistingSessionIds || []);
    const actualSession: SidebarSession | undefined = (workspace.sessions || [])
      .find((session: SidebarSession): boolean => {
        return !existingSessionIds.has(session.id) && !isOptimisticSessionId(session.id);
      });
    return { sessionId: actualSession?.id || "", workspaceId: actualSession ? workspace.id : "" };
  }

  return { sessionId: "", workspaceId: "" };
}

function retainOptimisticSessionsUntilActualAppears(
  optimisticSessionsByWorkspace: Record<string, OptimisticSidebarSession[]>,
  workspaces: SidebarWorkspace[],
): Record<string, OptimisticSidebarSession[]> {
  const workspacesById: Map<string, SidebarWorkspace> = new Map(
    workspaces.map((workspace: SidebarWorkspace): [string, SidebarWorkspace] => [workspace.id, workspace]),
  );
  const next: Record<string, OptimisticSidebarSession[]> = {};

  for (const [workspaceId, sessions] of Object.entries(optimisticSessionsByWorkspace)) {
    const workspace: SidebarWorkspace | undefined = workspacesById.get(workspaceId);
    if (!workspace) {
      continue;
    }

    const remainingSessions: OptimisticSidebarSession[] = sessions.filter((session: OptimisticSidebarSession): boolean => {
      return shouldRetainOptimisticSession(session, workspace.sessions || []);
    });

    if (remainingSessions.length > 0) {
      next[workspaceId] = remainingSessions;
    }
  }

  return next;
}

function shouldRetainOptimisticSession(session: OptimisticSidebarSession, actualSessions: SidebarSession[]): boolean {
  const nonOptimisticSessions: SidebarSession[] = actualSessions.filter((actualSession: SidebarSession): boolean => {
    return !isOptimisticSessionId(actualSession.id);
  });
  const existingSessionIds: Set<string> = new Set(session.optimisticExistingSessionIds || []);
  return nonOptimisticSessions.every((actualSession: SidebarSession): boolean => existingSessionIds.has(actualSession.id));
}

function removeOptimisticSession(
  optimisticSessionsByWorkspace: Record<string, OptimisticSidebarSession[]>,
  sessionId: string,
): Record<string, OptimisticSidebarSession[]> {
  const next: Record<string, OptimisticSidebarSession[]> = {};

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
  return sessions.some(sessionIsLive);
}

function workspaceContentSignature(
  workspaces: SidebarWorkspace[],
  ignoredStatusSessionIds: Set<string> = new Set(),
): string {
  return workspaces.map((workspace: SidebarWorkspace): string => {
    const sessions: string = (workspace.sessions || []).map((session: SidebarSession): string => {
      const status: string = ignoredStatusSessionIds.has(session.id) ? "" : session.status || "";
      return [session.id, session.name || "", status, session.kind || ""].join("/");
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

function isOptimisticSessionId(sessionId: string): boolean {
  return sessionId.startsWith("optimistic-");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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
