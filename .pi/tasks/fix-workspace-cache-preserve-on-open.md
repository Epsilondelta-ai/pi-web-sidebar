# Fix workspace cache preserve on open

## Re:ZERO Tasks

1. Add regression coverage for refresh → add workspace preserving existing cached workspaces.
   - Done: Tests cover cached sessionful workspace + new empty direct workspace, same-ID empty direct workspace, empty cached workspace preservation, and stale cache replacement when direct sessions arrive.
   - Depends on: none
   - Parallel: no
2. Fix workspace hydration merge semantics.
   - Done: Any direct snapshot with no sessions merges with cache instead of replacing it; cached sessions survive same-ID empty direct snapshots; direct snapshots with sessions still replace stale cache.
   - Depends on: 1
   - Parallel: no
3. Verify persistence path end-to-end.
   - Done: `bun run check`, `bun test`, `bun run test:coverage` pass; generated `index.js` reflects source fix.
   - Depends on: 2
   - Parallel: no
