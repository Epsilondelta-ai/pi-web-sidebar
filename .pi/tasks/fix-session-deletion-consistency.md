# Fix Session Deletion Consistency

## Request

- Verify with Playwright at `http://localhost:4321/` while progressing.
- Run `bun run build && bun run build:backend`, then verify again with Playwright.
- Delete all sessions must send the full list via RxJS.
- Delete all sessions button currently only removes from UI, not real storage.
- Delete all sessions styling is missing.
- Deleting a session must also delete child sessions (subagents, team agents).
- Newly-created idle sessions must not show as active in the indicator.
- Existing sessions must be shown even if not created by this plugin.
- If localStorage or `.pi-web/pi-web-sidebar/workspaces.json` references non-existent sessions, remove them from localStorage, workspaces.json, and UI.

## Re:ZERO Tasks

1. Fix session deletion data flow and persistence
   - Done: Delete-all emits full RxJS session list, deletes real sessions, removes stale localStorage/workspaces entries.
   - Depends on: none
   - Parallel: no
2. Fix cascade deletion for child sessions
   - Done: Deleting a parent removes subagent/team child sessions from backend/store/UI.
   - Depends on: 1
   - Parallel: no
3. Fix session visibility and active indicator
   - Done: Existing non-plugin sessions show; newly-created idle sessions are not marked active.
   - Depends on: 1
   - Parallel: no
4. Fix delete-all button styling and verify end-to-end
   - Done: Styles apply; Playwright verifies localhost before/after `bun run build && bun run build:backend`.
   - Depends on: 1,2,3
   - Parallel: no
