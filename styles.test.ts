import { describe, expect, test } from "bun:test";
import { PLUGIN_STYLE_TEXT } from "./src/styles";

describe("plugin CSS", () => {
  test("ships the plugin-owned sidebar styling core no longer provides", () => {
    expect(PLUGIN_STYLE_TEXT).toContain("--pi-web-sidebar-bg");
    expect(PLUGIN_STYLE_TEXT).toContain("[data-pi-web-sidebar-plugin] .sb-head");
    expect(PLUGIN_STYLE_TEXT).toContain("[data-pi-web-sidebar-plugin] .ws-row");
    expect(PLUGIN_STYLE_TEXT).toContain("[data-pi-web-sidebar-plugin] .workspace-empty");
    expect(PLUGIN_STYLE_TEXT).toContain("[data-pi-web-sidebar-plugin] .session-menu");
  });

  test("overlays the sidebar without pushing main content on mobile", () => {
    expect(PLUGIN_STYLE_TEXT).toContain("@media (max-width: 768px)");
    expect(PLUGIN_STYLE_TEXT).toContain(".app-body:has(> [data-pi-web-sidebar-plugin]:not([hidden]))");
    expect(PLUGIN_STYLE_TEXT).toContain("grid-template-columns: minmax(0, 1fr) !important");
    expect(PLUGIN_STYLE_TEXT).toContain("grid-column: 1 !important");
    expect(PLUGIN_STYLE_TEXT).toContain(":is(");
    expect(PLUGIN_STYLE_TEXT).toContain("[data-plugin-sidebar]");
    expect(PLUGIN_STYLE_TEXT).toContain("[data-view='workspace']");
    expect(PLUGIN_STYLE_TEXT).toContain("position: fixed");
    expect(PLUGIN_STYLE_TEXT).toContain("width: min(86vw, 320px)");
    expect(PLUGIN_STYLE_TEXT).toContain("[data-pi-web-sidebar-plugin] .sb-resizer { display: none; }");
  });
});
