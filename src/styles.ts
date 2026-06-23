import { MOBILE_STYLE_TEXT } from "./mobile-styles";
import { SIDEBAR_CHROME_STYLE_TEXT } from "./sidebar-chrome-styles";

export const PLUGIN_STYLE_TEXT: string = `
  [data-pi-web-sidebar-plugin] {
    --pi-web-sidebar-bg: var(--bg-2, #161616);
    --pi-web-sidebar-bg-soft: var(--bg-1, #101010);
    --pi-web-sidebar-bg-hover: var(--bg-3, #222222);
    --pi-web-sidebar-border: var(--border, #2a2a2a);
    --pi-web-sidebar-border-dim: var(--border-dim, rgba(255, 255, 255, 0.08));
    --pi-web-sidebar-fg: var(--fg-0, #e5e7eb);
    --pi-web-sidebar-fg-muted: var(--fg-2, #a3a3a3);
    --pi-web-sidebar-fg-dim: var(--fg-3, #737373);
    --pi-web-sidebar-accent: var(--accent, #7dd3fc);
    --pi-web-sidebar-danger: var(--danger, #ef4444);
    --pi-web-sidebar-ok: var(--ok, #22c55e);
    --pi-web-sidebar-radius: var(--radius-2, 12px);
    --pi-web-sidebar-font: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 4px;
    min-width: 0; min-height: 0; height: 100%; overflow: hidden;
    background: var(--pi-web-sidebar-bg);
    color: var(--pi-web-sidebar-fg);
    border-right: 1px solid var(--pi-web-sidebar-border);
    font: 12px/1.35 var(--pi-web-sidebar-font);
  }

  [data-pi-web-sidebar-plugin], [data-pi-web-sidebar-plugin] * { box-sizing: border-box; }
  [data-pi-web-sidebar-plugin][hidden] { display: none !important; }
  [data-pi-web-sidebar-plugin] button { font: inherit; }

  [data-pi-web-sidebar-plugin] .sidebar {
    display: flex;
    flex-direction: column;
    min-width: 0; min-height: 0; height: 100%; overflow: hidden;
    background: linear-gradient(180deg, var(--pi-web-sidebar-bg) 0%, var(--pi-web-sidebar-bg-soft) 100%);
  }

  [data-pi-web-sidebar-plugin] .sb-section {
    display: flex; flex-direction: column; gap: 6px; padding: 10px;
  }

  [data-pi-web-sidebar-plugin] .sb-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px; min-height: 32px;
    color: var(--pi-web-sidebar-fg-muted);
    font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  }

  [data-pi-web-sidebar-plugin] .sb-head-actions {
    display: inline-flex; align-items: center; gap: 6px;
  }

  [data-pi-web-sidebar-plugin] .add,
  [data-pi-web-sidebar-plugin] .refresh,
  [data-pi-web-sidebar-plugin] .sb-collapse,
  [data-pi-web-sidebar-plugin] .row-action,
  [data-pi-web-sidebar-plugin] .session-menu-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px; min-width: 28px; min-height: 28px;
    border: 1px solid var(--pi-web-sidebar-border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--pi-web-sidebar-bg-hover) 78%, transparent);
    color: var(--pi-web-sidebar-fg-muted);
    cursor: pointer;
  }

  [data-pi-web-sidebar-plugin] .add { padding: 0 10px; color: var(--pi-web-sidebar-fg); }
  [data-pi-web-sidebar-plugin] button:hover {
    border-color: color-mix(in srgb, var(--pi-web-sidebar-accent) 55%, var(--pi-web-sidebar-border));
    color: var(--pi-web-sidebar-accent);
  }

  [data-pi-web-sidebar-plugin] button:focus-visible {
    outline: 2px solid var(--pi-web-sidebar-accent); outline-offset: 2px;
  }

  [data-pi-web-sidebar-plugin] .workspace-empty {
    border: 1px dashed var(--pi-web-sidebar-border-dim);
    border-radius: var(--pi-web-sidebar-radius); padding: 12px;
    color: var(--pi-web-sidebar-fg-dim);
    background: color-mix(in srgb, var(--pi-web-sidebar-bg-hover) 40%, transparent);
  }

  [data-pi-web-sidebar-plugin] .workspace-group,
  [data-pi-web-sidebar-plugin] .session-row[data-session] {
    min-width: 0;
    transition: transform 140ms ease, opacity 140ms ease, background-color 140ms ease;
  }

  [data-pi-web-sidebar-plugin] .workspace-group { display: grid; gap: 4px; }
  [data-pi-web-sidebar-plugin] .workspace-shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center; gap: 4px;
  }

  [data-pi-web-sidebar-plugin] .ws-row,
  [data-pi-web-sidebar-plugin] .session-row,
  [data-pi-web-sidebar-plugin] .new-session-row {
    width: 100%; min-width: 0;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: var(--pi-web-sidebar-fg-muted);
    cursor: pointer;
  }

  [data-pi-web-sidebar-plugin] .ws-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center; gap: 8px; padding: 8px;
    text-align: left;
  }

  [data-pi-web-sidebar-plugin] .ws-row:hover,
  [data-pi-web-sidebar-plugin] .session-row:hover,
  [data-pi-web-sidebar-plugin] .new-session-row:hover {
    background: var(--pi-web-sidebar-bg-hover);
    color: var(--pi-web-sidebar-fg);
  }

  [data-pi-web-sidebar-plugin] .ws-row.open {
    border-color: var(--pi-web-sidebar-border-dim);
    background: color-mix(in srgb, var(--pi-web-sidebar-bg-hover) 35%, transparent);
    color: var(--pi-web-sidebar-fg);
  }

  [data-pi-web-sidebar-plugin] .ws-row.active,
  [data-pi-web-sidebar-plugin] .session-row.active,
  [data-pi-web-sidebar-plugin] .session-row.selected {
    border-color: color-mix(in srgb, var(--pi-web-sidebar-accent) 38%, var(--pi-web-sidebar-border));
    background: color-mix(in srgb, var(--pi-web-sidebar-accent) 12%, transparent);
    color: var(--pi-web-sidebar-fg);
  }

  [data-pi-web-sidebar-plugin] .ws-stack, [data-pi-web-sidebar-plugin] .session-main { min-width: 0; }
  [data-pi-web-sidebar-plugin] .ws-stack { display: grid; gap: 2px; }
  [data-pi-web-sidebar-plugin] .ws-name {
    display: flex; align-items: center; gap: 7px; min-width: 0;
  }

  [data-pi-web-sidebar-plugin] .label,
  [data-pi-web-sidebar-plugin] .ws-path,
  [data-pi-web-sidebar-plugin] .title {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  [data-pi-web-sidebar-plugin] .ws-path,
  [data-pi-web-sidebar-plugin] .ws-meta,
  [data-pi-web-sidebar-plugin] .meta { color: var(--pi-web-sidebar-fg-dim); font-size: 11px; }

  [data-pi-web-sidebar-plugin] .dot {
    flex: 0 0 auto;
    width: 8px; height: 8px; border-radius: 999px;
    background: var(--pi-web-sidebar-fg-dim);
  }

  [data-pi-web-sidebar-plugin] .dot.live,
  [data-pi-web-sidebar-plugin] .session-indicator.live {
    background: var(--pi-web-sidebar-ok);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--pi-web-sidebar-ok) 18%, transparent);
  }

  [data-pi-web-sidebar-plugin] .ws-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px; min-height: 20px; padding: 0 6px; border-radius: 999px;
    background: var(--pi-web-sidebar-bg-soft);
    color: var(--pi-web-sidebar-fg-muted);
  }

  [data-pi-web-sidebar-plugin] .sessions {
    display: grid;
    gap: 3px; margin: 0 0 4px 10px; padding: 0 0 0 8px;
    border-left: 1px solid var(--pi-web-sidebar-border-dim);
  }

  [data-pi-web-sidebar-plugin] .sessions[hidden] { display: none !important; }
  [data-pi-web-sidebar-plugin] .workspace-group > .sessions .session-row[data-session] {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center; gap: 4px; position: relative;
    padding-left: calc(6px + (var(--pi-web-sidebar-session-depth, 0) * 14px));
  }

  [data-pi-web-sidebar-plugin] .workspace-group > .sessions .session-row.agent-parent-session {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  [data-pi-web-sidebar-plugin] .agent-session-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px; height: 20px; padding: 0;
    border-color: transparent;
    background: transparent;
    color: var(--pi-web-sidebar-fg-dim);
    transform: rotate(90deg);
    transition: transform 140ms ease, color 140ms ease;
  }

  [data-pi-web-sidebar-plugin] .agent-session-toggle[aria-expanded="false"] { transform: rotate(0deg); }
  [data-pi-web-sidebar-plugin] .agent-session-toggle:hover { color: var(--pi-web-sidebar-accent); }
  [data-pi-web-sidebar-plugin] .agent-session-toggle:disabled { cursor: default; opacity: 0.55; }

  [data-pi-web-sidebar-plugin] .session-row.child-session::before {
    content: "↳";
    position: absolute;
    left: calc(2px + (var(--pi-web-sidebar-session-depth, 0) * 14px));
    color: var(--pi-web-sidebar-fg-dim);
  }

  [data-pi-web-sidebar-plugin] .session-row[data-session] .session-main {
    display: flex;
    align-items: center; gap: 6px;
    width: 100%; min-width: 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  [data-pi-web-sidebar-plugin] .session-row[data-session] .meta { flex: 0 0 auto; }
  [data-pi-web-sidebar-plugin] .session-menu-button {
    position: relative; z-index: 2;
    min-width: 24px; min-height: 24px;
    border-color: transparent;
    background: transparent;
  }

  [data-pi-web-sidebar-plugin] .session-menu {
    position: absolute;
    top: 100%; right: 0; z-index: 10;
    display: grid;
    min-width: 132px; gap: 3px; padding: 5px;
    border: 1px solid var(--pi-web-sidebar-border);
    border-radius: 10px;
    background: var(--pi-web-sidebar-bg);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
  }

  [data-pi-web-sidebar-plugin] .session-menu[hidden] { display: none !important; }
  [data-pi-web-sidebar-plugin] .session-menu button {
    display: flex;
    align-items: center; gap: 8px;
    border: 0; border-radius: 7px; padding: 7px 8px;
    background: transparent;
    color: var(--pi-web-sidebar-fg-muted);
    text-align: left;
    cursor: pointer;
  }

  [data-pi-web-sidebar-plugin] .danger,
  [data-pi-web-sidebar-plugin] .danger:hover { color: var(--pi-web-sidebar-danger) !important; }

  [data-pi-web-sidebar-plugin] .clear-sessions-row[data-action="delete-workspace-sessions"] {
    display: flex !important;
    align-items: center;
    width: 100%; border: 0; border-radius: 8px; padding: 6px 10px 6px 22px;
    background: color-mix(in srgb, var(--pi-web-sidebar-danger) 10%, transparent) !important;
    color: var(--pi-web-sidebar-danger) !important;
    text-align: left;
    cursor: pointer;
  }

  [data-pi-web-sidebar-plugin] .clear-sessions-row[data-action="delete-workspace-sessions"]:hover {
    background: color-mix(in srgb, var(--pi-web-sidebar-danger) 18%, transparent) !important;
  }

  [data-pi-web-sidebar-plugin] .new-session-row {
    display: flex; align-items: center; padding: 7px 10px 7px 22px; text-align: left;
  }

  [data-pi-web-sidebar-plugin].pi-web-sidebar-dragging-workspace .workspace-group > .sessions {
    display: none !important;
  }

  [data-pi-web-sidebar-plugin] .pi-web-sidebar-drag-source { opacity: 0.45; }
  [data-pi-web-sidebar-plugin] .pi-web-sidebar-drop-target {
    background: color-mix(in srgb, var(--pi-web-sidebar-accent) 12%, transparent);
  }

${SIDEBAR_CHROME_STYLE_TEXT}${MOBILE_STYLE_TEXT}`;
