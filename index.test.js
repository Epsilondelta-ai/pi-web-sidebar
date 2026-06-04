import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createSidebarController } from "./index.js";

let windowRef;

afterEach(() => {
  windowRef?.happyDOM?.close();
  windowRef = undefined;
  delete globalThis.window;
  delete globalThis.document;
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
  app.workspaceList = [{ id: "w1", name: "one", sessions: [] }];
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
  app.reorderWorkspacesCalls = [];
  app.reorderWorkspaces = (ids) => app.reorderWorkspacesCalls.push(ids);
  app.reorderWorkspaceSessionsCalls = [];
  app.reorderWorkspaceSessions = (workspaceId, ids) => app.reorderWorkspaceSessionsCalls.push({ workspaceId, ids });
  app.sidebarSortableCleanupCalls = 0;
  app.sidebarSortableCleanup = () => app.sidebarSortableCleanupCalls += 1;
  app.sidebarSortableRoot = { unmount: () => app.sidebarSortableUnmounted = true };
  app.sidebarSortableRenderToken = Symbol("old-render");
  return app;
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
    const controller = createSidebarController(app);

    controller.mount();

    const body = app.querySelector(".app-body");
    const pluginSidebar = body.firstElementChild;
    expect(pluginSidebar.hasAttribute("data-pi-web-sidebar-plugin")).toBe(true);
    expect(pluginSidebar.querySelector("[data-action='refresh-workspaces']")).toBeTruthy();
    expect(pluginSidebar.querySelector(".sb-footer")).toBeFalsy();
    expect(pluginSidebar.querySelector("[data-action='open-settings']")).toBeFalsy();
    expect(app.querySelector("[data-native-sidebar]")).toBeFalsy();
    expect(app.renderSidebarWorkspacesCalls).toEqual([[{ id: "w1", name: "one", sessions: [] }]]);
    expect(app.restoreSidebarCalls).toBe(1);
    expect(app.sidebarSortableCleanupCalls).toBe(1);
    expect(app.sidebarSortableUnmounted).toBe(true);
    expect(app.sidebarSortableRoot).toBeUndefined();
    expect(app.sidebarSortableRenderToken).toBeUndefined();
    await Promise.resolve();
    expect(app.renderSortableSidebarWorkspacesCalls).toHaveLength(1);
    expect(app.renderSortableSidebarWorkspacesCalls[0].section).toBe(pluginSidebar.querySelector(".sb-section"));
  });

  test("dispose removes plugin sidebar and restores native sidebar", () => {
    const app = setupApp();
    const controller = createSidebarController(app);

    controller.mount();
    controller.dispose();

    expect(app.querySelector("[data-pi-web-sidebar-plugin]")).toBeFalsy();
    expect(app.querySelector("[data-native-sidebar]")).toBeTruthy();
    expect(app.renderSidebarWorkspaces).toBe(app.baseRenderSidebarWorkspaces);
    expect(app.applyGridCalls).toBe(1);
    expect(app.sidebarSortableRoot).toBeUndefined();
    expect(app.sidebarSortableRenderToken).toBeUndefined();
  });

  test("dispose restores native sidebar hidden when host state is collapsed", () => {
    const app = setupApp();
    const controller = createSidebarController(app);

    controller.mount();
    app.dataset.sidebar = "collapsed";
    controller.dispose();

    expect(app.querySelector("[data-native-sidebar]").hidden).toBe(true);
  });

  test("mounts without a native sidebar", () => {
    const app = setupApp();
    app.querySelector("[data-native-sidebar]").remove();
    const controller = createSidebarController(app);

    controller.mount();

    expect(app.querySelector("[data-pi-web-sidebar-plugin]")).toBeTruthy();
    expect(app.querySelector(".app-body").firstElementChild.hasAttribute("data-pi-web-sidebar-plugin")).toBe(true);
  });

  test("mount and dispose are idempotent", () => {
    const app = setupApp();
    const controller = createSidebarController(app);

    controller.mount();
    controller.mount();
    controller.dispose();

    expect(app.querySelector("[data-pi-web-sidebar-plugin]")).toBeFalsy();
    expect(app.querySelectorAll("[data-native-sidebar]")).toHaveLength(1);
  });

  test("sortable bridge reactivates drag after host workspace renders", async () => {
    const app = setupApp();
    const controller = createSidebarController(app);
    const nextWorkspaces = [{ id: "w2", name: "two", sessions: [] }];

    controller.mount();
    await Promise.resolve();
    app.renderSortableSidebarWorkspacesCalls = [];
    app.renderSidebarWorkspaces(nextWorkspaces);
    await Promise.resolve();

    expect(app.renderSidebarWorkspacesCalls.at(-1)).toBe(nextWorkspaces);
    expect(app.renderSortableSidebarWorkspacesCalls).toHaveLength(1);
    expect(app.renderSortableSidebarWorkspacesCalls[0].workspaces).toBe(nextWorkspaces);
  });

  test("adds fallback grip handles to static host rows", async () => {
    const app = setupApp();
    app.renderSidebarWorkspaces = (workspaces) => {
      app.renderSidebarWorkspacesCalls.push(workspaces);
      const section = app.querySelector("[data-pi-web-sidebar-plugin] .sb-section");
      section.insertAdjacentHTML("beforeend", `
        <div class="workspace-group" data-workspace-group="w1">
          <div class="workspace-shell"><button class="ws-row" type="button"><span class="label">one</span></button></div>
          <div class="sessions"><div class="session-row" data-session="s1" data-workspace="w1"><button class="session-main" type="button"><span class="title">one</span></button></div></div>
        </div>`);
    };
    app.baseRenderSidebarWorkspaces = app.renderSidebarWorkspaces;
    const controller = createSidebarController(app);

    controller.mount();
    await Promise.resolve();

    expect(app.querySelector(".workspace-drag-handle")?.getAttribute("draggable")).toBe("true");
    expect(app.querySelector(".session-drag-handle")?.getAttribute("draggable")).toBe("true");
  });

  test("fallback drag previews workspace and session moves before drop", async () => {
    const app = setupApp();
    app.renderSidebarWorkspaces = (workspaces) => {
      app.renderSidebarWorkspacesCalls.push(workspaces);
      const section = app.querySelector("[data-pi-web-sidebar-plugin] .sb-section");
      section.insertAdjacentHTML("beforeend", `
        <div class="workspace-group" data-workspace-group="w1">
          <div class="workspace-shell"><button class="ws-row" type="button"><span class="label">one</span></button></div>
          <div class="sessions">
            <div class="session-row" data-session="s1" data-workspace="w1"><button class="session-main" type="button"><span class="title">one</span></button></div>
            <div class="session-row" data-session="s2" data-workspace="w1"><button class="session-main" type="button"><span class="title">two</span></button></div>
          </div>
        </div>
        <div class="workspace-group" data-workspace-group="w2">
          <div class="workspace-shell"><button class="ws-row" type="button"><span class="label">two</span></button></div>
          <div class="sessions"></div>
        </div>`);
    };
    app.baseRenderSidebarWorkspaces = app.renderSidebarWorkspaces;
    const controller = createSidebarController(app);

    controller.mount();
    await Promise.resolve();
    const workspaceHandle = app.querySelector("[data-workspace-group='w1'] .workspace-drag-handle");
    const workspaceTarget = app.querySelector("[data-workspace-group='w2']");
    workspaceTarget.getBoundingClientRect = () => ({ top: 0, height: 10 });
    workspaceHandle.dispatchEvent(dragEvent("dragstart"));
    expect(app.querySelector("[data-pi-web-sidebar-plugin]").classList.contains("pi-web-sidebar-dragging-workspace")).toBe(true);
    workspaceTarget.dispatchEvent(dragEvent("dragover", { clientY: 9 }));
    app.querySelector("[data-pi-web-sidebar-plugin]").dispatchEvent(dragEvent("drop"));

    expect([...app.querySelectorAll(".workspace-group")].map((group) => group.dataset.workspaceGroup)).toEqual(["w2", "w1"]);
    expect(app.reorderWorkspacesCalls.at(-1)).toEqual(["w2", "w1"]);

    const sessionHandle = app.querySelector("[data-session='s1'] .session-drag-handle");
    const sessionTarget = app.querySelector("[data-session='s2']");
    sessionTarget.getBoundingClientRect = () => ({ top: 0, height: 10 });
    sessionHandle.dispatchEvent(dragEvent("dragstart"));
    sessionTarget.dispatchEvent(dragEvent("dragover", { clientY: 9 }));
    app.querySelector("[data-pi-web-sidebar-plugin]").dispatchEvent(dragEvent("drop"));

    expect([...app.querySelectorAll("[data-workspace-group='w1'] .session-row[data-session]")].map((row) => row.dataset.session)).toEqual(["s2", "s1"]);
    expect(app.reorderWorkspaceSessionsCalls.at(-1)).toEqual({ workspaceId: "w1", ids: ["s2", "s1"] });
  });

  test("plugin resizer delegates to host startResize", () => {
    const app = setupApp();
    const controller = createSidebarController(app);

    controller.mount();
    app.querySelector(".sb-resizer").dispatchEvent(new window.Event("pointerdown"));

    expect(app.startResizeCalls).toBe(1);
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
