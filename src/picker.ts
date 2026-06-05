import { callBackend, loadFolders, openWorkspacePath } from "./api";
import { routePicker, routeWorkspace } from "./layout";
import { pickerMarkup } from "./picker-markup";
import { renderWorkspacePickerRows } from "./picker-rows";
import { eventTarget, isRecord, textInputValue } from "./picker-utils";
import type { AppElement, FolderEntry, FolderListing, PluginContext, SidebarWorkspace } from "./types";

export function bindOpenWorkspace(
  wrap: HTMLElement,
  app: AppElement,
  context: PluginContext,
  refreshWorkspaces: () => Promise<SidebarWorkspace[]>,
): void {
  if (wrap.dataset.piWebSidebarOpenBound === "true") {
    return;
  }

  wrap.addEventListener("click", async (event: MouseEvent): Promise<void> => {
    const button: HTMLButtonElement | null = eventTarget(event)?.closest("[data-pi-web-sidebar-action='open-workspace']");

    if (!button || !wrap.contains(button)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    await openWorkspaceWithBackend(button, app, context, refreshWorkspaces);
  });
  wrap.dataset.piWebSidebarOpenBound = "true";
}

async function openWorkspaceWithBackend(
  button: HTMLButtonElement,
  app: AppElement,
  context: PluginContext,
  refreshWorkspaces: () => Promise<SidebarWorkspace[]>,
): Promise<void> {
  if (typeof context.backend !== "function") {
    routePicker(app);
    return;
  }

  button.disabled = true;

  try {
    const picker: HTMLElement = ensureWorkspacePicker(app, context, refreshWorkspaces);
    picker.hidden = false;
    await loadWorkspacePickerPath(picker, context, picker.dataset.currentPath || "~");
  } catch (error) {
    showWorkspacePickerError(app, error);
  } finally {
    button.disabled = false;
  }
}
function ensureWorkspacePicker(
  app: AppElement,
  context: PluginContext,
  refreshWorkspaces: () => Promise<SidebarWorkspace[]>,
): HTMLElement {
  let picker: HTMLElement | null = app.querySelector("[data-pi-web-sidebar-picker]");

  if (picker) {
    return picker;
  }

  picker = document.createElement("div");
  picker.dataset.piWebSidebarPicker = "";
  picker.hidden = true;
  picker.innerHTML = pickerMarkup();
  app.append(picker);
  bindPickerActions(picker, app, context, refreshWorkspaces);
  return picker;
}

function bindPickerActions(
  picker: HTMLElement,
  app: AppElement,
  context: PluginContext,
  refreshWorkspaces: () => Promise<SidebarWorkspace[]>,
): void {
  picker.addEventListener("click", async (event: MouseEvent): Promise<void> => {
    const target: HTMLElement | null = eventTarget(event);
    const action: string | undefined = target?.closest<HTMLElement>("[data-picker-action]")?.dataset.pickerAction;

    if (!action) {
      return;
    }

    event.preventDefault();

    try {
      await handlePickerAction(action, picker, app, context, refreshWorkspaces, target);
    } catch (error) {
      showWorkspacePickerError(app, error);
    }
  });
  bindPickerForms(picker, app, context);
}

async function handlePickerAction(
  action: string,
  picker: HTMLElement,
  app: AppElement,
  context: PluginContext,
  refreshWorkspaces: () => Promise<SidebarWorkspace[]>,
  target: HTMLElement | null,
): Promise<void> {
  if (action === "close") {
    picker.hidden = true;
  }
  if (action === "refresh") {
    await loadWorkspacePickerPath(picker, context, picker.dataset.currentPath || "~");
  }
  if (action === "enter") {
    await loadWorkspacePickerPath(picker, context, target?.closest<HTMLElement>("[data-path]")?.dataset.path || "~");
  }

  if (action === "new-folder") {
    showNewFolderDialog(picker);
  }

  if (action === "new-folder-cancel") {
    hideDialog(picker, "[data-new-folder-dialog]");
  }

  if (action === "clone") {
    showCloneWorkspaceDialog(picker);
  }

  if (action === "clone-cancel") {
    hideDialog(picker, "[data-clone-dialog]");
  }

  if (action === "open-current") {
    await openPickedWorkspace(app, context, refreshWorkspaces, picker.dataset.currentPath || "");
  }
}

function bindPickerForms(picker: HTMLElement, app: AppElement, context: PluginContext): void {
  picker.querySelector<HTMLFormElement>("[data-picker-path-form]")?.addEventListener("submit", async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();

    try {
      const form: HTMLFormElement = event.currentTarget as HTMLFormElement;
      await loadWorkspacePickerPath(picker, context, textInputValue(form, "path") || "~");
    } catch (error) {
      showWorkspacePickerError(app, error);
    }
  });
  picker.querySelector<HTMLFormElement>("[data-new-folder-form]")?.addEventListener("submit", async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const form: HTMLFormElement = event.currentTarget as HTMLFormElement;
    await createWorkspacePickerFolder(picker, context, textInputValue(form, "name"));
  });
  picker.querySelector<HTMLFormElement>("[data-clone-form]")?.addEventListener("submit", async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const form: HTMLFormElement = event.currentTarget as HTMLFormElement;
    await cloneWorkspaceIntoPickerFolder(picker, context, textInputValue(form, "gitUrl"), textInputValue(form, "name"));
  });
}
async function loadWorkspacePickerPath(picker: HTMLElement, context: PluginContext, path: string): Promise<void> {
  const input: HTMLInputElement | null = picker.querySelector('input[name="path"]');
  const list: HTMLElement | null = picker.querySelector("[data-picker-list]");
  const error: HTMLElement | null = picker.querySelector("[data-picker-error]");

  if (!input || !list || !error) {
    return;
  }

  error.textContent = "";
  list.textContent = "loading…";

  try {
    const listing: FolderListing = await loadFolders(context, path);
    picker.dataset.currentPath = listing.path || path;
    picker.dataset.parentPath = listing.parent || listing.path || path;
    input.value = listing.displayPath || listing.path || path;
    renderWorkspacePickerRows(picker, listing.folders || [], picker.dataset.parentPath);
  } catch (caught) {
    list.textContent = "";
    error.textContent = caught instanceof Error ? caught.message : String(caught);
  }
}

