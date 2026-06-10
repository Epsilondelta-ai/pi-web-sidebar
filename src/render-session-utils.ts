import type { SidebarSession, SidebarWorkspace } from "./types";

export function sessionBadges(session: SidebarSession): string[] {
  const badges: string[] = [];
  const kind: string = session.kind?.trim() || "";

  if (kind && !isStatusLabel(kind)) {
    badges.push(kind);
  }

  return badges;
}

export function sessionIndicatorLabel(session: SidebarSession): string {
  const status: string = (session.status || "").toLowerCase();

  if (status === "streaming") {
    return "session streaming";
  }

  return sessionIsLive(session) ? "session active" : "session inactive";
}

export function sessionIsLive(session: SidebarSession): boolean {
  if (sessionIsCompleted(session)) {
    return false;
  }

  const status: string = (session.status || "").toLowerCase();
  if (["idle", "waiting", "inactive"].includes(status)) {
    return false;
  }

  return !!(session.live || ["running", "thinking", "active", "live", "streaming"].includes(status));
}

export function sessionDisplayName(session: SidebarSession): string {
  const name: string = agentDisplayName(session) || session.name || "";

  if (name && !isStatusLabel(name)) {
    return normalizeSessionName(name);
  }

  return normalizeSessionName(session.id);
}

export function workspaceSessionCount(workspace: SidebarWorkspace): number {
  return Number.isFinite(workspace.sessionCount) ? Number(workspace.sessionCount) : (workspace.sessions || []).length;
}

function sessionIsCompleted(session: SidebarSession): boolean {
  const status: string = (session.status || "").toLowerCase();
  return !!(session.unreadCompleted || ["complete", "completed", "done", "failed", "success"].includes(status));
}

function isStatusLabel(value: string): boolean {
  const label: string = value.trim().toLowerCase();
  const statusLabels: string[] = [
    "active",
    "complete",
    "completed",
    "done",
    "failed",
    "idle",
    "live",
    "running",
    "streaming",
    "success",
    "thinking",
    "waiting",
  ];
  return statusLabels.includes(label);
}

function agentDisplayName(session: SidebarSession): string {
  const kind: string = session.kind?.trim().toLowerCase() || "";
  const name: string = session.name || "";

  if (kind === "team agent") {
    return name.replace(/^pi agent teams - teammate\s+/i, "").trim();
  }

  if (kind === "subagent") {
    return name.replace(/^subagent-/i, "").trim();
  }

  return "";
}

function normalizeSessionName(name: string): string {
  return name.length > 12 ? `${name.slice(0, 12)}...` : name;
}
