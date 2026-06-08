import { WORKSPACE_CACHE_KEY } from "./constants";
import { readStoredValue } from "./storage";
import type { AppElement, FolderListing, PiStatus, PluginContext, SessionRenameResponse, SidebarSession, SidebarWorkspace } from "./types";

export type WorkspaceHydrationStep = "local" | "file" | "actual";

export type WorkspaceHydrationCallback = (workspaces: SidebarWorkspace[], step: WorkspaceHydrationStep) => void;

export async function loadWorkspaces(
  context: PluginContext,
  app: AppElement,
  onHydrate?: WorkspaceHydrationCallback,
): Promise<SidebarWorkspace[]> {
  const localWorkspaces: SidebarWorkspace[] = readWorkspaceCache();
  notifyHydration(onHydrate, localWorkspaces, "local");

  const fileWorkspaces: SidebarWorkspace[] = await loadWorkspaceCache(context);
  notifyHydration(onHydrate, fileWorkspaces, "file");

  const latestDirectWorkspaces: SidebarWorkspace[] = normalizeSidebarWorkspaces(directWorkspaceList(context, app));
  const workspaceSource: SidebarWorkspace[] = latestDirectWorkspaces.length > 0
    ? latestDirectWorkspaces
    : fileWorkspaces.length > 0
      ? fileWorkspaces
      : localWorkspaces;

  if (workspaceSource.length > 0) {
    return validateAndStoreWorkspaces(context, workspaceSource);
  }

  return workspaceSource;
}

export function loadStoredWorkspaces(): SidebarWorkspace[] {
  return readWorkspaceCache();
}

export async function deleteWorkspaceById(app: AppElement, workspaceId?: string): Promise<void> {
  if (!workspaceId) {
    return;
  }

  await app.deleteWorkspace?.(workspaceId);
}

export async function createWorkspaceSession(context: PluginContext, app: AppElement, workspaceId?: string): Promise<string> {
  if (!workspaceId) {
    return "";
  }

  const backendSessionId: string = await createBackendWorkspaceSession(context, workspaceId);
  if (backendSessionId) {
    return backendSessionId;
  }

  return sessionIdFromResponse(await app.newSession?.(workspaceId));
}

async function createBackendWorkspaceSession(context: PluginContext, workspaceId: string): Promise<string> {
  try {
    return sessionIdFromResponse(await context.backend?.("create-session", { data: { workspaceId } }));
  } catch (error) {
    console.warn("pi-web-sidebar failed to create backend session", error);
    return "";
  }
}

export async function deleteWorkspaceSessionList(
  app: AppElement,
  context: PluginContext,
  workspaceId: string | undefined,
  sessionIds: string[],
): Promise<string[]> {
  if (!workspaceId) {
    return [];
  }

  const result: unknown = await context.backend?.("delete-workspace-sessions", { data: { sessionIds, workspaceId } });
  if (isRecord(result) && Array.isArray(result.deleted)) {
    const deletedSessionIds: string[] = result.deleted.filter((sessionId: unknown): sessionId is string => typeof sessionId === "string");
    return deletedSessionIds.length > 0 ? deletedSessionIds : sessionIds;
  }

  await app.deleteWorkspaceSessions?.(workspaceId);
  return sessionIds;
}

export async function deleteSessionList(
  app: AppElement,
  context: PluginContext,
  workspaceId: string,
  sessionIds: string[],
): Promise<string[]> {
  const result: unknown = await context.backend?.("delete-sessions", { data: { sessionIds, workspaceId } });
  const backendDeletedSessionIds: string[] = isRecord(result) && Array.isArray(result.deleted)
    ? result.deleted.filter((sessionId: unknown): sessionId is string => typeof sessionId === "string")
    : [];
  const deletedSessionIds: string[] = backendDeletedSessionIds.length > 0 ? backendDeletedSessionIds : sessionIds;

  for (const sessionId of deletedSessionIds) {
    await app.deleteSession?.(sessionId);
  }

  return deletedSessionIds;
}

export async function renameSessionById(app: AppElement, sessionId: string): Promise<SessionRenameResponse> {
  await app.renameSession?.(sessionId);
  return {};
}

export async function deleteSessionById(app: AppElement, sessionId: string): Promise<void> {
  await app.deleteSession?.(sessionId);
}

export async function openWorkspacePath(app: AppElement, path: string): Promise<void> {
  await app.openWorkspacePath?.(path);
}

function sessionIdFromResponse(response: unknown): string {
  if (typeof response === "string") {
    return response;
  }

  if (!response || typeof response !== "object") {
    return "";
  }

  const record: Record<string, unknown> = response as Record<string, unknown>;
  const session: unknown = record.session;

  if (typeof record.id === "string") {
    return record.id;
  }

  if (typeof record.sessionId === "string") {
    return record.sessionId;
  }

  if (session && typeof session === "object") {
    const sessionRecord: Record<string, unknown> = session as Record<string, unknown>;

    if (typeof sessionRecord.id === "string") {
      return sessionRecord.id;
    }

    if (typeof sessionRecord.sessionId === "string") {
      return sessionRecord.sessionId;
    }
  }

  return "";
}

