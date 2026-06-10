import { findTopbar } from "./layout";
import { sessionDisplayName } from "./render-session-utils";
import type { AppElement, SidebarSession, SidebarWorkspace } from "./types";

export function syncTopbarCrumb(app: AppElement, workspaces: SidebarWorkspace[]): void {
  const topbar: HTMLElement | null = findTopbar(app);

  if (!topbar) {
    return;
  }

  const crumb: HTMLElement = ensureTopbarCrumb(topbar);
  captureHostCrumbState(crumb);
  const activeWorkspace: SidebarWorkspace | undefined = findActiveWorkspace(app, workspaces);
  const activeSession: SidebarSession | undefined = findActiveSession(app, activeWorkspace, workspaces);
  const workspaceLabel: string = workspaceDisplayName(activeWorkspace);
  const sessionLabel: string = sessionCrumbLabel(activeSession);
  const fullSessionLabel: string = fullSessionCrumbLabel(activeSession);
  const label: string = `${workspaceLabel} / ${sessionLabel}`;
  const fullLabel: string = `${workspaceLabel} / ${fullSessionLabel}`;
  crumb.textContent = label;
  crumb.title = fullLabel;
  crumb.setAttribute("aria-label", `Current workspace ${workspaceLabel}, current session ${fullSessionLabel}`);
}

export function cleanupTopbarCrumb(app: AppElement): void {
  const topbar: HTMLElement | null = findTopbar(app);
  const crumb: HTMLElement | null | undefined = topbar?.querySelector(":scope > .crumb[data-pi-web-sidebar-crumb]");

  if (!crumb) {
    return;
  }

  if (crumb.dataset.piWebSidebarCrumb === "owned") {
    crumb.remove();
    return;
  }

  restoreHostCrumbState(crumb);
}

function ensureTopbarCrumb(topbar: HTMLElement): HTMLElement {
  const existing: HTMLElement | undefined = [...topbar.children].find((child: Element): boolean => {
    return child.classList.contains("crumb");
  }) as HTMLElement | undefined;

  if (existing) {
    existing.dataset.piWebSidebarCrumb = existing.dataset.piWebSidebarCrumb || "host";
    return existing;
  }

  const crumb: HTMLSpanElement = document.createElement("span");
  crumb.className = "crumb";
  crumb.dataset.piWebSidebarCrumb = "owned";
  mountTopbarCrumb(crumb, topbar);
  return crumb;
}

function mountTopbarCrumb(crumb: HTMLElement, topbar: HTMLElement): void {
  const brand: Element | null = [...topbar.children].find((child: Element): boolean => {
    return child.classList.contains("brand");
  }) || null;

  if (brand?.nextSibling) {
    topbar.insertBefore(crumb, brand.nextSibling);
    return;
  }

  topbar.insertBefore(crumb, topbar.firstChild);
}

function findActiveWorkspace(app: AppElement, workspaces: SidebarWorkspace[]): SidebarWorkspace | undefined {
  const activeWorkspaceId: string = app.dataset.activeWorkspaceId || "";
  const activeSessionId: string = app.dataset.activeSessionId || "";
  const selectedWorkspace: SidebarWorkspace | undefined = workspaces.find((workspace: SidebarWorkspace): boolean => {
    return workspace.id === activeWorkspaceId;
  });

  if (selectedWorkspace) {
    return selectedWorkspace;
  }

  return workspaces.find((workspace: SidebarWorkspace): boolean => {
    return (workspace.sessions || []).some((session: SidebarSession): boolean => session.id === activeSessionId);
  });
}

function findActiveSession(
  app: AppElement,
  activeWorkspace: SidebarWorkspace | undefined,
  workspaces: SidebarWorkspace[],
): SidebarSession | undefined {
  const activeSessionId: string = app.dataset.activeSessionId || "";

  if (!activeSessionId) {
    return undefined;
  }

  const activeSession: SidebarSession | undefined = (activeWorkspace?.sessions || []).find(
    (session: SidebarSession): boolean => session.id === activeSessionId,
  );

  if (activeSession) {
    return activeSession;
  }

  for (const workspace of workspaces) {
    const session: SidebarSession | undefined = (workspace.sessions || []).find((item: SidebarSession): boolean => {
      return item.id === activeSessionId;
    });

    if (session) {
      return session;
    }
  }

  return undefined;
}

function workspaceDisplayName(workspace: SidebarWorkspace | undefined): string {
  return workspace?.name || workspace?.path || workspace?.id || "No workspace";
}

function sessionCrumbLabel(session: SidebarSession | undefined): string {
  return session ? sessionDisplayName(session) : "No session";
}

function fullSessionCrumbLabel(session: SidebarSession | undefined): string {
  return session?.name || session?.id || "No session";
}

function captureHostCrumbState(crumb: HTMLElement): void {
  if (crumb.dataset.piWebSidebarCrumb !== "host" || crumb.dataset.piWebSidebarOriginalText !== undefined) {
    return;
  }

  crumb.dataset.piWebSidebarOriginalText = crumb.textContent || "";
  crumb.dataset.piWebSidebarOriginalTitle = crumb.getAttribute("title") || "";
  crumb.dataset.piWebSidebarOriginalAriaLabel = crumb.getAttribute("aria-label") || "";
}

function restoreHostCrumbState(crumb: HTMLElement): void {
  crumb.textContent = crumb.dataset.piWebSidebarOriginalText || "";
  setOptionalAttribute(crumb, "title", crumb.dataset.piWebSidebarOriginalTitle || "");
  setOptionalAttribute(crumb, "aria-label", crumb.dataset.piWebSidebarOriginalAriaLabel || "");
  delete crumb.dataset.piWebSidebarCrumb;
  delete crumb.dataset.piWebSidebarOriginalText;
  delete crumb.dataset.piWebSidebarOriginalTitle;
  delete crumb.dataset.piWebSidebarOriginalAriaLabel;
}

function setOptionalAttribute(element: HTMLElement, name: string, value: string): void {
  if (value) {
    element.setAttribute(name, value);
    return;
  }

  element.removeAttribute(name);
}
