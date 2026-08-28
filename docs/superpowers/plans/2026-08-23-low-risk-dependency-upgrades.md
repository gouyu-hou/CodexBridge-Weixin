# Low Risk Dependency Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Electron, user-event, and `@openai/codex` independently with complete compatibility verification.

**Architecture:** Each dependency is changed and locked in its own commit. No source refactor is mixed into an upgrade; compatibility fixes must be narrowly demonstrated by failing tests.

**Tech Stack:** npm lockfile, Electron Builder, Vitest, Codex app-server integration tests.

## Global Constraints

- Upgrade only Electron `41.10.5 -> 41.10.6`, `@testing-library/user-event 14.6.4 -> 14.6.6`, and `@openai/codex 0.144.6 -> 0.149.0`.
- Do not upgrade Electron 43, TypeScript 7, Vite 8, or `@openai/agents`.
- Do not change app version, tags, or release metadata.
- Do not mix unrelated manifest or source changes into dependency commits.

---

### Task 1: Upgrade Electron To 41.10.6

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Run `npm install --save-dev electron@41.10.6 --save-exact=false` and verify only Electron-related lock entries change.
- [ ] Run `npm ls electron --depth=0` and require `electron@41.10.6`.
- [ ] Run `npm run verify:release`.
- [ ] Run `npm run weixin:electron:dist` and verify the NSIS artifact exists and is non-empty.
- [ ] If a compatibility failure appears, add a focused failing test before the smallest source fix.
- [ ] Commit as `chore: upgrade Electron to 41.10.6`.

### Task 2: Upgrade user-event To 14.6.6

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Run `npm install --save-dev @testing-library/user-event@14.6.6 --save-exact=false`.
- [ ] Run `npm ls @testing-library/user-event --depth=0` and require `14.6.6`.
- [ ] Run `npm run weixin:admin:test`, `npm run weixin:admin:typecheck`, and `npm run verify:release`.
- [ ] Commit as `chore: upgrade user-event to 14.6.6`.

### Task 3: Upgrade @openai/codex To 0.149.0

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Run `npm install @openai/codex@0.149.0 --save-exact=false`.
- [ ] Run `npm ls @openai/codex --depth=0` and require `0.149.0`.
- [ ] Run root AppClient tests, bridge coordinator tests, Codex provider tests, Native API tests, and all boundary/type checks.
- [ ] Run `npm run verify:release`.
- [ ] If protocol behavior changes, first add a regression test reproducing the incompatibility, then add the narrowest compatibility adapter.
- [ ] Commit as `chore: upgrade Codex CLI to 0.149.0`.

### Task 4: Final Dependency Audit

- [ ] Run `npm audit --omit=dev --audit-level=high` and record results without changing unrelated dependencies.
- [ ] Confirm `npm ls electron @testing-library/user-event @openai/codex --depth=0` reports exactly the approved versions.
- [ ] Confirm `git diff` contains no application version, release tag, Electron major, TypeScript, Vite, or agents upgrade.
- [ ] Request independent dependency-diff review and fix all Critical/Important findings.
