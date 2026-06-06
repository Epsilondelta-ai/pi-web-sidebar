import type { AppElement, FolderListing, PluginContext, SessionRenameResponse, SidebarWorkspace } from "./types";

export async function loadWorkspaces(context: PluginContext, app: AppElement): Promise<SidebarWorkspace[]> {
  const directWorkspaces: SidebarWorkspace[] = directWorkspaceList(context, app);

  if (directWorkspaces.length > 0) {
    await saveWorkspaceCache(context, directWorkspaces);
    return directWorkspaces;
  }

  const cachedWorkspaces: SidebarWorkspace[] = await loadWorkspaceCache(context);
  return cachedWorkspaces.length > 0 ? cachedWorkspaces : directWorkspaces;
}

export async function deleteWorkspaceById(app: AppElement, workspaceId?: string): Promise<void> {
  if (!workspaceId) {
    return;
  }

  await app.deleteWorkspace?.(workspaceId);
}

export async function createWorkspaceSession(app: AppElement, workspaceId?: string): Promise<void> {
  if (!workspaceId) {
    return;
  }

  await app.newSession?.(workspaceId);
}

export async function deleteWorkspaceSessionList(app: AppElement, workspaceId?: string): Promise<void> {
  if (!workspaceId) {
    return;
  }

  await app.deleteWorkspaceSessions?.(workspaceId);
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

export async function saveWorkspaceCache(context: PluginContext, workspaces: SidebarWorkspace[]): Promise<void> {
  if (workspaces.length === 0) {
    return;
  }

  await context.backend?.("save-workspace-cache", { data: { workspaces } });
}

function directWorkspaceList(context: PluginContext, app: AppElement): SidebarWorkspace[] {
  if (Array.isArray(app.workspaceList)) {
    return app.workspaceList.filter(isSidebarWorkspace);
  }

  return Array.isArray(context.initialWorkspaces) ? context.initialWorkspaces.filter(isSidebarWorkspace) : [];
}

async function loadWorkspaceCache(context: PluginContext): Promise<SidebarWorkspace[]> {
  const result: unknown = await context.backend?.("load-workspace-cache", { data: {} });

  if (!isRecord(result) || !Array.isArray(result.workspaces)) {
    return [];
  }

  return result.workspaces.filter(isSidebarWorkspace);
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
