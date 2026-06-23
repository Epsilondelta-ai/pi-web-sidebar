export const SIDEBAR_CHROME_STYLE_TEXT: string = `
  [data-pi-web-sidebar-drag-handle] { cursor: grab; }
  [data-pi-web-sidebar-drag-handle]:active { cursor: grabbing; }
  [data-pi-web-sidebar-plugin] .sb-resizer {
    width: 4px; background: transparent; cursor: col-resize;
  }

  [data-pi-web-sidebar-plugin] .sb-resizer:hover {
    background: color-mix(in srgb, var(--pi-web-sidebar-accent) 35%, transparent);
  }

  .pi-web-sidebar-toggle {
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    min-width: 28px; min-height: 28px;
    border: 1px solid var(--border, #2a2a2a);
    border-radius: 8px;
    background: var(--bg-1, #101010);
    color: var(--fg-1, #d4d4d4);
    cursor: pointer;
    font: 18px/1 var(--font-mono, ui-monospace, monospace);
  }
`;
