## Re:ZERO Tasks

1. Stop sidebar streaming state from re-emitting unchanged selected session state into chat renders.
   - Done: sidebar streaming observer/render path is idempotent when streaming session state is unchanged; selectedSession$ emits only when selected session actually changes; regression test proves repeated chat DOM mutations do not repeatedly emit selected session/render triggers.
   - Depends on: none
   - Parallel: no
