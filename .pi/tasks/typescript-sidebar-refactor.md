# TypeScript sidebar refactor

- Convert source and tests from JS to TS.
- Split `src/index.js` into focused modules; keep touched source files <=300 lines.
- Preserve plugin output entry `index.js` for manifest compatibility.
- Add typecheck to verification.
- Verify with diff check and full project checks.
- Commit with required co-author trailer.
