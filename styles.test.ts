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
});
