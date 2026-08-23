# Strict Type Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strict TypeScript checks for the extracted command and Weixin admin backend service boundaries while keeping root strict mode disabled.

**Architecture:** Two dedicated no-emit tsconfig files opt selected modules into `strict: true`. Explicit npm scripts run them before the existing root typecheck in the release gate.

**Tech Stack:** TypeScript, npm scripts, existing NodeNext build.

## Global Constraints

- Keep root `tsconfig.json` and `packages/codex-native-api/tsconfig.json` at `strict: false`.
- Do not add broad `any`, `@ts-ignore`, or behavior-changing strictness refactors.
- Use `unknown` and narrowing for external input.
- Include both checks in `verify:release`.

---

### Task 1: Add Command-Service Strict Configuration

**Files:**
- Create: `tsconfig.command-services-strict.json`
- Modify: `package.json`
- Modify: command-service files only when strict errors require typing corrections.

- [ ] Add a script assertion test or package metadata assertion that expects `typecheck:command-services:strict` and its release-gate placement; run it and capture RED.
- [ ] Create a no-emit config extending root options with `allowJs: false`, `strict: true`, `noEmit: true`, and explicit command-service includes.
- [ ] Add `typecheck:command-services:strict=tsc -p tsconfig.command-services-strict.json`.
- [ ] Fix selected-boundary errors with precise nullable/unknown types.
- [ ] Run the new command, focused command tests, and root typecheck.
- [ ] Commit as `chore: enable strict command service checks`.

### Task 2: Add Weixin Admin Backend Strict Configuration

**Files:**
- Create: `tsconfig.weixin-admin-services-strict.json`
- Modify: `package.json`
- Modify: `src/platforms/weixin/admin_route.ts`
- Modify: `src/platforms/weixin/admin_backup_service.ts`
- Modify: `src/platforms/weixin/admin_diagnostics_service.ts`
- Modify: `src/platforms/weixin/admin_log_maintenance_service.ts`

- [ ] Add the failing package metadata assertion for `typecheck:weixin-admin-services:strict`.
- [ ] Create the strict no-emit config with explicit admin route, backup, diagnostics, and log-maintenance includes.
- [ ] Add `typecheck:weixin-admin-services:strict=tsc -p tsconfig.weixin-admin-services-strict.json`.
- [ ] Replace unsafe external JSON assumptions with `unknown` plus local type guards.
- [ ] Run the new command and focused admin tests.
- [ ] Commit as `chore: enable strict weixin admin service checks`.

### Task 3: Wire Strict Checks Into Release Verification

**Files:**
- Modify: `package.json`
- Test: existing package script metadata test or a new focused `test/package_scripts.test.ts`.

- [ ] Assert strict commands occur after admin browser typecheck and before root typecheck in `verify:release`; capture RED.
- [ ] Update `verify:release` with both commands in the asserted order.
- [ ] Run both strict checks, root checks, package script test, and `git diff --check`.
- [ ] Commit as `ci: enforce strict extracted service boundaries`.

### Task 4: Strict Boundary Review Gate

- [ ] Search the phase diff for new `any`, `@ts-ignore`, `@ts-expect-error`, and non-null assertions; justify or remove every addition.
- [ ] Run `npm run typecheck:command-services:strict`, `npm run typecheck:weixin-admin-services:strict`, `npm run typecheck`, and `npm run typecheck:js`.
- [ ] Request independent review and fix all Critical/Important findings.
