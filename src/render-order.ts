import { readStoredList, readStoredObject, storeJson } from "./storage";
import type { SidebarSession, SidebarWorkspace } from "./types";

export const AGENT_SESSION_COLLAPSE_KEY = "pi.agentSessionCollapse";

export type OrderedSessionRow = {
  agentChildCount: number;
  collapsed: boolean;
  depth: number;
  forceOpen: boolean;
  session: SidebarSession;
};

type AppendSession = (session: SidebarSession, depth: number) => void;

type SessionTreeOptions = {
  activeSessionId?: string;
  collapsedSessionIds?: Set<string>;
};

export function orderedWorkspaces(workspaces: SidebarWorkspace[]): SidebarWorkspace[] {
  return applyStoredOrder(workspaces, readStoredList("pi.workspaceOrder"));
}

export function orderedSessionTree(workspace: SidebarWorkspace, options: SessionTreeOptions = {}): OrderedSessionRow[] {
  const orders: Record<string, string[]> = readStoredObject("pi.sessionOrder");
  const ordered: SidebarSession[] = applyStoredOrder(workspace.sessions || [], orders[workspace.id] || []);
  const byParentId: Map<string, SidebarSession[]> = childSessionsByParentId(ordered);
  const seenIds: Set<string> = new Set(ordered.map((session: SidebarSession): string => session.id));
  const agentCounts: Map<string, number> = agentDescendantCounts(ordered, byParentId);
  const collapsedSessionIds: Set<string> = options.collapsedSessionIds || new Set();
  const forceOpenSessionIds: Set<string> = forcedOpenSessionIds(ordered, options.activeSessionId || "");
  const rows: OrderedSessionRow[] = [];
  const visitedIds: Set<string> = new Set();
  const appendSession: AppendSession = (session: SidebarSession, depth: number): void => {
    if (visitedIds.has(session.id)) {
      return;
    }

    const forceOpen: boolean = forceOpenSessionIds.has(session.id);
    const collapsed: boolean = collapsedSessionIds.has(session.id) && !forceOpen;
    visitedIds.add(session.id);
    rows.push({
      agentChildCount: agentCounts.get(session.id) || 0,
      collapsed,
      depth,
      forceOpen,
      session,
    });

    if (collapsed) {
      markDescendantsVisited(session.id, byParentId, visitedIds);
      return;
    }

    (byParentId.get(session.id) || []).forEach((child: SidebarSession): void => {
      appendSession(child, depth + 1);
    });
  };

  ordered.forEach((session: SidebarSession): void => {
    if (session.parentId && seenIds.has(session.parentId)) {
      return;
    }

    appendSession(session, orphanAgentDepth(session, seenIds));
  });

  ordered.forEach((session: SidebarSession): void => {
    appendSession(session, 0);
  });

  return rows;
}

export function readCollapsedAgentSessionIds(workspaceId: string): Set<string> {
  const collapsedByWorkspace: Record<string, string[]> = readStoredObject(AGENT_SESSION_COLLAPSE_KEY);
  return new Set(collapsedByWorkspace[workspaceId] || []);
}

export function toggleCollapsedAgentSession(workspaceId: string, sessionId: string): boolean {
  const collapsedByWorkspace: Record<string, string[]> = readStoredObject(AGENT_SESSION_COLLAPSE_KEY);
  const collapsedIds: Set<string> = new Set(collapsedByWorkspace[workspaceId] || []);

  if (collapsedIds.has(sessionId)) {
    collapsedIds.delete(sessionId);
  } else {
    collapsedIds.add(sessionId);
  }

  collapsedByWorkspace[workspaceId] = [...collapsedIds];
  storeJson(AGENT_SESSION_COLLAPSE_KEY, collapsedByWorkspace);
  return collapsedIds.has(sessionId);
}

function childSessionsByParentId(sessions: SidebarSession[]): Map<string, SidebarSession[]> {
  const byParentId: Map<string, SidebarSession[]> = new Map();
  const seenIds: Set<string> = new Set(sessions.map((session: SidebarSession): string => session.id));

  sessions.forEach((session: SidebarSession): void => {
    const parentId: string = session.parentId || "";
    if (!parentId || !seenIds.has(parentId)) {
      return;
    }

    byParentId.set(parentId, [...byParentId.get(parentId) || [], session]);
  });

  return byParentId;
}

function forcedOpenSessionIds(sessions: SidebarSession[], activeSessionId: string): Set<string> {
  const byId: Map<string, SidebarSession> = new Map(
    sessions.map((session: SidebarSession): [string, SidebarSession] => [session.id, session]),
  );
  const openIds: Set<string> = new Set();
  let parentId: string = byId.get(activeSessionId)?.parentId || "";

  while (parentId && !openIds.has(parentId)) {
    openIds.add(parentId);
    parentId = byId.get(parentId)?.parentId || "";
  }

  return openIds;
}

function markDescendantsVisited(
  sessionId: string,
  byParentId: Map<string, SidebarSession[]>,
  visitedIds: Set<string>,
): void {
  const pending: SidebarSession[] = [...byParentId.get(sessionId) || []];

  while (pending.length > 0) {
    const session: SidebarSession | undefined = pending.pop();
    if (!session || visitedIds.has(session.id)) {
      continue;
    }

    visitedIds.add(session.id);
    pending.push(...byParentId.get(session.id) || []);
  }
}

function agentDescendantCounts(
  sessions: SidebarSession[],
  byParentId: Map<string, SidebarSession[]>,
): Map<string, number> {
  const counts: Map<string, number> = new Map();

  sessions.forEach((session: SidebarSession): void => {
    counts.set(session.id, countAgentDescendants(session.id, byParentId));
  });

  return counts;
}

function countAgentDescendants(sessionId: string, byParentId: Map<string, SidebarSession[]>): number {
  let count = 0;
  const pending: SidebarSession[] = [...byParentId.get(sessionId) || []];
  const seenIds: Set<string> = new Set([sessionId]);

  while (pending.length > 0) {
    const session: SidebarSession | undefined = pending.pop();
    if (!session || seenIds.has(session.id)) {
      continue;
    }

    seenIds.add(session.id);

    if (agentSessionKind(session)) {
      count += 1;
    }

    pending.push(...byParentId.get(session.id) || []);
  }

  return count;
}

function orphanAgentDepth(session: SidebarSession, seenIds: Set<string>): number {
  if (!session.parentId || seenIds.has(session.parentId)) {
    return 0;
  }

  return agentSessionKind(session) ? 1 : 0;
}

function agentSessionKind(session: SidebarSession): boolean {
  const kind: string = session.kind?.trim().toLowerCase() || "";
  return kind === "subagent" || kind === "team agent";
}

function applyStoredOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const positions: Map<string, number> = new Map(
    order.map((id: string, index: number): [string, number] => [id, index]),
  );
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
