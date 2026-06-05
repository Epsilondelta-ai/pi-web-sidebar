import { afterEach, describe, expect, test } from "bun:test";
import { Window as HappyWindow } from "happy-dom";
import { createSidebarController } from "./src/index";
import { requestPiWeb } from "./src/api";
import type { AppElement, PluginContext, SidebarWorkspace, SubjectLike, SubscriptionLike } from "./src/types";

type ApiCall = { path: string; options: RequestInit };
type BackendCallLog = { method: string; options: { workspaceId?: string; data?: Record<string, unknown> } };
type DragOptions = { clientY?: number };
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
type TestApp = AppElement & {
  testWorkspaces: SidebarWorkspace[];
  renderSidebarWorkspacesCalls: SidebarWorkspace[][];
  renderSidebarWorkspaces: (workspaces: SidebarWorkspace[]) => void;
  baseRenderSidebarWorkspaces: (workspaces: SidebarWorkspace[]) => void;
  renderSortableSidebarWorkspacesCalls: { section: Element; workspaces: SidebarWorkspace[] }[];
  renderSortableSidebarWorkspaces: (section: Element, workspaces: SidebarWorkspace[]) => void;
  restoreSidebarCalls: number;
  restoreSidebar: () => number;
  applyGridCalls: number;
  applyGrid: () => number;
  startResizeCalls: number;
  startResize: () => number;
  routeCalls: string[];
  route: (route: string) => number;
  openWorkspacePathCalls: string[];
  openWorkspacePath: (path: string) => Promise<number>;
  reorderWorkspacesCalls: string[][];
  reorderWorkspaces: (ids: string[]) => number;
  reorderWorkspaceSessionsCalls: { workspaceId: string; ids: string[] }[];
  reorderWorkspaceSessions: (workspaceId: string, ids: string[]) => number;
  sidebarSortableCleanupCalls: number;
  sidebarSortableUnmounted?: boolean;
  newSession?: () => Promise<void>;
  clearActiveSession?: () => void;
};

type TestContext = PluginContext & { apiCalls: ApiCall[]; backendCalls?: BackendCallLog[] };

let windowRef: HappyWindow | undefined;

afterEach(() => {
  windowRef?.happyDOM?.close();
  windowRef = undefined;
  globalThis.window = undefined as unknown as Window & typeof globalThis;
  globalThis.document = undefined as unknown as Document;
  globalThis.prompt = undefined as unknown as typeof prompt;
  globalThis.confirm = undefined as unknown as typeof confirm;
  globalThis.localStorage = undefined as unknown as Storage;
});

function setupApp(): TestApp {
  windowRef = new HappyWindow();
  windowRef.SyntaxError = SyntaxError;
  globalThis.window = windowRef as unknown as Window & typeof globalThis;
  globalThis.document = windowRef.document as unknown as Document;
  document.body.innerHTML = `
    <pi-app data-sidebar="open">
      <section class="app-body">
        <div class="sidebar-wrap" data-native-sidebar><aside class="sidebar"><div class="sb-section"><div class="sb-head"></div></div></aside></div>
        <main class="main"></main>
      </section>
    </pi-app>`;
  const app: TestApp | null = document.querySelector<TestApp>("pi-app");

  if (!app) {
    throw new Error("test app not found");
  }

  app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [] }];
  app.renderSidebarWorkspacesCalls = [];
  app.renderSidebarWorkspaces = (workspaces) => app.renderSidebarWorkspacesCalls.push(workspaces);
  app.baseRenderSidebarWorkspaces = app.renderSidebarWorkspaces;
  app.renderSortableSidebarWorkspacesCalls = [];
  app.renderSortableSidebarWorkspaces = (section, workspaces) => {
    app.renderSortableSidebarWorkspacesCalls.push({ section, workspaces });
  };
  app.restoreSidebarCalls = 0;
  app.restoreSidebar = () => app.restoreSidebarCalls += 1;
  app.applyGridCalls = 0;
  app.applyGrid = () => app.applyGridCalls += 1;
  app.startResizeCalls = 0;
  app.startResize = () => app.startResizeCalls += 1;
  app.routeCalls = [];
  app.route = (route) => app.routeCalls.push(route);
  app.openWorkspacePathCalls = [];
  app.openWorkspacePath = async (path) => app.openWorkspacePathCalls.push(path);
  app.reorderWorkspacesCalls = [];
  app.reorderWorkspaces = (ids) => app.reorderWorkspacesCalls.push(ids);
  app.reorderWorkspaceSessionsCalls = [];
  app.reorderWorkspaceSessions = (workspaceId, ids) => app.reorderWorkspaceSessionsCalls.push({ workspaceId, ids });
  app.sidebarSortableCleanupCalls = 0;
  app.sidebarSortableCleanup = () => app.sidebarSortableCleanupCalls += 1;
  app.sidebarSortableRoot = { unmount: () => app.sidebarSortableUnmounted = true };
  app.sidebarSortableRenderToken = Symbol("old-render");
  globalThis.confirm = () => true;
  globalThis.localStorage = windowRef.localStorage;
  return app;
}

