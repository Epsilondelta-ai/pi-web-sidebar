const PLUGIN_PANEL_ATTR = "data-pi-web-sidebar-plugin";
const ORIGINAL_PLACEHOLDER_ATTR = "data-pi-web-sidebar-original-placeholder";
const FALLBACK_STYLE_ID = "pi-web-sidebar-fallback-drag-style";

const ICONS = {
  plus: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>',
  refresh: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M3 21v-5h5"></path><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>',
  collapse: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>',
  grip: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>',
};

export default function activate(context) {
  const controller = createSidebarController(context.app, context);
  controller.mount();
  return () => controller.dispose();
}

export function createSidebarController(app, context = {}) {
  let wrap = null;
  let nativeSidebar = null;
  let nativePlaceholder = null;
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

    installFallbackDragStyles();
    app.dataset.sidebar = app.dataset.sidebar || "open";
    bindResizer(wrap, app);
    bindOpenWorkspace(wrap, app, context);
    bindFallbackDrag(wrap, app);
    bindWorkspaceActions(wrap, app);
    renderCurrentWorkspaces();
    app.restoreSidebar?.();
  }

  function dispose() {
    resetHostSidebarRenderState(app);
    app.querySelector("[data-pi-web-sidebar-picker]")?.remove();
    wrap?.remove();

    if (nativePlaceholder?.isConnected && nativeSidebar) {
      nativePlaceholder.replaceWith(nativeSidebar);
      nativeSidebar.toggleAttribute("hidden", app.dataset.sidebar === "collapsed");
    }

    nativePlaceholder = null;
    nativeSidebar = null;
    wrap = null;
    app.applyGrid?.();
  }

  function renderCurrentWorkspaces() {
    renderPluginWorkspaceList(wrap, app, app.workspaceList || []);
    ensureWorkspaceDragHandles(wrap);
    ensureSessionDragHandles(wrap);
  }

  function startDrag(item) {
    draggedItem = item;
    wrap.classList.add("pi-web-sidebar-dragging", `pi-web-sidebar-dragging-${item.type}`);
    item.element?.classList.add("pi-web-sidebar-drag-source");

    if (item.type === "workspace") {
      collapseAllSessionsForWorkspaceDrag();
    }
  }

  function clearDragState() {
    restoreSessionsAfterWorkspaceDrag();
    wrap?.classList.remove("pi-web-sidebar-dragging", "pi-web-sidebar-dragging-workspace", "pi-web-sidebar-dragging-session");
    wrap?.querySelectorAll(".pi-web-sidebar-drag-source, .pi-web-sidebar-drop-target").forEach((node) => {
      node.classList.remove("pi-web-sidebar-drag-source", "pi-web-sidebar-drop-target");
    });
    draggedItem = null;
  }

  function collapseAllSessionsForWorkspaceDrag() {
    wrap.querySelectorAll(".workspace-group > .sessions").forEach((sessions) => {
      sessions.dataset.piWebSidebarWasHidden = sessions.hidden ? "true" : "false";
      sessions.hidden = true;
    });
  }

  function restoreSessionsAfterWorkspaceDrag() {
    wrap?.querySelectorAll(".workspace-group > .sessions[data-pi-web-sidebar-was-hidden]").forEach((sessions) => {
      sessions.hidden = sessions.dataset.piWebSidebarWasHidden === "true";
      delete sessions.dataset.piWebSidebarWasHidden;
    });
  }

  function previewDrag(target, event) {
    if (!draggedItem || !target) {
      return;
    }

    if (draggedItem.type === "workspace") {
      moveWorkspaceNear(draggedItem.element, target.closest(".workspace-group"), event);
    }

    if (draggedItem.type === "session") {
      moveSessionNear(draggedItem.element, target.closest(".session-row[data-session]"), event);
    }
  }

  function finishDrag() {
    if (!draggedItem) {
      clearDragState();
      return;
    }

    if (draggedItem.type === "workspace") {
      persistWorkspaceOrder();
    }

    if (draggedItem.type === "session") {
      persistSessionOrder(draggedItem.element?.dataset.workspace);
    }

    clearDragState();
  }

  function insertNear(source, target, event) {
    if (!source || !target || source === target || !target.parentElement) {
      return false;
    }

    const rect = target.getBoundingClientRect?.();
    const after = rect && Number.isFinite(rect.top) ? event.clientY > rect.top + rect.height / 2 : false;
    const anchor = after ? target.nextSibling : target;
    if (anchor === source) {
      return false;
    }

    const siblings = movableSiblings(source);
    const before = measureTops(siblings);
    wrap.querySelectorAll(".pi-web-sidebar-drop-target").forEach((node) => node.classList.remove("pi-web-sidebar-drop-target"));
    target.parentElement.insertBefore(source, anchor);
    target.classList.add("pi-web-sidebar-drop-target");
    animateMovedSiblings(siblings, before);
    return true;
  }

  function moveWorkspaceNear(source, target, event) {
    if (insertNear(source, target, event)) {
      persistWorkspaceOrder();
    }
  }

  function moveSessionNear(source, target, event) {
    if (!source || !target || source.dataset.workspace !== target.dataset.workspace) {
      return;
    }

    if (insertNear(source, target, event)) {
      persistSessionOrder(source.dataset.workspace);
    }
  }

  function persistWorkspaceOrder() {
    const ids = [...wrap.querySelectorAll(".workspace-group[data-workspace-group]")].map((group) => group.dataset.workspaceGroup);
    app.reorderWorkspaces?.(ids);
  }

  function persistSessionOrder(workspaceId) {
    if (!workspaceId) {
      return;
    }

    const group = wrap.querySelector(`.workspace-group[data-workspace-group='${cssEscape(workspaceId)}']`);
    const ids = [...group?.querySelectorAll(".session-row[data-session]") || []].map((row) => row.dataset.session);
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
        previewDrag(event.target, event);
      }
    });
    panel.addEventListener("drop", (event) => {
      event.preventDefault();
      finishDrag();
    });
    panel.addEventListener("dragend", clearDragState);
    panel.dataset.piWebSidebarFallbackDragBound = "true";
  }

  return { mount, dispose, render: renderCurrentWorkspaces, get element() { return wrap; } };
}

