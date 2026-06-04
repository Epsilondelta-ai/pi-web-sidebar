# pi-web-sidebar

First-party-style workspace/session sidebar plugin for pi-web.

The plugin mounts a sidebar as a direct child of `.app-body` and renders the same workspace/session navigation surface that the built-in sidebar uses.

## Features

- Workspace list with path, session count, active/live state, and open/collapse behavior.
- Workspace open, refresh, remove, and drag reorder support through existing pi-web actions.
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

## Notes

Current pi-web already ships a built-in sidebar. On activation this plugin temporarily detaches the built-in `.sidebar-wrap`, mounts its own `.sidebar-wrap` under `.app-body`, and reuses pi-web's existing workspace/session render methods and event actions. On deactivation it restores the built-in sidebar.
