# pi-web-sidebar

First-party-style workspace/session sidebar plugin for pi-web.

The plugin mounts a sidebar as a direct child of `.app-body` and renders the same workspace/session navigation surface that the built-in sidebar uses.

## Features

- Workspace list with path, session count, active/live state, and open/collapse behavior.
- Workspace open, refresh, remove, and drag reorder support. The `+ open` flow uses this plugin's own backend-powered folder browser instead of pi-web's route picker.
- Session list with active/live state, hierarchy, subagent/team badges, unread-completed state, rename/delete menu, selection, creation, deletion, and drag reorder support.
- Sidebar collapse/expand, resize persistence, mobile drawer compatibility, settings entry, and update notice entry.

## Install in pi-web

Use pi-web settings → Plugins → local path, then install this folder:

```text
/Users/juunini/Desktop/code/epsilondelta/pi-web-sidebar
```

## Files

- `plugin.json` — pi-web plugin manifest.
- `index.js` — browser plugin entry.
- `backend.go` — Go backend implementation for the custom workspace folder browser.
- `backend.js` — Node wrapper that executes the prebuilt Go backend binary.
- `bin/<os>-<arch>/pi-web-sidebar-backend` — prebuilt backend binary.

## Notes

Current pi-web already ships a built-in sidebar. On activation this plugin temporarily detaches the built-in `.sidebar-wrap`, mounts its own `.sidebar-wrap` under `.app-body`, and reuses pi-web's existing workspace/session render methods and most event actions. On deactivation it restores the built-in sidebar.

The `+ open` button is implemented inside this plugin: frontend opens a custom folder picker, calls `backend.js` with `list-folders`, `create-folder`, or `clone-workspace`, `backend.js` executes the prebuilt Go binary, then the frontend opens the selected path through `app.openWorkspacePath()`.

Rebuild backend binaries with:

```sh
./scripts/build-backends.sh
```
