const PLUGIN_PANEL_ATTR = "data-pi-web-sidebar-plugin";
const ORIGINAL_PLACEHOLDER_ATTR = "data-pi-web-sidebar-original-placeholder";

const ICONS = {
  plus: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>',
  refresh: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M3 21v-5h5"></path><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>',
  collapse: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>',
  grip: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>',
};

export default function activate(context) {
  const controller = createSidebarController(context.app);
  controller.mount();
  return () => controller.dispose();
}

export function createSidebarController(app) {
  let wrap = null;
  let nativeSidebar = null;
  let nativePlaceholder = null;
  let originalRenderSidebarWorkspaces = null;
  let draggedItem = null;

  function mount() {
    const body = app.querySelector(".app-body");
    if (!body) {
      throw new Error("pi-web-sidebar requires .app-body");
    }

    wrap = app.querySelector(`[${PLUGIN_PANEL_ATTR}]`) || createSidebar();
    const foundNativeSidebar = findNativeSidebar(body, wrap);
    nativeSidebar = nativeSidebar || foundNativeSidebar;

    if (!nativePlaceholder && foundNativeSidebar) {
      resetHostSidebarRenderState(app);
      nativePlaceholder = document.createElement("template");
      nativePlaceholder.setAttribute(ORIGINAL_PLACEHOLDER_ATTR, "");
      foundNativeSidebar.replaceWith(nativePlaceholder);
    }

    if (!wrap.isConnected) {
      body.insertBefore(wrap, body.firstElementChild);
    }

    app.dataset.sidebar = app.dataset.sidebar || "open";
    bindResizer(wrap, app);
    bindFallbackDrag(wrap, app);
    installSortableRenderBridge();
    renderExistingWorkspaces();
    app.restoreSidebar?.();
  }

  function dispose() {
    resetHostSidebarRenderState(app);
    wrap?.remove();

    if (nativePlaceholder?.isConnected && nativeSidebar) {
      nativePlaceholder.replaceWith(nativeSidebar);
      nativeSidebar.toggleAttribute("hidden", app.dataset.sidebar === "collapsed");
    }

    restoreSidebarRenderer();
    nativePlaceholder = null;
    nativeSidebar = null;
    wrap = null;
    app.applyGrid?.();
  }

  function renderExistingWorkspaces() {
    if (Array.isArray(app.workspaceList)) {
      app.renderSidebarWorkspaces?.(app.workspaceList);
    }
  }

  function installSortableRenderBridge() {
    if (originalRenderSidebarWorkspaces || typeof app.renderSidebarWorkspaces !== "function") {
      return;
    }

    originalRenderSidebarWorkspaces = app.renderSidebarWorkspaces;
    app.renderSidebarWorkspaces = function renderPiWebSidebarWorkspaces(workspaces) {
      const result = originalRenderSidebarWorkspaces.call(this, workspaces);
      ensureFallbackDragHandles();
      activateSortableSidebar(workspaces);
      return result;
    };
  }

  function restoreSidebarRenderer() {
    if (originalRenderSidebarWorkspaces) {
      app.renderSidebarWorkspaces = originalRenderSidebarWorkspaces;
    }

    originalRenderSidebarWorkspaces = null;
  }

  function activateSortableSidebar(workspaces = app.workspaceList) {
    const section = wrap?.querySelector(".sidebar .sb-section");
    if (!section || !Array.isArray(workspaces) || typeof app.renderSortableSidebarWorkspaces !== "function") {
      return;
    }

    void Promise.resolve().then(() => app.renderSortableSidebarWorkspaces(section, workspaces));
  }

  function ensureFallbackDragHandles() {
    ensureWorkspaceDragHandles(wrap);
    ensureSessionDragHandles(wrap);
  }

  function startDrag(item) {
    draggedItem = item;
  }

  function finishDrag(target) {
    if (!draggedItem || !target) {
      draggedItem = null;
      return;
    }

    if (draggedItem.type === "workspace") {
      moveWorkspaceBefore(draggedItem.element, target.closest(".workspace-group"));
    }

    if (draggedItem.type === "session") {
      moveSessionBefore(draggedItem.element, target.closest(".session-row[data-session]"));
    }

    draggedItem = null;
  }

  function moveWorkspaceBefore(source, target) {
    if (!source || !target || source === target) {
      return;
    }

    target.parentElement.insertBefore(source, target);
    const ids = [...wrap.querySelectorAll(".workspace-group[data-workspace-group]")].map((group) => group.dataset.workspaceGroup);
    app.reorderWorkspaces?.(ids);
  }

  function moveSessionBefore(source, target) {
    if (!source || !target || source === target || source.dataset.workspace !== target.dataset.workspace) {
      return;
    }

    target.parentElement.insertBefore(source, target);
    const workspaceId = source.dataset.workspace;
    const ids = [...target.parentElement.querySelectorAll(".session-row[data-session]")].map((row) => row.dataset.session);
    app.reorderWorkspaceSessions?.(workspaceId, ids);
  }

  function bindFallbackDrag(panel, host) {
    if (panel.dataset.piWebSidebarFallbackDragBound === "true") {
      return;
    }

    panel.addEventListener("dragstart", (event) => {
      const handle = event.target.closest("[data-pi-web-sidebar-drag-handle]");
      if (!handle) {
        return;
      }

      const workspace = handle.closest(".workspace-group");
      const session = handle.closest(".session-row[data-session]");
      startDrag(session ? { type: "session", element: session } : { type: "workspace", element: workspace });
      event.dataTransfer?.setData("text/plain", "pi-web-sidebar-drag");
      event.dataTransfer?.setDragImage?.(handle, 6, 6);
    });
    panel.addEventListener("dragover", (event) => {
      if (draggedItem && event.target.closest(".workspace-group, .session-row[data-session]")) {
        event.preventDefault();
      }
    });
    panel.addEventListener("drop", (event) => {
      event.preventDefault();
      finishDrag(event.target);
      host.renderWorkspaces?.(host.workspaceList || []);
    });
    panel.addEventListener("dragend", () => {
      draggedItem = null;
    });
    panel.dataset.piWebSidebarFallbackDragBound = "true";
  }

  return { mount, dispose, get element() { return wrap; } };
}