function bindWorkspaceActions(wrap, app) {
  if (wrap.dataset.piWebSidebarWorkspaceActionsBound === "true") {
    return;
  }

  wrap.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action], .session-row[data-session]");
    if (!target || !wrap.contains(target)) {
      return;
    }

    const action = target.dataset.action || (target.dataset.session ? "pick-session" : "");
    if (await handleWorkspaceAction(action, target, app)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  wrap.dataset.piWebSidebarWorkspaceActionsBound = "true";
}

async function handleWorkspaceAction(action, target, app) {
  if (action === "refresh-workspaces") {
    target.disabled = true;
    try {
      await app.refreshWorkspaces?.();
      renderPluginWorkspaceList(app.querySelector(`[${PLUGIN_PANEL_ATTR}]`), app, app.workspaceList || []);
    } finally {
      target.disabled = false;
    }
    return true;
  }

  if (action === "toggle-workspace") {
    toggleWorkspaceGroup(app, target.dataset.workspace);
    return true;
  }

  if (action === "delete-workspace") {
    await app.deleteWorkspace?.(target.dataset.workspace);
    renderPluginWorkspaceList(app.querySelector(`[${PLUGIN_PANEL_ATTR}]`), app, app.workspaceList || []);
    return true;
  }

  if (action === "new-session") {
    await app.newSession?.(target.dataset.workspace);
    renderPluginWorkspaceList(app.querySelector(`[${PLUGIN_PANEL_ATTR}]`), app, app.workspaceList || []);
    return true;
  }

  if (action === "delete-workspace-sessions") {
    await app.deleteWorkspaceSessions?.(target.dataset.workspace);
    renderPluginWorkspaceList(app.querySelector(`[${PLUGIN_PANEL_ATTR}]`), app, app.workspaceList || []);
    return true;
  }

  if (action === "pick-session") {
    await pickSession(target, app);
    return true;
  }

  return false;
}

async function pickSession(row, app) {
  if (typeof app.pickSession === "function") {
    await app.pickSession(row);
  } else if (row.dataset.session && typeof app.loadSession === "function") {
    app.dataset.activeWorkspaceId = row.dataset.workspace || app.dataset.activeWorkspaceId || "";
    app.dataset.activeSessionId = row.dataset.session;
    await app.loadSession(row.dataset.session);
  }

  markSelectedSession(row, app);
  app.route?.("workspace");
}

function markSelectedSession(row, app) {
  app.querySelectorAll(`[${PLUGIN_PANEL_ATTR}] .session-row.active`).forEach((session) => {
    session.classList.remove("active");
  });
  row.classList.add("active");
}

