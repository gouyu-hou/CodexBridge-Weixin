# Web Runtime Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Next.js from tracing the complete repository by moving its reachable runtime utilities into an app-scoped workspace and removing repository-root discovery from the Next server graph.

**Architecture:** Add `@codexbridge/web-runtime` under the Web pnpm workspace for state paths, JSON cache access, and permission read-model projection. Child worker entrypoints derive the repository root themselves, so Next routes no longer pass or resolve it; Next tracing can then use `apps/web` as its root without `experimental.externalDir`.

**Tech Stack:** Next.js 16, pnpm 11, TypeScript 6, Node.js 24.

## Global Constraints

- Preserve existing state-directory environment compatibility.
- Preserve `lib/server/runtime` and `lib/server/queries` import compatibility.
- Do not bundle provider runtime code into Next routes.
- Worker payloads may still accept legacy `repoRoot`, but callers stop sending it.
- The production build must emit no whole-project NFT warning.
- Do not hide the warning with an ignore comment.
- Do not bump version, tag, publish, or create a release.

---

### Task 1: Add the Web runtime workspace

**Files:**
- Create: `apps/web/pnpm-workspace.yaml`
- Create: `apps/web/packages/runtime/package.json`
- Create: `apps/web/packages/runtime/src/index.ts`
- Create: `apps/web/packages/runtime/src/permissions.ts`
- Create: `apps/web/packages/runtime/src/state.ts`
- Modify: `apps/web/package.json`
- Modify: `apps/web/pnpm-lock.yaml`

**Interfaces:**
- Produces: `getWebPaths`, `readRuntimeJson`, `clearRuntimeJsonCache`,
  `buildPermissionsSettingsUpdate`, `resolvePermissionsState`, and local
  permission types.

- [ ] **Step 1: Add failing workspace tests**

Add a focused test that imports the package source, verifies state path
resolution never exposes a repository root, and checks default/full/custom
permission projections.

- [ ] **Step 2: Verify the missing-package failure**

Run the focused test and expect module-not-found.

- [ ] **Step 3: Implement the package and workspace dependency**

Use dependency-free TypeScript, explicit exports, and `workspace:*`. Regenerate
the Web lockfile with frozen supply-chain policy checks enabled.

- [ ] **Step 4: Re-export the runtime compatibility module**

Replace `apps/web/lib/server/runtime.ts` with a pure re-export. Point
`queries.ts` permission imports at the package and remove root type imports.

### Task 2: Remove repo-root discovery from the Next graph

**Files:**
- Create: `apps/web/server/worker-runtime.ts`
- Modify: worker entrypoints under `apps/web/server`
- Modify: API routes that launch workers
- Modify: `apps/web/server/reply-run-manager.ts`
- Modify: `apps/web/next.config.mjs`

**Interfaces:**
- Produces: `resolveWorkerRepoRoot(explicitRoot?: unknown): string`.
- Consumes: state-only `getWebPaths()`.

- [ ] **Step 1: Add a failing worker-root test**

Assert a legacy explicit root is normalized and an absent root resolves to the
repository containing the worker source.

- [ ] **Step 2: Implement worker-local root resolution**

Keep legacy input optional, remove it from required payload validation, and
stop Next routes and the reply manager from sending it.

- [ ] **Step 3: Narrow Next configuration**

Remove `experimental.externalDir`, set `outputFileTracingRoot` to `__dirname`,
and transpile `@codexbridge/web-runtime`.

- [ ] **Step 4: Verify tests, types, lockfile, and build output**

Run focused Web worker tests, strict and normal typechecks, workspace install
with frozen lockfile, and `npm run web:build`. The build must exit `0` and must
not contain `whole project was traced unintentionally`.

- [ ] **Step 5: Commit**

Run `git diff --check` and commit with
`refactor: isolate Web runtime workspace`.

