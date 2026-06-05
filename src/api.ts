import type { ApiOptions, FolderListing, PluginContext, SessionRenameResponse, SidebarWorkspace } from "./types";

export async function loadWorkspaces(context: PluginContext): Promise<SidebarWorkspace[]> {
  const result: unknown = await requestPiWeb(context, "/api/workspaces");

  if (!isRecord(result) || !Array.isArray(result.workspaces)) {
    return [];
  }

  return result.workspaces.filter(isSidebarWorkspace);
}

export function openWorkspacePath(context: PluginContext, path: string): Promise<unknown> {
  return requestPiWeb(context, "/api/workspaces/open", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function deleteWorkspaceById(context: PluginContext, workspaceId?: string): Promise<unknown> | undefined {
  if (!workspaceId) {
    return undefined;
  }

  return requestPiWeb(context, `/api/workspaces/${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
}

export function createWorkspaceSession(context: PluginContext, workspaceId?: string): Promise<unknown> | undefined {
  if (!workspaceId) {
    return undefined;
  }

  return requestPiWeb(context, `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`, { method: "POST" });
}

export function deleteWorkspaceSessionList(context: PluginContext, workspaceId?: string): Promise<unknown> | undefined {
  if (!workspaceId) {
    return undefined;
  }

  return requestPiWeb(context, `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`, { method: "DELETE" });
}

export async function renameSessionById(
  context: PluginContext,
  sessionId: string,
  title: string,
): Promise<SessionRenameResponse> {
  const result: unknown = await requestPiWeb(context, `/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });

  return isRecord(result) ? { session: isRecord(result.session) ? { title: asString(result.session.title) } : undefined } : {};
}

export function deleteSessionById(context: PluginContext, sessionId: string): Promise<unknown> {
  return requestPiWeb(context, `/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

export async function requestPiWeb(context: PluginContext, path: string, options: ApiOptions = {}): Promise<unknown> {
  if (typeof context.apiRequest === "function") {
    return context.apiRequest(path, options);
  }

  const response: Response = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }

  return response.json() as Promise<unknown>;
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

function apiBase(): string {
  if (globalThis.PI_WEB_API_BASE !== undefined) {
    return String(globalThis.PI_WEB_API_BASE);
  }

  return "";
}

async function responseErrorMessage(response: Response): Promise<string> {
  let message: string = `${response.status} ${response.statusText}`;

  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === "string") {
      message = body.error;
    }
  } catch {}

  return message;
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