function showNewFolderDialog(picker: HTMLElement): void {
  const dialog: HTMLElement | null = picker.querySelector("[data-new-folder-dialog]");
  const form: HTMLFormElement | null = picker.querySelector("[data-new-folder-form]");

  if (!dialog || !form) {
    return;
  }

  form.reset();
  dialog.hidden = false;
  form.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
}

async function createWorkspacePickerFolder(picker: HTMLElement, context: PluginContext, name: string): Promise<void> {
  if (!name) {
    return;
  }

  const error: HTMLElement | null = picker.querySelector("[data-picker-error]");
  if (error) {
    error.textContent = "";
  }

  try {
    await callBackend(context, "create-folder", { parent: picker.dataset.currentPath || "~", name });
    hideDialog(picker, "[data-new-folder-dialog]");
    await loadWorkspacePickerPath(picker, context, picker.dataset.currentPath || "~");
  } catch (caught) {
    if (error) {
      error.textContent = caught instanceof Error ? caught.message : String(caught);
    }
  }
}

function showCloneWorkspaceDialog(picker: HTMLElement): void {
  const dialog: HTMLElement | null = picker.querySelector("[data-clone-dialog]");
  const form: HTMLFormElement | null = picker.querySelector("[data-clone-form]");

  if (!dialog || !form) {
    return;
  }

  form.reset();
  dialog.hidden = false;
  form.querySelector<HTMLInputElement>('input[name="gitUrl"]')?.focus();
}

async function cloneWorkspaceIntoPickerFolder(
  picker: HTMLElement,
  context: PluginContext,
  gitUrl: string,
  name: string = "",
): Promise<void> {
  if (!gitUrl) {
    return;
  }

  const error: HTMLElement | null = picker.querySelector("[data-picker-error]");
  if (error) {
    error.textContent = "cloning…";
  }

  try {
    const result: unknown = await callBackend(context, "clone-workspace", {
      parent: picker.dataset.currentPath || "~",
      gitUrl,
      name,
    });
    hideDialog(picker, "[data-clone-dialog]");
    await loadWorkspacePickerPath(picker, context, picker.dataset.currentPath || "~");

    if (isRecord(result) && typeof result.path === "string") {
      await loadWorkspacePickerPath(picker, context, result.path);
    }
  } catch (caught) {
    if (error) {
      error.textContent = caught instanceof Error ? caught.message : String(caught);
    }
  }
}
async function openPickedWorkspace(
  app: AppElement,
  context: PluginContext,
  refreshWorkspaces: () => Promise<SidebarWorkspace[]>,
  path: string,
): Promise<void> {
  if (!path) {
    return;
  }

  await openWorkspacePath(context, path);
  await refreshWorkspaces();
  routeWorkspace(app);
  app.querySelector("[data-pi-web-sidebar-picker]")?.setAttribute("hidden", "");
}

function showWorkspacePickerError(app: AppElement, error: unknown): void {
  const message: string = error instanceof Error ? error.message : String(error);
  console.error("Failed to open workspace", error);
  const picker: HTMLElement | null = app.querySelector("[data-pi-web-sidebar-picker]");
  const target: HTMLElement | null | undefined = picker?.querySelector("[data-picker-error]");

  if (target) {
    target.textContent = message;
  } else {
    alert(`Failed to open workspace: ${message}`);
  }
}

function hideDialog(picker: HTMLElement, selector: string): void {
  const dialog: HTMLElement | null = picker.querySelector(selector);

  if (dialog) {
    dialog.hidden = true;
  }
}
