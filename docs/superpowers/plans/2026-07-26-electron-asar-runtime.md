# Electron ASAR Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable ASAR while giving the spawned Node service explicit, ordinary-filesystem runtime and dependency roots.

**Architecture:** A pure layout helper resolves Electron app, built-in runtime, and dependency roots. The preparation script stages service sources and filtered production dependencies together for `extraResources/runtime-app`, and the runner receives the dependency root explicitly.

**Tech Stack:** Electron 41, electron-builder 24, Node.js 24, TypeScript 6.

## Global Constraints

- Keep version `0.1.7`.
- Do not tag, publish, or create a release.
- Preserve lightweight update verification and rollback.
- Do not require external Node to read `app.asar`.

---

### Task 1: Define and test the runtime layout

**Files:**
- Create: `scripts/electron/runtime-layout.cjs`
- Create: `test/scripts/electron_asar_runtime.test.ts`

**Interfaces:**
- Produces: `resolveElectronRuntimeLayout({ appRoot, isPackaged, resourcesPath })`
  and runtime staging filters.

- [x] **Step 1: Write failing tests**

Assert development mode returns the repository for all roots, while packaged
mode returns `runtime-app` for both service sources and dependencies. Also
assert the package build config enables ASAR and copies the staged runtime to
`runtime-app`.

- [x] **Step 2: Verify the tests fail**

Run `node scripts/test.mjs test/scripts/electron_asar_runtime.test.ts` and expect
the missing layout module or `asar: false` assertion to fail.

- [x] **Step 3: Implement the pure layout helper**

Normalize every returned path with `path.resolve`. In packaged mode return:

```js
{
  appRoot,
  builtInRuntimeRoot: path.join(resourcesPath, 'runtime-app'),
  dependencyRoot: path.join(resourcesPath, 'runtime-app'),
}
```

In development, use `appRoot` for all three roots.

### Task 2: Route the service through explicit roots

**Files:**
- Modify: `scripts/electron/weixin-admin-main.cjs`
- Modify: `scripts/service/run-weixin-service.mjs`
- Test: `test/scripts/electron_asar_runtime.test.ts`

**Interfaces:**
- Consumes: the layout helper from Task 1.
- Produces: `--dependency-root-dir` service-runner argument.

- [x] **Step 1: Add failing source-contract tests**

Assert the main process passes `--dependency-root-dir`, the runner resolves
`tsx` from that root, and Electron UI assets remain rooted at `appRoot`.

- [x] **Step 2: Verify the new assertions fail**

Run the focused test and confirm failure is caused by the absent explicit root.

- [x] **Step 3: Implement root propagation**

Use `builtInRuntimeRoot` for built-in service source and env files,
`dependencyRoot/node_modules` for `NODE_PATH`, Codex discovery, linking, and
verification, and `appRoot` for preload, icons, and shipped trust assets.
Pass `--base-root-dir builtInRuntimeRoot` and
`--dependency-root-dir dependencyRoot` to the service runner.

- [x] **Step 4: Verify focused Electron and update tests**

Run the ASAR test plus Electron args, lightweight update, release verification,
and release automation tests. Expect zero failures.

### Task 3: Enable ASAR and prove the packaged boundary

**Files:**
- Modify: `package.json`
- Modify: `scripts/release/smoke_packaged.mjs`
- Test: `test/scripts/electron_asar_runtime.test.ts`

**Interfaces:**
- Produces: packaged `resources/runtime-app` containing service sources and
  filtered production dependencies.

- [x] **Step 1: Configure Electron Builder**

Set `asar: true`, keep Electron files in `files`, stage the runtime through
`prepare-windows-runtime.cjs`, and copy `build/runtime/app` to `runtime-app`.

- [x] **Step 2: Extend packaged smoke preflight**

Before launch, verify `app.asar`, the service runner, `src/cli.ts`, and unpacked
`tsx` exist. Emit a specific missing-boundary error if any file is absent.
The smoke launcher also strips `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS` so
Node-mode shells (agent sandboxes, VS Code tasks) cannot force the packaged
Electron binary to parse argv as Node CLI flags.

- [ ] **Step 3: Run complete verification**

Run `npm run verify:release`, `npm run weixin:electron:dist`,
`node scripts/release/smoke_packaged.mjs`, `npm audit --omit=dev`, and
`git diff --check`. All commands must exit zero.

- [ ] **Step 4: Commit and push**

Commit with `build: enable Electron ASAR runtime boundary`, push `main` to
`gouyu`, then wait for Ubuntu and Windows CI to finish successfully.
