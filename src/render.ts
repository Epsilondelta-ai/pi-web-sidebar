import { ICONS, PLUGIN_PANEL_ATTR } from "./constants";
import { readStoredList, readStoredObject } from "./storage";
import type { AppElement, SidebarSession, SidebarWorkspace } from "./types";

export function renderPluginWorkspaceList(
  wrap: HTMLElement | null,
  app: AppElement,
  workspaces: SidebarWorkspace[],
): void {
  const section: HTMLElement | null | undefined = wrap?.querySelector(".sidebar .sb-section");
  const head: HTMLElement | null | undefined = section?.querySelector(".sb-head");

  if (!section || !head || !Array.isArray(workspaces)) {
    return;
  }

  section
    .querySelectorAll(":scope > .workspace-group, :scope > .workspace-empty, :scope > [data-sortable-workspaces]")
    .forEach((node: Element): void => node.remove());

  if (workspaces.length === 0) {
    section.append(createEmptyWorkspaceState());
    return;
  }

  for (const workspace of orderedWorkspaces(workspaces)) {
    section.append(createPluginWorkspaceGroup(workspace, app));
  }
}

function createEmptyWorkspaceState(): HTMLElement {
  const empty: HTMLDivElement = document.createElement("div");
  empty.className = "workspace-empty";
  empty.textContent = "no workspaces yet · press open to add one";
  return empty;
}

export function markSelectedSession(row: HTMLElement, app: AppElement): void {
  app.querySelectorAll(`[${PLUGIN_PANEL_ATTR}] .session-row.active, [${PLUGIN_PANEL_ATTR}] .session-row.selected`)
    .forEach((session: Element): void => {
      session.classList.remove("active", "selected");
      session.setAttribute("aria-current", "false");
    });
  row.classList.add("active", "selected");
  row.setAttribute("aria-current", "true");
}

export function workspaceHasActiveSession(workspace: SidebarWorkspace): boolean {
  return (workspace.sessions || []).some(sessionIsLive);
}

function createPluginWorkspaceGroup(workspace: SidebarWorkspace, app: AppElement): HTMLElement {
  const group: HTMLDivElement = document.createElement("div");
  const active: boolean = workspace.id === app.dataset.activeWorkspaceId;
  const openId: string = app.sidebarOpenWorkspaceId ?? app.dataset.activeWorkspaceId ?? "";
  const open: boolean = workspace.id === openId;
  group.className = "workspace-group";
  group.dataset.workspaceGroup = workspace.id;
  group.classList.toggle("active", active);
  group.classList.toggle("has-active-session", workspaceHasActiveSession(workspace));
  group.append(createWorkspaceShell(workspace, app, open, active));
  group.append(createSessionsList(workspace, app, open));
  return group;
}

function createWorkspaceShell(workspace: SidebarWorkspace, app: AppElement, open: boolean, active: boolean): HTMLElement {
  const shell: HTMLDivElement = document.createElement("div");
  shell.className = "workspace-shell";
  shell.append(createWorkspaceButton(workspace, app, open, active));
  shell.append(createWorkspaceDeleteButton(workspace));
  return shell;
}

function createWorkspaceButton(workspace: SidebarWorkspace, app: AppElement, open: boolean, active: boolean): HTMLElement {
  const button: HTMLButtonElement = document.createElement("button");
  button.type = "button";
  button.className = ["ws-row", open && "open", active && "active", workspaceHasActiveSession(workspace) && "has-active-session"]
    .filter(Boolean)
    .join(" ");
  button.dataset.action = "toggle-workspace";
  button.dataset.workspace = workspace.id;
  button.setAttribute("aria-expanded", String(open));
  button.setAttribute("aria-current", active ? "true" : "false");
  button.append(createWorkspaceStack(workspace), createWorkspaceMeta(workspace));
  return button;
}

