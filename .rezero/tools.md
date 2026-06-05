# Re:ZERO Tools

<!-- rezero-init: v0.1.0 -->

## Detected Stack

- JavaScript/TypeScript browser plugin using Bun (`bun.lock`, `package.json`).
- Go backend helper (`backend.go`) wrapped by Node (`backend.js`).
- Test runner: Bun (`bun test`).
- Type checker: TypeScript 5.9.3 (`tsc --noEmit`).
- Build: Bun browser ESM bundle and Go cross-compile script.

## Installed/Configured

- Echidna: project-native build/type/test/validate gate — `bun run check`.
- Typhon: TypeScript compiler — `bun run typecheck`.
- Minerva: Bun unit tests — `bun test`.
- Daphne: dependency/project hygiene baseline — `bun install --frozen-lockfile` when dependency drift is suspected.
- Carmilla: DOM behavior checks via Happy DOM unit tests — `bun test`.
- Sekhmet: bundle/manifest validation — `bun run build && bun run validate`.
- Satella: local git/secret sanity — `git status --short` and targeted source review.

## Skipped

- SonarQube local service — not configured; current project is small and has a project-native quality gate.
- Playwright/Lighthouse/axe — no full browser app route or deployed preview target in this plugin package.
- k6/Pact/Spectral — no HTTP service contract owned by this package.
- CodeQL/Gitleaks/Trivy/OSV-Scanner — not installed; run local CLIs if release/security audit requires them.

## Local Services

- None required for the current verification gate.

## Required Environment

- Bun, Node, Go, Git.
- Optional Docker is available locally but not required for current checks.
