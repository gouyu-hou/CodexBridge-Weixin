# Web Server Strict Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an incremental `strict: true` TypeScript gate for isolated Web server modules without enabling strict mode for the complete Next.js application.

**Architecture:** A dedicated `tsconfig.server-strict.json` extends the Web config and lists only approved server modules. Shared reply message types move to a type-only module so strict checking does not pull the complete query implementation into the initial boundary.

**Tech Stack:** TypeScript 6, Next.js 16, Node.js 24, existing Web and root verification scripts.

## Global Constraints

- Keep `apps/web/tsconfig.json` at `strict: false` during this phase.
- The strict config must use an explicit file list.
- Existing imports from `lib/server/queries` remain compatible through a type re-export.
- Do not add `any`, `@ts-ignore`, or `@ts-nocheck` to make the gate pass.
- Add the strict gate to `web:verify` and therefore `verify:release`.
- Do not bump version, tag, publish, or create a release.

---

### Task 1: Establish the strict server project

**Files:**
- Create: `apps/web/tsconfig.server-strict.json`
- Create: `apps/web/lib/server/thread-message.ts`
- Modify: `apps/web/lib/server/queries.ts`
- Modify: `apps/web/server/reply-run-manager.ts`
- Modify: `apps/web/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `WebCodexThreadMessage` from `lib/server/thread-message.ts`.
- Produces: `web:typecheck:server-strict` root script.
- Consumes: existing `ReplyRunManager` and `runTsxJsonWorker` implementations.

- [ ] **Step 1: Verify the strict gate is absent**

Run `npm run web:typecheck:server-strict` and expect npm to fail with a missing
script error.

- [ ] **Step 2: Extract the message type with a compatibility re-export**

Move `WebCodexThreadMessage` unchanged into `thread-message.ts`. Import it for
local use in `queries.ts`, re-export it from `queries.ts`, and update
`reply-run-manager.ts` to import directly from the type-only module.

- [ ] **Step 3: Add the strict config and scripts**

The strict config extends `tsconfig.json`, disables incremental state, enables
`strict`, and explicitly lists `server/tsx-json-worker.ts`,
`server/reply-run-manager.ts`, and `lib/server/thread-message.ts`. Add a Web
package script using `tsc -p tsconfig.server-strict.json --noEmit`, then add a
root forwarding script and invoke it from `web:verify`.

- [ ] **Step 4: Fix real strict errors within the approved boundary**

Use explicit event and payload types. Do not weaken compiler options or add
suppressions. If an imported implementation expands the project, replace only
its type dependency with a focused local contract while retaining the runtime
import.

- [ ] **Step 5: Run strict, normal Web, and focused behavior checks**

Run:

```powershell
npm run web:typecheck:server-strict
npm run web:typecheck
npm test -- test/apps/web_reply_run_manager.test.ts test/apps/web_tsx_json_worker.test.ts
```

Expected: every command exits `0`.

- [ ] **Step 6: Review and commit**

Run `git diff --check` and commit with
`build: add strict Web server type gate`.

