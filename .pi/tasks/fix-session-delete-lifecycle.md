# Fix session delete lifecycle

## Goals
- delete all sessions event must include full deleted session list.
- delete all sessions must delete actual session files, not UI-only.
- delete all sessions row needs danger styling.
- deleting a session must delete child/subagent/team sessions.
- newly created empty session must not show active green indicator.
- existing sessions not created by this plugin must remain visible after cache validation.

## Verification
- Unit tests for RxJS/event payloads, child deletion, active indicator, cache validation.
- Backend tests for workspace delete and session+children delete.
- `bun run check`
- `bun run build && bun run build:backend`