function ensureWorkspaceDragHandles(root) {
  root?.querySelectorAll(".workspace-group .ws-row").forEach((row) => {
    if (row.querySelector(".workspace-drag-handle")) {
      return;
    }

    const handle = document.createElement("span");
    handle.className = "drag-handle workspace-drag-handle";
    handle.setAttribute("aria-label", "reorder workspace");
    handle.setAttribute("draggable", "true");
    handle.setAttribute("data-pi-web-sidebar-drag-handle", "workspace");
    handle.innerHTML = ICONS.grip;
    row.insertBefore(handle, row.firstChild);
  });
}

function ensureSessionDragHandles(root) {
  root?.querySelectorAll(".session-row[data-session] .session-main").forEach((row) => {
    if (row.querySelector(".session-drag-handle")) {
      return;
    }

    const handle = document.createElement("span");
    handle.className = "drag-handle session-drag-handle";
    handle.setAttribute("aria-label", "reorder session");
    handle.setAttribute("draggable", "true");
    handle.setAttribute("data-pi-web-sidebar-drag-handle", "session");
    handle.innerHTML = ICONS.grip;
    row.insertBefore(handle, row.firstChild);
  });
}

function resetHostSidebarRenderState(app) {
  app.sidebarSortableCleanup?.();
  app.sidebarSortableRoot?.unmount?.();
  app.sidebarSortableRoot = undefined;
  app.sidebarSortableRenderToken = undefined;
}

function bindResizer(wrap, app) {
  const resizer = wrap.querySelector(".sb-resizer");
  if (!resizer || resizer.dataset.piWebSidebarResizeBound === "true") {
    return;
  }

  resizer.addEventListener("pointerdown", (event) => app.startResize?.(event));
  resizer.dataset.piWebSidebarResizeBound = "true";
}

function findNativeSidebar(body, pluginWrap) {
  const sidebars = [...body.querySelectorAll(".sidebar-wrap")];
  return sidebars.find((candidate) => candidate !== pluginWrap && !candidate.hasAttribute(PLUGIN_PANEL_ATTR));
}

function createSidebar() {
  const wrap = document.createElement("div");
  wrap.className = "sidebar-wrap";
  wrap.setAttribute(PLUGIN_PANEL_ATTR, "");
  wrap.innerHTML = [
    '<aside class="sidebar" aria-label="workspaces and sessions">',
    '<div class="sb-section" style="flex:1;overflow-y:auto;min-height:0">',
    '<div class="sb-head"><span>workspaces</span><span class="sb-head-actions">',
    `<button class="add" type="button" data-action="route-picker">${ICONS.plus} open</button>`,
    `<button class="refresh" type="button" data-action="refresh-workspaces" title="refresh workspaces" aria-label="refresh workspaces">${ICONS.refresh}</button>`,
    `<button class="sb-collapse" type="button" data-action="collapse-sidebar" title="collapse sidebar" aria-label="collapse sidebar">${ICONS.collapse}</button>`,
    '</span></div>',
    '</div>',
    '</aside>',
    '<div class="sb-resizer" role="separator" aria-orientation="vertical" aria-label="resize sidebar" title="drag to resize"></div>',
  ].join("");
  return wrap;
}