function createWorkspaceStack(workspace: SidebarWorkspace): HTMLElement {
  const stack: HTMLSpanElement = document.createElement("span");
  const name: HTMLSpanElement = document.createElement("span");
  const dot: HTMLSpanElement = document.createElement("span");
  const label: HTMLSpanElement = document.createElement("span");
  const path: HTMLSpanElement = document.createElement("span");
  stack.className = "ws-stack";
  name.className = "ws-name";
  dot.className = "dot";
  dot.classList.toggle("live", !!workspace.live || workspaceHasActiveSession(workspace));
  label.className = "label";
  label.textContent = workspace.name || workspace.path || workspace.id;
  path.className = "ws-path";
  path.textContent = workspace.path || "";
  name.append(dot, label);
  stack.append(name, path);
  return stack;
}

function createWorkspaceMeta(workspace: SidebarWorkspace): HTMLElement {
  const meta: HTMLSpanElement = document.createElement("span");
  const count: HTMLSpanElement = document.createElement("span");
  meta.className = "ws-meta";
  meta.setAttribute("aria-label", `${workspaceSessionCount(workspace)} sessions`);
  count.className = "ws-count";
  count.textContent = String(workspaceSessionCount(workspace));
  meta.append(count);
  return meta;
}
function createWorkspaceDeleteButton(workspace: SidebarWorkspace): HTMLElement {
  const button: HTMLButtonElement = document.createElement("button");
  button.type = "button";
  button.className = "row-action danger";
  button.dataset.action = "delete-workspace";
  button.dataset.workspace = workspace.id;
  button.title = "remove workspace";
  button.setAttribute("aria-label", "remove workspace");
  button.textContent = "×";
  return button;
}

function createSessionsList(workspace: SidebarWorkspace, app: AppElement, open: boolean): HTMLElement {
  const sessions: HTMLDivElement = document.createElement("div");
  sessions.className = "sessions";
  sessions.hidden = !open;

  for (const session of orderedSessions(workspace)) {
    sessions.append(createPluginSessionRow(session, workspace, app));
  }

  if (!workspace.sessions?.length) {
    const empty: HTMLDivElement = document.createElement("div");
    empty.className = "sessions-empty";
    empty.textContent = "no sessions yet · press N to start one";
    sessions.append(empty);
  } else {
    sessions.append(createDeleteWorkspaceSessionsRow(workspace.id));
  }

  sessions.append(createNewSessionRow(workspace.id));
  return sessions;
}

function createPluginSessionRow(session: SidebarSession, workspace: SidebarWorkspace, app: AppElement): HTMLElement {
  const selected: boolean = session.id === app.dataset.activeSessionId;
  const titleText: string = normalizeSessionTitle(session.title || session.name || session.id);
  const row: HTMLDivElement = document.createElement("div");
  row.className = ["session-row", selected && "active", selected && "selected", session.parentId && "child-session"]
    .filter(Boolean)
    .join(" ");
  row.dataset.session = session.id;
  row.dataset.workspace = workspace.id;
  row.dataset.title = titleText;
  row.dataset.lastUsed = session.lastUsed || "";

  if (session.parentId) {
    row.dataset.parentSession = session.parentId;
  }

  row.setAttribute("aria-current", selected ? "true" : "false");
  row.append(createSessionMain(session, workspace.id, titleText), createSessionMenuButton(session), createSessionMenu(session));
  return row;
}

function createSessionMain(session: SidebarSession, workspaceId: string, titleText: string): HTMLElement {
  const main: HTMLButtonElement = document.createElement("button");
  const dot: HTMLSpanElement = document.createElement("span");
  const title: HTMLSpanElement = document.createElement("span");
  const meta: HTMLSpanElement = document.createElement("span");
  main.type = "button";
  main.className = "session-main";
  main.dataset.session = session.id;
  main.dataset.workspace = workspaceId;
  main.dataset.title = titleText;
  dot.className = "dot session-indicator";
  dot.classList.toggle("live", sessionIsLive(session));
  dot.classList.toggle("unread", !sessionIsLive(session) && sessionIsUnread(session));
  dot.setAttribute("aria-label", sessionIndicatorLabel(session));
  dot.title = sessionIndicatorLabel(session);
  title.className = "title";
  title.textContent = titleText;
  meta.className = "meta";
  meta.textContent = sessionBadges(session).join(" · ");
  meta.hidden = !meta.textContent;
  main.append(dot, title, meta);
  return main;
}

