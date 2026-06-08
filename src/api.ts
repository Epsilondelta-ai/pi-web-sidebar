import { WORKSPACE_CACHE_KEY } from "./constants";
import { readStoredValue, storeJson } from "./storage";
import type { AppElement, FolderListing, PiStatus, PluginContext, SessionRenameResponse, SidebarWorkspace } from "./types";

export async function loadWorkspaces(context: PluginContext, app: AppElement): Promise<SidebarWorkspace[]> {
  const directWorkspaces: SidebarWorkspace[] = directWorkspaceList(context, app);

  if (directWorkspaces.length > 0) {
    storeWorkspaceCache(directWorkspaces);
    saveWorkspaceCacheInBackground(context, directWorkspaces);
    return directWorkspaces;
  }

  const cachedWorkspaces: SidebarWorkspace[] = await loadWorkspaceCache(context);
  const latestDirectWorkspaces: SidebarWorkspace[] = directWorkspaceList(context, app);

  if (latestDirectWorkspaces.length > 0) {
    storeWorkspaceCache(latestDirectWorkspaces);
    saveWorkspaceCacheInBackground(context, latestDirectWorkspaces);
    return latestDirectWorkspaces;
  }

  return cachedWorkspaces.length > 0 ? cachedWorkspaces : directWorkspaces;
}

export async function deleteWorkspaceById(app: AppElement, workspaceId?: string): Promise<void> {
  if (!workspaceId) {
    return;
  }

  await app.deleteWorkspace?.(workspaceId);
}

export async function createWorkspaceSession(app: AppElement, workspaceId?: string): Promise<string> {
  if (!workspaceId) {
    return "";
  }

  return sessionIdFromResponse(await app.newSession?.(workspaceId));
}

export async function deleteWorkspaceSessionList(
  app: AppElement,
  context: PluginContext,
  workspaceId?: string,
): Promise<void> {
  if (!workspaceId) {
    return;
  }

  await app.deleteWorkspaceSessions?.(workspaceId);
  await context.backend?.("delete-workspace-sessions", { data: { workspaceId } });
}

export async function deleteSessionList(
  app: AppElement,
  context: PluginContext,
  workspaceId: string,
  sessionIds: string[],
): Promise<void> {
  for (const sessionId of sessionIds) {
    await app.deleteSession?.(sessionId);
  }

  await context.backend?.("delete-sessions", { data: { sessionIds, workspaceId } });
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

function saveWorkspaceCacheInBackground(context: PluginContext, workspaces: SidebarWorkspace[]): void {
  void saveWorkspaceCache(context, workspaces).catch((error: unknown): void => {
    console.warn("pi-web-sidebar failed to save workspace cache", error);
  });
}

function directWorkspaceList(context: PluginContext, app: AppElement): SidebarWorkspace[] {
  if (Array.isArray(app.workspaceList)) {
    return app.workspaceList.filter(isSidebarWorkspace);
  }

  return Array.isArray(context.initialWorkspaces) ? context.initialWorkspaces.filter(isSidebarWorkspace) : [];
}

async function loadWorkspaceCache(context: PluginContext): Promise<SidebarWorkspace[]> {
  const result: unknown = await context.backend?.("load-workspace-cache", { data: {} });

  if (isRecord(result) && Array.isArray(result.workspaces)) {
    const backendWorkspaces: SidebarWorkspace[] = result.workspaces.filter(isSidebarWorkspace);
    storeWorkspaceCache(backendWorkspaces);
    return backendWorkspaces;
  }

  return readWorkspaceCache();
}

function readWorkspaceCache(): SidebarWorkspace[] {
  const value: unknown = readStoredValue(WORKSPACE_CACHE_KEY);

  if (!isRecord(value) || !Array.isArray(value.workspaces)) {
    return [];
  }

  return value.workspaces.filter(isSidebarWorkspace);
}

function storeWorkspaceCache(workspaces: SidebarWorkspace[]): void {
  if (workspaces.length === 0) {
    return;
  }

  storeJson(WORKSPACE_CACHE_KEY, { workspaces });
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
