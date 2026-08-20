# Portable Windows Launchers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove machine-specific Windows paths from the source login and serve launchers while preserving caller overrides and existing commands.

**Architecture:** Keep the two root batch files as thin entrypoints. Let the existing Codex runtime resolve the executable, and resolve only portable environment defaults in batch before invoking npm.

**Tech Stack:** Windows batch, Node.js built-in test runner, TypeScript tests.

## Global Constraints

- Do not add dependencies or a shared batch helper.
- Do not modify Electron, installed-service, provider, or runtime behavior.
- Preserve caller-provided environment variables.
- Use `%USERPROFILE%\Documents` only when it exists, then fall back to the repository root.

---

### Task 1: Make The Source Launchers Portable

**Files:**
- Create: `test/scripts/portable_windows_launchers.test.ts`
- Modify: `start-weixin-login.cmd`
- Modify: `start-weixin-serve.cmd`

**Interfaces:**
- Consumes: existing runtime Codex command resolution and npm scripts `weixin:login` / `weixin:serve`.
- Produces: portable root launchers that respect `CODEX_APP_SERVER_TRANSPORT`, `CODEXBRIDGE_LOCALE`, and `CODEXBRIDGE_DEFAULT_CWD` overrides.

- [ ] **Step 1: Write the failing launcher contract tests**

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

function readLauncher(name: string) {
  return fs.readFileSync(path.join(repositoryRoot, name), 'utf8');
}

const launchers = [
  ['start-weixin-login.cmd', readLauncher('start-weixin-login.cmd')],
  ['start-weixin-serve.cmd', readLauncher('start-weixin-serve.cmd')],
] as const;

test('Windows launchers do not embed machine-specific paths', () => {
  for (const [name, content] of launchers) {
    assert.doesNotMatch(content, /cully/iu, name);
    assert.doesNotMatch(content, /C:\\Users\\/iu, name);
    assert.doesNotMatch(content, /set\s+"CODEX_REAL_BIN=/iu, name);
  }
});

test('Windows launchers preserve overrides and resolve a portable cwd', () => {
  for (const [name, content] of launchers) {
    assert.match(content, /if not defined CODEX_APP_SERVER_TRANSPORT set "CODEX_APP_SERVER_TRANSPORT=stdio"/iu, name);
    assert.match(content, /if not defined CODEXBRIDGE_LOCALE set "CODEXBRIDGE_LOCALE=zh-CN"/iu, name);
    assert.match(content, /if not defined CODEXBRIDGE_DEFAULT_CWD if defined USERPROFILE if exist "%USERPROFILE%\\Documents\\" set "CODEXBRIDGE_DEFAULT_CWD=%USERPROFILE%\\Documents"/iu, name);
    assert.match(content, /if not defined CODEXBRIDGE_DEFAULT_CWD set "CODEXBRIDGE_DEFAULT_CWD=%CD%"/iu, name);
  }

  assert.match(launchers[0][1], /npm run weixin:login -- --timeout-sec 480/iu);
  assert.match(launchers[1][1], /npm run weixin:serve -- --cwd "%CODEXBRIDGE_DEFAULT_CWD%"/iu);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --import tsx test/scripts/portable_windows_launchers.test.ts
```

Expected: both tests fail because the current files contain `cully`, assign `CODEX_REAL_BIN`, and do not guard defaults.

- [ ] **Step 3: Implement portable defaults in both launchers**

Use this environment prelude after `cd /d "%~dp0"` in both files:

```bat
if not defined CODEX_APP_SERVER_TRANSPORT set "CODEX_APP_SERVER_TRANSPORT=stdio"
if not defined CODEXBRIDGE_LOCALE set "CODEXBRIDGE_LOCALE=zh-CN"
if not defined CODEXBRIDGE_DEFAULT_CWD if defined USERPROFILE if exist "%USERPROFILE%\Documents\" set "CODEXBRIDGE_DEFAULT_CWD=%USERPROFILE%\Documents"
if not defined CODEXBRIDGE_DEFAULT_CWD set "CODEXBRIDGE_DEFAULT_CWD=%CD%"
```

Keep the login command unchanged. Change the serve command to:

```bat
npm run weixin:serve -- --cwd "%CODEXBRIDGE_DEFAULT_CWD%"
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
node --test --import tsx test/scripts/portable_windows_launchers.test.ts
```

Expected: 2 tests pass, 0 fail.

- [ ] **Step 5: Run integration verification**

Run:

```powershell
npm run typecheck:js
npm run verify:release
git diff --check
```

Expected: every command exits `0` with no failed tests or build steps.

- [ ] **Step 6: Commit the implementation**

```powershell
git add start-weixin-login.cmd start-weixin-serve.cmd test/scripts/portable_windows_launchers.test.ts docs/superpowers/plans/2026-08-20-portable-windows-launchers.md
git commit -m "fix: make Windows launchers portable"
```
