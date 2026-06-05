import {
  createWorkspaceSession,
  deleteSessionById,
  deleteWorkspaceById,
  deleteWorkspaceSessionList,
  renameSessionById,
} from "./api";
import { PLUGIN_PANEL_ATTR } from "./constants";
import { collapseSidebarLayout, routeWorkspace } from "./layout";
import { markSelectedSession } from "./render";
import type { AppElement, PluginContext, SidebarBridge, SidebarWorkspace } from "./types";

export function bindWorkspaceActions(
  wrap: HTMLElement,
  app: AppElement,
  context: PluginContext,
  refreshWorkspaces: () => Promise<SidebarWorkspace[]>,
  sidebarBridge: SidebarBridge,
): void {
  if (wrap.dataset.piWebSidebarWorkspaceActionsBound === "true") {
    return;
  }

  wrap.addEventListener("click", async (event: MouseEvent): Promise<void> => {
    const target: HTMLElement | null = eventTarget(event)?.closest("[data-action], .session-row[data-session]");

    if (!target || !wrap.contains(target)) {
      return;
    }

    const action: string = target.dataset.action || (target.dataset.session ? "pick-session" : "");

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
  refreshWorkspaces: () => Promise<SidebarWorkspace[]>,
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
  refreshWorkspaces: () => Promise<SidebarWorkspace[]>,
  sidebarBridge: SidebarBridge,
): Promise<void> {
  const button: HTMLButtonElement | null = target.tagName === "BUTTON" ? (target as HTMLButtonElement) : null;

  if (button) {
    button.disabled = true;
  }

  try {
    await refreshWorkspaces();
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
  refreshWorkspaces: () => Promise<SidebarWorkspace[]>,
  sidebarBridge: SidebarBridge,
): Promise<boolean> {
  if (action === "delete-workspace") {
    return deleteWorkspaceAction(target, context, refreshWorkspaces, sidebarBridge);
  }

  if (action === "new-session") {
    await createWorkspaceSession(context, target.dataset.workspace);
    await refreshWorkspaces();
    sidebarBridge.emitEvent("new-session", { workspaceId: target.dataset.workspace || "" });
    return true;
  }

  if (action === "delete-workspace-sessions") {
    await deleteWorkspaceSessionList(context, target.dataset.workspace);
    await refreshWorkspaces();
    sidebarBridge.emitEvent("delete-workspace-sessions", { workspaceId: target.dataset.workspace || "" });
    return true;
  }

  return handleSessionAction(action, target, app, context, refreshWorkspaces, sidebarBridge);
}
async function deleteWorkspaceAction(
  target: HTMLElement,
  context: PluginContext,
  refreshWorkspaces: () => Promise<SidebarWorkspace[]>,
  sidebarBridge: SidebarBridge,
): Promise<boolean> {
  if (confirm(`Remove workspace ${target.dataset.workspace} from this view?`)) {
    await deleteWorkspaceById(context, target.dataset.workspace);
    await refreshWorkspaces();
    sidebarBridge.emitEvent("delete-workspace", { workspaceId: target.dataset.workspace || "" });
  }

  return true;
}

async function handleSessionAction(
  action: string,
  target: HTMLElement,
  app: AppElement,
  context: PluginContext,
  refreshWorkspaces: () => Promise<SidebarWorkspace[]>,
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
    await renameSidebarSession(context, target.closest(".session-row"));
    sidebarBridge.emitEvent("rename-session", { sessionId: target.closest<HTMLElement>(".session-row")?.dataset.session || "" });
    sidebarBridge.emitState("rename-session");
    return true;
  }

  if (action === "delete-session") {
    await deleteSidebarSession(context, app, target.closest(".session-row"));
    await refreshWorkspaces();
    sidebarBridge.emitEvent("delete-session", { sessionId: target.closest<HTMLElement>(".session-row")?.dataset.session || "" });
    return true;
  }

  if (action === "pick-session") {
    markSelectedSession(target, app);
    routeWorkspace(app);
    sidebarBridge.emitEvent("pick-session", {
      sessionId: target.dataset.session || "",
      workspaceId: target.dataset.workspace || "",
    });
    sidebarBridge.emitState("pick-session");
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

async function renameSidebarSession(context: PluginContext, row: Element | null): Promise<void> {
  if (!row) {
    return;
  }

  const htmlRow: HTMLElement = row as HTMLElement;
  const sessionId: string | undefined = htmlRow.dataset.session;
  if (!sessionId) {
    return;
  }

  const title: string | undefined = prompt("Rename session", htmlRow.dataset.title || "")?.trim();
  if (!title) {
    return;
  }

  const result = await renameSessionById(context, sessionId, title);
  const nextTitle: string = result.session?.title || title;
  htmlRow.dataset.title = nextTitle;
  htmlRow.querySelector<HTMLElement>(".session-main")?.setAttribute("data-title", nextTitle);

  const label: HTMLElement | null = htmlRow.querySelector(".title");
  if (label) {
    label.textContent = nextTitle;
  }
}

async function deleteSidebarSession(context: PluginContext, app: AppElement, row: Element | null): Promise<void> {
  if (!row) {
    return;
  }

  const htmlRow: HTMLElement = row as HTMLElement;
  const sessionId: string | undefined = htmlRow.dataset.session;
  if (!sessionId) {
    return;
  }

  closeSessionMenus(app);
  if (!confirm(`Delete session ${sessionId}? This removes the local JSONL file.`)) {
    return;
  }

  await deleteSessionById(context, sessionId);
  if (app.dataset.activeSessionId === sessionId) {
    app.dataset.activeSessionId = "";
  }
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

function eventTarget(event: Event): HTMLElement | null {
  const target: EventTarget | null = event.target;
  return target && typeof (target as Element).closest === "function" ? target as HTMLElement : null;
}
