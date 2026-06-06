# pi-web-sidebar plugin rewrite plan

Re:ZERO execution task list: `.rezero/sidebar-plugin-rewrite-tasks.md`.

## Context

Source document: <https://raw.githubusercontent.com/Epsilondelta-ai/pi-web/refs/heads/main/docs/plugins/README.md>

Verification note: this raw `refs/heads/main` URL and the earlier raw `main` URL resolved to the same content hash
`64c42138e4cb7b86fe892571de74ed02cebaff3d90b53bfcccba3d382057d5e3` at review time.

The pi-web plugin contract defines plugins as trusted local code loaded by a small core. Core owns lifecycle,
`piWeb` shared RxJS Subject registry, standard channel names/payload contracts, and stable DOM hook names. Plugins own
user-facing features, plugin state, and plugin persistence.

## Current problem

`pi-web-sidebar` currently behaves like a host sidebar replacement rather than a standard pi-web feature plugin.

Observed issues:

- It depends on host private DOM/class structure such as `.app-body`, `.sidebar-wrap`, `.workspace-group`, and
  `.session-row`.
- Earlier versions temporarily detached a built-in sidebar, but current pi-web no longer ships one in `.app-body`.
- Older implementations exposed `context.app.piWebSidebar` as a custom bridge instead of using the shared
  `globalThis.piWeb` Subject registry.
- Older implementations relied on `context.rxjs` constructors instead of pi-web's registry methods.
- It treats host DOM dataset fields as state inputs instead of keeping a plugin-owned state model.
- Workspace/session behavior is spread across DOM handlers, API calls, and render code without a clear runtime/domain/UI
  split.

## New definition

`pi-web-sidebar` is a workspace/session navigation feature plugin.

It owns:

- Sidebar UI and styles.
- Workspace/session list rendering.
- Sidebar collapse, width, open workspace, and ordering preferences.
- Workspace open, refresh, remove, and reorder actions.
- Session select, create, rename, delete, and reorder actions.
- Folder picker UI and backend bridge.
- Plugin-owned persistence.
- Sidebar state/event publication over pi-web channels.

It does not own:

- pi-web core plugin lifecycle.
- Core settings or language storage.
- Chat transcript/composer/session storage internals.
- Host routing implementation.
- Host private DOM structure.
- Feature APIs outside the documented channel/API contract.

## Operating model

### Activation

The plugin entry stays small:

```ts
export default function activate(): () => void {
  return activateSidebarPlugin(createBrowserRuntime());
}
```

Activation must:

1. Verify `globalThis.piWeb` exists and supports the shared Subject registry.
2. Locate only documented stable DOM hooks, such as `[data-main]` or future sidebar extension hooks.
3. Mount one plugin root, for example `<aside data-plugin="pi-web-sidebar">`.
4. Subscribe to standard state/event channels.
5. Load workspace/session state through platform adapters.
6. Render from a state snapshot.
7. Return a disposer that removes DOM, subscriptions, pending listeners, and in-flight resources.

Activation must treat `.app-body` as an empty mount host. It must not detach or restore a host sidebar.

### State

The plugin keeps one state source of truth:

```ts
type SidebarState = {
  workspaces: SidebarWorkspace[];
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  openWorkspaceId: string | null;
  collapsed: boolean;
  width: number;
  loading: boolean;
  error: string | null;
};
```

Persistence is plugin-owned localStorage only:

- `plugin.pi-web-sidebar.activeSessionId`
- `plugin.pi-web-sidebar.activeWorkspaceId`
- `plugin.pi-web-sidebar.collapsed`
- `plugin.pi-web-sidebar.width`
- `plugin.pi-web-sidebar.workspaceOrder`
- `plugin.pi-web-sidebar.sessionOrder`

Selected session behavior is explicit:

1. On activation, read `plugin.pi-web-sidebar.activeSessionId` and
   `plugin.pi-web-sidebar.activeWorkspaceId` from localStorage.
2. Seed `SidebarState.activeSessionId` and `SidebarState.activeWorkspaceId` with those values until fresher
   `session.activeId` or workspace/session API state arrives.
3. When a user selects a session, update `SidebarState.activeSessionId`, persist it to localStorage, and publish the
   updated snapshot through `plugin.pi-web-sidebar.state`.
4. Also emit `session.selected` on `plugin.pi-web-sidebar.event` so other plugins can react without scraping DOM.
5. If the session owner channel later publishes `session.activeId`, reconcile local state and localStorage to that value.

There are two different concepts and the rewrite must keep them separate:

- `selected` — the one session/workspace pair that answer generation targets.
- `live` — any registered session that is currently active/running, even inside a workspace the user is not viewing.
- `unread` — completed/unread notification state. It is not live and must not use the green indicator.

Selected target resolution for answer generation is deterministic and never reads host DOM:

1. Authoritative selected session = latest `session.activeId` channel value when present.
2. If `session.activeId` is absent, use `SidebarState.activeSessionId` restored from localStorage.
3. Authoritative selected workspace = the workspace in `SidebarState.workspaces` whose `sessions[]` contains the selected
   session ID.
4. If the session is not found in loaded workspaces, use `SidebarState.activeWorkspaceId` only as a temporary navigation
   hint, not as proof that the session belongs there.
5. If no selected session is known, answer generation has no valid target and must request/select a session instead of
   guessing.
6. Publish the resolved pair through `plugin.pi-web-sidebar.selectedSession`; publish `null` when the pair cannot be
   proven.

Activity indicator resolution is different:

1. The plugin must load status for all registered workspaces and their sessions, not only the currently viewed workspace.
2. Backend/API may report per-session activity fields such as `live`, `active`, `status`, `unread`, and
   `unreadCompleted` for every registered session.
3. The sidebar reducer stores those fields on each `SidebarSession`.
4. A workspace indicator is green only when any session in that workspace is live/running/active.
5. A session indicator is green only when that specific session is live/running/active.
6. Session rows must not render textual status labels such as `waiting` for this state.
7. Session rows use the same left-side indicator pattern as workspace rows, with color/shape carrying the state.
8. Unread/completed-unread sessions must use a separate non-green indicator.
9. These indicators do not change the selected answer target. They are display state only.

### Channels

Use the documented naming rules.

Subscribe to standard channels when present:

- `core.language`
- `core.settings.changed`
- `chat.input.submitted`
- `session.activeId`
- `session.changed`

Publish plugin channels:

- `plugin.pi-web-sidebar.state` — `BehaviorSubject<SidebarState>`; includes the latest selected session in
  `activeSessionId`.
- `plugin.pi-web-sidebar.selectedSession` — `BehaviorSubject<SelectedSession | null>`; convenience stream for consumers
  that only need selection changes.
- `plugin.pi-web-sidebar.event` — `Subject<SidebarEvent>`
- `plugin.pi-web-sidebar.command` — `Subject<SidebarCommand>` if command fan-out is needed

```ts
type SelectedSession = {
  sessionId: string;
  workspaceId: string;
};
```

Event examples:

```ts
type SidebarEvent =
  | { type: "workspace.selected"; workspaceId: string }
  | { type: "workspace.openRequested"; path: string }
  | { type: "workspace.removed"; workspaceId: string }
  | { type: "session.selected"; sessionId: string; workspaceId: string }
  | { type: "session.createRequested"; workspaceId: string }
  | { type: "session.deleteRequested"; sessionId: string }
  | { type: "sidebar.collapsedChanged"; collapsed: boolean }
  | { type: "sidebar.widthChanged"; width: number };
```

If another plugin owns a feature channel, `pi-web-sidebar` publishes intent and observes resulting state. It does not
mutate another plugin's state directly.

First-message session naming is event-driven:

1. A newly created session may start with a placeholder title.
2. When the first chat message causes the session owner to generate the real title, the owner must emit
   `session.changed` with the same `sessionId` and the updated title/name.
3. `pi-web-sidebar` listens for `session.changed`, finds that `sessionId` across all registered workspaces, normalizes
   the updated title/name, updates only that session row in `SidebarState.workspaces`, and republishes
   `plugin.pi-web-sidebar.state`.
4. Session title normalization is mandatory before storing or publishing: if the visible/persisted session name is longer
   than 12 characters, store the first 12 characters plus `...` as the session name.
5. The normalized truncated name is the stored sidebar name, not only a render-time cosmetic abbreviation.
6. The core plugin document defines `chat.input.submitted` as the documented chat event. It means a user submitted
   input; it does not mean the response completed or the session title has already been generated.
7. If `session.changed` is unavailable, the sidebar treats `chat.input.submitted` only as a dirty signal, schedules a
   debounced workspace/session API refresh, and reconciles titles by stable `sessionId` from API metadata.
8. Any response-complete/session-write signal is optional plugin-defined behavior unless pi-web documents a standard
   channel for it. The rewrite must not depend on that signal as a core contract.
9. The backend may read session metadata returned by the workspace/session API, but it must not invent the title or
   rename from JSONL contents. The session owner/API is the title authority before sidebar normalization.

### API/backend boundaries