function toggleWorkspaceGroup(app, workspaceId) {
  if (!workspaceId) {
    return;
  }

  const groups = app.querySelectorAll(`[${PLUGIN_PANEL_ATTR}] [data-workspace-group]`);
  const selected = [...groups].find((group) => group.dataset.workspaceGroup === workspaceId);
  const shouldOpen = !!selected?.querySelector(".sessions")?.hidden;
  app.sidebarOpenWorkspaceId = shouldOpen ? workspaceId : "";

  groups.forEach((group) => {
    const open = group.dataset.workspaceGroup === workspaceId && shouldOpen;
    const sessions = group.querySelector(".sessions");
    const row = group.querySelector(".ws-row");
    if (sessions) {
      sessions.hidden = !open;
    }
    row?.classList.toggle("open", open);
    row?.setAttribute("aria-expanded", String(open));
  });

  window.dispatchEvent(new CustomEvent("pi-sidebar-workspace-state", {
    detail: {
      activeWorkspaceId: app.dataset.activeWorkspaceId || "",
      openWorkspaceId: app.sidebarOpenWorkspaceId || "",
    },
  }));
}

function renderPluginWorkspaceList(wrap, app, workspaces) {
  const section = wrap?.querySelector(".sidebar .sb-section");
  const head = section?.querySelector(".sb-head");
  if (!section || !head || !Array.isArray(workspaces)) {
    return;
  }

  section
    .querySelectorAll(":scope > .workspace-group, :scope > [data-sortable-workspaces]")
    .forEach((node) => node.remove());
  for (const workspace of orderedWorkspaces(workspaces)) {
    section.append(createPluginWorkspaceGroup(workspace, app));
  }
}

function createPluginWorkspaceGroup(workspace, app) {
  const group = document.createElement("div");
  const active = workspace.id === app.dataset.activeWorkspaceId;
  const openId = app.sidebarOpenWorkspaceId ?? app.dataset.activeWorkspaceId ?? "";
  const open = workspace.id === openId;
  group.className = "workspace-group";
  group.dataset.workspaceGroup = workspace.id;
  group.classList.toggle("active", active);
  group.classList.toggle("has-active-session", workspaceHasActiveSession(workspace));
  group.append(createWorkspaceShell(workspace, app, open, active));
  group.append(createSessionsList(workspace, app, open));
  return group;
}

function createWorkspaceShell(workspace, app, open, active) {
  const shell = document.createElement("div");
  shell.className = "workspace-shell";
  shell.append(createWorkspaceButton(workspace, app, open, active));
  shell.append(createWorkspaceDeleteButton(workspace));
  return shell;
}

function createWorkspaceButton(workspace, app, open, active) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = [
    "ws-row",
    open && "open",
    active && "active",
    workspaceHasActiveSession(workspace) && "has-active-session",
  ].filter(Boolean).join(" ");
  button.dataset.action = "toggle-workspace";
  button.dataset.workspace = workspace.id;
  button.setAttribute("aria-expanded", String(open));
  button.setAttribute("aria-current", active ? "true" : "false");

  const stack = document.createElement("span");
  stack.className = "ws-stack";
  const name = document.createElement("span");
  name.className = "ws-name";
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.classList.toggle("live", !!workspace.live || workspaceHasActiveSession(workspace));
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = workspace.name || workspace.path || workspace.id;
  name.append(dot, label);
  const path = document.createElement("span");
  path.className = "ws-path";
  path.textContent = workspace.path || "";
  stack.append(name, path);

  const meta = document.createElement("span");
  meta.className = "ws-meta";
  meta.setAttribute("aria-label", `${workspaceSessionCount(workspace)} sessions`);
  const count = document.createElement("span");
  count.className = "ws-count";
  count.textContent = String(workspaceSessionCount(workspace));
  meta.append(count);
  button.append(stack, meta);
  return button;
}

function createWorkspaceDeleteButton(workspace) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-action danger";
  button.dataset.action = "delete-workspace";
  button.dataset.workspace = workspace.id;
  button.title = "remove workspace";
  button.setAttribute("aria-label", "remove workspace");
  button.textContent = "×";
  return button;
}

