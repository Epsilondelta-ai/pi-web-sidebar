import type { FolderEntry } from "./types";

export function renderWorkspacePickerRows(picker: HTMLElement, folders: FolderEntry[], parentPath?: string): void {
  const list: HTMLElement | null = picker.querySelector("[data-picker-list]");

  if (!list) {
    return;
  }

  list.replaceChildren();

  if (parentPath) {
    list.append(createWorkspacePickerRow({ name: "..", path: parentPath, displayPath: parentPath }, "↑"));
  }

  for (const folder of folders) {
    list.append(createWorkspacePickerRow(folder, "▸"));
  }
}

function createWorkspacePickerRow(folder: FolderEntry, icon: string): HTMLElement {
  const row: HTMLButtonElement = document.createElement("button");
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