function testContext(app: TestApp, overrides: Partial<TestContext> = {}): TestContext {
  const context: TestContext = {
    initialWorkspaces: app.testWorkspaces,
    apiCalls: [],
    async apiRequest(path: string, options: RequestInit = {}): Promise<unknown> {
      context.apiCalls.push({ path, options });
      if (path === "/api/workspaces") {
        return { workspaces: app.testWorkspaces };
      }
      return {};
    },
    ...overrides,
  };
  return context;
}

class TestSubject<T> implements SubjectLike<T> {
  closed: boolean;
  subscribers: ((value: T) => void)[];
  value: T | undefined;

  constructor(initialValue?: T) {
    this.closed = false;
    this.subscribers = [];
    this.value = initialValue;
  }

  subscribe(callback: (value: T) => void): SubscriptionLike {
    this.subscribers.push(callback);
    if (arguments.length > 0 && this.value !== undefined) {
      callback(this.value);
    }

    return {
      unsubscribe: () => {
        this.subscribers = this.subscribers.filter((subscriber: (value: T) => void): boolean => subscriber !== callback);
      },
    };
  }

  next(value: T): void {
    this.value = value;
    for (const subscriber of this.subscribers) {
      subscriber(value);
    }
  }

  complete(): void {
    this.closed = true;
  }
}

function testRxjs(): PluginContext["rxjs"] {
  return {
    Subject: TestSubject,
    BehaviorSubject: TestSubject,
  };
}

function dragEvent(type: string, options: DragOptions = {}): Event {
  const event: Event & { dataTransfer?: { setData(): void; setDragImage(): void } } = new window.Event(type, {
    bubbles: true,
    cancelable: true,
  });
  event.dataTransfer = {
    setData: (): void => undefined,
    setDragImage: (): void => undefined,
  };
  Object.defineProperty(event, "clientY", { value: options.clientY || 0 });
  return event;
}

function requireElement<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element: T | null = root.querySelector<T>(selector);

  if (!element) {
    throw new Error(`missing element: ${selector}`);
  }

  return element;
}

function deferred<T>(): Deferred<T> {
  let resolveDeferred: ((value: T) => void) | undefined;
  const promise: Promise<T> = new Promise((resolve: (value: T) => void): void => {
    resolveDeferred = resolve;
  });

  if (!resolveDeferred) {
    throw new Error("deferred resolver was not initialized");
  }

  return { promise, resolve: resolveDeferred };
}

