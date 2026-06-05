import { callBackend, loadFolders, openWorkspacePath } from "./api";
import { routePicker, routeWorkspace } from "./layout";
import { pickerMarkup } from "./picker-markup";
import { renderWorkspacePickerRows } from "./picker-rows";
import { eventTarget, isRecord, textInputValue } from "./picker-utils";
import type { AppElement, FolderEntry, FolderListing, PluginContext, SidebarWorkspace } from "./types";

const pickerReturnFocus: WeakMap<HTMLElement, HTMLElement> = new WeakMap();

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
    const button: HTMLButtonElement | null = eventTarget(event)?.closest("[data-pi-web-sidebar-action='open-workspace']") || null;

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
    pickerReturnFocus.set(picker, button);
    picker.hidden = false;
    focusPickerPathInput(picker);
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
    closePicker(picker);
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
  picker.addEventListener("keydown", (event: KeyboardEvent): void => handlePickerKeydown(picker, event));
}

function handlePickerKeydown(picker: HTMLElement, event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    closeTopPickerDialog(picker);
    return;
  }

  if (event.key === "Tab") {
    trapPickerFocus(picker, event);
  }
}

function closeTopPickerDialog(picker: HTMLElement): void {
  const cloneDialog: HTMLElement | null = picker.querySelector("[data-clone-dialog]:not([hidden])");
  const folderDialog: HTMLElement | null = picker.querySelector("[data-new-folder-dialog]:not([hidden])");

  if (cloneDialog) {
    hideDialog(picker, "[data-clone-dialog]");
    picker.querySelector<HTMLElement>("[data-picker-action='clone']")?.focus();
    return;
  }

  if (folderDialog) {
    hideDialog(picker, "[data-new-folder-dialog]");
    picker.querySelector<HTMLElement>("[data-picker-action='new-folder']")?.focus();
    return;
  }

  closePicker(picker);
}

function trapPickerFocus(picker: HTMLElement, event: KeyboardEvent): void {
  const focusRoot: HTMLElement = picker.querySelector<HTMLElement>("[data-clone-dialog]:not([hidden]), [data-new-folder-dialog]:not([hidden])") || picker;
  const focusable: HTMLElement[] = [...focusRoot.querySelectorAll<HTMLElement>(
    "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])",
  )].filter(isVisibleFocusable);

  if (focusable.length === 0) {
    return;
  }

  const first: HTMLElement = focusable[0];
  const last: HTMLElement = focusable[focusable.length - 1];
  const active: Element | null = document.activeElement;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function isVisibleFocusable(element: HTMLElement): boolean {
  return !element.hasAttribute("disabled") && !element.hidden && !element.closest("[hidden]");
}

function closePicker(picker: HTMLElement): void {
  resetPickerDialogs(picker);
  picker.hidden = true;
  const returnFocus: HTMLElement | undefined = pickerReturnFocus.get(picker);
  pickerReturnFocus.delete(picker);
  returnFocus?.focus();
}

function resetPickerDialogs(picker: HTMLElement): void {
  hideDialog(picker, "[data-clone-dialog]");
  hideDialog(picker, "[data-new-folder-dialog]");
  picker.querySelector<HTMLFormElement>("[data-clone-form]")?.reset();
  picker.querySelector<HTMLFormElement>("[data-new-folder-form]")?.reset();
}

function focusPickerPathInput(picker: HTMLElement): void {
  picker.querySelector<HTMLInputElement>('input[name="path"]')?.focus();
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
  const picker: HTMLElement | null = app.querySelector("[data-pi-web-sidebar-picker]");

  if (picker) {
    closePicker(picker);
  }
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

  if (!dialog) {
    return;
  }

  const active: Element | null = document.activeElement;
  dialog.hidden = true;

  if (active && dialog.contains(active)) {
    dialogReturnTarget(picker, selector)?.focus();
  }
}

function dialogReturnTarget(picker: HTMLElement, selector: string): HTMLElement | null {
  if (selector === "[data-clone-dialog]") {
    return picker.querySelector("[data-picker-action='clone']");
  }

  if (selector === "[data-new-folder-dialog]") {
    return picker.querySelector("[data-picker-action='new-folder']");
  }

  return null;
}
