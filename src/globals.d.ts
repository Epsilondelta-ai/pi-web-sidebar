import type { PiWebRegistry, PiWebSidebarGlobal } from "./types";

declare global {
  var piWeb: PiWebRegistry | undefined;
  var piWebSidebar: PiWebSidebarGlobal | undefined;
}

export {};
