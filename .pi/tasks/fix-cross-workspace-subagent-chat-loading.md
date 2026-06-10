## Re:ZERO Tasks

1. Fix cross-workspace and subagent session loading from sidebar selections without reintroducing chat rerender loops.
   - Done: selecting a session in another workspace immediately requests chat state using that session's workspace path/id; selecting a child/subagent session preserves the child session id instead of falling back to the parent; regression tests cover both paths and full checks pass.
   - Depends on: none
   - Parallel: no
