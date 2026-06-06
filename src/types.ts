export type SidebarMode = "open" | "collapsed";

export type SidebarActionEvent = {
  type: string;
  detail?: Record<string, unknown>;
  reason?: string;
  snapshot: SidebarSnapshot;
};

export type SidebarSession = {
  id: string;
  title?: string;
  name?: string;
  parentId?: string;
  lastUsed?: string;
  live?: boolean;
  active?: boolean;
  unreadCompleted?: boolean;
  unread?: boolean;
  kind?: string;
  status?: string;
};

export type SidebarWorkspace = {
  id: string;
  name?: string;
  path?: string;
  live?: boolean;
  sessionCount?: number;
  sessions?: SidebarSession[];
};

export type SelectedSession = {
  sessionId: string;
  workspaceId: string;
};

export type SidebarSnapshot = {
  activeSessionId: string;
  activeWorkspaceId: string;
  collapsed: boolean;
  element: HTMLElement | null;
  openWorkspaceId: string;
  sessionCount: number;
  sidebar: SidebarMode;
  width: number;
  workspaceCount: number;
  workspaces: SidebarWorkspace[];
};

export type SubscriptionLike = {
  unsubscribe(): void;
};

export type SubjectLike<T> = {
  subscribe(callback: (value: T) => void): SubscriptionLike;
  next(value: T): void;
  complete(): void;
};

export type PiWebRegistry = {
  readonly version: string;
  subject<T>(name: string): SubjectLike<T>;
  behaviorSubject<T>(name: string, initialValue: T): SubjectLike<T>;
};

export type ApiOptions = RequestInit & {
  headers?: HeadersInit;
};

export type BackendCall = (method: string, input: { workspaceId?: string; data?: Record<string, unknown> }) => Promise<unknown>;
export type ApiRequest = (path: string, options?: ApiOptions) => Promise<unknown>;

export type PluginContext = {
  app?: AppElement;
  initialWorkspaces?: SidebarWorkspace[];
  backend?: BackendCall;
  apiRequest?: ApiRequest;
};

export type AppElement = HTMLElement & {
  sidebarOpenWorkspaceId?: string;
  sidebarSortableCleanup?: () => void;
  sidebarSortableRoot?: { unmount?: () => void };
  sidebarSortableRenderToken?: unknown;
};

export type SidebarBridge = {
  emitState(reason: string): void;
  emitEvent(type: string, detail?: Record<string, unknown>): void;
  dispose(): void;
};

export type SidebarController = {
  mount(): void;
  dispose(): void;
  render(nextWorkspaces?: SidebarWorkspace[]): void;
  refresh(): Promise<SidebarWorkspace[]>;
  readonly element: HTMLElement | null;
};

export type DragItem = {
  type: "workspace" | "session";
  element: HTMLElement;
};

export type FolderEntry = {
  name?: string;
  path: string;
  displayPath?: string;
};

export type FolderListing = {
  path?: string;
  parent?: string;
  displayPath?: string;
  folders?: FolderEntry[];
};

export type SessionRenameResponse = {
  session?: { title?: string };
};
