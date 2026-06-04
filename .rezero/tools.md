# Re:ZERO Tools

<!-- rezero-init: v0.1.0 -->

## Detected Stack

- Pi Web browser plugin: `plugin.json` declares frontend entry `index.js`.
- JavaScript ESM package managed by Bun: `package.json`, `bun.lock`.
- DOM unit tests: `index.test.js` uses `bun:test` and `happy-dom`.

## Installed/Configured

- Typhon: manifest/source validation — `bun run validate`.
- Minerva: unit tests — `bun test`.

## Skipped

- Echidna/Sekhmet: SonarQube — unnecessary for this small plugin package; no CI quality gate present.
- Daphne: bundle/dependency hygiene tools — no build bundle and one test-only dependency.
- Carmilla: Playwright/axe screenshots — plugin has no standalone page; host integration required.
- Satella: CodeQL/Gitleaks/Trivy — no CI or container/IaC in this plugin repository.

## Local Services

- None.

## Required Environment

- Bun available locally.
- pi-web host with plugin loader for runtime integration.