describe("pi-web-sidebar plugin", () => {
  test("mounts plugin sidebar directly under app body and detaches native sidebar", async () => {
    const app = setupApp();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();

    const body = requireElement(app, ".app-body");
    const pluginSidebar = body.firstElementChild;

    if (!(pluginSidebar instanceof window.HTMLElement)) {
      throw new Error("plugin sidebar not mounted");
    }

    expect(pluginSidebar.hasAttribute("data-pi-web-sidebar-plugin")).toBe(true);
    expect(pluginSidebar.querySelector("[data-action='refresh-workspaces']")).toBeTruthy();
    expect(pluginSidebar.querySelector("[data-pi-web-sidebar-action='open-workspace']")).toBeTruthy();
    expect(pluginSidebar.querySelector("[data-action='route-picker']")).toBeFalsy();
    expect(pluginSidebar.querySelector(".sb-footer")).toBeFalsy();
    expect(pluginSidebar.querySelector("[data-action='open-settings']")).toBeFalsy();
    expect(app.querySelector("[data-native-sidebar]")).toBeFalsy();
    expect(requireElement(pluginSidebar, "[data-workspace-group='w1'] .label").textContent).toBe("one");
    expect(requireElement(pluginSidebar, "[data-workspace-group='w1'] .ws-path").textContent).toBe("/one");
    expect(app.renderSidebarWorkspacesCalls).toEqual([]);
    expect(app.renderSortableSidebarWorkspacesCalls).toEqual([]);
    expect(app.restoreSidebarCalls).toBe(0);
    expect(app.sidebarSortableCleanupCalls).toBe(1);
    expect(app.sidebarSortableUnmounted).toBe(true);
    expect(app.sidebarSortableRoot).toBeUndefined();
    expect(app.sidebarSortableRenderToken).toBeUndefined();
  });

  test("dispose removes plugin sidebar and restores native sidebar", () => {
    const app = setupApp();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    controller.dispose();

    expect(app.querySelector("[data-pi-web-sidebar-plugin]")).toBeFalsy();
    expect(app.querySelector("[data-pi-web-sidebar-picker]")).toBeFalsy();
    expect(app.querySelector("[data-native-sidebar]")).toBeTruthy();
    expect(app.renderSidebarWorkspaces).toBe(app.baseRenderSidebarWorkspaces);
    expect(app.applyGridCalls).toBe(0);
    expect(app.sidebarSortableRoot).toBeUndefined();
    expect(app.sidebarSortableRenderToken).toBeUndefined();
  });

  test("dispose restores native sidebar hidden when host state is collapsed", () => {
    const app = setupApp();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    app.dataset.sidebar = "collapsed";
    controller.dispose();

    expect(requireElement<HTMLElement>(app, "[data-native-sidebar]").hidden).toBe(true);
  });

  test("mounts without a native sidebar", () => {
    const app = setupApp();
    app.querySelector("[data-native-sidebar]")?.remove();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();

    expect(app.querySelector("[data-pi-web-sidebar-plugin]")).toBeTruthy();
    expect(requireElement(app, ".app-body").firstElementChild?.hasAttribute("data-pi-web-sidebar-plugin")).toBe(true);
  });

  test("mount and dispose are idempotent", () => {
    const app = setupApp();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    controller.mount();
    controller.dispose();

    expect(app.querySelector("[data-pi-web-sidebar-plugin]")).toBeFalsy();
    expect(app.querySelectorAll("[data-native-sidebar]")).toHaveLength(1);
  });

  test("controller renders workspace changes without host sidebar renderers", () => {
    const app = setupApp();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    controller.render([{ id: "w2", name: "two", path: "/two", sessions: [] }]);

    expect(app.querySelector("[data-workspace-group='w1']")).toBeFalsy();
    expect(requireElement<HTMLElement>(app, "[data-workspace-group='w2'] .label").textContent).toBe("two");
    expect(app.renderSidebarWorkspacesCalls).toEqual([]);
    expect(app.renderSortableSidebarWorkspacesCalls).toEqual([]);
  });

  test("exposes RxJS sidebar state and events for other plugins", async () => {
    const app = setupApp();
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", title: "one" }] }];
    const controller = createSidebarController(app, testContext(app, { rxjs: testRxjs() }));
    const states: import("./src/types").SidebarSnapshot[] = [];
    const events: import("./src/types").SidebarActionEvent[] = [];

    controller.mount();
    const sidebarApi = app.piWebSidebar;

    if (!sidebarApi) {
      throw new Error("sidebar api not mounted");
    }

    const stateSubscription = sidebarApi.state$.subscribe((state) => states.push(state));
    const eventSubscription = sidebarApi.events$.subscribe((event) => events.push(event));
    controller.render([{ id: "w2", name: "two", path: "/two", sessions: [] }]);

    expect(sidebarApi.getSnapshot().workspaceCount).toBe(1);
    expect(sidebarApi.getSnapshot().sessionCount).toBe(0);
    expect(states.at(-1)?.workspaces[0]?.id).toBe("w2");
    expect(events.some((event) => event.type === "state" && event.reason === "render-workspaces")).toBe(true);

    controller.dispose();

    expect(app.piWebSidebar).toBeUndefined();
    expect(stateSubscription).toBeTruthy();
    expect(eventSubscription).toBeTruthy();
  });

  test("adds fallback grip handles to plugin-rendered rows", async () => {
    const app = setupApp();
    app.testWorkspaces = [{ id: "w1", name: "one", sessions: [{ id: "s1", title: "one" }] }];
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    await Promise.resolve();

    expect(app.querySelector(".workspace-drag-handle")?.getAttribute("draggable")).toBe("true");
    expect(app.querySelector(".session-drag-handle")?.getAttribute("draggable")).toBe("true");
    expect(app.querySelector("[data-session='s1'] .session-menu-button")?.getAttribute("aria-controls")).toBe("session-menu-s1");
    expect(app.querySelector("[data-session='s1'] .session-menu [data-action='rename-session']")).toBeTruthy();
    expect(app.querySelector("[data-session='s1'] .session-menu [data-action='delete-session']")).toBeTruthy();
    const sidebarStyle = document.getElementById("pi-web-sidebar-fallback-drag-style")?.textContent;
    expect(sidebarStyle).toContain(".session-row[data-session]");
    expect(sidebarStyle).toContain("padding-left: 12px");
  });

  test("new session click is handled once and renders session actions without full refresh", async () => {
    const app = setupApp();
    let hostNewSessionClicks = 0;
    let hostNewSessionCalls = 0;
    app.newSession = async () => {
      hostNewSessionCalls += 1;
      app.querySelector(".sb-section")?.replaceChildren();
    };
    const context = testContext(app, {
      async apiRequest(path: string, options: RequestInit = {}): Promise<unknown> {
        context.apiCalls.push({ path, options });
        if (path === "/api/workspaces/w1/sessions" && options.method === "POST") {
          app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", title: "new session" }] }];
          return { session: { id: "s1", title: "new session" } };
        }
        if (path === "/api/workspaces") {
          return { workspaces: app.testWorkspaces };
        }
        return {};
      },
    });
    app.addEventListener("click", (event) => {
      if ((event.target as Element | null)?.closest("[data-action='new-session']")) {
        hostNewSessionClicks += 1;
      }
    });
    const controller = createSidebarController(app, context);

    controller.mount();
    requireElement(app, "[data-action='new-session']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const createCalls = context.apiCalls.filter((call) => call.path === "/api/workspaces/w1/sessions");
    expect(createCalls).toHaveLength(1);
    expect(hostNewSessionClicks).toBe(0);
    expect(hostNewSessionCalls).toBe(0);
    expect(app.querySelectorAll("[data-workspace-group='w1'] .session-row[data-session]")).toHaveLength(1);
    expect(app.querySelector("[data-session='s1'] .session-menu-button")).toBeTruthy();
  });

  test("ignores stale refreshes so session mutations cannot empty the plugin sidebar", async () => {
    const app = setupApp();
    const workspaceRequests: Deferred<{ workspaces: SidebarWorkspace[] }>[] = [];
    const context = testContext(app, {
      async apiRequest(path: string, options: RequestInit = {}): Promise<unknown> {
        context.apiCalls.push({ path, options });

        if (path === "/api/workspaces") {
          const request: Deferred<{ workspaces: SidebarWorkspace[] }> = deferred();
          workspaceRequests.push(request);
          return request.promise;
        }

        if (path === "/api/workspaces/w1/sessions" && options.method === "POST") {
          return { session: { id: "s1", title: "new session" } };
        }

        return {};
      },
    });
    const controller = createSidebarController(app, context);

    controller.mount();
    requireElement(app, "[data-action='new-session']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(workspaceRequests).toHaveLength(2);
    workspaceRequests[1].resolve({
      workspaces: [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", title: "new session" }] }],
    });
    await Promise.resolve();
    await Promise.resolve();
    workspaceRequests[0].resolve({ workspaces: [] });
    await Promise.resolve();
    await Promise.resolve();

    expect(app.querySelector("[data-workspace-group='w1']")).toBeTruthy();
    expect(app.querySelector("[data-session='s1'] .session-drag-handle")).toBeTruthy();
    expect(app.querySelector("[data-workspace-group='w1'] .workspace-drag-handle")).toBeTruthy();
  });

  test("session menu delete keeps the current workspace list when refresh returns transient empty", async () => {
    const app = setupApp();
    app.dataset.activeSessionId = "s1";
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", title: "new session" }] }];
    const context = testContext(app, {
      async apiRequest(path: string, options: RequestInit = {}): Promise<unknown> {
        context.apiCalls.push({ path, options });

        if (path === "/api/sessions/s1" && options.method === "DELETE") {
          return {};
        }

        if (path === "/api/workspaces") {
          return { workspaces: [] };
        }

        return {};
      },
    });
    const controller = createSidebarController(app, context);

    controller.mount();
    await Promise.resolve();
    requireElement(app, "[data-session='s1'] [data-action='session-menu-toggle']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    requireElement(app, "[data-session='s1'] [data-action='delete-session']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.querySelector("[data-workspace-group='w1']")).toBeTruthy();
    expect(app.querySelector("[data-workspace-group='w1'] .workspace-drag-handle")).toBeTruthy();
    expect(app.querySelector("[data-session='s1'] .session-drag-handle")).toBeTruthy();
  });

  test("session menu delete is handled by plugin without blanking sidebar", async () => {
    const app = setupApp();
    app.dataset.activeSessionId = "s1";
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", title: "new session" }] }];
    let hostDeleteClicks = 0;
    let clearActiveSessionCalls = 0;
    app.clearActiveSession = () => {
      clearActiveSessionCalls += 1;
      app.querySelector(".sb-section")?.replaceChildren();
    };
    const context = testContext(app, {
      async apiRequest(path: string, options: RequestInit = {}): Promise<unknown> {
        context.apiCalls.push({ path, options });
        if (path === "/api/sessions/s1" && options.method === "DELETE") {
          app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [] }];
          return {};
        }
        if (path === "/api/workspaces") {
          return { workspaces: app.testWorkspaces };
        }
        return {};
      },
    });
    app.addEventListener("click", (event) => {
      if ((event.target as Element | null)?.closest("[data-action='delete-session']")) {
        hostDeleteClicks += 1;
        app.querySelector(".sb-section")?.replaceChildren();
      }
    });
    const controller = createSidebarController(app, context);

    controller.mount();
    requireElement(app, "[data-session='s1'] [data-action='session-menu-toggle']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    expect(requireElement<HTMLElement>(app, "[data-session='s1'] .session-menu").hidden).toBe(false);
    requireElement(app, "[data-session='s1'] [data-action='delete-session']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(context.apiCalls).toContainEqual({ path: "/api/sessions/s1", options: { method: "DELETE" } });
    expect(hostDeleteClicks).toBe(0);
    expect(clearActiveSessionCalls).toBe(0);
    expect(app.dataset.activeSessionId).toBe("");
    expect(app.querySelector("[data-workspace-group='w1']")).toBeTruthy();
    expect(app.querySelector("[data-workspace-group='w1'] .sessions-empty")?.textContent).toContain("no sessions yet");
    expect(app.querySelector("[data-workspace-group='w1'] [data-action='new-session']")).toBeTruthy();
  });

  test("fallback drag previews workspace and session moves before drop", async () => {
    const app = setupApp();
    app.testWorkspaces = [
      { id: "w1", name: "one", sessions: [{ id: "s1", title: "one" }, { id: "s2", title: "two" }] },
      { id: "w2", name: "two", sessions: [] },
    ];
    app.sidebarOpenWorkspaceId = "w1";
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    await Promise.resolve();
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    };
    const animated: string[] = [];
    app.querySelectorAll(".workspace-group").forEach((group) => {
      group.animate = (() => {
        animated.push(group.dataset.workspaceGroup || "");
        return {} as Animation;
      }) as typeof group.animate;
      group.getBoundingClientRect = (): DOMRect => ({
        bottom: 0,
        height: 10,
        left: 0,
        right: 0,
        top: [...app.querySelectorAll(".workspace-group")].indexOf(group) * 10,
        width: 0,
        x: 0,
        y: 0,
        toJSON: (): Record<string, number> => ({}),
      });
    });
    const workspaceHandle = requireElement(app, "[data-workspace-group='w1'] .workspace-drag-handle");
    const workspaceTarget = requireElement(app, "[data-workspace-group='w2']");
    const pluginSidebar = requireElement(app, "[data-pi-web-sidebar-plugin]");
    workspaceHandle.dispatchEvent(dragEvent("dragstart"));
    expect(pluginSidebar.classList.contains("pi-web-sidebar-dragging-workspace")).toBe(true);
    expect([...app.querySelectorAll<HTMLElement>(".workspace-group > .sessions")].every((sessions) => sessions.hidden)).toBe(true);
    workspaceTarget.dispatchEvent(dragEvent("dragover", { clientY: 19 }));
    pluginSidebar.dispatchEvent(dragEvent("drop"));

    expect([...app.querySelectorAll<HTMLElement>(".workspace-group")].map((group) => group.dataset.workspaceGroup || "")).toEqual(["w2", "w1"]);
    expect(JSON.parse(localStorage.getItem("pi.workspaceOrder") || "[]")).toEqual(["w2", "w1"]);
    expect(animated).toContain("w1");
    expect(requireElement<HTMLElement>(app, "[data-workspace-group='w1'] > .sessions").hidden).toBe(false);
    expect(requireElement<HTMLElement>(app, "[data-workspace-group='w2'] > .sessions").hidden).toBe(true);

    const sessionHandle = requireElement(app, "[data-session='s1'] .session-drag-handle");
    const sessionTarget = requireElement<HTMLElement>(app, "[data-session='s2']");
    sessionTarget.getBoundingClientRect = (): DOMRect => ({
      bottom: 0,
      height: 10,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: (): Record<string, number> => ({}),
    });
    sessionHandle.dispatchEvent(dragEvent("dragstart"));
    sessionTarget.dispatchEvent(dragEvent("dragover", { clientY: 9 }));
    pluginSidebar.dispatchEvent(dragEvent("drop"));

    expect([...app.querySelectorAll<HTMLElement>("[data-workspace-group='w1'] .session-row[data-session]")].map((row) => row.dataset.session || "")).toEqual(["s2", "s1"]);
    expect(JSON.parse(localStorage.getItem("pi.sessionOrder") || "{}")).toEqual({ w1: ["s2", "s1"] });
  });

  test("plugin open button uses backend folder browser and opens selected workspace path", async () => {
    const app = setupApp();
    const context = testContext(app, { backendCalls: [], backend: async (method, options) => {
      context.backendCalls!.push({ method, options });
      return { path: "/picked", displayPath: "/picked", parent: "/", folders: [{ name: "workspace", path: "/picked/workspace" }] };
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    requireElement(app, "[data-pi-web-sidebar-action='open-workspace']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(context.backendCalls).toEqual([{ method: "list-folders", options: { data: { path: "~" } } }]);
    expect(requireElement<HTMLElement>(app, "[data-pi-web-sidebar-picker]").hidden).toBe(false);
    expect(app.querySelector("[data-picker-action='up']")).toBeFalsy();
    const rows = [...app.querySelectorAll(".pi-sidebar-picker-row")];
    expect(rows[0].textContent).toContain("..");
    expect(rows[1].textContent).toContain("workspace");

    requireElement(app, "[data-picker-action='open-current']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.apiCalls).toContainEqual({ path: "/api/workspaces/open", options: { method: "POST", body: JSON.stringify({ path: "/picked" }) } });
    expect(app.dataset.route).toBe("workspace");
  });

  test("plugin folder browser restores focus and closes with Escape", async () => {
    const app = setupApp();
    const context = testContext(app, { backendCalls: [], backend: async (method, options) => {
      context.backendCalls!.push({ method, options });
      return { path: "/picked", displayPath: "/picked", parent: "/", folders: [] };
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    const openButton = requireElement<HTMLButtonElement>(app, "[data-pi-web-sidebar-action='open-workspace']");
    openButton.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });

    const picker = requireElement<HTMLElement>(app, "[data-pi-web-sidebar-picker]");
    expect(document.activeElement).toBe(requireElement<HTMLInputElement>(picker, 'input[name="path"]'));

    picker.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

    expect(picker.hidden).toBe(true);
    expect(document.activeElement).toBe(openButton);
  });

  test("plugin folder browser resets nested dialogs when closed", async () => {
    const app = setupApp();
    const context = testContext(app, { backendCalls: [], backend: async (method, options) => {
      context.backendCalls!.push({ method, options });
      return { path: "/picked", displayPath: "/picked", parent: "/", folders: [] };
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    const openButton = requireElement<HTMLButtonElement>(app, "[data-pi-web-sidebar-action='open-workspace']");
    openButton.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    const picker = requireElement<HTMLElement>(app, "[data-pi-web-sidebar-picker]");
    requireElement(picker, "[data-picker-action='clone']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    expect(requireElement<HTMLElement>(picker, "[data-clone-dialog]").hidden).toBe(false);

    picker.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    picker.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    openButton.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(requireElement<HTMLElement>(picker, "[data-clone-dialog]").hidden).toBe(true);
  });

  test("plugin folder browser restores focus after nested dialog cancel", async () => {
    const app = setupApp();
    const context = testContext(app, { backendCalls: [], backend: async (method, options) => {
      context.backendCalls!.push({ method, options });
      return { path: "/picked", displayPath: "/picked", parent: "/", folders: [] };
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    requireElement(app, "[data-pi-web-sidebar-action='open-workspace']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    const picker = requireElement<HTMLElement>(app, "[data-pi-web-sidebar-picker]");
    const newFolderButton = requireElement<HTMLButtonElement>(picker, "[data-picker-action='new-folder']");
    newFolderButton.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    requireElement<HTMLInputElement>(picker, "[data-new-folder-form] input[name='name']").focus();
    requireElement(picker, "[data-picker-action='new-folder-cancel']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));

    expect(document.activeElement).toBe(newFolderButton);
  });

  test("plugin folder browser traps focus inside nested dialogs", async () => {
    const app = setupApp();
    const context = testContext(app, { backendCalls: [], backend: async (method, options) => {
      context.backendCalls!.push({ method, options });
      return { path: "/picked", displayPath: "/picked", parent: "/", folders: [] };
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    requireElement(app, "[data-pi-web-sidebar-action='open-workspace']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    const picker = requireElement<HTMLElement>(app, "[data-pi-web-sidebar-picker]");
    requireElement(picker, "[data-picker-action='new-folder']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    const createButton = requireElement<HTMLButtonElement>(picker, "[data-new-folder-form] button[type='submit']");
    const nameInput = requireElement<HTMLInputElement>(picker, "[data-new-folder-form] input[name='name']");
    createButton.focus();
    picker.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));

    expect(document.activeElement).toBe(nameInput);
  });

  test("request fallback tolerates empty success responses", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (): Promise<Response> => new Response(null, { status: 204 })) as unknown as typeof fetch;

    try {
      await expect(requestPiWeb({}, "/api/empty")).resolves.toEqual({});
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("plugin folder browser creates a new folder through backend modal and refreshes", async () => {
    const app = setupApp();
    let folders: { name: string; path: string }[] = [];
    const context = testContext(app, { backendCalls: [], backend: async (method, options) => {
      context.backendCalls!.push({ method, options });
      if (method === "create-folder") {
        folders = [{ name: "new-dir", path: "/home/me/new-dir" }];
        return { name: "new-dir", path: "/home/me/new-dir" };
      }
      return { path: "/home/me", parent: "/home", folders };
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    requireElement(app, "[data-pi-web-sidebar-action='open-workspace']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    requireElement(app, "[data-picker-action='new-folder']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    expect(requireElement<HTMLElement>(app, "[data-new-folder-dialog]").hidden).toBe(false);
    requireElement<HTMLInputElement>(app, "[data-new-folder-form] input[name='name']").value = "new-dir";
    requireElement(app, "[data-new-folder-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });

    expect(requireElement<HTMLElement>(app, "[data-new-folder-dialog]").hidden).toBe(true);
    expect(context.backendCalls!.at(-2)).toEqual({ method: "create-folder", options: { data: { parent: "/home/me", name: "new-dir" } } });
    expect(context.backendCalls!.at(-1)).toEqual({ method: "list-folders", options: { data: { path: "/home/me" } } });
    expect(requireElement<HTMLElement>(app, ".pi-sidebar-picker-row[data-path='/home/me/new-dir']").textContent).toContain("new-dir");
  });

  test("plugin folder browser clones a git repository through backend modal and enters clone", async () => {
    const app = setupApp();
    const context = testContext(app, { backendCalls: [], backend: async (method, options) => {
      context.backendCalls!.push({ method, options });
      if (method === "clone-workspace") return { name: "repo", path: "/home/me/repo" };
      if (options.data!.path === "/home/me/repo") return { path: "/home/me/repo", parent: "/home/me", folders: [] };
      return { path: "/home/me", parent: "/home", folders: [{ name: "repo", path: "/home/me/repo" }] };
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    requireElement(app, "[data-pi-web-sidebar-action='open-workspace']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    requireElement(app, "[data-picker-action='clone']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    expect(requireElement<HTMLElement>(app, "[data-clone-dialog]").hidden).toBe(false);
    requireElement<HTMLInputElement>(app, "[data-clone-form] input[name='gitUrl']").value = "https://example.com/repo.git";
    requireElement<HTMLInputElement>(app, "[data-clone-form] input[name='name']").value = "repo";
    requireElement(app, "[data-clone-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });

    expect(requireElement<HTMLElement>(app, "[data-clone-dialog]").hidden).toBe(true);
    expect(context.backendCalls!.at(-3)).toEqual({ method: "clone-workspace", options: { data: { parent: "/home/me", gitUrl: "https://example.com/repo.git", name: "repo" } } });
    expect(context.backendCalls!.at(-1)).toEqual({ method: "list-folders", options: { data: { path: "/home/me/repo" } } });
    expect(requireElement<HTMLElement>(app, "[data-pi-web-sidebar-picker]").dataset.currentPath).toBe("/home/me/repo");
  });

  test("plugin folder browser enters child folders through backend", async () => {
    const app = setupApp();
    const responses: Record<string, { path: string; parent: string; folders: { name: string; path: string }[] }> = {
      "~": { path: "/home/me", parent: "/home", folders: [{ name: "code", path: "/home/me/code" }] },
      "/home/me/code": { path: "/home/me/code", parent: "/home/me", folders: [] },
    };
    const context = testContext(app, { backendCalls: [], backend: async (method, options) => {
      context.backendCalls!.push({ method, options });
      return responses[String(options.data!.path)];
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    requireElement(app, "[data-pi-web-sidebar-action='open-workspace']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    requireElement(app, ".pi-sidebar-picker-row[data-path='/home/me/code']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });

    expect(context.backendCalls!.at(-1)).toEqual({ method: "list-folders", options: { data: { path: "/home/me/code" } } });
    expect(requireElement<HTMLElement>(app, "[data-pi-web-sidebar-picker]").dataset.currentPath).toBe("/home/me/code");
    expect(app.querySelector(".pi-sidebar-picker-empty")).toBeFalsy();
  });

  test("plugin open button falls back to picker route when backend is unavailable", async () => {
    const app = setupApp();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    requireElement(app, "[data-pi-web-sidebar-action='open-workspace']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(app.dataset.route).toBe("picker");
  });

  test("plugin resizer stores width without host startResize", () => {
    const app = setupApp();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    const down = new window.Event("pointerdown");
    Object.defineProperty(down, "clientX", { value: 100 });
    requireElement(app, ".sb-resizer").dispatchEvent(down);
    const move = new window.Event("pointermove");
    Object.defineProperty(move, "clientX", { value: 130 });
    window.dispatchEvent(move);

    expect(app.startResizeCalls).toBe(0);
    expect(app.dataset.sidebarWidth).toBe("310");
    expect(localStorage.getItem("pi.sb.width")).toBe("310");
  });

  test("throws when app body is missing", () => {
    windowRef = new HappyWindow();
    windowRef.SyntaxError = SyntaxError;
    globalThis.window = windowRef as unknown as Window & typeof globalThis;
    globalThis.document = windowRef.document as unknown as Document;
    document.body.innerHTML = "<pi-app></pi-app>";

    expect(() => createSidebarController(requireElement(document, "pi-app") as AppElement).mount()).toThrow(".app-body");
  });
});
