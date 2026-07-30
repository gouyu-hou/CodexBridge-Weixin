# Thread Command Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the thread-command domain, pure routing behavior, and stateful command orchestration out of `BridgeCoordinator` without changing command behavior.

**Architecture:** Establish `src/core/thread_command.ts` with exported domain types and pure route/candidate helpers first. Then add a `ThreadCommandService` that receives a narrow host contract; coordinator methods delegate to it while cross-cutting session/provider capabilities remain coordinator-owned.

**Tech Stack:** TypeScript 6, Node.js 24, Node test runner through `tsx`, existing coordinator/provider/session contracts.

## Global Constraints

- Preserve all `/threads`, `/search`, `/open`, archive, restore, pin, unpin, confirmation, and natural-language behavior.
- Preserve response metadata and translation keys.
- Do not add a runtime dependency.
- Keep coordinator compatibility methods while migrating callers.
- Use failing tests before every production-code behavior or boundary change.
- Keep the complete root test and release gates green.
- Do not bump version, tag, publish, or create a release.

---

### Task 1: Establish the thread-command domain boundary

**Files:**
- Create: `src/core/thread_command.ts`
- Create: `test/core/thread_command.test.ts`
- Modify: `src/core/bridge_coordinator.ts`

**Interfaces:**
- Produces: `ThreadCommandOperationKind`, `ThreadCommandSkillSubcommand`,
  `ThreadCommandInventoryItem`, `PendingThreadCommandOperation`, and
  `ThreadCommandSkillResult`.
- Produces: `resolveThreadCommandRoute(args: readonly unknown[]): ThreadCommandRoute`.
- Produces: `resolveThreadSkillCandidateItems(inventory, candidateThreadIds)`.
- Produces: `skillActionToThreadOperationKind(action)`.

- [x] **Step 1: Write failing pure-boundary tests**

Create table-driven tests asserting that empty, `all`, `pinned`, `confirm`,
`cancel`, aliases `del`/`delete`, archive/restore/pin/unpin, and natural input
produce these route kinds:

```ts
assert.deepEqual(resolveThreadCommandRoute(['delete', 'thread-1']), {
  kind: 'manage',
  operation: 'archive',
  args: ['thread-1'],
});
assert.deepEqual(resolveThreadCommandRoute(['find', 'yesterday']), {
  kind: 'natural',
  args: ['find', 'yesterday'],
});
```

Test candidate resolution with duplicates and unknown IDs:

```ts
assert.deepEqual(
  resolveThreadSkillCandidateItems(inventory, ['thread-2', 'missing', 'thread-2'])
    .map((item) => item.threadId),
  ['thread-2'],
);
```

- [x] **Step 2: Run the tests and verify the missing-module failure**

Run:

```powershell
npm test -- test/core/thread_command.test.ts
```

Expected: FAIL because `src/core/thread_command.ts` does not exist.

- [x] **Step 3: Implement the pure module**

Define the exported route union and deterministic router:

```ts
export type ThreadCommandRoute =
  | { kind: 'home'; includeArchived: boolean; onlyPinned: boolean }
  | { kind: 'confirm' | 'cancel' }
  | { kind: 'manage'; operation: ThreadCommandOperationKind; args: unknown[] }
  | { kind: 'natural'; args: unknown[] };
```

Move the five domain types unchanged from `bridge_coordinator.ts`. Implement
candidate matching with an inventory map and output-ID set so caller order is
preserved and duplicates are removed. Return `null` from
`skillActionToThreadOperationKind` for non-management skill actions.

- [x] **Step 4: Delegate coordinator routing to the pure module**

Import the exported types and functions. Replace the branch chain in
`handleThreadsCommand` with a switch on `resolveThreadCommandRoute(args)`.
Replace the coordinator candidate helper body and operation mapping helper with
the imported functions, then remove local duplicate type declarations.

- [x] **Step 5: Run focused tests and type checking**

Run:

```powershell
npm test -- test/core/thread_command.test.ts test/core/bridge_coordinator.test.ts
npm run typecheck
```

Expected: all commands exit `0`.

- [x] **Step 6: Review and commit the boundary**

Run `git diff --check`, confirm no response text changed, and commit:

```powershell
git add src/core/thread_command.ts src/core/bridge_coordinator.ts test/core/thread_command.test.ts
git commit -m "refactor: extract thread command domain"
```

### Task 2: Extract thread inventory and target resolution

**Files:**
- Modify: `src/core/thread_command.ts`
- Modify: `src/core/bridge_coordinator.ts`
- Modify: `test/core/thread_command.test.ts`
- Test: `test/core/bridge_coordinator.test.ts`

**Interfaces:**
- Consumes: Task 1 domain types.
- Produces: `ThreadInventoryHost` with thread-list, current-session, alias, and
  pin-state lookup callbacks.