export async function loadFolders(context: PluginContext, path: string): Promise<FolderListing> {
  const result: unknown = await context.backend?.("list-folders", { data: { path } });

  if (!isRecord(result)) {
    return {};
  }

  const folders: unknown = result.folders;
  return {
    path: asString(result.path),
    parent: asString(result.parent),
    displayPath: asString(result.displayPath),
    folders: Array.isArray(folders) ? folders.filter(isFolderEntry) : [],
  };
}

export async function callBackend(context: PluginContext, method: string, data: Record<string, unknown>): Promise<unknown> {
  return context.backend?.(method, { data });
}

export async function loadPiStatus(context: PluginContext): Promise<PiStatus> {
  const result: unknown = await context.backend?.("pi-status", { data: {} });

  if (!isRecord(result)) {
    return unavailablePiStatus("pi status backend unavailable");
  }

  return {
    available: result.available === true,
    checkedAt: asString(result.checkedAt) || new Date().toISOString(),
    executable: asString(result.executable),
    version: asString(result.version),
    error: asString(result.error),
  };
}

export async function saveWorkspaceCache(context: PluginContext, workspaces: SidebarWorkspace[]): Promise<void> {
  if (workspaces.length === 0) {
    return;
  }

  await context.backend?.("save-workspace-cache", { data: { workspaces } });
}

async function validateAndStoreWorkspaces(context: PluginContext, workspaces: SidebarWorkspace[]): Promise<SidebarWorkspace[]> {
  return normalizeSidebarWorkspaces(await validateWorkspaces(context, workspaces));
}

async function validateWorkspaces(context: PluginContext, workspaces: SidebarWorkspace[]): Promise<SidebarWorkspace[]> {
  try {
    const result: unknown = await context.backend?.("validate-workspaces", { data: { workspaces } });

    if (isRecord(result) && Array.isArray(result.workspaces)) {
      return result.workspaces.filter(isSidebarWorkspace);
    }
  } catch {
    return workspaces;
  }

  return workspaces;
}

function notifyHydration(
  onHydrate: WorkspaceHydrationCallback | undefined,
  workspaces: SidebarWorkspace[],
  step: WorkspaceHydrationStep,
): void {
  if (workspaces.length === 0) {
    return;
  }

  onHydrate?.(workspaces, step);
}

function directWorkspaceList(context: PluginContext, app: AppElement): SidebarWorkspace[] {
  if (Array.isArray(app.workspaceList)) {
    return app.workspaceList.filter(isSidebarWorkspace);
  }

  return Array.isArray(context.initialWorkspaces) ? context.initialWorkspaces.filter(isSidebarWorkspace) : [];
}

async function loadWorkspaceCache(context: PluginContext): Promise<SidebarWorkspace[]> {
  try {
    const result: unknown = await context.backend?.("load-workspace-cache", { data: {} });

    if (isRecord(result) && Array.isArray(result.workspaces)) {
      return normalizeSidebarWorkspaces(result.workspaces.filter(isSidebarWorkspace));
    }
  } catch (error) {
    console.warn("pi-web-sidebar failed to load workspace cache", error);
  }

  return readWorkspaceCache();
}

function readWorkspaceCache(): SidebarWorkspace[] {
  const value: unknown = readStoredValue(WORKSPACE_CACHE_KEY);

  if (!isRecord(value) || !Array.isArray(value.workspaces)) {
    return [];
  }

  return normalizeSidebarWorkspaces(value.workspaces.filter(isSidebarWorkspace));
}

function normalizeSidebarWorkspaces(workspaces: SidebarWorkspace[]): SidebarWorkspace[] {
  return workspaces.map((workspace: SidebarWorkspace): SidebarWorkspace => {
    if (!workspace.sessions) {
      return workspace;
    }

    return { ...workspace, sessions: workspace.sessions.map(normalizeSidebarSession) };
  });
}

function normalizeSidebarSession(session: SidebarSession): SidebarSession {
  const normalized: Record<string, unknown> = { ...session };
  const legacyTitle: unknown = normalized["title"];
  delete normalized["title"];

  if (!session.name && typeof legacyTitle === "string" && legacyTitle.trim()) {
    normalized.name = legacyTitle.trim();
  }
  return normalized as SidebarSession;
}

function isSidebarWorkspace(value: unknown): value is SidebarWorkspace {
  return isRecord(value) && typeof value.id === "string";
}

function isFolderEntry(value: unknown): value is { name?: string; path: string; displayPath?: string } {
  return isRecord(value) && typeof value.path === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function unavailablePiStatus(error: string): PiStatus {
  return { available: false, checkedAt: new Date().toISOString(), error };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
