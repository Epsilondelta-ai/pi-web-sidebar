import type { AppElement, PluginContext, SidebarActionEvent, SidebarBridge, SidebarSnapshot, SidebarWorkspace } from "./types";

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
  const rxjs = context.rxjs;

  if (typeof rxjs?.BehaviorSubject !== "function" || typeof rxjs?.Subject !== "function") {
    return NOOP_SIDEBAR_BRIDGE;
  }

  let latestSnapshot: SidebarSnapshot = createSidebarSnapshot(app, getWorkspaces(), getElement());
  const state$ = new rxjs.BehaviorSubject<SidebarSnapshot>(latestSnapshot);
  const events$ = new rxjs.Subject<SidebarActionEvent>();
  const api = {
    state$,
    events$,
    refresh,
    getSnapshot: (): SidebarSnapshot => latestSnapshot,
  };
  app.piWebSidebar = api;

  return {
    emitState(reason: string): void {
      latestSnapshot = createSidebarSnapshot(app, getWorkspaces(), getElement());
      state$.next(latestSnapshot);
      events$.next({ type: "state", reason, snapshot: latestSnapshot });
    },
    emitEvent(type: string, detail: Record<string, unknown> = {}): void {
      events$.next({ type, detail, snapshot: latestSnapshot });
    },
    dispose(): void {
      events$.next({ type: "disposed", detail: {}, snapshot: latestSnapshot });
      state$.complete();
      events$.complete();

      if (app.piWebSidebar === api) {
        delete app.piWebSidebar;
      }
    },
  };
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
    activeSessionId: app.dataset.activeSessionId || "",
    activeWorkspaceId: app.dataset.activeWorkspaceId || "",
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
