import { BehaviorSubject, Subject } from "rxjs";
import { ACTIVE_SESSION_KEY, ACTIVE_WORKSPACE_KEY } from "./constants";
import { storeString } from "./storage";
import type {
  AppElement,
  PiStatus,
  PluginContext,
  SelectedSession,
  SidebarActionEvent,
  SidebarBridge,
  SidebarSnapshot,
  SidebarRxChannels,
  SidebarWorkspace,
  PiWebSidebarGlobal,
  SubjectLike,
} from "./types";

export function createSidebarBridge(
  app: AppElement,
  _context: PluginContext,
  getWorkspaces: () => SidebarWorkspace[],
  getElement: () => HTMLElement | null,
  refresh: () => Promise<SidebarWorkspace[]>,
): SidebarBridge {
  let latestPiStatus: PiStatus = createUnknownPiStatus();
  let latestSnapshot: SidebarSnapshot = createSidebarSnapshot(app, getWorkspaces(), getElement(), latestPiStatus);
  const channels: SidebarRxChannels = createRxChannels(latestSnapshot, latestPiStatus);
  const state$: SubjectLike<SidebarSnapshot> | undefined = globalThis.piWeb?.behaviorSubject(
    "plugin.pi-web-sidebar.state",
    latestSnapshot,
  );
  const piStatus$: SubjectLike<PiStatus> | undefined = globalThis.piWeb?.behaviorSubject(
    "plugin.pi-web-sidebar.piStatus",
    latestPiStatus,
  );
  const selectedSession$: SubjectLike<SelectedSession | null> | undefined = globalThis.piWeb?.behaviorSubject(
    "plugin.pi-web-sidebar.selectedSession",
    resolveSelectedSession(latestSnapshot),
  );
  const events$: SubjectLike<SidebarActionEvent> | undefined = globalThis.piWeb?.subject("plugin.pi-web-sidebar.event");
  const api: PiWebSidebarGlobal = {
    channels,
    getSnapshot(): SidebarSnapshot {
      return latestSnapshot;
    },
    refresh,
  };
  exposeSidebarApi(app, api);

  function publishState(reason: string): void {
    latestSnapshot = createSidebarSnapshot(app, getWorkspaces(), getElement(), latestPiStatus);
    const selected: SelectedSession | null = resolveSelectedSession(latestSnapshot);
    persistSelectedSession(selected);
    channels.state$.next(latestSnapshot);
    channels.selectedSession$.next(selected);
    state$?.next(latestSnapshot);
    selectedSession$?.next(selected);
    publishEvent(channels, events$, { type: "state", reason, snapshot: latestSnapshot, detail: selected || {} });
  }

  return {
    emitState(reason: string): void {
      publishState(reason);
    },
    emitEvent(type: string, detail: Record<string, unknown> = {}): void {
      publishEvent(channels, events$, { type, detail, snapshot: latestSnapshot });
    },
    updatePiStatus(status: PiStatus, reason: string): void {
      latestPiStatus = status;
      channels.piStatus$.next(status);
      piStatus$?.next(status);
      publishState(reason);
      publishEvent(channels, events$, { type: "pi-status", detail: { available: status.available }, snapshot: latestSnapshot });
    },
    dispose(): void {
      latestSnapshot = createSidebarSnapshot(app, getWorkspaces(), getElement(), latestPiStatus);
      channels.state$.next(latestSnapshot);
      state$?.next(latestSnapshot);
      publishEvent(channels, events$, { type: "disposed", detail: {}, snapshot: latestSnapshot });
      clearSidebarApi(app, api);
      completeRxChannels(channels);
    },
  };
}

function createSidebarSnapshot(
  app: AppElement,
  workspaces: SidebarWorkspace[],
  element: HTMLElement | null,
  piStatus: PiStatus,
): SidebarSnapshot {
  const workspaceList: SidebarWorkspace[] = Array.isArray(workspaces) ? workspaces : [];
  const sessionCount: number = workspaceList.reduce(
    (count: number, workspace: SidebarWorkspace): number => count + (workspace.sessions || []).length,
    0,
  );
  const width: number = Number(app.dataset.sidebarWidth || 280);

  return {
    activeSessionId: app.dataset.activeSessionId || readStoredString(ACTIVE_SESSION_KEY),
    activeWorkspaceId: app.dataset.activeWorkspaceId || readStoredString(ACTIVE_WORKSPACE_KEY),
    collapsed: app.dataset.sidebar === "collapsed",
    element,
    openWorkspaceId: app.sidebarOpenWorkspaceId || "",
    piStatus,
    sessionCount,
    sidebar: app.dataset.sidebar === "collapsed" ? "collapsed" : "open",
    width: Number.isFinite(width) ? width : 280,
    workspaceCount: workspaceList.length,
    workspaces: workspaceList,
  };
}

function createUnknownPiStatus(): PiStatus {
  return { available: false, checkedAt: new Date().toISOString(), error: "pi status not checked yet" };
}

function resolveSelectedSession(snapshot: SidebarSnapshot): SelectedSession | null {
  if (!snapshot.activeSessionId) {
    return null;
  }

  const workspace: SidebarWorkspace | undefined = snapshot.workspaces.find((candidate: SidebarWorkspace): boolean => {
    return (candidate.sessions || []).some((session): boolean => session.id === snapshot.activeSessionId);
  });

  return workspace ? { sessionId: snapshot.activeSessionId, workspaceId: workspace.id } : null;
}

function readStoredString(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function persistSelectedSession(selected: SelectedSession | null): void {
  if (!selected) {
    return;
  }

  storeString(ACTIVE_SESSION_KEY, selected.sessionId);
  storeString(ACTIVE_WORKSPACE_KEY, selected.workspaceId);
}

function createRxChannels(snapshot: SidebarSnapshot, piStatus: PiStatus): SidebarRxChannels {
  return {
    state$: new BehaviorSubject<SidebarSnapshot>(snapshot),
    piStatus$: new BehaviorSubject<PiStatus>(piStatus),
    selectedSession$: new BehaviorSubject<SelectedSession | null>(resolveSelectedSession(snapshot)),
    events$: new Subject<SidebarActionEvent>(),
  };
}

function exposeSidebarApi(app: AppElement, api: PiWebSidebarGlobal): void {
  globalThis.piWebSidebar = api;
  app.piWebSidebar = api;
}

function clearSidebarApi(app: AppElement, api: PiWebSidebarGlobal): void {
  if (globalThis.piWebSidebar === api) {
    delete globalThis.piWebSidebar;
  }

  if (app.piWebSidebar === api) {
    delete app.piWebSidebar;
  }
}

function publishEvent(
  channels: SidebarRxChannels,
  registry: SubjectLike<SidebarActionEvent> | undefined,
  event: SidebarActionEvent,
): void {
  channels.events$.next(event);
  registry?.next(event);
}

function completeRxChannels(channels: SidebarRxChannels): void {
  channels.state$.complete();
  channels.piStatus$.complete();
  channels.selectedSession$.complete();
  channels.events$.complete();
}
