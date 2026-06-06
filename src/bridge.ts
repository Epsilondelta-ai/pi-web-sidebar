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

export function createSidebarBridge(
  app: AppElement,
  _context: PluginContext,
  getWorkspaces: () => SidebarWorkspace[],
  getElement: () => HTMLElement | null,
  _refresh: () => Promise<SidebarWorkspace[]>,
): SidebarBridge {
  if (!globalThis.piWeb) {
    throw new Error("pi-web-sidebar requires globalThis.piWeb");
  }

  let latestSnapshot: SidebarSnapshot = createSidebarSnapshot(app, getWorkspaces(), getElement());
  const state$: SubjectLike<SidebarSnapshot> = globalThis.piWeb.behaviorSubject("plugin.pi-web-sidebar.state", latestSnapshot);
  const selectedSession$: SubjectLike<SelectedSession | null> = globalThis.piWeb.behaviorSubject(
    "plugin.pi-web-sidebar.selectedSession",
    resolveSelectedSession(latestSnapshot),
  );
  const events$: SubjectLike<SidebarActionEvent> = globalThis.piWeb.subject("plugin.pi-web-sidebar.event");

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
