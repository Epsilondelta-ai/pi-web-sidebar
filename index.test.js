import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createSidebarController } from "./index.js";

let windowRef;

afterEach(() => {
  windowRef?.happyDOM?.close();
  windowRef = undefined;
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.prompt;
  delete globalThis.confirm;
  delete globalThis.localStorage;
});

function setupApp() {
  windowRef = new Window();
  windowRef.SyntaxError = SyntaxError;
  globalThis.window = windowRef;
  globalThis.document = windowRef.document;
  document.body.innerHTML = `
    <pi-app data-sidebar="open">
      <section class="app-body">
        <div class="sidebar-wrap" data-native-sidebar><aside class="sidebar"><div class="sb-section"><div class="sb-head"></div></div></aside></div>
        <main class="main"></main>
      </section>
    </pi-app>`;
  const app = document.querySelector("pi-app");
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

function testContext(app, overrides = {}) {
  const context = {
    initialWorkspaces: app.testWorkspaces,
    apiCalls: [],
    async apiRequest(path, options = {}) {
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

class TestSubject {
  constructor(initialValue) {
    this.closed = false;
    this.subscribers = [];
    this.value = initialValue;
  }

  subscribe(callback) {
    this.subscribers.push(callback);
    if (arguments.length > 0 && this.value !== undefined) {
      callback(this.value);
    }

    return {
      unsubscribe: () => {
        this.subscribers = this.subscribers.filter((subscriber) => subscriber !== callback);
      },
    };
  }

  next(value) {
    this.value = value;
    for (const subscriber of this.subscribers) {
      subscriber(value);
    }
  }

  complete() {
    this.closed = true;
  }
}

function testRxjs() {
  return {
    Subject: TestSubject,
    BehaviorSubject: TestSubject,
  };
}

function dragEvent(type, options = {}) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  event.dataTransfer = {
    setData: () => undefined,
    setDragImage: () => undefined,
  };
  Object.defineProperty(event, "clientY", { value: options.clientY || 0 });
  return event;
}

describe("pi-web-sidebar plugin", () => {
  test("mounts plugin sidebar directly under app body and detaches native sidebar", async () => {
    const app = setupApp();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();

    const body = app.querySelector(".app-body");
    const pluginSidebar = body.firstElementChild;
    expect(pluginSidebar.hasAttribute("data-pi-web-sidebar-plugin")).toBe(true);
    expect(pluginSidebar.querySelector("[data-action='refresh-workspaces']")).toBeTruthy();
    expect(pluginSidebar.querySelector("[data-pi-web-sidebar-action='open-workspace']")).toBeTruthy();
    expect(pluginSidebar.querySelector("[data-action='route-picker']")).toBeFalsy();
    expect(pluginSidebar.querySelector(".sb-footer")).toBeFalsy();
    expect(pluginSidebar.querySelector("[data-action='open-settings']")).toBeFalsy();
    expect(app.querySelector("[data-native-sidebar]")).toBeFalsy();
    expect(pluginSidebar.querySelector("[data-workspace-group='w1'] .label").textContent).toBe("one");
    expect(pluginSidebar.querySelector("[data-workspace-group='w1'] .ws-path").textContent).toBe("/one");
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

    expect(app.querySelector("[data-native-sidebar]").hidden).toBe(true);
  });

  test("mounts without a native sidebar", () => {
    const app = setupApp();
    app.querySelector("[data-native-sidebar]").remove();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();

    expect(app.querySelector("[data-pi-web-sidebar-plugin]")).toBeTruthy();
    expect(app.querySelector(".app-body").firstElementChild.hasAttribute("data-pi-web-sidebar-plugin")).toBe(true);
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
    expect(app.querySelector("[data-workspace-group='w2'] .label").textContent).toBe("two");
    expect(app.renderSidebarWorkspacesCalls).toEqual([]);
    expect(app.renderSortableSidebarWorkspacesCalls).toEqual([]);
  });

  test("exposes RxJS sidebar state and events for other plugins", async () => {
    const app = setupApp();
    app.testWorkspaces = [{ id: "w1", name: "one", path: "/one", sessions: [{ id: "s1", title: "one" }] }];
    const controller = createSidebarController(app, testContext(app, { rxjs: testRxjs() }));
    const states = [];
    const events = [];

    controller.mount();
    const stateSubscription = app.piWebSidebar.state$.subscribe((state) => states.push(state));
    const eventSubscription = app.piWebSidebar.events$.subscribe((event) => events.push(event));
    controller.render([{ id: "w2", name: "two", path: "/two", sessions: [] }]);

    expect(app.piWebSidebar.getSnapshot().workspaceCount).toBe(1);
    expect(app.piWebSidebar.getSnapshot().sessionCount).toBe(0);
    expect(states.at(-1).workspaces[0].id).toBe("w2");
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
      async apiRequest(path, options = {}) {
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
      if (event.target.closest("[data-action='new-session']")) {
        hostNewSessionClicks += 1;
      }
    });
    const controller = createSidebarController(app, context);

    controller.mount();
    app.querySelector("[data-action='new-session']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
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
      async apiRequest(path, options = {}) {
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
      if (event.target.closest("[data-action='delete-session']")) {
        hostDeleteClicks += 1;
        app.querySelector(".sb-section")?.replaceChildren();
      }
    });
    const controller = createSidebarController(app, context);

    controller.mount();
    app.querySelector("[data-session='s1'] [data-action='session-menu-toggle']")
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    expect(app.querySelector("[data-session='s1'] .session-menu").hidden).toBe(false);
    app.querySelector("[data-session='s1'] [data-action='delete-session']")
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
    window.requestAnimationFrame = (callback) => {
      callback();
      return 1;
    };
    const animated = [];
    app.querySelectorAll(".workspace-group").forEach((group) => {
      group.animate = () => animated.push(group.dataset.workspaceGroup);
      group.getBoundingClientRect = () => ({
        top: [...app.querySelectorAll(".workspace-group")].indexOf(group) * 10,
        height: 10,
      });
    });
    const workspaceHandle = app.querySelector("[data-workspace-group='w1'] .workspace-drag-handle");
    const workspaceTarget = app.querySelector("[data-workspace-group='w2']");
    workspaceHandle.dispatchEvent(dragEvent("dragstart"));
    expect(app.querySelector("[data-pi-web-sidebar-plugin]").classList.contains("pi-web-sidebar-dragging-workspace")).toBe(true);
    expect([...app.querySelectorAll(".workspace-group > .sessions")].every((sessions) => sessions.hidden)).toBe(true);
    workspaceTarget.dispatchEvent(dragEvent("dragover", { clientY: 19 }));
    app.querySelector("[data-pi-web-sidebar-plugin]").dispatchEvent(dragEvent("drop"));

    expect([...app.querySelectorAll(".workspace-group")].map((group) => group.dataset.workspaceGroup)).toEqual(["w2", "w1"]);
    expect(JSON.parse(localStorage.getItem("pi.workspaceOrder"))).toEqual(["w2", "w1"]);
    expect(animated).toContain("w1");
    expect(app.querySelector("[data-workspace-group='w1'] > .sessions").hidden).toBe(false);
    expect(app.querySelector("[data-workspace-group='w2'] > .sessions").hidden).toBe(true);

    const sessionHandle = app.querySelector("[data-session='s1'] .session-drag-handle");
    const sessionTarget = app.querySelector("[data-session='s2']");
    sessionTarget.getBoundingClientRect = () => ({ top: 0, height: 10 });
    sessionHandle.dispatchEvent(dragEvent("dragstart"));
    sessionTarget.dispatchEvent(dragEvent("dragover", { clientY: 9 }));
    app.querySelector("[data-pi-web-sidebar-plugin]").dispatchEvent(dragEvent("drop"));

    expect([...app.querySelectorAll("[data-workspace-group='w1'] .session-row[data-session]")].map((row) => row.dataset.session)).toEqual(["s2", "s1"]);
    expect(JSON.parse(localStorage.getItem("pi.sessionOrder"))).toEqual({ w1: ["s2", "s1"] });
  });

  test("plugin open button uses backend folder browser and opens selected workspace path", async () => {
    const app = setupApp();
    const context = testContext(app, { backendCalls: [], backend: async (method, options) => {
      context.backendCalls.push({ method, options });
      return { path: "/picked", displayPath: "/picked", parent: "/", folders: [{ name: "workspace", path: "/picked/workspace" }] };
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    app.querySelector("[data-pi-web-sidebar-action='open-workspace']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(context.backendCalls).toEqual([{ method: "list-folders", options: { data: { path: "~" } } }]);
    expect(app.querySelector("[data-pi-web-sidebar-picker]").hidden).toBe(false);
    expect(app.querySelector("[data-picker-action='up']")).toBeFalsy();
    const rows = [...app.querySelectorAll(".pi-sidebar-picker-row")];
    expect(rows[0].textContent).toContain("..");
    expect(rows[1].textContent).toContain("workspace");

    app.querySelector("[data-picker-action='open-current']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.apiCalls).toContainEqual({ path: "/api/workspaces/open", options: { method: "POST", body: JSON.stringify({ path: "/picked" }) } });
    expect(app.dataset.route).toBe("workspace");
  });

  test("plugin folder browser creates a new folder through backend modal and refreshes", async () => {
    const app = setupApp();
    let folders = [];
    const context = testContext(app, { backendCalls: [], backend: async (method, options) => {
      context.backendCalls.push({ method, options });
      if (method === "create-folder") {
        folders = [{ name: "new-dir", path: "/home/me/new-dir" }];
        return { name: "new-dir", path: "/home/me/new-dir" };
      }
      return { path: "/home/me", parent: "/home", folders };
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    app.querySelector("[data-pi-web-sidebar-action='open-workspace']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    app.querySelector("[data-picker-action='new-folder']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    expect(app.querySelector("[data-new-folder-dialog]").hidden).toBe(false);
    app.querySelector("[data-new-folder-form] input[name='name']").value = "new-dir";
    app.querySelector("[data-new-folder-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(app.querySelector("[data-new-folder-dialog]").hidden).toBe(true);
    expect(context.backendCalls.at(-2)).toEqual({ method: "create-folder", options: { data: { parent: "/home/me", name: "new-dir" } } });
    expect(context.backendCalls.at(-1)).toEqual({ method: "list-folders", options: { data: { path: "/home/me" } } });
    expect(app.querySelector(".pi-sidebar-picker-row[data-path='/home/me/new-dir']").textContent).toContain("new-dir");
  });

  test("plugin folder browser clones a git repository through backend modal and enters clone", async () => {
    const app = setupApp();
    const context = testContext(app, { backendCalls: [], backend: async (method, options) => {
      context.backendCalls.push({ method, options });
      if (method === "clone-workspace") return { name: "repo", path: "/home/me/repo" };
      if (options.data.path === "/home/me/repo") return { path: "/home/me/repo", parent: "/home/me", folders: [] };
      return { path: "/home/me", parent: "/home", folders: [{ name: "repo", path: "/home/me/repo" }] };
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    app.querySelector("[data-pi-web-sidebar-action='open-workspace']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    app.querySelector("[data-picker-action='clone']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    expect(app.querySelector("[data-clone-dialog]").hidden).toBe(false);
    app.querySelector("[data-clone-form] input[name='gitUrl']").value = "https://example.com/repo.git";
    app.querySelector("[data-clone-form] input[name='name']").value = "repo";
    app.querySelector("[data-clone-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(app.querySelector("[data-clone-dialog]").hidden).toBe(true);
    expect(context.backendCalls.at(-3)).toEqual({ method: "clone-workspace", options: { data: { parent: "/home/me", gitUrl: "https://example.com/repo.git", name: "repo" } } });
    expect(context.backendCalls.at(-1)).toEqual({ method: "list-folders", options: { data: { path: "/home/me/repo" } } });
    expect(app.querySelector("[data-pi-web-sidebar-picker]").dataset.currentPath).toBe("/home/me/repo");
  });

  test("plugin folder browser enters child folders through backend", async () => {
    const app = setupApp();
    const responses = {
      "~": { path: "/home/me", parent: "/home", folders: [{ name: "code", path: "/home/me/code" }] },
      "/home/me/code": { path: "/home/me/code", parent: "/home/me", folders: [] },
    };
    const context = testContext(app, { backendCalls: [], backend: async (method, options) => {
      context.backendCalls.push({ method, options });
      return responses[options.data.path];
    } });
    const controller = createSidebarController(app, context);

    controller.mount();
    app.querySelector("[data-pi-web-sidebar-action='open-workspace']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    app.querySelector(".pi-sidebar-picker-row[data-path='/home/me/code']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(context.backendCalls.at(-1)).toEqual({ method: "list-folders", options: { data: { path: "/home/me/code" } } });
    expect(app.querySelector("[data-pi-web-sidebar-picker]").dataset.currentPath).toBe("/home/me/code");
    expect(app.querySelector(".pi-sidebar-picker-empty")).toBeFalsy();
  });

  test("plugin open button falls back to picker route when backend is unavailable", async () => {
    const app = setupApp();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    app.querySelector("[data-pi-web-sidebar-action='open-workspace']").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(app.dataset.route).toBe("picker");
  });

  test("plugin resizer stores width without host startResize", () => {
    const app = setupApp();
    const controller = createSidebarController(app, testContext(app));

    controller.mount();
    const down = new window.Event("pointerdown");
    Object.defineProperty(down, "clientX", { value: 100 });
    app.querySelector(".sb-resizer").dispatchEvent(down);
    const move = new window.Event("pointermove");
    Object.defineProperty(move, "clientX", { value: 130 });
    window.dispatchEvent(move);

    expect(app.startResizeCalls).toBe(0);
    expect(app.dataset.sidebarWidth).toBe("310");
    expect(localStorage.getItem("pi.sb.width")).toBe("310");
  });

  test("throws when app body is missing", () => {
    windowRef = new Window();
    windowRef.SyntaxError = SyntaxError;
    globalThis.window = windowRef;
    globalThis.document = windowRef.document;
    document.body.innerHTML = "<pi-app></pi-app>";

    expect(() => createSidebarController(document.querySelector("pi-app")).mount()).toThrow(".app-body");
  });
});