All host and backend access must be behind adapters:

- Workspace/session HTTP API calls live in `platform/http.ts`.
- Folder browser backend calls live in `platform/backend.ts`.
- `piWeb` registry access lives in `runtime/piweb.ts`.
- DOM rendering lives only in `ui/*`.
- State transitions live only in `domain/*`.

## Target structure

```txt
src/
  index.ts
  plugin.ts
  runtime/
    piweb.ts
    channels.ts
    lifecycle.ts
  domain/
    state.ts
    reducer.ts
    selectors.ts
    effects.ts
    persistence.ts
  platform/
    http.ts
    backend.ts
  ui/
    sidebar.ts
    workspace-list.ts
    session-list.ts
    picker.ts
    styles.ts
  types.ts
```

## Rewrite phases

### Phase 1 — Contract first

- Define `PluginRuntime` and channel contracts.
- Add `piWeb.subject`, `piWeb.behaviorSubject`, and cleanup adapters.
- Replace the planned public bridge with `plugin.pi-web-sidebar.*` channels.
- Remove `context.app.piWebSidebar`, `context.rxjs`, and legacy action-event compatibility paths.

Done when runtime/channel behavior is testable without DOM.

### Phase 2 — Domain state

- Implement `SidebarState`, reducer, selectors, and persistence.
- Persist selected session/workspace IDs on selection changes.
- Restore selected session/workspace IDs from localStorage during activation.
- Express all sidebar operations as actions/effects.
- Derive workspace/session activity indicators from all registered workspace/session statuses.
- Keep API results and UI events out of direct DOM mutation paths.

Done when workspace/session behavior is unit-tested without DOM.

### Phase 3 — UI renderer

- Render only from `SidebarState`.
- Mount into the empty `.app-body` host used by current pi-web.
- Remove built-in sidebar detach/restore behavior.
- Make deactivation fully clean up plugin DOM and listeners.

Done when activate/render/deactivate leaves no plugin DOM or subscriptions behind.

### Phase 4 — Channels

- Publish `plugin.pi-web-sidebar.state` snapshots.
- Publish `plugin.pi-web-sidebar.selectedSession` whenever selected session changes.
- Publish `plugin.pi-web-sidebar.event` for user and effect outcomes.
- Subscribe to `chat.input.submitted`, `session.activeId`, and `session.changed`.
- Reconcile `session.activeId` into state, selected-session stream, and localStorage.
- Reconcile first-message title changes from `session.changed`, with debounced API refresh fallback after
  `chat.input.submitted` when the session change channel is absent.
- Remove the custom `app.piWebSidebar` bridge and legacy action-event aliases.

Done when another plugin can observe sidebar state only through `globalThis.piWeb`.

### Phase 5 — Folder picker/backend

- Keep the backend wrapper, but isolate it behind `platform/backend.ts`.
- Represent picker loading/error/success/cancel in plugin state.
- Open selected folders through the workspace API/effect layer.

Done when picker success/failure is deterministic and observable through state/events.

### Phase 6 — Verification

Run and keep green:

```sh
bun run build
bun run typecheck
bun test
bun run test:coverage
bun run validate
bun run test:backend
```

Coverage expectations:

- Lifecycle cleanup.
- Channel publish/subscribe.
- Reducer/selectors/effects.
- API adapters with mocked fetch.
- Backend picker with mocked backend calls.
- Activity indicators for non-selected workspaces and sessions.
- First-message session title rename updates the matching sidebar row by stable `sessionId`.
- Session names longer than 12 characters are stored as the first 12 characters plus `...`.
- Session `waiting` text is replaced by the left-side indicator pattern.
- Unread indicators are not green and are tested separately from live/active indicators.
- No private host DOM selectors.

## Success criteria

- No dependency on a host-provided `.sidebar-wrap`, `.workspace-group`, or other private host sidebar selectors.
- `.app-body` is treated as an empty mount host.
- No built-in sidebar detach/restore side effects.
- Public integration happens through `globalThis.piWeb` shared Subject registry.
- Plugin state is deterministic and plugin-owned.
- Selected session is sent through RxJS and persisted to localStorage.
- UI is disposable and mount-hook based.
- Workspace/session operations remain feature-complete.
- First-message generated session names appear in the sidebar without losing selection/order state.
- Stored sidebar session names are truncated to 12 characters plus `...` when longer than 12 characters.
- Non-selected workspaces still show live/active session indicators.
- Session status uses a left-side indicator instead of `waiting` text.
- Unread sessions never use the green live/active indicator.
- Full check suite passes before implementation is considered complete.
