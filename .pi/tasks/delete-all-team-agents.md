# Delete all sessions includes team agents

## Re:ZERO Tasks

1. Extend backend session deletion to include team-agent session files for the workspace and ignore stale missing team sessions.
   - Done: Backend deletes project sessions plus matching team worker session files/config members; missing team session files are not rendered; tests cover both.
   - Depends on: none
   - Parallel: no

2. Verify frontend/backend behavior and commit accepted route after Seven Witches.
   - Done: Unit/backend checks pass; generated bundle is current; commit includes required co-author trailer.
   - Depends on: 1
   - Parallel: no