function createSessionsList(workspace, app, open) {
  const sessions = document.createElement("div");
  sessions.className = "sessions";
  sessions.hidden = !open;

  for (const session of orderedSessions(workspace)) {
    sessions.append(createPluginSessionRow(session, workspace, app));
  }

  if (!workspace.sessions?.length) {
    const empty = document.createElement("div");
    empty.className = "sessions-empty";
    empty.textContent = "no sessions yet · press N to start one";
    sessions.append(empty);
  } else {
    sessions.append(createDeleteWorkspaceSessionsRow(workspace.id));
  }

  sessions.append(createNewSessionRow(workspace.id));
  return sessions;
}

function createPluginSessionRow(session, workspace, app) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = [
    "session-row",
    session.id === app.dataset.activeSessionId && "active",
    session.parentId && "child-session",
  ].filter(Boolean).join(" ");
  row.dataset.action = "pick-session";
  row.dataset.session = session.id;
  row.dataset.workspace = workspace.id;
  row.dataset.title = session.title || session.name || session.id;
  row.setAttribute("aria-current", session.id === app.dataset.activeSessionId ? "true" : "false");

  const main = document.createElement("span");
  main.className = "session-main";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = session.title || session.name || session.id;
  main.append(title);

  const badges = sessionBadges(session);
  if (badges.length) {
    const meta = document.createElement("span");
    meta.className = "session-meta";
    meta.textContent = badges.join(" · ");
    main.append(meta);
  }

  row.append(main);
  return row;
}

function createDeleteWorkspaceSessionsRow(workspaceId) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "session-row clear-sessions-row";
  row.dataset.action = "delete-workspace-sessions";
  row.dataset.workspace = workspaceId;
  row.innerHTML = `<span class="title">delete all sessions</span>`;
  return row;
}

function createNewSessionRow(workspaceId) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "session-row new-session-row";
  row.dataset.action = "new-session";
  row.dataset.workspace = workspaceId;
  row.innerHTML = `<span class="title">${ICONS.plus} new session</span>`;
  return row;
}

function sessionBadges(session) {
  const badges = [];
  if (session.live || session.active || ["running", "thinking"].includes(session.status)) {
    badges.push("live");
  }
  if (session.unreadCompleted || session.unread) {
    badges.push("unread");
  }
  if (session.kind) {
    badges.push(session.kind);
  }
  return badges;
}

function workspaceHasActiveSession(workspace) {
  return (workspace.sessions || []).some((session) => session.active || session.live);
}

function workspaceSessionCount(workspace) {
  return Number.isFinite(workspace.sessionCount) ? workspace.sessionCount : (workspace.sessions || []).length;
}

function orderedWorkspaces(workspaces) {
  return applyStoredOrder(workspaces, readStoredList("pi.workspaceOrder"));
}

function orderedSessions(workspace) {
  const orders = readStoredObject("pi.sessionOrder");
  return applyStoredOrder(workspace.sessions || [], orders[workspace.id] || []);
}

function applyStoredOrder(items, order) {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((left, right) => {
    const leftIndex = positions.get(left.id);
    const rightIndex = positions.get(right.id);
    if (leftIndex === undefined && rightIndex === undefined) {
      return 0;
    }
    if (leftIndex === undefined) {
      return 1;
    }
    if (rightIndex === undefined) {
      return -1;
    }
    return leftIndex - rightIndex;
  });
}

