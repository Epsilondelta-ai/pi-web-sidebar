## Re:ZERO Tasks

1. Define the browser runtime and piWeb channel contract.
   - Done: `src/index.ts` is a thin entry, runtime adapters expose documented `globalThis.piWeb` registry access, no `context.app.piWebSidebar` public bridge remains, and runtime/channel unit tests pass.
   - Depends on: none
   - Parallel: no
2. Define sidebar domain types, state, reducer, selectors, and persistence keys.
   - Done: `SidebarState`, `SelectedSession`, session/workspace models, reducer, selectors, and localStorage persistence exist with tests for restore/save of selected session, selected workspace, collapsed state, width, and ordering.
   - Depends on: 1
   - Parallel: no
3. Implement selected answer-target resolution.
   - Done: selector resolves `{ sessionId, workspaceId }` from `session.activeId` or restored state by finding the session inside all loaded workspaces, publishes `null` when not proven, and tests cover missing/stale workspace hints.
   - Depends on: 2
   - Parallel: no
4. Implement all-workspace activity indicator derivation.
   - Done: selectors derive workspace and session live indicators from every registered workspace/session, green appears only for live/running/active status, unread/completed-unread uses a separate non-green state, and tests cover non-selected workspaces.
   - Depends on: 2
   - Parallel: yes; safe with 5 after 2
5. Implement session title normalization and first-message rename reconciliation.
   - Done: title updates reconcile by stable `sessionId`, names longer than 12 characters are stored as first 12 characters plus `...`, selection/order state is preserved, and tests cover `session.changed` plus API-refresh fallback after `chat.input.submitted`.
   - Depends on: 2
   - Parallel: yes; safe with 4 after 2
6. Implement platform HTTP and backend adapters.
   - Done: workspace/session HTTP calls and folder backend calls are isolated under platform modules, adapters return typed normalized data, backend never decides selected session/title authority, and mocked adapter tests pass.
   - Depends on: 2
   - Parallel: yes; safe with 7 after 2
7. Implement channel effects.
   - Done: effects subscribe to `chat.input.submitted`, `session.activeId`, and `session.changed`, publish `plugin.pi-web-sidebar.state`, `plugin.pi-web-sidebar.selectedSession`, and `plugin.pi-web-sidebar.event`, debounce dirty refreshes, and clean all subscriptions on dispose.
   - Depends on: 2, 3, 5
   - Parallel: no
8. Implement sidebar mount lifecycle using stable DOM hooks only.
   - Done: activation mounts one disposable plugin root through documented hooks, deactivation removes DOM/listeners/resources, no `.sidebar-wrap`, `.app-body`, `.workspace-group`, or host private selector dependency remains, and lifecycle tests pass.
   - Depends on: 1, 2
   - Parallel: yes; safe with 6 after 2
9. Implement workspace list UI.
   - Done: workspace rows render from state snapshots, show left live indicators for non-selected workspaces, support open/collapse/reorder/remove/refresh intents through effects, and UI tests use stable plugin DOM only.
   - Depends on: 4, 7, 8
   - Parallel: no
10. Implement session list UI.
   - Done: session rows render from state snapshots, use left-side indicators instead of `waiting` text, separate unread non-green indicators, truncated stored names, select/create/rename/delete/reorder intents, and tests cover selected and non-selected workspace sessions.
   - Depends on: 3, 4, 5, 7, 8
   - Parallel: no
11. Implement folder picker UI and workspace-open flow.
   - Done: picker loading/error/success/cancel state is represented in domain state, backend calls are isolated through the adapter, selected folders open through workspace effects/API, and mocked picker tests pass.
   - Depends on: 6, 7, 8
   - Parallel: yes; safe with 9 only if UI files are isolated
12. Remove legacy host-sidebar replacement behavior.
   - Done: no code detaches/restores built-in sidebar, no host dataset is used as source of truth, old bridge/types/dead code are removed, and grep-based validation confirms forbidden selectors/bridge names are absent.
   - Depends on: 8, 9, 10, 11
   - Parallel: no
13. Rebuild tests around the rewritten architecture.
   - Done: unit tests cover runtime, reducer, selectors, persistence, channel effects, platform adapters, lifecycle cleanup, activity indicators, title normalization, and folder picker behavior without render-only tests or ignored coverage.
   - Depends on: 12
   - Parallel: no
14. Run full verification and fix failures.
   - Done: `bun run build`, `bun run typecheck`, `bun test`, `bun run test:coverage`, `bun run validate`, and `bun run test:backend` all pass with a clean working tree before commit.
   - Depends on: 13
   - Parallel: no
