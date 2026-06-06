import { createSidebarController } from "./controller";
import type { AppElement, PluginContext } from "./types";

export { createSidebarController } from "./controller";
export type { SidebarController, SidebarWorkspace, SidebarSession, SidebarSnapshot } from "./types";

export default function activate(context: PluginContext): () => void {
  if (!context.app) {
    throw new Error("pi-web-sidebar requires context.app");
  }

  const controller = createSidebarController(context.app as AppElement, context);
  controller.mount();
  return (): void => controller.dispose();
}
