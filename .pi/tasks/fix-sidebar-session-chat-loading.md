## Re:ZERO Tasks

1. Restore reliable chat loading from sidebar session clicks without reviving the `.term-inner` rerender loop.
   - Done: selecting a session always emits an explicit selection signal even when it is already active; unchanged render-state emissions stay deduped; subagent/child session selection is preserved; regression tests cover same-session reload and child-session click behavior.
   - Depends on: none
   - Parallel: no
