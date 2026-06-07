import { FALLBACK_STYLE_ID, ICONS, PLUGIN_PANEL_ATTR } from "./constants";
import type { AppElement } from "./types";

export function installFallbackDragStyles(): void {
  if (document.getElementById(FALLBACK_STYLE_ID)) {
    return;
  }

  const style: HTMLStyleElement = document.createElement("style");
  style.id = FALLBACK_STYLE_ID;
  style.textContent = `
    [data-pi-web-sidebar-plugin] {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 4px;
      min-width: 0;
      min-height: 0;
      height: 100%;
      overflow: hidden;
    }
    [data-pi-web-sidebar-plugin][hidden] {
      display: none !important;
    }
    [data-pi-web-sidebar-plugin] .sidebar {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      height: 100%;
      overflow: hidden;
    }
    [data-pi-web-sidebar-plugin] .workspace-group,
    [data-pi-web-sidebar-plugin] .session-row[data-session] {
      min-width: 0;
    }
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
    [data-pi-web-sidebar-plugin] .session-indicator {
      flex: 0 0 auto;
      background: var(--fg-3, #6b7280);
    }
    [data-pi-web-sidebar-plugin] .session-indicator.live {
      background: var(--ok, #22c55e);
    }
    [data-pi-web-sidebar-drag-handle]:active {
      cursor: grabbing;
    }
    .pi-web-sidebar-toggle {
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      min-width: 28px;
      min-height: 28px;
      cursor: pointer;
      font: 18px/1 var(--font-mono, ui-monospace, monospace);
    }
    @media (max-width: 768px) {
      [data-pi-web-sidebar-plugin]:not([hidden]) {
        position: fixed;
        inset: 0 auto 0 0;
        z-index: 999;
        width: min(86vw, 320px);
        max-width: calc(100vw - 48px);
      }
      [data-pi-web-sidebar-plugin] .sb-resizer {
        display: none;
      }
    }
  `;
  document.head.append(style);
}

export function cssEscape(value: string): string {
  if (typeof globalThis.CSS?.escape === "function") {
    return CSS.escape(value);
  }

  return String(value).replace(/['\\]/g, "\\$&");
}

export function ensureWorkspaceDragHandles(root: HTMLElement | null): void {
  root?.querySelectorAll<HTMLElement>(".workspace-group .ws-row").forEach((row: HTMLElement): void => {
    if (row.querySelector(".workspace-drag-handle")) {
      return;
    }

    const handle: HTMLSpanElement = document.createElement("span");
    handle.className = "drag-handle workspace-drag-handle";
    handle.setAttribute("aria-label", "reorder workspace");
    handle.setAttribute("draggable", "true");
    handle.setAttribute("data-pi-web-sidebar-drag-handle", "workspace");
    handle.innerHTML = ICONS.grip;
    row.insertBefore(handle, row.firstChild);
  });
}

export function ensureSessionDragHandles(root: HTMLElement | null): void {
  root?.querySelectorAll<HTMLElement>(".session-row[data-session] .session-main").forEach((row: HTMLElement): void => {
    if (row.querySelector(".session-drag-handle")) {
      return;
    }

    const handle: HTMLSpanElement = document.createElement("span");
    handle.className = "drag-handle session-drag-handle";
    handle.setAttribute("aria-label", "reorder session");
    handle.setAttribute("draggable", "true");
    handle.setAttribute("data-pi-web-sidebar-drag-handle", "session");
    handle.innerHTML = ICONS.grip;
    row.insertBefore(handle, row.firstChild);
  });
}

export function resetHostSidebarRenderState(app: AppElement): void {
  app.sidebarSortableCleanup?.();
  app.sidebarSortableRoot?.unmount?.();
  app.sidebarSortableRoot = undefined;
  app.sidebarSortableRenderToken = undefined;
}

export function createSidebar(): HTMLElement {
  const wrap: HTMLDivElement = document.createElement("div");
  wrap.className = "sidebar-wrap";
  wrap.setAttribute(PLUGIN_PANEL_ATTR, "");
  wrap.innerHTML = [
    '<aside class="sidebar" aria-label="workspaces and sessions">',
    '<div class="sb-section" style="flex:1;overflow-y:auto;min-height:0">',
    '<div class="sb-head"><span>workspaces</span><span class="sb-head-actions">',
    `<button class="add" type="button" data-pi-web-sidebar-action="open-workspace">${ICONS.plus} open</button>`,
    `<button class="refresh" type="button" data-action="refresh-workspaces" title="refresh workspaces" aria-label="refresh workspaces">${ICONS.refresh}</button>`,
    `<button class="sb-collapse" type="button" data-action="collapse-sidebar" title="collapse sidebar" aria-label="collapse sidebar">${ICONS.collapse}</button>`,
    "</span></div>",
    "</div>",
    "</aside>",
    '<div class="sb-resizer" role="separator" aria-orientation="vertical" aria-label="resize sidebar" title="drag to resize"></div>',
  ].join("");
  return wrap;
}