function createSessionMenuButton(session: SidebarSession): HTMLElement {
  const menuButton: HTMLButtonElement = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "session-menu-button";
  menuButton.dataset.action = "session-menu-toggle";
  menuButton.setAttribute("aria-haspopup", "true");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-controls", sessionMenuId(session.id));
  menuButton.setAttribute("aria-label", "session actions");
  menuButton.innerHTML = ICONS.ellipsis;
  return menuButton;
}

function createSessionMenu(session: SidebarSession): HTMLElement {
  const menu: HTMLDivElement = document.createElement("div");
  menu.className = "session-menu";
  menu.id = sessionMenuId(session.id);
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menu.innerHTML = [
    `<button type="button" role="menuitem" data-action="rename-session">${ICONS.pencil}<span>rename</span></button>`,
    `<button type="button" role="menuitem" class="danger" data-action="delete-session">${ICONS.trash}<span>delete</span></button>`,
  ].join("");
  return menu;
}

function createDeleteWorkspaceSessionsRow(workspaceId: string): HTMLElement {
  const row: HTMLButtonElement = document.createElement("button");
  row.type = "button";
  row.className = "session-row clear-sessions-row";
  row.dataset.action = "delete-workspace-sessions";
  row.dataset.workspace = workspaceId;
  row.innerHTML = '<span class="title">delete all sessions</span>';
  return row;
}

function createNewSessionRow(workspaceId: string): HTMLElement {
  const row: HTMLButtonElement = document.createElement("button");
  row.type = "button";
  row.className = "session-row new-session-row";
  row.dataset.action = "new-session";
  row.dataset.workspace = workspaceId;
  row.innerHTML = `<span class="title">${ICONS.plus} new session</span>`;
  return row;
}

function sessionBadges(session: SidebarSession): string[] {
  const badges: string[] = [];

  if (sessionIsUnread(session)) {
    badges.push("unread");
  }

  if (session.kind) {
    badges.push(session.kind);
  }

  return badges;
}

function sessionIndicatorLabel(session: SidebarSession): string {
  if (sessionIsLive(session)) {
    return "session live";
  }

  if (sessionIsUnread(session)) {
    return "session unread";
  }

  return "session idle";
}

function sessionIsLive(session: SidebarSession): boolean {
  return !!(session.live || session.active || ["running", "thinking", "active", "live"].includes(session.status || ""));
}

function sessionIsUnread(session: SidebarSession): boolean {
  return !!(session.unreadCompleted || session.unread);
}

function normalizeSessionTitle(title: string): string {
  return title.length > 12 ? `${title.slice(0, 12)}...` : title;
}

function workspaceSessionCount(workspace: SidebarWorkspace): number {
  return Number.isFinite(workspace.sessionCount) ? Number(workspace.sessionCount) : (workspace.sessions || []).length;
}

function orderedWorkspaces(workspaces: SidebarWorkspace[]): SidebarWorkspace[] {
  return applyStoredOrder(workspaces, readStoredList("pi.workspaceOrder"));
}

function orderedSessions(workspace: SidebarWorkspace): SidebarSession[] {
  const orders: Record<string, string[]> = readStoredObject("pi.sessionOrder");
  return applyStoredOrder(workspace.sessions || [], orders[workspace.id] || []);
}

function applyStoredOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const positions: Map<string, number> = new Map(order.map((id: string, index: number): [string, number] => [id, index]));
  return [...items].sort((left: T, right: T): number => {
    const leftIndex: number | undefined = positions.get(left.id);
    const rightIndex: number | undefined = positions.get(right.id);

    if (leftIndex === undefined && rightIndex === undefined) {
      return 0;
    }

    if (leftIndex === undefined) {
      return 1;
    }

    if (rightIndex === undefined) {
      return -1;
    }

    return leftIndex - rightIndex;
  });
}

function sessionMenuId(sessionId: string): string {
  return `session-menu-${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