- Produces: `listThreadInventoryForCommand(host, options)` and
  `resolveSingleThreadSkillTarget(inventory, candidateThreadIds)`.

- [x] **Step 1: Add failing inventory normalization tests**

Use a real in-memory host fixture and assert archived, pinned, aliased, current,
and duplicate records normalize to `ThreadCommandInventoryItem`. Preserve the
existing single-target behavior: return the first valid requested candidate,
and return `null` only when no valid candidate exists.

- [x] **Step 2: Verify the tests fail for missing exports**

Run `npm test -- test/core/thread_command.test.ts` and expect missing-export
failures.

- [x] **Step 3: Implement inventory helpers behind `ThreadInventoryHost`**

The host contract exposes callbacks rather than coordinator state:

```ts
export interface ThreadInventoryHost {
  listThreads(options: { includeArchived: boolean }): Promise<ThreadCommandInventoryItem[]>;
}
```

Keep filtering, ordering, deduplication, and result limits in the module. Keep
provider access and session repository implementation in the coordinator host
adapter.

- [x] **Step 4: Replace coordinator helper bodies with delegation**

Construct the host from existing coordinator methods and preserve method names
as wrappers. Remove only code now covered by the extracted helpers.

- [x] **Step 5: Run focused tests, typecheck, and commit**

Run the Task 1 focused commands plus `git diff --check`; commit with
`refactor: extract thread inventory resolution`.

### Task 3: Extract thread command orchestration

**Files:**
- Modify: `src/core/thread_command.ts`
- Modify: `src/core/bridge_coordinator.ts`
- Modify: `test/core/thread_command.test.ts`
- Test: `test/core/bridge_coordinator.test.ts`

**Interfaces:**
- Produces: `ThreadCommandHost`, containing only callbacks required by thread
  command operations.
- Produces: `ThreadCommandService` methods `handleThreads`, `handleSearch`,
  `handleConfirm`, `handleCancel`, `handleArchive`, `handleRestore`, `handlePin`,
  `handleUnpin`, and `renderPage`.
- Consumes: existing provider profile, scope, response, and translator types.

- [x] **Step 1: Add failing service delegation tests**

Create a recording `ThreadCommandHost`; assert `handleThreads(['all'])` calls
the home renderer with `{ includeArchived: true, onlyPinned: false }`, and a
management route calls explicit or natural management based on the host's
`areExplicitTargets` result.

- [x] **Step 2: Verify missing-service failures**

Run `npm test -- test/core/thread_command.test.ts` and expect
`ThreadCommandService` to be missing.

- [x] **Step 3: Implement the narrow host and route orchestration**

Use method-shaped callbacks with concrete parameter and promise return types.
The service may call host capabilities but must not import or cast to
`BridgeCoordinator`.

- [ ] **Step 4: Move stateful thread methods in behavior-preserving groups**

Progress: route delegation and the shared archive/restore/pin/unpin executor
are complete. Search/natural normalization and page rendering still remain in
the coordinator.

Move confirmation/cancellation first, then archive/restore/pin/unpin, then
search/natural normalization and page rendering. After each group, retain a
coordinator compatibility method that calls the service and run the relevant
coordinator test name pattern.

- [ ] **Step 5: Remove migrated coordinator implementation bodies**

Keep only host-adapter methods that are genuinely cross-cutting. Ensure
`bridge_coordinator.ts` no longer declares thread operation state types or
implements command-family branching.

- [ ] **Step 6: Run focused and root verification**

Run:

```powershell
npm test -- test/core/thread_command.test.ts test/core/bridge_coordinator.test.ts
npm run typecheck
npm run typecheck:js
npm test
```

Expected: every command exits `0`.

- [ ] **Step 7: Review and commit orchestration extraction**

Run `git diff --check`, compare coordinator line count, and commit with
`refactor: extract thread command orchestration`.

### Task 4: Verify compatibility and close the phase

**Files:**
- Modify only if verification exposes a regression.

**Interfaces:**
- Consumes: extracted thread command module and coordinator adapter.
- Produces: a release-gate-clean refactoring stage ready for the AppClient plan.

- [ ] **Step 1: Run the complete release gate**

Run `npm run verify:release` and expect exit `0`.

- [ ] **Step 2: Run Windows packaging smoke verification**

Run:

```powershell
npm run weixin:electron:dist
node scripts/release/smoke_packaged.mjs
```

Expected: the installer build exits `0`, admin page and state endpoints return
HTTP `200`, and both service endpoints stop cleanly.

- [ ] **Step 3: Push and wait for CI**

Push `main` to `gouyu`, identify the workflow run for the pushed commit, and
wait until Ubuntu and Windows jobs both pass. Do not tag or publish.
