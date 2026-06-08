import { afterEach, describe, expect, test } from "bun:test";
import { Window as HappyWindow } from "happy-dom";
import { loadWorkspaces } from "./src/api";
import { WORKSPACE_CACHE_KEY } from "./src/constants";
import { createSidebarController } from "./src/index";
import type { AppElement, PluginContext, SidebarWorkspace, SubjectLike, SubscriptionLike } from "./src/types";

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
  openWorkspacePath: (path: string) => Promise<void>;
  reorderWorkspacesCalls: string[][];
  reorderWorkspaces: (ids: string[]) => number;
  reorderWorkspaceSessionsCalls: { workspaceId: string; ids: string[] }[];
  reorderWorkspaceSessions: (workspaceId: string, ids: string[]) => number;
  sidebarSortableCleanupCalls: number;
  sidebarSortableUnmounted?: boolean;
  clearActiveSession?: () => void;
};

type TestContext = PluginContext & { backendCalls?: BackendCallLog[] };

let windowRef: HappyWindow | undefined;

afterEach(() => {
  windowRef?.happyDOM?.close();
  windowRef = undefined;
  globalThis.window = undefined as unknown as Window & typeof globalThis;
  globalThis.document = undefined as unknown as Document;
  globalThis.prompt = undefined as unknown as typeof prompt;
  globalThis.confirm = undefined as unknown as typeof confirm;
  globalThis.localStorage = undefined as unknown as Storage;
  delete globalThis.piWeb;
  delete globalThis.piWebSidebar;
});

function setupApp(): TestApp {
  windowRef = new HappyWindow();
  windowRef.SyntaxError = SyntaxError;
  globalThis.window = windowRef as unknown as Window & typeof globalThis;
  globalThis.document = windowRef.document as unknown as Document;
  document.body.innerHTML = `
    <pi-app data-sidebar="open">
      <header class="topbar"><span class="brand">pi/web</span><div class="actions" data-plugin-toolbar></div></header>
      <section class="app-body"></section>
    </pi-app>`;
  const app: TestApp | null = document.querySelector<TestApp>("pi-app");

  if (!app) {
    throw new Error("test app not found");
  }

  let testWorkspaces: SidebarWorkspace[] = [{ id: "w1", name: "one", path: "/one", sessions: [] }];
  Object.defineProperty(app, "testWorkspaces", {
    get: (): SidebarWorkspace[] => testWorkspaces,
    set: (value: SidebarWorkspace[]): void => {
      testWorkspaces = value;
      app.workspaceList = value;
    },
  });
  app.workspaceList = testWorkspaces;
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
  app.openWorkspacePath = async (path) => { app.openWorkspacePathCalls.push(path); };
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
  installTestPiWeb();
  return app;
}