function readStoredList(key) {
  const value = readStoredValue(key);
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function readStoredObject(key) {
  const value = readStoredValue(key);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readStoredValue(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
}

function movableSiblings(source) {
  if (source.classList.contains("workspace-group")) {
    return [...source.parentElement.querySelectorAll(".workspace-group[data-workspace-group]")];
  }

  return [...source.parentElement.querySelectorAll(".session-row[data-session]")];
}

function measureTops(elements) {
  return new Map(elements.map((element) => [element, element.getBoundingClientRect?.().top || 0]));
}

function scheduleFrame(callback) {
  const frame = globalThis.requestAnimationFrame || window?.requestAnimationFrame;
  if (typeof frame === "function") {
    frame(callback);
    return;
  }

  setTimeout(callback, 0);
}

function animateMovedSiblings(elements, before) {
  scheduleFrame(() => {
    for (const element of elements) {
      const oldTop = before.get(element) || 0;
      const newTop = element.getBoundingClientRect?.().top || 0;
      const delta = oldTop - newTop;
      if (!delta) {
        continue;
      }

      if (typeof element.animate === "function") {
        element.animate([
          { transform: `translateY(${delta}px)` },
          { transform: "translateY(0)" },
        ], { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" });
      } else {
        element.style.transform = `translateY(${delta}px)`;
        element.style.transition = "transform 180ms cubic-bezier(0.2, 0, 0, 1)";
        scheduleFrame(() => {
          element.style.transform = "";
        });
      }
    }
  });
}

function installFallbackDragStyles() {
  if (document.getElementById(FALLBACK_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = FALLBACK_STYLE_ID;
  style.textContent = `
    [data-pi-web-sidebar-plugin] .workspace-group,
    [data-pi-web-sidebar-plugin] .session-row[data-session] {
      transition: transform 140ms ease, opacity 140ms ease, background-color 140ms ease;
    }
    [data-pi-web-sidebar-plugin] .workspace-group > .sessions .session-row[data-session] {
      padding-left: 12px;
    }
    [data-pi-web-sidebar-plugin].pi-web-sidebar-dragging-workspace .workspace-group > .sessions {
      display: none !important;
    }
    [data-pi-web-sidebar-plugin] .pi-web-sidebar-drag-source {
      opacity: 0.45;
    }
    [data-pi-web-sidebar-plugin] .pi-web-sidebar-drop-target {
      background: color-mix(in srgb, var(--accent, #7dd3fc) 12%, transparent);
    }
    [data-pi-web-sidebar-drag-handle] {
      cursor: grab;
    }
    [data-pi-web-sidebar-drag-handle]:active {
      cursor: grabbing;
    }
  `;
  document.head.append(style);
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) {
    return CSS.escape(value);
  }

  return String(value).replace(/['\\]/g, "\\$&");
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

function bindOpenWorkspace(wrap, app, context) {
  if (wrap.dataset.piWebSidebarOpenBound === "true") {
    return;
  }

  wrap.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-pi-web-sidebar-action='open-workspace']");
    if (!button || !wrap.contains(button)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    await openWorkspaceWithBackend(button, app, context);
  });
  wrap.dataset.piWebSidebarOpenBound = "true";
}

async function openWorkspaceWithBackend(button, app, context) {
  if (typeof context.backend !== "function") {
    app.route?.("picker");
    return;
  }

  button.disabled = true;
  try {
    const picker = ensureWorkspacePicker(app, context);
    picker.hidden = false;
    await loadWorkspacePickerPath(picker, context, picker.dataset.currentPath || "~");
  } catch (error) {
    showWorkspacePickerError(app, error);
  } finally {
    button.disabled = false;
  }
}

function ensureWorkspacePicker(app, context) {
  let picker = app.querySelector("[data-pi-web-sidebar-picker]");
  if (picker) {
    return picker;
  }

  picker = document.createElement("div");
  picker.dataset.piWebSidebarPicker = "";
  picker.hidden = true;
  picker.innerHTML = [
    "<style>",
    "[data-pi-web-sidebar-picker][hidden]{display:none}",
    "[data-pi-web-sidebar-picker]{position:fixed;inset:0;z-index:120;display:grid;place-items:center;background:rgba(0,0,0,.45)}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-dialog{width:min(720px,calc(100vw - 32px));height:min(640px,calc(100vh - 32px));display:grid;grid-template-rows:auto auto 1fr auto;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-2,14px);box-shadow:0 24px 80px rgba(0,0,0,.5);overflow:hidden}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-head,[data-pi-web-sidebar-picker] .pi-sidebar-picker-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;border-bottom:1px solid var(--border-dim,var(--border))}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-actions{border-top:1px solid var(--border-dim,var(--border));border-bottom:0}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-path{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border-dim,var(--border))}",
    "[data-pi-web-sidebar-picker] input{flex:1;min-width:0;border:1px solid var(--border);border-radius:9px;background:var(--bg-1);color:var(--fg-0);font:12px/1 var(--font-mono);padding:8px 10px}",
    "[data-pi-web-sidebar-picker] button{border:1px solid var(--border);border-radius:9px;background:var(--bg-1);color:var(--fg-1);font:12px/1 var(--font-mono);padding:8px 10px;cursor:pointer}",
    "[data-pi-web-sidebar-picker] button:hover{border-color:var(--accent);color:var(--accent)}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-list{overflow:auto;padding:6px}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-row{width:100%;display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:8px;text-align:left;background:transparent;border:0;border-radius:8px;padding:9px 10px}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-row:hover{background:var(--bg-3)}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-row small{color:var(--fg-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-error{color:var(--danger,#f87171);font-size:12px;min-height:1em}",
    "[data-pi-web-sidebar-picker] [data-clone-dialog][hidden],[data-pi-web-sidebar-picker] [data-new-folder-dialog][hidden]{display:none}",
    "[data-pi-web-sidebar-picker] [data-clone-dialog],[data-pi-web-sidebar-picker] [data-new-folder-dialog]{position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.42)}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-form-dialog{width:min(460px,calc(100vw - 48px));display:grid;gap:10px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-2,14px);box-shadow:0 20px 60px rgba(0,0,0,.5);padding:14px}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-form-dialog label{display:grid;gap:6px;color:var(--fg-2);font:12px/1 var(--font-mono)}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}",
    "</style>",

    '<section class="pi-sidebar-picker-dialog" role="dialog" aria-modal="true" aria-label="open workspace">',
    '<div class="pi-sidebar-picker-head"><strong>open workspace</strong><button type="button" data-picker-action="close">close</button></div>',
    '<form class="pi-sidebar-picker-path" data-picker-path-form><input name="path" autocomplete="off" spellcheck="false"><button type="submit">go</button></form>',
    '<div class="pi-sidebar-picker-list" data-picker-list></div>',
    '<div class="pi-sidebar-picker-actions"><span class="pi-sidebar-picker-error" data-picker-error></span><span><button type="button" data-picker-action="new-folder">new folder</button> <button type="button" data-picker-action="clone">clone</button> <button type="button" data-picker-action="refresh">refresh</button> <button type="button" data-picker-action="open-current">open current</button></span></div>',
    "</section>",
    '<div data-new-folder-dialog hidden><form class="pi-sidebar-form-dialog" data-new-folder-form><strong>new folder</strong><label>folder name<input name="name" autocomplete="off" spellcheck="false" required></label><div class="pi-sidebar-form-actions"><button type="button" data-picker-action="new-folder-cancel">cancel</button><button type="submit">create</button></div></form></div>',
    '<div data-clone-dialog hidden><form class="pi-sidebar-form-dialog" data-clone-form><strong>clone repository</strong><label>git url<input name="gitUrl" autocomplete="off" spellcheck="false" placeholder="https://github.com/user/repo.git" required></label><label>folder name <input name="name" autocomplete="off" spellcheck="false" placeholder="optional"></label><div class="pi-sidebar-form-actions"><button type="button" data-picker-action="clone-cancel">cancel</button><button type="submit">clone</button></div></form></div>',
  ].join("");
  app.append(picker);

  picker.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-picker-action]")?.dataset.pickerAction;
    if (!action) return;
    event.preventDefault();
    try {
      if (action === "close") picker.hidden = true;
      if (action === "refresh") await loadWorkspacePickerPath(picker, context, picker.dataset.currentPath || "~");
      if (action === "enter") await loadWorkspacePickerPath(picker, context, event.target.closest("[data-path]")?.dataset.path || "~");
      if (action === "new-folder") showNewFolderDialog(picker);
      if (action === "new-folder-cancel") hideNewFolderDialog(picker);
      if (action === "clone") showCloneWorkspaceDialog(picker);
      if (action === "clone-cancel") hideCloneWorkspaceDialog(picker);
      if (action === "open-current") await openPickedWorkspace(app, picker.dataset.currentPath || "");
    } catch (error) {
      showWorkspacePickerError(app, error);
    }
  });
  picker.querySelector("[data-picker-path-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await loadWorkspacePickerPath(picker, context, event.currentTarget.elements.path.value.trim() || "~");
    } catch (error) {
      showWorkspacePickerError(app, error);
    }
  });
  picker.querySelector("[data-new-folder-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    await createWorkspacePickerFolder(picker, context, event.currentTarget.elements.name.value.trim());
  });
  picker.querySelector("[data-clone-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    await cloneWorkspaceIntoPickerFolder(picker, context, form.elements.gitUrl.value.trim(), form.elements.name.value.trim());
  });
  return picker;
}

