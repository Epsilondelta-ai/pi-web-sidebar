import { ACTIVE_SESSION_KEY, ACTIVE_WORKSPACE_KEY } from "./constants";
import { storeString } from "./storage";
import type {
  AppElement,
  PluginContext,
  SelectedSession,
  SidebarActionEvent,
  SidebarBridge,
  SidebarSnapshot,
  SidebarWorkspace,
  SubjectLike,
} from "./types";

export const NOOP_SIDEBAR_BRIDGE: SidebarBridge = {
  emitState: (_reason: string): void => undefined,
  emitEvent: (_type: string, _detail: Record<string, unknown> = {}): void => undefined,
  dispose: (): void => undefined,
};

export function createSidebarBridge(
  app: AppElement,
  context: PluginContext,
  getWorkspaces: () => SidebarWorkspace[],
  getElement: () => HTMLElement | null,
  refresh: () => Promise<SidebarWorkspace[]>,
): SidebarBridge {
  let latestSnapshot: SidebarSnapshot = createSidebarSnapshot(app, getWorkspaces(), getElement());
  const state$ = behaviorSubject<SidebarSnapshot>("plugin.pi-web-sidebar.state", latestSnapshot, context);
  const selectedSession$ = behaviorSubject<SelectedSession | null>(
    "plugin.pi-web-sidebar.selectedSession",
    resolveSelectedSession(latestSnapshot),
    context,
  );
  const events$ = subject<SidebarActionEvent>("plugin.pi-web-sidebar.event", context);
  const api = {
    state$,
    selectedSession$,
    events$,
    refresh,
    getSnapshot: (): SidebarSnapshot => latestSnapshot,
  };
  app.piWebSidebar = api;

  return {
    emitState(reason: string): void {
      latestSnapshot = createSidebarSnapshot(app, getWorkspaces(), getElement());
      const selected: SelectedSession | null = resolveSelectedSession(latestSnapshot);
      persistSelectedSession(selected);
      state$.next(latestSnapshot);
      selectedSession$.next(selected);
      events$.next({ type: "state", reason, snapshot: latestSnapshot, detail: selected || {} });
    },
    emitEvent(type: string, detail: Record<string, unknown> = {}): void {
      events$.next({ type, detail, snapshot: latestSnapshot });
    },
    dispose(): void {
      events$.next({ type: "disposed", detail: {}, snapshot: latestSnapshot });
      state$.complete();
      selectedSession$.complete();
      events$.complete();

      if (app.piWebSidebar === api) {
        delete app.piWebSidebar;
      }
    },
  };
}

function behaviorSubject<T>(name: string, initialValue: T, context: PluginContext): SubjectLike<T> {
  if (globalThis.piWeb) {
    return globalThis.piWeb.behaviorSubject(name, initialValue);
  }

  if (typeof context.rxjs?.BehaviorSubject === "function") {
    return new context.rxjs.BehaviorSubject<T>(initialValue);
  }

  return new LocalSubject<T>(initialValue);
}

function subject<T>(name: string, context: PluginContext): SubjectLike<T> {
  if (globalThis.piWeb) {
    return globalThis.piWeb.subject(name);
  }

  if (typeof context.rxjs?.Subject === "function") {
    return new context.rxjs.Subject<T>();
  }

  return new LocalSubject<T>();
}

function createSidebarSnapshot(
  app: AppElement,
  workspaces: SidebarWorkspace[],
  element: HTMLElement | null,
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
    sessionCount,
    sidebar: app.dataset.sidebar === "collapsed" ? "collapsed" : "open",
    width: Number.isFinite(width) ? width : 280,
    workspaceCount: workspaceList.length,
    workspaces: workspaceList,
  };
}

function resolveSelectedSession(snapshot: SidebarSnapshot): SelectedSession | null {
  if (!snapshot.activeSessionId) {
    return null;
  }

  const workspace = snapshot.workspaces.find((candidate: SidebarWorkspace): boolean => {
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

class LocalSubject<T> implements SubjectLike<T> {
  private subscribers: ((value: T) => void)[] = [];
  private value: T | undefined;

  constructor(initialValue?: T) {
    this.value = initialValue;
  }

  subscribe(callback: (value: T) => void): { unsubscribe(): void } {
    this.subscribers.push(callback);

    if (this.value !== undefined) {
      callback(this.value);
    }

    return { unsubscribe: (): void => { this.subscribers = this.subscribers.filter((item) => item !== callback); } };
  }

  next(value: T): void {
    this.value = value;
    this.subscribers.forEach((callback: (nextValue: T) => void): void => callback(value));
  }

  complete(): void {
    this.subscribers = [];
  }
}