function testContext(app: TestApp, overrides: Partial<TestContext> = {}): TestContext {
  const context: TestContext = {
    initialWorkspaces: app.testWorkspaces,
    async backend(method: string, options: { workspaceId?: string; data?: Record<string, unknown> }): Promise<unknown> {
      if (method === "load-workspace-cache") {
        return { workspaces: app.testWorkspaces };
      }

      if (method === "save-workspace-cache") {
        return { path: "~/.pi-web/pi-web-sidebar/workspaces.json" };
      }

      if (method === "validate-workspaces") {
        return { workspaces: options.data?.workspaces || [] };
      }

      if (method === "pi-status") {
        return { available: true, checkedAt: "2026-06-07T00:00:00.000Z", executable: "/bin/pi", version: "pi test" };
      }

      return overrides.backend?.(method, options) || {};
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
    if (this.closed) {
      return;
    }

    this.value = value;
    for (const subscriber of this.subscribers) {
      subscriber(value);
    }
  }

  complete(): void {
    this.closed = true;
  }
}

function installTestPiWeb(): Map<string, TestSubject<unknown>> {
  const subjects = new Map<string, TestSubject<unknown>>();
  globalThis.piWeb = {
    version: "test",
    subject<T>(name: string): SubjectLike<T> {
      return registrySubject<T>(subjects, name);
    },
    behaviorSubject<T>(name: string, initialValue: T): SubjectLike<T> {
      const subject = registrySubject<T>(subjects, name);
      if (subject.value === undefined) {
        subject.value = initialValue;
      }
      return subject;
    },
  };
  return subjects;
}

function registrySubject<T>(subjects: Map<string, TestSubject<unknown>>, name: string): TestSubject<T> {
  let subject = subjects.get(name);
  if (!subject) {
    subject = new TestSubject<unknown>();
    subjects.set(name, subject);
  }
  return subject as TestSubject<T>;
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

function nonCacheBackendCalls(context: TestContext): BackendCallLog[] {
  return (context.backendCalls || []).filter((call: BackendCallLog): boolean => call.method !== "save-workspace-cache");
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
  test("mounts plugin sidebar directly under empty app body", async () => {
    const app = setupApp();
    app.removeAttribute("data-sidebar");
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
    expect(app.querySelectorAll(".app-body > :not([data-pi-web-sidebar-plugin])")).toHaveLength(0);
    expect((pluginSidebar as HTMLElement).hidden).toBe(false);
    expect(app.dataset.sidebar).toBe("open");
    expect(requireElement<HTMLElement>(app, ".app-body").style.gridTemplateColumns).toBe("280px 1fr");
    expect(requireElement(pluginSidebar, "[data-workspace-group='w1'] .label").textContent).toBe("one");
    expect(requireElement(pluginSidebar, "[data-workspace-group='w1'] .ws-path").textContent).toBe("/one");
    expect(app.renderSidebarWorkspacesCalls).toEqual([]);
    expect(app.renderSortableSidebarWorkspacesCalls).toEqual([]);
    expect(app.restoreSidebarCalls).toBe(0);
    expect(app.sidebarSortableCleanupCalls).toBe(0);
    expect(app.sidebarSortableUnmounted).toBeUndefined();
    expect(app.sidebarSortableRoot).toBeTruthy();
    expect(app.sidebarSortableRenderToken).toBeTruthy();
  });

  test("dispose removes plugin sidebar and leaves app body empty", () => {
    const app = setupApp();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    controller.dispose();

    expect(app.querySelector("[data-pi-web-sidebar-plugin]")).toBeFalsy();
    expect(app.querySelector("[data-pi-web-sidebar-picker]")).toBeFalsy();
    expect(requireElement(app, ".app-body").children).toHaveLength(0);
    expect(app.renderSidebarWorkspaces).toBe(app.baseRenderSidebarWorkspaces);
    expect(app.applyGridCalls).toBe(0);
    expect(app.sidebarSortableRoot).toBeUndefined();
    expect(app.sidebarSortableRenderToken).toBeUndefined();
  });

  test("dispose leaves empty app body empty when host state is collapsed", () => {
    const app = setupApp();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    app.dataset.sidebar = "collapsed";
    controller.dispose();

    expect(requireElement(app, ".app-body").children).toHaveLength(0);
  });

  test("recreates a malformed plugin sidebar instead of rendering nothing", () => {
    const app = setupApp();
    requireElement(app, ".app-body").insertAdjacentHTML("afterbegin", '<div data-pi-web-sidebar-plugin></div>');
    const controller = createSidebarController(app, testContext(app));

    controller.mount();

    expect(app.querySelector("[data-pi-web-sidebar-plugin] .sb-head")?.textContent).toContain("workspaces");
    expect(requireElement(app, "[data-workspace-group='w1'] .label").textContent).toBe("one");
  });

  test("renders an actionable empty workspace state", () => {
    const app = setupApp();
    app.testWorkspaces = [];
    const controller = createSidebarController(app, testContext(app));

    controller.mount();

    expect(requireElement(app, "[data-pi-web-sidebar-plugin] .workspace-empty").textContent).toContain("press open");
  });

  test("removes empty workspace state when workspaces render later", () => {
    const app = setupApp();
    app.testWorkspaces = [];
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    controller.render([{ id: "w2", name: "two", path: "/two", sessions: [] }]);

    expect(app.querySelector("[data-pi-web-sidebar-plugin] .workspace-empty")).toBeFalsy();
    expect(requireElement(app, "[data-workspace-group='w2'] .sessions").children).toHaveLength(1);
    expect(requireElement(app, "[data-workspace-group='w2'] .label").textContent).toBe("two");
  });

  test("mounts the sidebar toggle into the document topbar when app does not contain the header", () => {
    const app = setupApp();
    const internalTopbar = requireElement<HTMLElement>(app, ".topbar");
    const externalTopbar = document.createElement("header");
    internalTopbar.remove();
    externalTopbar.className = "topbar";
    externalTopbar.innerHTML = '<span class="brand">pi/web</span>';
    document.body.insertBefore(externalTopbar, app);
    const controller = createSidebarController(app, testContext(app));

    controller.mount();

    const expand = requireElement<HTMLButtonElement>(document, "[data-pi-web-sidebar-toggle]");
    expect(expand.parentElement).toBe(externalTopbar);
    expect(externalTopbar.firstElementChild).toBe(expand);
    expect(expand.style.display).toBe("inline-flex");

    controller.dispose();

    expect(document.querySelector("[data-pi-web-sidebar-toggle]")).toBeFalsy();
  });

  test("collapsed restore keeps an expand control visible", () => {
    const app = setupApp();
    localStorage.setItem("pi.sb.collapsed", "1");
    const controller = createSidebarController(app, testContext(app));

    controller.mount();

    const pluginSidebar = requireElement<HTMLElement>(app, "[data-pi-web-sidebar-plugin]");
    const expand = requireElement<HTMLElement>(app, "[data-pi-web-sidebar-toggle]");
    const topbar = requireElement<HTMLElement>(app, ".topbar");
    expect(pluginSidebar.hidden).toBe(true);
    expect(expand.style.display).toBe("inline-flex");
    expect(expand.parentElement).toBe(topbar);
    expect(topbar.firstElementChild).toBe(expand);

    expand.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));

    expect(pluginSidebar.hidden).toBe(false);
    expect(expand.style.display).toBe("inline-flex");
    expect(expand.getAttribute("aria-label")).toBe("collapse sidebar");
  });

  test("header sidebar toggle stays visible while open", () => {
    const app = setupApp();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();

    const pluginSidebar = requireElement<HTMLElement>(app, "[data-pi-web-sidebar-plugin]");
    const expand = requireElement<HTMLButtonElement>(app, "[data-pi-web-sidebar-toggle]");
    expect(pluginSidebar.hidden).toBe(false);
    expect(expand.style.display).toBe("inline-flex");
    expect(expand.getAttribute("aria-label")).toBe("collapse sidebar");
  });

  test("header sidebar toggle closes and reopens the sidebar", () => {
    const app = setupApp();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();

    const pluginSidebar = requireElement<HTMLElement>(app, "[data-pi-web-sidebar-plugin]");
    const expand = requireElement<HTMLButtonElement>(app, "[data-pi-web-sidebar-toggle]");
    const topbar = requireElement<HTMLElement>(app, ".topbar");
    expect(pluginSidebar.hidden).toBe(false);
    expect(expand.style.display).toBe("inline-flex");
    expect(expand.getAttribute("aria-label")).toBe("collapse sidebar");
    expect(expand.parentElement).toBe(topbar);
    expect(topbar.firstElementChild).toBe(expand);

    expand.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));

    expect(pluginSidebar.hidden).toBe(true);
    expect(expand.style.display).toBe("inline-flex");
    expect(expand.getAttribute("aria-label")).toBe("expand sidebar");

    expand.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));

    expect(pluginSidebar.hidden).toBe(false);
    expect(expand.style.display).toBe("inline-flex");
  });

  test("mount and dispose are idempotent", () => {
    const app = setupApp();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    controller.mount();
    controller.dispose();

    expect(app.querySelector("[data-pi-web-sidebar-plugin]")).toBeFalsy();
    expect(app.querySelector("[data-pi-web-sidebar-toggle]")).toBeFalsy();
    expect(requireElement(app, ".app-body").children).toHaveLength(0);
  });

  test("does not reuse or remove a host-owned sidebar button", () => {
    const app = setupApp();
    const topbar = requireElement<HTMLElement>(app, ".topbar");
    const hostButton = document.createElement("button");
    const controller = createSidebarController(app, testContext(app));
    hostButton.type = "button";
    hostButton.className = "sb-expand-btn";
    hostButton.textContent = "host";
    topbar.append(hostButton);

    controller.mount();

    const pluginButton = requireElement<HTMLButtonElement>(app, "[data-pi-web-sidebar-toggle]");
    expect(pluginButton).not.toBe(hostButton);
    expect(topbar.firstElementChild).toBe(pluginButton);

    pluginButton.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));

    expect(requireElement<HTMLElement>(app, "[data-pi-web-sidebar-plugin]").hidden).toBe(true);

    controller.dispose();

    expect(hostButton.isConnected).toBe(true);
    expect(app.querySelector("[data-pi-web-sidebar-toggle]")).toBeFalsy();
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

  test("mounts before existing workspace content so the sidebar renders on the left", async () => {
    const app = setupApp();
    const workspaceView: HTMLDivElement = document.createElement("div");
    workspaceView.dataset.view = "workspace";
    requireElement(app, ".app-body").append(workspaceView);
    const controller = createSidebarController(app, testContext(app));

    controller.mount();

    const body = requireElement(app, ".app-body");
    const pluginSidebar = requireElement<HTMLElement>(body, "[data-pi-web-sidebar-plugin]");
    expect(body.firstElementChild).toBe(pluginSidebar);
    expect(body.children[1]).toBe(workspaceView);
    expect(body.style.gridTemplateColumns).toBe("280px 1fr");
    expect(pluginSidebar.style.gridColumn).toBe("1");
    expect(workspaceView.style.gridColumn).toBe("2");
  });

  test("overrides host grid columns so desktop main content stays right of the sidebar", async () => {
    const app = setupApp();
    const body = requireElement(app, ".app-body");
    const workspaceMain: HTMLElement = document.createElement("main");
    const sessionMain: HTMLElement = document.createElement("main");
    const composer: HTMLElement = document.createElement("section");
    const customOverlay: HTMLElement = document.createElement("div");
    const tree: HTMLElement = document.createElement("aside");
    workspaceMain.style.gridColumn = "1";
    sessionMain.style.gridColumn = "1";
    composer.style.gridColumn = "1";
    customOverlay.style.gridColumn = "1 / -1";
    composer.dataset.pluginComposerRoot = "";
    tree.dataset.pluginSidebar = "";
    app.dataset.tree = "on";
    body.append(workspaceMain, tree, sessionMain, composer, customOverlay);
    const controller = createSidebarController(app, testContext(app));

    controller.mount();

    expect(requireElement<HTMLElement>(body, "[data-pi-web-sidebar-plugin]").style.gridColumn).toBe("1");
    expect(workspaceMain.style.gridColumn).toBe("2");
    expect(sessionMain.style.gridColumn).toBe("2");
    expect(composer.style.gridColumn).toBe("2");
    expect(customOverlay.style.gridColumn).toBe("1 / -1");
    expect(tree.style.gridColumn).toBe("3");
    expect(body.style.gridTemplateColumns).toBe("280px 1fr 320px");
  });

  test("loadWorkspaces returns direct workspace state without waiting for cache save", async () => {
    const app = setupApp();
    const saveDeferred = deferred<unknown>();
    const context = testContext(app, { backend: async (method, options) => {
      if (method === "load-workspace-cache") {
        return { workspaces: [] };
      }

      if (method === "validate-workspaces") {
        return { workspaces: options.data?.workspaces || [] };
      }

      if (method === "save-workspace-cache") {
        return saveDeferred.promise;
      }

      throw new Error(`unexpected backend call: ${method}`);
    } });

    const workspaces = await Promise.race([
      loadWorkspaces(context, app),
      new Promise((resolve: (value: string) => void): void => { setTimeout((): void => resolve("save-blocked"), 20); }),
    ]);

    expect(workspaces).toEqual(app.testWorkspaces);
    expect(localStorage.getItem(WORKSPACE_CACHE_KEY)).toBeNull();
    saveDeferred.resolve({});
  });

  test("loadWorkspaces validates direct workspaces without persisting outside controller guard", async () => {
    const app = setupApp();
    const validatedWorkspaces: SidebarWorkspace[] = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "real" }] }];
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "stale", active: true }] }];
    app.workspaceList = app.testWorkspaces;
    const context = testContext(app, { backend: async (method: string, options: BackendCallLog["options"]): Promise<unknown> => {
      if (method === "validate-workspaces") {
        expect(options.data?.workspaces).toEqual(app.testWorkspaces);
        return { workspaces: validatedWorkspaces };
      }

      if (method === "save-workspace-cache") {
        expect(options.data?.workspaces).toEqual(validatedWorkspaces);
        return {};
      }

      return {};
    } });

    expect(await loadWorkspaces(context, app)).toEqual(validatedWorkspaces);
    expect(localStorage.getItem(WORKSPACE_CACHE_KEY)).toBeNull();
  });

  test("loadWorkspaces returns backend file cache before local stale cache", async () => {
    const app = setupApp();
    app.testWorkspaces = [];
    app.workspaceList = [];
    const cachedWorkspaces: SidebarWorkspace[] = [{ id: "local", name: "local", path: "/local", sessions: [{ id: "stale" }] }];
    const backendWorkspaces: SidebarWorkspace[] = [{ id: "backend", name: "backend", path: "/backend", sessions: [] }];
    const context = testContext(app, { initialWorkspaces: [], backend: async (method) => {
      if (method === "load-workspace-cache") {
        return { workspaces: backendWorkspaces };
      }

      throw new Error(`unexpected backend call: ${method}`);
    } });
    localStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify({ workspaces: cachedWorkspaces }));

    expect(await loadWorkspaces(context, app)).toEqual(backendWorkspaces);
    expect(localStorage.getItem(WORKSPACE_CACHE_KEY)).toContain("local");
  });

  test("controller renders local cache, file cache, then actual session cache in order", async () => {
    const app = setupApp();
    app.testWorkspaces = [];
    app.workspaceList = [];
    const validateDeferred = deferred<{ workspaces: SidebarWorkspace[] }>();
    const localWorkspaces: SidebarWorkspace[] = [{ id: "local", name: "local", path: "/local", sessions: [] }];
    const fileWorkspaces: SidebarWorkspace[] = [{ id: "file", name: "file", path: "/file", sessions: [] }];
    const actualWorkspaces: SidebarWorkspace[] = [{
      id: "file",
      name: "file",
      path: "/file",
      sessions: [{ id: "actual", name: "actual" }],
    }];
    const saveCalls: SidebarWorkspace[][] = [];
    const context = testContext(app, { initialWorkspaces: [], backend: async (method, options) => {
      if (method === "load-workspace-cache") {
        return { workspaces: fileWorkspaces };
      }

      if (method === "validate-workspaces") {
        expect(options.data?.workspaces).toEqual(fileWorkspaces);
        return validateDeferred.promise;
      }

      if (method === "save-workspace-cache") {
        saveCalls.push(options.data?.workspaces as SidebarWorkspace[]);
        return {};
      }

      if (method === "pi-status") {
        return { available: true, checkedAt: "2026-06-07T00:00:00.000Z" };
      }

      throw new Error(`unexpected backend call: ${method}`);
    } });
    localStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify({ workspaces: localWorkspaces }));
    const controller = createSidebarController(app, context);

    controller.mount();

    expect(requireElement<HTMLElement>(app, "[data-workspace-group='local'] .label").textContent).toBe("local");
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });

    expect(app.querySelector("[data-workspace-group='local']")).toBeFalsy();
    expect(requireElement<HTMLElement>(app, "[data-workspace-group='file'] .label").textContent).toBe("file");
    expect(localStorage.getItem(WORKSPACE_CACHE_KEY)).toContain("file");

    validateDeferred.resolve({ workspaces: actualWorkspaces });
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });

    expect(requireElement<HTMLElement>(app, "[data-session='actual']").dataset.title).toBe("actual");
    expect(localStorage.getItem(WORKSPACE_CACHE_KEY)).toContain("actual");
    expect(saveCalls.at(-1)).toEqual(actualWorkspaces);
    controller.dispose();
  });

  test("controller ignores stale actual persistence from an older refresh", async () => {
    const app = setupApp();
    app.testWorkspaces = [];
    const firstValidate = deferred<{ workspaces: SidebarWorkspace[] }>();
    const secondValidate = deferred<{ workspaces: SidebarWorkspace[] }>();
    const staleWorkspaces: SidebarWorkspace[] = [{ id: "stale", name: "stale", path: "/stale", sessions: [] }];
    const actualWorkspaces: SidebarWorkspace[] = [{ id: "actual", name: "actual", path: "/actual", sessions: [] }];
    app.workspaceList = staleWorkspaces;
    const saveCalls: SidebarWorkspace[][] = [];
    let validateCalls = 0;
    const context = testContext(app, { initialWorkspaces: [], backend: async (method, options) => {
      if (method === "load-workspace-cache") {
        return { workspaces: [] };
      }

      if (method === "validate-workspaces") {
        validateCalls += 1;
        return validateCalls === 1 ? firstValidate.promise : secondValidate.promise;
      }

      if (method === "save-workspace-cache") {
        saveCalls.push(options.data?.workspaces as SidebarWorkspace[]);
        return {};
      }

      if (method === "pi-status") {
        return { available: true, checkedAt: "2026-06-07T00:00:00.000Z" };
      }

      throw new Error(`unexpected backend call: ${method}`);
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });
    app.workspaceList = actualWorkspaces;
    const refreshPromise = globalThis.piWebSidebar!.refresh();
    secondValidate.resolve({ workspaces: actualWorkspaces });
    await refreshPromise;
    firstValidate.resolve({ workspaces: staleWorkspaces });
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });

    expect(app.querySelector("[data-workspace-group='stale']")).toBeFalsy();
    expect(requireElement<HTMLElement>(app, "[data-workspace-group='actual'] .label").textContent).toBe("actual");
    expect(localStorage.getItem(WORKSPACE_CACHE_KEY)).toContain("actual");
    expect(localStorage.getItem(WORKSPACE_CACHE_KEY)).not.toContain("stale");
    expect(saveCalls).toEqual([actualWorkspaces]);
    controller.dispose();
  });

  test("controller serializes backend cache saves so stale writes cannot finish last", async () => {
    const app = setupApp();
    app.testWorkspaces = [];
    app.workspaceList = [];
    const firstSave = deferred<unknown>();
    const staleWorkspaces: SidebarWorkspace[] = [{ id: "stale", name: "stale", path: "/stale", sessions: [] }];
    const actualWorkspaces: SidebarWorkspace[] = [{ id: "actual", name: "actual", path: "/actual", sessions: [] }];
    const saveCalls: SidebarWorkspace[][] = [];
    const context = testContext(app, { initialWorkspaces: [], backend: async (method, options) => {
      if (method === "load-workspace-cache") {
        return { workspaces: [] };
      }

      if (method === "validate-workspaces") {
        return { workspaces: options.data?.workspaces || [] };
      }

      if (method === "save-workspace-cache") {
        saveCalls.push(options.data?.workspaces as SidebarWorkspace[]);
        return saveCalls.length === 1 ? firstSave.promise : {};
      }

      if (method === "pi-status") {
        return { available: true, checkedAt: "2026-06-07T00:00:00.000Z" };
      }

      throw new Error(`unexpected backend call: ${method}`);
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });
    app.workspaceList = staleWorkspaces;
    await globalThis.piWebSidebar!.refresh();
    app.workspaceList = actualWorkspaces;
    await globalThis.piWebSidebar!.refresh();

    expect(saveCalls).toEqual([staleWorkspaces]);
    expect(localStorage.getItem(WORKSPACE_CACHE_KEY)).toContain("actual");
    firstSave.resolve({});
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });

    expect(saveCalls).toEqual([staleWorkspaces, actualWorkspaces]);
    controller.dispose();
  });

  test("controller ignores stale file cache localStorage from an older refresh", async () => {
    const app = setupApp();
    app.testWorkspaces = [];
    app.workspaceList = [];
    const firstCache = deferred<{ workspaces: SidebarWorkspace[] }>();
    const staleWorkspaces: SidebarWorkspace[] = [{ id: "stale-file", name: "stale-file", path: "/stale-file", sessions: [] }];
    const actualWorkspaces: SidebarWorkspace[] = [{ id: "actual", name: "actual", path: "/actual", sessions: [] }];
    let cacheCalls = 0;
    const context = testContext(app, { initialWorkspaces: [], backend: async (method, options) => {
      if (method === "load-workspace-cache") {
        cacheCalls += 1;
        return cacheCalls === 1 ? firstCache.promise : { workspaces: [] };
      }

      if (method === "validate-workspaces") {
        return { workspaces: actualWorkspaces };
      }

      if (method === "save-workspace-cache") {
        return {};
      }

      if (method === "pi-status") {
        return { available: true, checkedAt: "2026-06-07T00:00:00.000Z" };
      }

      throw new Error(`unexpected backend call: ${method}`);
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });
    app.workspaceList = actualWorkspaces;
    await globalThis.piWebSidebar!.refresh();
    firstCache.resolve({ workspaces: staleWorkspaces });
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });

    expect(app.querySelector("[data-workspace-group='stale-file']")).toBeFalsy();
    expect(localStorage.getItem(WORKSPACE_CACHE_KEY)).toContain("actual");
    expect(localStorage.getItem(WORKSPACE_CACHE_KEY)).not.toContain("stale-file");
    controller.dispose();
  });

  test("loadWorkspaces falls back to direct workspaces when file cache backend fails", async () => {
    const app = setupApp();
    const context = testContext(app, { backend: async (method, options) => {
      if (method === "load-workspace-cache") {
        throw new Error("legacy backend without cache method");
      }

      if (method === "validate-workspaces") {
        return { workspaces: options.data?.workspaces || [] };
      }

      throw new Error(`unexpected backend call: ${method}`);
    } });

    expect(await loadWorkspaces(context, app)).toEqual(app.testWorkspaces);
  });

  test("loadWorkspaces rechecks direct workspace state after cache fallback latency", async () => {
    const app = setupApp();
    app.workspaceList = [];
    const cacheDeferred = deferred<unknown>();
    const lateWorkspaces: SidebarWorkspace[] = [{ id: "late", name: "late", path: "/late", sessions: [] }];
    const context = testContext(app, { initialWorkspaces: [], backend: async (method) => {
      if (method === "load-workspace-cache") {
        return cacheDeferred.promise;
      }

      if (method === "save-workspace-cache") {
        return {};
      }

      throw new Error(`unexpected backend call: ${method}`);
    } });
    const promise = loadWorkspaces(context, app);

    app.workspaceList = lateWorkspaces;
    cacheDeferred.resolve({ workspaces: [] });

    expect(await promise).toEqual(lateWorkspaces);
  });

  test("empty initial mount does not duplicate cache fallback while waiting for host workspaces", async () => {
    const app = setupApp();
    app.testWorkspaces = [];
    app.workspaceList = [];
    let cacheLoads = 0;
    const cacheDeferred = deferred<unknown>();
    const context = testContext(app, { initialWorkspaces: [], backend: async (method) => {
      if (method === "load-workspace-cache") {
        cacheLoads += 1;
        return cacheDeferred.promise;
      }

      if (method === "pi-status") {
        return { available: true, checkedAt: "2026-06-07T00:00:00.000Z" };
      }

      throw new Error(`unexpected backend call: ${method}`);
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 150); });

    expect(cacheLoads).toBe(1);
    cacheDeferred.resolve({ workspaces: [] });
    controller.dispose();
  });

  test("polls host workspaces until sessions render without pressing refresh", async () => {
    const app = setupApp();
    app.testWorkspaces = [];
    app.workspaceList = [];
    const context = testContext(app, { initialWorkspaces: [], backend: async (method) => {
      if (method === "load-workspace-cache") {
        return { workspaces: [] };
      }

      if (method === "save-workspace-cache") {
        return {};
      }

      if (method === "pi-status") {
        return { available: true, checkedAt: "2026-06-07T00:00:00.000Z" };
      }

      throw new Error(`unexpected backend call: ${method}`);
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 220); });
    app.workspaceList = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", name: "loaded" }] }];
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 140); });

    expect(requireElement<HTMLElement>(app, "[data-session='s1'] .title").textContent).toBe("loaded");
    controller.dispose();
  });

  test("keeps polling until delayed host sessions populate an existing workspace", async () => {
    const app = setupApp();
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [] }];
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 220); });
    app.workspaceList = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", name: "late session" }] }];
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 140); });

    expect(requireElement<HTMLElement>(app, "[data-session='s1'] .title").textContent).toBe("late session");
    controller.dispose();
  });

  test("replaces stale cached workspaces when direct sessions arrive later", async () => {
    const app = setupApp();
    app.testWorkspaces = [];
    app.workspaceList = [];
    localStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify({
      workspaces: [{ id: "cached", name: "cached", path: "/cached", sessions: [] }],
    }));
    const context = testContext(app, { initialWorkspaces: [], backend: async (method) => {
      if (method === "load-workspace-cache") {
        return { workspaces: [] };
      }

      if (method === "save-workspace-cache") {
        return {};
      }

      if (method === "pi-status") {
        return { available: true, checkedAt: "2026-06-07T00:00:00.000Z" };
      }

      throw new Error(`unexpected backend call: ${method}`);
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 220); });
    app.workspaceList = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", name: "direct" }] }];
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 140); });

    expect(app.querySelector("[data-workspace-group='cached']")).toBeFalsy();
    expect(requireElement<HTMLElement>(app, "[data-session='s1'] .title").textContent).toBe("direct");
    controller.dispose();
  });

  test("migrates cached legacy session title to name and updates localStorage", async () => {
    const app = setupApp();
    app.testWorkspaces = [];
    app.workspaceList = [];
    localStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify({
      workspaces: [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", title: "legacy title" }] }],
    }));
    const controller = createSidebarController(app, testContext(app, { initialWorkspaces: [], backend: undefined }));

    controller.mount();
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });

    const cached: unknown = JSON.parse(localStorage.getItem(WORKSPACE_CACHE_KEY) || "{}");
    expect(requireElement<HTMLElement>(app, "[data-session='s1'] .title").textContent).toBe("legacy title");
    expect(cached).toEqual({
      workspaces: [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", name: "legacy title" }] }],
    });
    controller.dispose();
  });

  test("exposes RxJS sidebar state and events for other plugins", async () => {
    const app = setupApp();
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", name: "one" }] }];
    const controller = createSidebarController(app, testContext(app));
    const states: import("./src/types").SidebarSnapshot[] = [];
    const events: import("./src/types").SidebarActionEvent[] = [];
    const piStatuses: import("./src/types").PiStatus[] = [];
    const rxStates: import("./src/types").SidebarSnapshot[] = [];
    const rxEvents: import("./src/types").SidebarActionEvent[] = [];
    const rxPiStatuses: import("./src/types").PiStatus[] = [];
    const state$ = globalThis.piWeb!.behaviorSubject<import("./src/types").SidebarSnapshot>(
      "plugin.pi-web-sidebar.state",
      {} as import("./src/types").SidebarSnapshot,
    );
    const events$ = globalThis.piWeb!.subject<import("./src/types").SidebarActionEvent>("plugin.pi-web-sidebar.event");
    const piStatus$ = globalThis.piWeb!.behaviorSubject<import("./src/types").PiStatus>(
      "plugin.pi-web-sidebar.piStatus",
      { available: false, checkedAt: "" },
    );

    controller.mount();
    const sidebarApi = globalThis.piWebSidebar;
    const rxChannels = sidebarApi?.channels;

    if (!sidebarApi || !rxChannels) {
      throw new Error("missing sidebar API");
    }

    expect(app.piWebSidebar).toBe(sidebarApi);
    expect(sidebarApi.getSnapshot().workspaceCount).toBe(1);
    expect(sidebarApi.getSnapshot().activeSessionId).toBe("");

    const stateSubscription = state$.subscribe((state) => states.push(state));
    const eventSubscription = events$.subscribe((event) => events.push(event));
    const piStatusSubscription = piStatus$.subscribe((status) => piStatuses.push(status));
    const rxStateSubscription = rxChannels.state$.subscribe((state) => rxStates.push(state));
    const rxEventSubscription = rxChannels.events$.subscribe((event) => rxEvents.push(event));
    const rxPiStatusSubscription = rxChannels.piStatus$.subscribe((status) => rxPiStatuses.push(status));
    expect(await sidebarApi.refresh()).toEqual(app.testWorkspaces);
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });
    controller.render([{ id: "w2", name: "two", path: "/two", sessions: [] }]);

    expect(states.at(-1)?.workspaceCount).toBe(1);
    expect(states.at(-1)?.sessionCount).toBe(0);
    expect(states.at(-1)?.workspaces[0]?.id).toBe("w2");
    expect(states.at(-1)?.piStatus.available).toBe(true);
    expect(piStatuses.at(-1)?.version).toBe("pi test");
    expect(rxStates.at(-1)?.workspaces[0]?.id).toBe("w2");
    expect(rxPiStatuses.at(-1)?.version).toBe("pi test");
    expect(events.some((event) => event.type === "state" && event.reason === "render-workspaces")).toBe(true);
    expect(events.some((event) => event.type === "pi-status")).toBe(true);
    expect(rxEvents.some((event) => event.type === "pi-status")).toBe(true);

    controller.dispose();
    expect(states.at(-1)?.element).toBeNull();
    expect(events.at(-1)?.snapshot.element).toBeNull();
    expect((state$ as TestSubject<import("./src/types").SidebarSnapshot>).closed).toBe(false);
    expect((events$ as TestSubject<import("./src/types").SidebarActionEvent>).closed).toBe(false);
    expect(globalThis.piWebSidebar).toBeUndefined();
    expect(app.piWebSidebar).toBeUndefined();

    const secondController = createSidebarController(app, testContext(app));
    secondController.mount();
    secondController.render([{ id: "w3", name: "three", path: "/three", sessions: [] }]);

    expect(states.at(-1)?.workspaces[0]?.id).toBe("w3");
    expect(events.some((event) => event.type === "disposed")).toBe(true);
    expect(stateSubscription).toBeTruthy();
    expect(eventSubscription).toBeTruthy();
    expect(piStatusSubscription).toBeTruthy();
    expect(rxStateSubscription).toBeTruthy();
    expect(rxEventSubscription).toBeTruthy();
    expect(rxPiStatusSubscription).toBeTruthy();
    secondController.dispose();
  });

  test("persists selected session and publishes selectedSession over RxJS", async () => {
    const app = setupApp();
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", name: "one" }] }];
    const controller = createSidebarController(app, testContext(app));
    const selected: import("./src/types").SelectedSession[] = [];
    const events: import("./src/types").SidebarActionEvent[] = [];
    globalThis.piWeb!.behaviorSubject<import("./src/types").SelectedSession | null>(
      "plugin.pi-web-sidebar.selectedSession",
      null,
    ).subscribe((value) => {
      if (value) {
        selected.push(value);
      }
    });
    globalThis.piWeb!.subject<import("./src/types").SidebarActionEvent>("plugin.pi-web-sidebar.event")
      .subscribe((event) => events.push(event));
    controller.mount();
    await Promise.resolve();
    requireElement<HTMLElement>(app, "[data-session='s1']").click();

    expect(localStorage.getItem("plugin.pi-web-sidebar.activeSessionId")).toBe("s1");
    expect(localStorage.getItem("plugin.pi-web-sidebar.activeWorkspaceId")).toBe("w1");
    expect(selected.at(-1)).toEqual({ sessionId: "s1", workspaceId: "w1" });
    expect(events.some((event) => event.type === "session.selected")).toBe(true);
    expect(events.some((event) => event.type === "select-session")).toBe(false);
  });

  test("piWeb channels reconcile active id and first-message title updates", async () => {
    installTestPiWeb();
    const app = setupApp();
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", name: "placeholder" }] }];
    const controller = createSidebarController(app, testContext(app));
    controller.mount();
    await Promise.resolve();
    globalThis.piWeb?.behaviorSubject<string | null>("session.activeId", null).next("s1");
    globalThis.piWeb?.subject<Record<string, unknown>>("session.changed").next({ sessionId: "s1", name: "abcdefghijklmnop" });

    expect(localStorage.getItem("plugin.pi-web-sidebar.activeSessionId")).toBe("s1");
    expect(requireElement<HTMLElement>(app, "[data-session='s1'] .title").textContent).toBe("abcdefghijkl...");
  });

  test("workspace rows only show green indicators when active", async () => {
    const app = setupApp();
    app.dataset.activeWorkspaceId = "w1";
    app.testWorkspaces = [
      { id: "w1", name: "one", sessions: [{ id: "s1", name: "running", status: "running" }] },
      { id: "w2", name: "two", live: false, sessions: [{ id: "s2", name: "running", status: "running" }] },
    ];
    const controller = createSidebarController(app, testContext(app));
    controller.mount();
    await Promise.resolve();

    expect(app.querySelector("[data-workspace-group='w1'] .ws-name .dot.live")).toBeTruthy();
    expect(app.querySelector("[data-workspace-group='w2'] .ws-name .dot.live")).toBeFalsy();
  });

  test("session rows render subagent and team agent tree badges", async () => {
    const app: TestApp = setupApp();
    app.testWorkspaces = [{
      id: "w1",
      name: "one",
      sessions: [
        { id: "parent", name: "parent" },
        { id: "sub", parentId: "parent", name: "subagent-Beatrice", kind: "subagent" },
        { id: "team", parentId: "parent", name: "pi agent teams - teammate Emilia", kind: "team agent" },
      ],
    }];
    const controller: ReturnType<typeof createSidebarController> = createSidebarController(
      app,
      testContext(app),
    );

    controller.mount();
    await Promise.resolve();

    const rows: HTMLElement[] = [...app.querySelectorAll<HTMLElement>("[data-workspace-group='w1'] .session-row[data-session]")];
    expect(rows.map((row: HTMLElement): string => row.dataset.session || "")).toEqual(["parent", "sub", "team"]);
    expect(requireElement<HTMLElement>(app, "[data-session='sub']").dataset.depth).toBe("1");
    expect(requireElement<HTMLElement>(app, "[data-session='team']").dataset.depth).toBe("1");
    expect(requireElement<HTMLElement>(app, "[data-session='sub'] .title").textContent).toBe("Beatrice");
    expect(requireElement<HTMLElement>(app, "[data-session='sub'] .meta").textContent).toBe("subagent");
    expect(requireElement<HTMLElement>(app, "[data-session='team'] .title").textContent).toBe("Emilia");
    expect(requireElement<HTMLElement>(app, "[data-session='team'] .meta").textContent).toBe("team agent");
  });

  test("orphan agent sessions keep child indentation while parent sessions stay flush", async () => {
    const app: TestApp = setupApp();
    app.testWorkspaces = [{
      id: "w1",
      name: "one",
      sessions: [
        { id: "parent", name: "parent" },
        { id: "sub", parentId: "missing-parent", name: "sub worker", kind: "subagent" },
        { id: "team", parentId: "missing-team", name: "team worker", kind: "team agent" },
      ],
    }];
    const controller: ReturnType<typeof createSidebarController> = createSidebarController(
      app,
      testContext(app),
    );

    controller.mount();
    await Promise.resolve();

    expect(requireElement<HTMLElement>(app, "[data-session='parent']").dataset.depth).toBe("0");
    expect(requireElement<HTMLElement>(app, "[data-session='sub']").dataset.depth).toBe("1");
    expect(requireElement<HTMLElement>(app, "[data-session='team']").dataset.depth).toBe("1");
  });

  test("external parent session deletion removes descendant rows", async () => {
    const app = setupApp();
    app.dataset.activeSessionId = "grandchild";
    app.testWorkspaces = [{
      id: "w1",
      name: "one",
      sessions: [
        { id: "parent", name: "parent" },
        { id: "child", parentId: "parent", name: "child" },
        { id: "grandchild", parentId: "child", name: "grandchild" },
        { id: "sibling", name: "sibling" },
      ],
    }];
    const sidebarEvents: import("./src/types").SidebarActionEvent[] = [];
    globalThis.piWeb!.subject<import("./src/types").SidebarActionEvent>("plugin.pi-web-sidebar.event")
      .subscribe((event: import("./src/types").SidebarActionEvent): void => {
        sidebarEvents.push(event);
      });
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    await Promise.resolve();
    app.dispatchEvent(new window.CustomEvent("pi-web-sidebar:session-deleted", {
      bubbles: true,
      detail: { sessionId: "parent", workspaceId: "w1" },
    }));

    expect(app.querySelector("[data-session='parent']")).toBeFalsy();
    expect(app.querySelector("[data-session='child']")).toBeFalsy();
    expect(app.querySelector("[data-session='grandchild']")).toBeFalsy();
    expect(app.querySelector("[data-session='sibling']")).toBeTruthy();
    const activeEndEvent: import("./src/types").SidebarActionEvent | undefined = sidebarEvents.find(
      (event: import("./src/types").SidebarActionEvent): boolean => event.type === "active.end",
    );
    expect(app.dataset.activeSessionId).toBe("");
    expect(activeEndEvent?.detail?.sessionIds).toEqual(["parent", "child", "grandchild"]);
  });

  test("session rows use active or inactive left indicators without waiting text", async () => {
    const app = setupApp();
    app.testWorkspaces = [{
      id: "w1",
      name: "one",
      sessions: [
        { id: "live", name: "live", status: "running" },
        { id: "active-waiting", name: "real chat", active: true, kind: " waiting " },
        { id: "completed", name: "completed", active: true, unreadCompleted: true },
        { id: "waiting", name: "waiting", kind: " waiting ", status: "waiting", unread: true },
      ],
    }];
    const controller = createSidebarController(app, testContext(app));
    controller.mount();
    await Promise.resolve();

    expect(app.querySelector("[data-session='live'] .session-indicator.live")).toBeTruthy();
    expect(app.querySelector("[data-session='live'] .session-indicator.idle")).toBeFalsy();
    expect(requireElement<HTMLElement>(app, "[data-session='live'] .session-indicator").title).toBe("session active");
    expect(app.querySelector("[data-session='active-waiting'] .session-indicator.idle")).toBeTruthy();
    expect(app.querySelector("[data-session='active-waiting'] .session-indicator.live")).toBeFalsy();
    expect(requireElement<HTMLElement>(app, "[data-session='active-waiting'] .session-indicator").title).toBe("session inactive");
    expect(requireElement<HTMLElement>(app, "[data-session='active-waiting'] .meta").hidden).toBe(true);
    expect(app.querySelector("[data-session='completed'] .session-indicator.idle")).toBeTruthy();
    expect(app.querySelector("[data-session='completed'] .session-indicator.live")).toBeFalsy();
    expect(requireElement<HTMLElement>(app, "[data-session='completed'] .session-indicator").title).toBe("session inactive");
    expect(requireElement<HTMLElement>(app, "[data-session='completed'] .title").textContent).toBe("completed");
    expect(app.querySelector("[data-session='waiting'] .session-indicator.idle")).toBeTruthy();
    expect(app.querySelector("[data-session='waiting'] .session-indicator.live")).toBeFalsy();
    expect(app.querySelector("[data-session='waiting'] .session-indicator.unread")).toBeFalsy();
    expect(requireElement<HTMLElement>(app, "[data-session='waiting'] .session-indicator").title).toBe("session inactive");
    expect(requireElement<HTMLElement>(app, "[data-session='waiting'] .meta").hidden).toBe(true);
  });

  test("chat input submitted marks sessions dirty and schedules refresh", async () => {
    installTestPiWeb();
    const app = setupApp();
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", name: "old" }] }];
    const controller = createSidebarController(app, testContext(app));
    controller.mount();
    await Promise.resolve();
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", name: "new title" }] }];
    globalThis.piWeb?.subject("chat.input.submitted").next({ text: "hello", attachments: [] });
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(requireElement<HTMLElement>(app, "[data-session='s1'] .title").textContent).toBe("new title");
  });

  test("adds fallback grip handles to plugin-rendered rows", async () => {
    const app = setupApp();
    app.testWorkspaces = [{ id: "w1", name: "one", sessions: [{ id: "s1", name: "one" }] }];
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    await Promise.resolve();

    expect(app.querySelector(".workspace-drag-handle")?.getAttribute("draggable")).toBe("true");
    expect(app.querySelector(".session-drag-handle")?.getAttribute("draggable")).toBe("true");
    expect(app.querySelector("[data-session='s1'] .session-menu-button")?.getAttribute("aria-controls")).toBe("session-menu-s1");
    expect(app.querySelector("[data-session='s1'] .session-menu [data-action='rename-session']")).toBeTruthy();
    expect(app.querySelector("[data-session='s1'] .session-menu [data-action='delete-session']")).toBeTruthy();
    const sidebarStyle = document.getElementById("pi-web-sidebar-fallback-drag-style")?.textContent;
    expect(sidebarStyle).toContain("[data-pi-web-sidebar-plugin] {");
    expect(sidebarStyle).toContain("grid-template-columns: minmax(0, 1fr) 4px");
    expect(sidebarStyle).toContain(".session-row[data-session]");
    expect(sidebarStyle).toContain(".session-row[data-session] .session-main");
    expect(sidebarStyle).toContain("text-overflow: ellipsis");
    expect(sidebarStyle).toContain("--pi-web-sidebar-session-depth");
    expect(sidebarStyle).toContain(".session-row.child-session::before");
    expect(sidebarStyle).toContain(".clear-sessions-row");
  });

  test("new session click is handled once and renders session actions without full refresh", async () => {
    const app = setupApp();
    let hostNewSessionClicks = 0;
    let hostNewSessionCalls = 0;
    app.newSession = async (workspaceId: string): Promise<void> => {
      hostNewSessionCalls += 1;
      app.testWorkspaces = [{ id: workspaceId, name: "one", path: "/one", sessions: [{ id: "s1", name: "new session" }] }];
      app.workspaceList = app.testWorkspaces;
    };
    app.addEventListener("click", (event) => {
      if ((event.target as Element | null)?.closest("[data-action='new-session']")) {
        hostNewSessionClicks += 1;
      }
    });
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    requireElement(app, "[data-action='new-session']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hostNewSessionCalls).toBe(1);
    expect(hostNewSessionClicks).toBe(0);
    expect(app.querySelectorAll("[data-workspace-group='w1'] .session-row[data-session]")).toHaveLength(1);
    expect(app.querySelector("[data-session='s1'] .session-menu-button")).toBeTruthy();
    expect(app.querySelector("[data-session='s1'].active")).toBeTruthy();
    expect(app.dataset.activeSessionId || "").toBe("s1");
    expect(app.dataset.route).toBe("workspace");
    expect(app.querySelector("[data-session='s1'] .session-indicator.live")).toBeFalsy();
    expect(app.querySelector("[data-workspace-group='w1'] .ws-name .dot.live")).toBeFalsy();
  });

  test("new session falls back to host creation when backend create-session fails", async () => {
    const app = setupApp();
    app.newSession = async (workspaceId: string): Promise<unknown> => {
      app.testWorkspaces = [{ id: workspaceId, name: "one", path: "/one", sessions: [{ id: "fallback", name: "fallback" }] }];
      return { sessionId: "fallback" };
    };
    const controller = createSidebarController(app, testContext(app, {
      backend: async (method: string): Promise<unknown> => {
        if (method === "create-session") {
          throw new Error("legacy backend");
        }

        return {};
      },
    }));

    controller.mount();
    requireElement(app, "[data-action='new-session']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });

    expect(app.querySelector("[data-session='fallback'].active")).toBeTruthy();
    expect(app.dataset.activeSessionId || "").toBe("fallback");
  });

  test("new session without a host id renders optimistic session until real session appears", async () => {
    const app = setupApp();
    const sidebarEvents: import("./src/types").SidebarActionEvent[] = [];
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "old", name: "old session" }] }];
    app.newSession = async (): Promise<unknown> => undefined;
    globalThis.piWeb!.subject<import("./src/types").SidebarActionEvent>("plugin.pi-web-sidebar.event").subscribe((event) => {
      sidebarEvents.push(event);
    });
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    requireElement(app, "[data-action='new-session']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve: (value: void) => void): void => { setTimeout(resolve, 0); });

    const optimisticRow: HTMLElement = requireElement(app, "[data-workspace-group='w1'] [data-session^='optimistic-']");
    const optimisticSessionId: string = optimisticRow.dataset.session || "";
    expect(optimisticRow.textContent).toContain("New chat");
    expect(optimisticRow.classList.contains("active")).toBe(true);
    expect(app.dataset.activeSessionId || "").toBe(optimisticSessionId);
    expect(app.dataset.route).toBe("workspace");
    expect(app.querySelector("[data-session='old']")).toBeTruthy();
    expect(sidebarEvents.some((event) => event.type === "session.created")).toBe(true);
    expect(sidebarEvents.some((event) => event.type === "new-session")).toBe(true);

    await controller.refresh();

    expect(app.querySelector("[data-workspace-group='w1'] [data-session^='optimistic-']")).toBeTruthy();
    expect(app.dataset.activeSessionId || "").toBe(optimisticSessionId);

    app.testWorkspaces = [{
      id: "w1",
      name: "one",
      path: "/one",
      sessions: [{ id: "real", name: "real session" }, { id: "old", name: "old session" }],
    }];
    await controller.refresh();

    expect(app.querySelector("[data-workspace-group='w1'] [data-session^='optimistic-']")).toBeFalsy();
    expect(app.querySelector("[data-session='real'] .title")?.textContent).toBe("real session");
    expect(app.dataset.activeSessionId || "").toBe("real");
    expect(app.querySelector("[data-session='real'].active")).toBeTruthy();
  });

  test("uses cached workspaces when direct pi state is empty", async () => {
    const app = setupApp();
    app.testWorkspaces = [];
    app.workspaceList = [];
    const cached: SidebarWorkspace[] = [{ id: "cached", name: "cached", path: "/cached", sessions: [{ id: "s1", name: "saved" }] }];
    const context = testContext(app, {
      backend: async (method: string): Promise<unknown> => method === "load-workspace-cache" ? { workspaces: cached } : {},
    });
    const controller = createSidebarController(app, context);

    controller.mount();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.querySelector("[data-workspace-group='cached']")).toBeTruthy();
    expect(app.querySelector("[data-session='s1'] .session-drag-handle")).toBeTruthy();
  });

  test("session menu delete keeps the current workspace list when pi state is unchanged", async () => {
    const app = setupApp();
    app.dataset.activeSessionId = "s1";
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", name: "new session" }] }];
    app.workspaceList = app.testWorkspaces;
    app.deleteSession = async (): Promise<void> => {};
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    await Promise.resolve();
    requireElement(app, "[data-session='s1'] [data-action='session-menu-toggle']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    requireElement(app, "[data-session='s1'] [data-action='delete-session']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(app.querySelector("[data-workspace-group='w1']")).toBeTruthy();
    expect(app.querySelector("[data-workspace-group='w1'] .workspace-drag-handle")).toBeTruthy();
  });

  test("delete all sessions asks for confirmation before deleting", async () => {
    const app = setupApp();
    app.dataset.activeSessionId = "s1";
    app.testWorkspaces = [{
      id: "w1",
      name: "one",
      path: "/one",
      sessions: [{ id: "s1", name: "new session" }],
    }];
    app.workspaceList = app.testWorkspaces;
    const confirmMessages: string[] = [];
    globalThis.confirm = (message?: string): boolean => {
      confirmMessages.push(String(message || ""));
      return false;
    };
    let hostDeleteAllCalls = 0;
    app.deleteWorkspaceSessions = async (): Promise<void> => {
      hostDeleteAllCalls += 1;
    };
    const backendCalls: BackendCallLog[] = [];
    const context = testContext(app, {
      backend: async (method: string, options: BackendCallLog["options"]): Promise<unknown> => {
        backendCalls.push({ method, options });
        return {};
      },
    });
    const controller = createSidebarController(app, context);

    controller.mount();
    requireElement(app, "[data-action='delete-workspace-sessions']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(confirmMessages).toEqual([
      "Warning: delete all 1 session in workspace w1? This removes local JSONL files and child sessions.",
    ]);
    expect(hostDeleteAllCalls).toBe(0);
    expect(backendCalls.some((call: BackendCallLog): boolean => call.method === "delete-workspace-sessions")).toBe(false);
    expect(app.dataset.activeSessionId).toBe("s1");
    expect(app.querySelector("[data-session='s1']")).toBeTruthy();
  });

  test("delete all sessions keeps sidebar shell", async () => {
    const app = setupApp();
    app.dataset.activeSessionId = "s1";
    app.testWorkspaces = [{
      id: "w1",
      name: "one",
      path: "/one",
      sessions: [{ id: "s1", name: "new session" }, { id: "child", parentId: "s1", name: "child" }],
    }];
    app.workspaceList = app.testWorkspaces;
    const deletedPayloads: Record<string, unknown>[] = [];
    const sidebarEvents: import("./src/types").SidebarActionEvent[] = [];
    globalThis.piWeb!.subject<Record<string, unknown>>("plugin.pi-web-sidebar.deletedSessions").subscribe((payload) => {
      deletedPayloads.push(payload);
    });
    globalThis.piWeb!.subject<import("./src/types").SidebarActionEvent>("plugin.pi-web-sidebar.event").subscribe((event) => {
      sidebarEvents.push(event);
    });
    let hostDeleteAllCalls = 0;
    app.deleteWorkspaceSessions = async (workspaceId: string): Promise<void> => {
      hostDeleteAllCalls += 1;
      app.testWorkspaces = [{ id: workspaceId, name: "one", path: "/one", sessions: [] }];
      app.workspaceList = app.testWorkspaces;
    };
    const backendCalls: BackendCallLog[] = [];
    const context = testContext(app, {
      backend: async (method: string, options: BackendCallLog["options"]): Promise<unknown> => {
        backendCalls.push({ method, options });
        return {};
      },
    });
    const controller = createSidebarController(app, context);

    controller.mount();
    expect(requireElement<HTMLElement>(app, ".clear-sessions-row").classList.contains("danger")).toBe(true);
    requireElement(app, "[data-action='delete-workspace-sessions']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hostDeleteAllCalls).toBe(1);
    const backendDeletedSessions: boolean = backendCalls.some((call: BackendCallLog): boolean => {
      return call.method === "delete-workspace-sessions"
        && call.options.data?.workspaceId === "w1"
        && JSON.stringify(call.options.data?.sessionIds) === JSON.stringify(["s1", "child"]);
    });
    expect(backendDeletedSessions).toBe(true);
    expect(deletedPayloads.at(-1)?.sessionIds).toEqual(["s1", "child"]);
    expect(deletedPayloads.at(-1)?.sessions).toEqual([
      { id: "s1", name: "new session" },
      { id: "child", parentId: "s1", name: "child" },
    ]);
    const clearEvent: import("./src/types").SidebarActionEvent | undefined = sidebarEvents.find(
      (event: import("./src/types").SidebarActionEvent): boolean => event.type === "delete-workspace-sessions",
    );
    expect(clearEvent?.detail?.sessionIds).toEqual(["s1", "child"]);
    expect(app.dataset.activeSessionId).toBe("");
    expect(app.querySelector("[data-workspace-group='w1']")).toBeTruthy();
    expect(app.querySelector("[data-session='s1']")).toBeFalsy();
    expect(app.querySelector("[data-session='child']")).toBeFalsy();
    expect(requireElement(app, "[data-workspace-group='w1'] .sessions").children).toHaveLength(1);
    expect(app.querySelector("[data-workspace-group='w1'] [data-action='new-session']")).toBeTruthy();

    await Promise.resolve();
    await Promise.resolve();
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s2", name: "future" }] }];
    await controller.refresh();
    expect(app.querySelector("[data-session='s2']")).toBeTruthy();
  });

  test("delete all sessions publishes active end for every requested id when backend deleted list is empty", async () => {
    const app = setupApp();
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "optimistic", name: "New chat" }] }];
    app.workspaceList = app.testWorkspaces;
    const activeEndPayloads: Record<string, unknown>[] = [];
    const context = testContext(app, {
      backend: async (method: string): Promise<unknown> => {
        if (method === "delete-workspace-sessions") {
          return { deleted: [] };
        }

        return {};
      },
      events: {
        publish: async (_channel: string, type: string, payload: unknown): Promise<unknown> => {
          if (type === "active.end") {
            activeEndPayloads.push(payload as Record<string, unknown>);
          }

          return {};
        },
        subscribe: (): (() => void) => (): void => {},
      },
    });
    const controller = createSidebarController(app, context);

    controller.mount();
    requireElement(app, "[data-action='delete-workspace-sessions']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(activeEndPayloads.at(-1)?.sessionIds).toEqual(["optimistic"]);
  });

  test("delete all sessions publishes backend-expanded deleted ids", async () => {
    const app = setupApp();
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", name: "new session" }] }];
    app.workspaceList = app.testWorkspaces;
    const deletedPayloads: Record<string, unknown>[] = [];
    globalThis.piWeb!.subject<Record<string, unknown>>("plugin.pi-web-sidebar.deletedSessions").subscribe((payload) => {
      deletedPayloads.push(payload);
    });
    const context = testContext(app, {
      backend: async (method: string): Promise<unknown> => {
        if (method === "delete-workspace-sessions") {
          return { deleted: ["s1", "hidden-child"] };
        }

        return {};
      },
    });
    const controller = createSidebarController(app, context);

    controller.mount();
    requireElement(app, "[data-action='delete-workspace-sessions']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(deletedPayloads.at(-1)?.sessionIds).toEqual(["s1", "hidden-child"]);
    expect(deletedPayloads.at(-1)?.sessions).toEqual([{ id: "s1", name: "new session" }, { id: "hidden-child" }]);
  });

  test("session menu delete is handled by plugin without blanking sidebar", async () => {
    const app = setupApp();
    app.dataset.activeSessionId = "s1";
    app.testWorkspaces = [{
      id: "w1",
      name: "one",
      path: "/one",
      sessions: [{ id: "s1", name: "new session" }, { id: "child", parentId: "s1", name: "child" }],
    }];
    app.workspaceList = app.testWorkspaces;
    const deletedSessionIds: string[] = [];
    const deletedPayloads: Record<string, unknown>[] = [];
    globalThis.piWeb!.subject<Record<string, unknown>>("plugin.pi-web-sidebar.deletedSessions").subscribe((payload) => {
      deletedPayloads.push(payload);
    });
    app.deleteSession = async (sessionId: string): Promise<void> => {
      deletedSessionIds.push(sessionId);
      app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [] }];
      app.workspaceList = app.testWorkspaces;
    };
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    requireElement(app, "[data-session='s1'] [data-action='session-menu-toggle']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    expect(requireElement<HTMLElement>(app, "[data-session='s1'] .session-menu").hidden).toBe(false);
    requireElement(app, "[data-session='s1'] [data-action='delete-session']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deletedSessionIds).toEqual(["s1", "child"]);
    expect(deletedPayloads.at(-1)?.sessionIds).toEqual(["s1", "child"]);
    expect(app.dataset.activeSessionId).toBe("");
    expect(app.querySelector("[data-workspace-group='w1']")).toBeTruthy();
    expect(app.querySelector("[data-session='s1']")).toBeFalsy();
    expect(app.querySelector("[data-session='child']")).toBeFalsy();
    expect(app.querySelector("[data-workspace-group='w1'] [data-action='new-session']")).toBeTruthy();
  });

  test("fallback drag previews workspace and session moves before drop", async () => {
    const app = setupApp();
    app.testWorkspaces = [
      { id: "w1", name: "one", sessions: [{ id: "s1", name: "one" }, { id: "s2", name: "two" }] },
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

  test("fallback drag keeps subagent and team agent sessions inside their parent session", async () => {
    const app = setupApp();
    app.testWorkspaces = [{
      id: "w1",
      name: "one",
      sessions: [
        { id: "parent", name: "parent" },
        { id: "sub", parentId: "parent", name: "sub worker", kind: "subagent" },
        { id: "team", parentId: "parent", name: "team worker", kind: "team agent" },
        { id: "other", name: "other parent" },
      ],
    }];
    app.sidebarOpenWorkspaceId = "w1";
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    await Promise.resolve();
    const pluginSidebar = requireElement(app, "[data-pi-web-sidebar-plugin]");
    const subHandle = requireElement(app, "[data-session='sub'] .session-drag-handle");
    const otherParent = requireElement<HTMLElement>(app, "[data-session='other']");
    otherParent.getBoundingClientRect = (): DOMRect => ({
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

    subHandle.dispatchEvent(dragEvent("dragstart"));
    otherParent.dispatchEvent(dragEvent("dragover", { clientY: 9 }));

    const sessionOrderAfterBlockedDrag: string[] = [...app.querySelectorAll<HTMLElement>(
      "[data-workspace-group='w1'] .session-row[data-session]",
    )].map((row: HTMLElement): string => row.dataset.session || "");
    expect(sessionOrderAfterBlockedDrag).toEqual(["parent", "sub", "team", "other"]);
    expect(localStorage.getItem("pi.sessionOrder")).toBeNull();

    const teamRow = requireElement<HTMLElement>(app, "[data-session='team']");
    teamRow.getBoundingClientRect = (): DOMRect => ({
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
    teamRow.dispatchEvent(dragEvent("dragover", { clientY: 9 }));
    pluginSidebar.dispatchEvent(dragEvent("drop"));

    const sessionOrderAfterSiblingDrag: string[] = [...app.querySelectorAll<HTMLElement>(
      "[data-workspace-group='w1'] .session-row[data-session]",
    )].map((row: HTMLElement): string => row.dataset.session || "");
    expect(sessionOrderAfterSiblingDrag).toEqual(["parent", "team", "sub", "other"]);
    expect(JSON.parse(localStorage.getItem("pi.sessionOrder") || "{}")).toEqual({ w1: ["parent", "team", "sub", "other"] });
  });

  test("fallback drag moves a parent session with its child agent sessions", async () => {
    const app = setupApp();
    app.testWorkspaces = [{
      id: "w1",
      name: "one",
      sessions: [
        { id: "parent", name: "parent" },
        { id: "sub", parentId: "parent", name: "sub worker", kind: "subagent" },
        { id: "team", parentId: "parent", name: "team worker", kind: "team agent" },
        { id: "other", name: "other parent" },
      ],
    }];
    app.sidebarOpenWorkspaceId = "w1";
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    await Promise.resolve();
    const pluginSidebar = requireElement(app, "[data-pi-web-sidebar-plugin]");
    const parentHandle = requireElement(app, "[data-session='parent'] .session-drag-handle");
    const otherRow = requireElement<HTMLElement>(app, "[data-session='other']");
    otherRow.getBoundingClientRect = (): DOMRect => ({
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

    parentHandle.dispatchEvent(dragEvent("dragstart"));
    otherRow.dispatchEvent(dragEvent("dragover", { clientY: 9 }));
    pluginSidebar.dispatchEvent(dragEvent("drop"));

    const sessionOrderAfterParentDrag: string[] = [...app.querySelectorAll<HTMLElement>(
      "[data-workspace-group='w1'] .session-row[data-session]",
    )].map((row: HTMLElement): string => row.dataset.session || "");
    expect(sessionOrderAfterParentDrag).toEqual(["other", "parent", "sub", "team"]);
    expect(JSON.parse(localStorage.getItem("pi.sessionOrder") || "{}")).toEqual({
      w1: ["other", "parent", "sub", "team"],
    });
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

    expect(context.backendCalls).toContainEqual({ method: "list-folders", options: { data: { path: "~" } } });
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
    expect(app.openWorkspacePathCalls).toEqual(["/picked"]);
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

    const calls: BackendCallLog[] = nonCacheBackendCalls(context);
    expect(requireElement<HTMLElement>(app, "[data-new-folder-dialog]").hidden).toBe(true);
    expect(calls.at(-2)).toEqual({ method: "create-folder", options: { data: { parent: "/home/me", name: "new-dir" } } });
    expect(calls.at(-1)).toEqual({ method: "list-folders", options: { data: { path: "/home/me" } } });
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

    const calls: BackendCallLog[] = nonCacheBackendCalls(context);
    expect(requireElement<HTMLElement>(app, "[data-clone-dialog]").hidden).toBe(true);
    expect(calls.at(-3)).toEqual({ method: "clone-workspace", options: { data: { parent: "/home/me", gitUrl: "https://example.com/repo.git", name: "repo" } } });
    expect(calls.at(-1)).toEqual({ method: "list-folders", options: { data: { path: "/home/me/repo" } } });
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

    expect(nonCacheBackendCalls(context).at(-1)).toEqual({ method: "list-folders", options: { data: { path: "/home/me/code" } } });
    expect(requireElement<HTMLElement>(app, "[data-pi-web-sidebar-picker]").dataset.currentPath).toBe("/home/me/code");
    expect(app.querySelector(".pi-sidebar-picker-empty")).toBeFalsy();
  });

  test("plugin open button falls back to picker route when backend is unavailable", async () => {
    const app = setupApp();
    const controller = createSidebarController(app, { initialWorkspaces: app.testWorkspaces });

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
    installTestPiWeb();

    expect(() => createSidebarController(requireElement(document, "pi-app") as AppElement).mount()).toThrow(".app-body");
  });
});
