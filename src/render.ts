import { ICONS, PLUGIN_PANEL_ATTR } from "./constants";
import { orderedSessionTree, orderedWorkspaces } from "./render-order";
import {
  sessionBadges,
  sessionDisplayName,
  sessionIndicatorLabel,
  sessionIsLive,
  workspaceSessionCount,
} from "./render-session-utils";
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

  orderedWorkspaces(workspaces).forEach((workspace: SidebarWorkspace): void => {
    section.append(createPluginWorkspaceGroup(workspace, app));
  });
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

function createWorkspaceShell(
  workspace: SidebarWorkspace,
  app: AppElement,
  open: boolean,
  active: boolean,
): HTMLElement {
  const shell: HTMLDivElement = document.createElement("div");
  shell.className = "workspace-shell";
  shell.append(createWorkspaceButton(workspace, app, open, active));
  shell.append(createWorkspaceDeleteButton(workspace));
  return shell;
}

function createWorkspaceButton(
  workspace: SidebarWorkspace,
  app: AppElement,
  open: boolean,
  active: boolean,
): HTMLElement {
  const button: HTMLButtonElement = document.createElement("button");
  const activeSessionClass: boolean = workspaceHasActiveSession(workspace);
  button.type = "button";
  button.className = ["ws-row", open && "open", active && "active", activeSessionClass && "has-active-session"]
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
  dot.classList.toggle("live", workspaceHasActiveSession(workspace) || !!workspace.live);
  dot.setAttribute("aria-label", workspaceIndicatorLabel(workspace));
  dot.title = workspaceIndicatorLabel(workspace);
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

  orderedSessionTree(workspace).forEach((item: { session: SidebarSession; depth: number }): void => {
    sessions.append(createPluginSessionRow(item.session, workspace, app, item.depth));
  });

  if (workspace.sessions?.length) {
    sessions.append(createDeleteWorkspaceSessionsRow(workspace.id));
  }

  sessions.append(createNewSessionRow(workspace.id));
  return sessions;
}

function createPluginSessionRow(
  session: SidebarSession,
  workspace: SidebarWorkspace,
  app: AppElement,
  depth: number,
): HTMLElement {
  const selected: boolean = session.id === app.dataset.activeSessionId;
  const nameText: string = sessionDisplayName(session);
  const row: HTMLDivElement = document.createElement("div");
  row.className = ["session-row", selected && "active", selected && "selected", session.parentId && "child-session"]
    .filter(Boolean)
    .join(" ");
  row.dataset.session = session.id;
  row.dataset.workspace = workspace.id;
  row.dataset.title = nameText;
  row.dataset.lastUsed = session.lastUsed || "";
  row.dataset.depth = String(depth);
  row.style.setProperty("--pi-web-sidebar-session-depth", String(depth));

  if (session.parentId) {
    row.dataset.parentSession = session.parentId;
  }

  row.setAttribute("aria-current", selected ? "true" : "false");
  row.append(
    createSessionMain(session, workspace.id, nameText),
    createSessionMenuButton(session),
    createSessionMenu(session),
  );
  return row;
}

function createSessionMain(session: SidebarSession, workspaceId: string, nameText: string): HTMLElement {
  const main: HTMLButtonElement = document.createElement("button");
  const dot: HTMLSpanElement = document.createElement("span");
  const label: HTMLSpanElement = document.createElement("span");
  const meta: HTMLSpanElement = document.createElement("span");
  main.type = "button";
  main.className = "session-main";
  main.dataset.session = session.id;
  main.dataset.workspace = workspaceId;
  main.dataset.title = nameText;
  dot.className = "dot session-indicator";
  dot.classList.toggle("live", sessionIsLive(session));
  dot.classList.toggle("idle", !sessionIsLive(session));
  dot.setAttribute("aria-label", sessionIndicatorLabel(session));
  dot.title = sessionIndicatorLabel(session);
  label.className = "title";
  label.textContent = nameText;
  meta.className = "meta";
  meta.textContent = sessionBadges(session).join(" · ");
  meta.hidden = !meta.textContent;
  main.append(dot, label, meta);
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
    `<button type="button" role="menuitem" class="danger" data-action="delete-session">${ICONS.trash}` +
      "<span>delete</span></button>",
  ].join("");
  return menu;
}

function createDeleteWorkspaceSessionsRow(workspaceId: string): HTMLElement {
  const row: HTMLButtonElement = document.createElement("button");
  row.type = "button";
  row.className = "session-row clear-sessions-row danger";
  row.dataset.action = "delete-workspace-sessions";
  row.dataset.workspace = workspaceId;
  row.setAttribute("aria-label", "delete all sessions in workspace");
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

function workspaceIndicatorLabel(workspace: SidebarWorkspace): string {
  return workspaceHasActiveSession(workspace) || !!workspace.live ? "workspace live" : "workspace inactive";
}

function sessionMenuId(sessionId: string): string {
  return `session-menu-${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
