import { readStoredList, readStoredObject } from "./storage";
import type { SidebarSession, SidebarWorkspace } from "./types";

type AppendSession = (session: SidebarSession, depth: number) => void;

export function orderedWorkspaces(workspaces: SidebarWorkspace[]): SidebarWorkspace[] {
  return applyStoredOrder(workspaces, readStoredList("pi.workspaceOrder"));
}

export function orderedSessionTree(workspace: SidebarWorkspace): { session: SidebarSession; depth: number }[] {
  const orders: Record<string, string[]> = readStoredObject("pi.sessionOrder");
  const ordered: SidebarSession[] = applyStoredOrder(workspace.sessions || [], orders[workspace.id] || []);
  const byParentId: Map<string, SidebarSession[]> = new Map();
  const seenIds: Set<string> = new Set(ordered.map((session: SidebarSession): string => session.id));

  ordered.forEach((session: SidebarSession): void => {
    const parentId: string = session.parentId || "";
    if (!parentId || !seenIds.has(parentId)) {
      return;
    }

    byParentId.set(parentId, [...byParentId.get(parentId) || [], session]);
  });

  const rows: { session: SidebarSession; depth: number }[] = [];
  const visitedIds: Set<string> = new Set();
  const appendSession: AppendSession = (session: SidebarSession, depth: number): void => {
    if (visitedIds.has(session.id)) {
      return;
    }

    visitedIds.add(session.id);
    rows.push({ session, depth });
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
