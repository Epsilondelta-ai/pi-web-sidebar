import {
  createWorkspaceSession,
  deleteSessionList,
  deleteWorkspaceById,
  deleteWorkspaceSessionList,
  renameSessionById,
} from "./api";
import { ACTIVE_SESSION_KEY, ACTIVE_WORKSPACE_KEY, PLUGIN_PANEL_ATTR } from "./constants";
import { collapseSidebarLayout, routeWorkspace } from "./layout";
import { markSelectedSession } from "./render";
import type { AppElement, PluginContext, SidebarBridge, SidebarSession, SidebarWorkspace } from "./types";

type RefreshWorkspaces = (options?: { allowEmpty?: boolean; emptySessionsForWorkspaceId?: string }) => Promise<SidebarWorkspace[]>;

export function bindWorkspaceActions(
  wrap: HTMLElement,
  app: AppElement,
  context: PluginContext,
  refreshWorkspaces: RefreshWorkspaces,
  sidebarBridge: SidebarBridge,
): void {
  if (wrap.dataset.piWebSidebarWorkspaceActionsBound === "true") {
    return;
  }

  wrap.addEventListener("click", async (event: MouseEvent): Promise<void> => {
    const target: HTMLElement | null = eventTarget(event)?.closest("[data-action], .session-row[data-session]") || null;

    if (!target || !wrap.contains(target)) {
      return;
    }

    const action: string = target.dataset.action || (target.dataset.session ? "select-session" : "");

    if (shouldHandleActionInsidePlugin(action)) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (await handleWorkspaceAction(action, target, app, context, refreshWorkspaces, sidebarBridge)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  wrap.dataset.piWebSidebarWorkspaceActionsBound = "true";
}

function shouldHandleActionInsidePlugin(action: string): boolean {
  return [
    "refresh-workspaces",
    "toggle-workspace",
    "delete-workspace",
    "new-session",
    "delete-workspace-sessions",
    "collapse-sidebar",
    "session-menu-toggle",
    "rename-session",
    "delete-session",
  ].includes(action);
}

async function handleWorkspaceAction(
  action: string,
  target: HTMLElement,
  app: AppElement,
  context: PluginContext,
  refreshWorkspaces: RefreshWorkspaces,
  sidebarBridge: SidebarBridge,
): Promise<boolean> {
  if (action === "refresh-workspaces") {
    await refreshFromButton(target, refreshWorkspaces, sidebarBridge);
    return true;
  }

  if (action === "toggle-workspace") {
    toggleWorkspaceGroup(app, target.dataset.workspace);
    sidebarBridge.emitEvent("toggle-workspace", { workspaceId: target.dataset.workspace || "" });
    sidebarBridge.emitState("toggle-workspace");
    return true;
  }

  return handleMutatingWorkspaceAction(action, target, app, context, refreshWorkspaces, sidebarBridge);
}

async function refreshFromButton(
  target: HTMLElement,
  refreshWorkspaces: RefreshWorkspaces,
  sidebarBridge: SidebarBridge,
): Promise<void> {
  const button: HTMLButtonElement | null = target.tagName === "BUTTON" ? (target as HTMLButtonElement) : null;

  if (button) {
    button.disabled = true;
  }

  try {
    await refreshWorkspaces({ allowEmpty: true });
    sidebarBridge.emitEvent("refresh-click", {});
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function handleMutatingWorkspaceAction(
  action: string,
  target: HTMLElement,
  app: AppElement,
  context: PluginContext,
  refreshWorkspaces: RefreshWorkspaces,
  sidebarBridge: SidebarBridge,
): Promise<boolean> {
  if (action === "delete-workspace") {
    return deleteWorkspaceAction(target, app, refreshWorkspaces, sidebarBridge);
  }

  if (action === "new-session") {
    const workspaceId: string = target.dataset.workspace
      || target.closest<HTMLElement>("[data-workspace-group]")?.dataset.workspaceGroup
      || "";
    const existingSessionIds: Set<string> = workspaceSessionIds(app, workspaceId);
    const createdSessionId: string = await createWorkspaceSession(context, app, workspaceId);
    const detectedSessionId: string = createdSessionId || createdWorkspaceSessionId(app, workspaceId, existingSessionIds);
    const sessionId: string = detectedSessionId || optimisticWorkspaceSessionId();
    await refreshWorkspaces();
    createSidebarSession(app, workspaceId, sessionId, existingSessionIds);
    sidebarBridge.emitEvent("new-session", { workspaceId });
    return true;
  }

  if (action === "delete-workspace-sessions") {
    const workspaceId: string | undefined = target.dataset.workspace;
    const deletedSessions: SidebarSession[] = workspaceSessions(app, workspaceId || "");

    if (!confirmDeleteWorkspaceSessions(workspaceId || "", deletedSessions)) {
      return true;
    }

    const requestedSessionIds: string[] = deletedSessions.map((session: SidebarSession): string => session.id);
    clearWorkspaceSessionSelection(app, workspaceId || "");
    clearWorkspaceSessionDom(app, workspaceId || "");
    const deletedSessionIds: string[] = await deleteWorkspaceSessionList(app, context, workspaceId, requestedSessionIds);
    const publishedSessions: SidebarSession[] = deletedSessionsForIds(deletedSessions, deletedSessionIds);
    dispatchSidebarEvent(app, "pi-web-sidebar:workspace-sessions-cleared", { sessionIds: deletedSessionIds, workspaceId: workspaceId || "" });
    publishDeletedSessions(workspaceId || "", publishedSessions);
    sidebarBridge.emitEvent("delete-workspace-sessions", {
      sessionIds: deletedSessionIds,
      sessions: publishedSessions,
      workspaceId: workspaceId || "",
    });
    await context.events?.publish("active-state", "active.end", {
      active: false,
      sessionId: deletedSessionIds[0] || "",
      sessionIds: deletedSessionIds,
      source: "pi-web-sidebar",
      status: "idle",
      workspaceId: workspaceId || "",
    });
    await refreshWorkspaces({ emptySessionsForWorkspaceId: workspaceId });
    return true;
  }

  return handleSessionAction(action, target, app, context, refreshWorkspaces, sidebarBridge);
}

function confirmDeleteWorkspaceSessions(workspaceId: string, sessions: SidebarSession[]): boolean {
  const sessionCount: number = sessions.length;
  const sessionLabel: string = sessionCount === 1 ? "1 session" : `${sessionCount} sessions`;
  return confirm(
    `Warning: delete all ${sessionLabel} in workspace ${workspaceId || "unknown"}? `
      + "This removes local JSONL files and child sessions.",
  );
}

async function deleteWorkspaceAction(
  target: HTMLElement,
  app: AppElement,
  refreshWorkspaces: RefreshWorkspaces,
  sidebarBridge: SidebarBridge,
): Promise<boolean> {
  if (confirm(`Remove workspace ${target.dataset.workspace} from this view?`)) {
    await deleteWorkspaceById(app, target.dataset.workspace);
    await refreshWorkspaces({ allowEmpty: true });
    sidebarBridge.emitEvent("delete-workspace", { workspaceId: target.dataset.workspace || "" });
  }

  return true;
}

async function handleSessionAction(
  action: string,
  target: HTMLElement,
  app: AppElement,
  context: PluginContext,
  refreshWorkspaces: RefreshWorkspaces,
  sidebarBridge: SidebarBridge,
): Promise<boolean> {
  if (action === "collapse-sidebar") {
    collapseSidebarLayout(app, true);
    sidebarBridge.emitEvent("collapse-sidebar", {});
    sidebarBridge.emitState("collapse-sidebar");
    return true;
  }

  if (action === "session-menu-toggle") {
    toggleSessionMenu(target.closest(".session-row"), app);
    return true;
  }

  if (action === "rename-session") {
    await renameSidebarSession(app, target.closest(".session-row"));
    await refreshWorkspaces();
    sidebarBridge.emitEvent("rename-session", { sessionId: target.closest<HTMLElement>(".session-row")?.dataset.session || "" });
    sidebarBridge.emitState("rename-session");
    return true;
  }

  if (action === "delete-session") {
    const deletedSessions: SidebarSession[] = await deleteSidebarSession(app, context, target.closest(".session-row"));
    await refreshWorkspaces();
    sidebarBridge.emitEvent("delete-session", {
      sessionId: deletedSessions[0]?.id || "",
      sessionIds: deletedSessions.map((session: SidebarSession): string => session.id),
      sessions: deletedSessions,
      workspaceId: deletedSessions[0] ? target.closest<HTMLElement>(".session-row")?.dataset.workspace || "" : "",
    });
    return true;
  }

  if (action === "select-session") {
    markSelectedSession(target, app);
    markSelectedWorkspace(target, app);
    persistSelectedSession(target, app);
    publishSelectedSession(target);
    routeWorkspace(app);
    const detail: Record<string, unknown> = {
      sessionId: target.dataset.session || "",
      workspaceId: target.dataset.workspace || "",
    };
    sidebarBridge.emitEvent("session.selected", detail);
    sidebarBridge.emitState("session.selected");
    return false;
  }

  return false;
}

function toggleSessionMenu(row: Element | null, app: AppElement): void {
  if (!row) {
    return;
  }

  const htmlRow: HTMLElement = row as HTMLElement;
  const menu: HTMLElement | null = htmlRow.querySelector(".session-menu");
  const button: HTMLElement | null = row.querySelector(".session-menu-button");
  const open: boolean = !!menu?.hidden;
  closeSessionMenus(app, htmlRow);
  menu?.toggleAttribute("hidden", !open);
  button?.setAttribute("aria-expanded", String(open));
}

function closeSessionMenus(app: AppElement, except?: HTMLElement): void {
  app.querySelectorAll<HTMLElement>(`[${PLUGIN_PANEL_ATTR}] .session-row`).forEach((row: HTMLElement): void => {
    if (except && row === except) {
      return;
    }

    row.querySelector(".session-menu")?.setAttribute("hidden", "");
    row.querySelector(".session-menu-button")?.setAttribute("aria-expanded", "false");
  });
}

async function renameSidebarSession(app: AppElement, row: Element | null): Promise<void> {
  if (!row) {
    return;
  }

  const htmlRow: HTMLElement = row as HTMLElement;
  const sessionId: string | undefined = htmlRow.dataset.session;
  if (!sessionId) {
    return;
  }

  await renameSessionById(app, sessionId);
}

async function deleteSidebarSession(app: AppElement, context: PluginContext, row: Element | null): Promise<SidebarSession[]> {
  if (!row) {
    return [];
  }

  const htmlRow: HTMLElement = row as HTMLElement;
  const sessionId: string | undefined = htmlRow.dataset.session;
  if (!sessionId) {
    return [];
  }

  closeSessionMenus(app);
  if (!confirm(`Delete session ${sessionId}? This removes the local JSONL file and child sessions.`)) {
    return [];
  }

  const workspaceId: string = htmlRow.dataset.workspace || "";
  const deletedSessions: SidebarSession[] = sessionTree(app, workspaceId, sessionId);
  const requestedSessionIds: string[] = deletedSessions.map((session: SidebarSession): string => session.id);
  const deletedSessionIds: string[] = await deleteSessionList(app, context, workspaceId, requestedSessionIds);
  const publishedSessions: SidebarSession[] = deletedSessionsForIds(deletedSessions, deletedSessionIds);
  dispatchSidebarEvent(app, "pi-web-sidebar:session-deleted", { sessionId, sessionIds: deletedSessionIds, sessions: publishedSessions, workspaceId });
  publishDeletedSessions(workspaceId, publishedSessions);
  await context.events?.publish("active-state", "active.end", {
    active: false,
    sessionId,
    sessionIds: deletedSessionIds,
    source: "pi-web-sidebar",
    status: "idle",
    workspaceId,
  });
  return publishedSessions;
}

function deletedSessionsForIds(sessions: SidebarSession[], sessionIds: string[]): SidebarSession[] {
  return sessionIds.map((sessionId: string): SidebarSession => {
    return sessions.find((session: SidebarSession): boolean => session.id === sessionId) || { id: sessionId };
  });
}

function createSidebarSession(app: AppElement, workspaceId: string, sessionId: string, existingSessionIds: Set<string>): void {
  if (!workspaceId || !sessionId) {
    return;
  }

  dispatchSidebarEvent(app, "pi-web-sidebar:session-created", {
    existingSessionIds: [...existingSessionIds],
    sessionId,
    status: "idle",
    workspaceId,
  });
}

function optimisticWorkspaceSessionId(): string {
  const randomValue: string = Math.random().toString(36).slice(2, 8);
  return `optimistic-${Date.now().toString(36)}-${randomValue}`;
}

function createdWorkspaceSessionId(app: AppElement, workspaceId: string, existingSessionIds: Set<string>): string {
  return [...workspaceSessionIds(app, workspaceId)].find((sessionId: string): boolean => {
    return !existingSessionIds.has(sessionId);
  }) || "";
}

function workspaceSessionIds(app: AppElement, workspaceId: string): Set<string> {
  return new Set(workspaceSessions(app, workspaceId).map((session: SidebarSession): string => session.id));
}

function workspaceSessions(app: AppElement, workspaceId: string): SidebarSession[] {
  const workspace = (app.workspaceList || []).find((item): boolean => item.id === workspaceId);
  return workspace?.sessions || [];
}

function sessionTree(app: AppElement, workspaceId: string, sessionId: string): SidebarSession[] {
  const sessions: SidebarSession[] = workspaceSessions(app, workspaceId);
  const byParentId: Map<string, SidebarSession[]> = new Map();

  for (const session of sessions) {
    if (!session.parentId) {
      continue;
    }

    byParentId.set(session.parentId, [...byParentId.get(session.parentId) || [], session]);
  }

  const deletedSessions: SidebarSession[] = [];
  const pendingIds: string[] = [sessionId];
  const seenIds: Set<string> = new Set();

  while (pendingIds.length > 0) {
    const currentId: string = pendingIds.shift() || "";
    if (!currentId || seenIds.has(currentId)) {
      continue;
    }

    seenIds.add(currentId);
    const session: SidebarSession | undefined = sessions.find((item: SidebarSession): boolean => item.id === currentId);
    if (session) {
      deletedSessions.push(session);
    }

    for (const child of byParentId.get(currentId) || []) {
      pendingIds.push(child.id);
    }
  }

  return deletedSessions.length > 0 ? deletedSessions : [{ id: sessionId }];
}

function publishDeletedSessions(workspaceId: string, sessions: SidebarSession[]): void {
  const payload: Record<string, unknown> = {
    sessionIds: sessions.map((session: SidebarSession): string => session.id),
    sessions,
    workspaceId,
  };
  globalThis.piWeb?.subject<Record<string, unknown>>("plugin.pi-web-sidebar.deletedSessions").next(payload);
}

function clearWorkspaceSessionDom(app: AppElement, workspaceId: string): void {
  if (!workspaceId) {
    return;
  }

  const escapedWorkspaceId: string = cssEscape(workspaceId);
  app.workspaceList = (app.workspaceList || []).map((workspace: SidebarWorkspace): SidebarWorkspace => {
    return workspace.id === workspaceId ? { ...workspace, sessions: [], sessionCount: 0, live: false } : workspace;
  });

  const group: HTMLElement | null = app.querySelector(`[data-workspace-group='${escapedWorkspaceId}']`);
  const sessions: HTMLElement | null = group?.querySelector(".sessions") || null;
  if (!sessions) {
    return;
  }

  sessions
    .querySelectorAll(":scope > .session-row[data-session], :scope > .clear-sessions-row")
    .forEach((row: Element): void => row.remove());
}

function clearWorkspaceSessionSelection(app: AppElement, workspaceId: string): void {
  const activeWorkspaceId: string = app.dataset.activeWorkspaceId || "";
  const activeSessionId: string = app.dataset.activeSessionId || "";
  if (activeWorkspaceId && activeWorkspaceId !== workspaceId && !workspaceSessionIds(app, workspaceId).has(activeSessionId)) {
    return;
  }

  app.dataset.activeSessionId = "";
  publishSelectedSessionId(null);
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, "");
  } catch {}
}

function persistSelectedSession(target: HTMLElement, app: AppElement): void {
  const sessionId: string = target.dataset.session || "";
  const workspaceId: string = target.dataset.workspace || "";
  app.dataset.activeSessionId = sessionId;
  app.dataset.activeWorkspaceId = workspaceId;

  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
  } catch {}
}

function markSelectedWorkspace(target: HTMLElement, app: AppElement): void {
  const workspaceId: string = target.dataset.workspace || "";
  app.querySelectorAll(".workspace-group.active, .ws-row.active").forEach((node: Element): void => {
    node.classList.remove("active");
    node.setAttribute("aria-current", "false");
  });
  const escapedWorkspaceId: string = cssEscape(workspaceId);
  app.querySelector<HTMLElement>(`[data-workspace-group='${escapedWorkspaceId}']`)?.classList.add("active");
  const row: HTMLElement | null = app.querySelector(`[data-workspace='${escapedWorkspaceId}'].ws-row`);
  row?.classList.add("active");
  row?.setAttribute("aria-current", "true");
}

function publishSelectedSession(target: HTMLElement): void {
  const sessionId: string = target.dataset.session || "";

  if (sessionId) {
    publishSelectedSessionId(sessionId);
  }
}

function publishSelectedSessionId(sessionId: string | null): void {
  globalThis.piWeb?.behaviorSubject<string | null>("session.activeId", sessionId).next(sessionId);
}

function toggleWorkspaceGroup(app: AppElement, workspaceId?: string): void {
  if (!workspaceId) {
    return;
  }

  const groups: HTMLElement[] = [...app.querySelectorAll<HTMLElement>(`[${PLUGIN_PANEL_ATTR}] [data-workspace-group]`)];
  const selected: HTMLElement | undefined = groups.find((group: HTMLElement): boolean => group.dataset.workspaceGroup === workspaceId);
  const shouldOpen: boolean = !!selected?.querySelector<HTMLElement>(".sessions")?.hidden;
  app.sidebarOpenWorkspaceId = shouldOpen ? workspaceId : "";

  for (const group of groups) {
    const open: boolean = group.dataset.workspaceGroup === workspaceId && shouldOpen;
    group.querySelector<HTMLElement>(".sessions")?.toggleAttribute("hidden", !open);
    group.querySelector<HTMLElement>(".ws-row")?.classList.toggle("open", open);
    group.querySelector<HTMLElement>(".ws-row")?.setAttribute("aria-expanded", String(open));
  }

  window.dispatchEvent(new CustomEvent("pi-sidebar-workspace-state", {
    detail: {
      activeWorkspaceId: app.dataset.activeWorkspaceId || "",
      openWorkspaceId: app.sidebarOpenWorkspaceId || "",
    },
  }));
}

function cssEscape(value: string): string {
  if (typeof globalThis.CSS?.escape === "function") {
    return CSS.escape(value);
  }

  return String(value).replace(/['\\]/g, "\\$&");
}

function dispatchSidebarEvent(app: AppElement, type: string, detail: Record<string, unknown>): void {
  const CustomEventConstructor: typeof CustomEvent = app.ownerDocument.defaultView?.CustomEvent || CustomEvent;
  app.dispatchEvent(new CustomEventConstructor(type, { bubbles: true, detail }));
}

function eventTarget(event: Event): HTMLElement | null {
  const target: EventTarget | null = event.target;
  return target && typeof (target as Element).closest === "function" ? target as HTMLElement : null;
}