async function loadWorkspacePickerPath(picker, context, path) {
  const input = picker.querySelector('input[name="path"]');
  const list = picker.querySelector("[data-picker-list]");
  const error = picker.querySelector("[data-picker-error]");
  error.textContent = "";
  list.textContent = "loading…";
  try {
    const listing = await context.backend("list-folders", { data: { path } });
    picker.dataset.currentPath = listing.path || path;
    picker.dataset.parentPath = listing.parent || listing.path || path;
    input.value = listing.displayPath || listing.path || path;
    renderWorkspacePickerRows(picker, listing.folders || [], picker.dataset.parentPath);
  } catch (err) {
    list.textContent = "";
    error.textContent = err instanceof Error ? err.message : String(err);
  }
}

function showNewFolderDialog(picker) {
  const dialog = picker.querySelector("[data-new-folder-dialog]");
  const form = picker.querySelector("[data-new-folder-form]");
  form.reset();
  dialog.hidden = false;
  form.elements.name.focus();
}

function hideNewFolderDialog(picker) {
  picker.querySelector("[data-new-folder-dialog]").hidden = true;
}

async function createWorkspacePickerFolder(picker, context, name) {
  if (!name) return;
  const error = picker.querySelector("[data-picker-error]");
  error.textContent = "";
  try {
    await context.backend("create-folder", { data: { parent: picker.dataset.currentPath || "~", name } });
    hideNewFolderDialog(picker);
    await loadWorkspacePickerPath(picker, context, picker.dataset.currentPath || "~");
  } catch (err) {
    error.textContent = err instanceof Error ? err.message : String(err);
  }
}

function showCloneWorkspaceDialog(picker) {
  const dialog = picker.querySelector("[data-clone-dialog]");
  const form = picker.querySelector("[data-clone-form]");
  form.reset();
  dialog.hidden = false;
  form.elements.gitUrl.focus();
}

function hideCloneWorkspaceDialog(picker) {
  picker.querySelector("[data-clone-dialog]").hidden = true;
}

async function cloneWorkspaceIntoPickerFolder(picker, context, gitUrl, name = "") {
  if (!gitUrl) return;
  const error = picker.querySelector("[data-picker-error]");
  error.textContent = "cloning…";
  try {
    const result = await context.backend("clone-workspace", { data: { parent: picker.dataset.currentPath || "~", gitUrl, name } });
    hideCloneWorkspaceDialog(picker);
    await loadWorkspacePickerPath(picker, context, picker.dataset.currentPath || "~");
    if (result?.path) {
      await loadWorkspacePickerPath(picker, context, result.path);
    }
  } catch (err) {
    error.textContent = err instanceof Error ? err.message : String(err);
  }
}

function renderWorkspacePickerRows(picker, folders, parentPath) {
  const list = picker.querySelector("[data-picker-list]");
  list.replaceChildren();
  if (parentPath) {
    list.append(createWorkspacePickerRow({ name: "..", path: parentPath, displayPath: parentPath }, "↑"));
  }
  if (!folders.length) {
    return;
  }
  for (const folder of folders) {
    list.append(createWorkspacePickerRow(folder, "▸"));
  }
}

function createWorkspacePickerRow(folder, icon) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "pi-sidebar-picker-row";
  row.dataset.pickerAction = "enter";
  row.dataset.path = folder.path;
  row.innerHTML = "<span></span><span></span><small></small>";
  row.children[0].textContent = icon;
  row.children[1].textContent = folder.name || folder.path;
  row.children[2].textContent = folder.displayPath || folder.path;
  return row;
}

async function openPickedWorkspace(app, path) {
  if (!path) return;
  if (typeof app.openWorkspacePath === "function") {
    await app.openWorkspacePath(path);
  } else {
    app.route?.("workspace");
  }
  app.querySelector("[data-pi-web-sidebar-picker]")?.setAttribute("hidden", "");
}

function showWorkspacePickerError(app, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Failed to open workspace", error);
  const picker = app.querySelector("[data-pi-web-sidebar-picker]");
  const target = picker?.querySelector("[data-picker-error]");
  if (target) target.textContent = message;
  else alert(`Failed to open workspace: ${message}`);
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
    `<button class="add" type="button" data-pi-web-sidebar-action="open-workspace">${ICONS.plus} open</button>`,
    `<button class="refresh" type="button" data-action="refresh-workspaces" title="refresh workspaces" aria-label="refresh workspaces">${ICONS.refresh}</button>`,
    `<button class="sb-collapse" type="button" data-action="collapse-sidebar" title="collapse sidebar" aria-label="collapse sidebar">${ICONS.collapse}</button>`,
    '</span></div>',
    '</div>',
    '</aside>',
    '<div class="sb-resizer" role="separator" aria-orientation="vertical" aria-label="resize sidebar" title="drag to resize"></div>',
  ].join("");
  return wrap;
}
