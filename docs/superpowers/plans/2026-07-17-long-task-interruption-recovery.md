# Long-Task Interruption Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist active Weixin conversation turns and safely reconcile provider state and final delivery after a service restart.

**Architecture:** Add a versioned checkpoint repository and make `ActiveTurnRegistry` durably mirror recovery-relevant mutations. A focused `ActiveTurnRecoveryService` restores scope locks, reconciles provider-authoritative thread state, and hands completed output to `WeixinBridgeRuntime`, which reuses the existing persistent delivery outbox.

**Tech Stack:** TypeScript 6, Node.js 24, synchronous atomic JSON repositories, Node test runner through `tsx`, existing CodexBridge provider and Weixin runtime contracts.

## Global Constraints

- Never automatically replay a user request after restart.
- Never restore or submit an approval decision from before restart.
- Weixin final delivery remains explicitly at-least-once.
- Do not add a dependency or a new environment variable.
- Do not expose prompt text, output text, credentials, or scope IDs in metrics, alerts, logs, or diagnostic exports.
- Reconciliation runs in the background and must not prevent the Weixin service from starting.
- The active reconciliation window is 24 hours; terminal diagnostic retention is a further 24 hours.
- Temporary provider retry delay is exponential and capped at 30 seconds.
- Preserve compatibility for runtimes that supply no checkpoint repository.
- Do not commit, tag, push, publish, or modify release state in the current dirty workspace unless the user explicitly requests it later.

---

### Task 1: Define and persist active-turn checkpoints

**Files:**
- Modify: `src/types/core.ts`
- Modify: `src/types/repository.ts`
- Create: `src/store/in_memory/in_memory_active_turn_checkpoint_repository.ts`
- Create: `src/store/file_json/file_json_active_turn_checkpoint_repository.ts`
- Modify: `src/store/file_json/create_file_json_repositories.ts`
- Test: `test/store/file_json_repositories.test.ts`

**Interfaces:**
- Produces: `ActiveTurnCheckpoint`, `ActiveTurnRecoveryPhase`, and `ActiveTurnCheckpointRepository`.
- Produces: repository methods `getByScope`, `list`, `save`, and guarded `deleteByScope`.
- Consumes: `JsonFileStore` and `PlatformScopeRef`.

- [ ] **Step 1: Add failing repository tests**

Add tests that save two scopes, reload the file repository, reject malformed
records independently, guard deletion by checkpoint ID, and quarantine corrupt
JSON. The core assertion shape is:

```ts
const repositoriesA = createFileJsonRepositories(stateDir);
repositoriesA.activeTurnCheckpoints.save(makeActiveTurnCheckpoint({
  id: 'checkpoint-a',
  externalScopeId: 'wx-a',
}));

const repositoriesB = createFileJsonRepositories(stateDir);
assert.equal(
  repositoriesB.activeTurnCheckpoints.getByScope('weixin', 'wx-a')?.id,
  'checkpoint-a',
);
assert.equal(
  repositoriesB.activeTurnCheckpoints.deleteByScope('weixin', 'wx-a', 'stale-id'),
  false,
);
assert.equal(
  repositoriesB.activeTurnCheckpoints.deleteByScope('weixin', 'wx-a', 'checkpoint-a'),
  true,
);
```

- [ ] **Step 2: Run the repository tests and verify failure**

Run:

```powershell
npm test -- test/store/file_json_repositories.test.ts
```

Expected: FAIL because `activeTurnCheckpoints` and its repository types do not
exist.

- [ ] **Step 3: Add the domain and repository contracts**

Add these exact domain fields to `src/types/core.ts`:

```ts
export type ActiveTurnRecoveryPhase =
  | 'starting'
  | 'running'
  | 'reconciling'
  | 'approval_expired'
  | 'completed_pending_delivery'
  | 'interrupted'
  | 'uncertain';

export interface ActiveTurnCheckpoint {
  version: 1;
  id: string;
  platform: string;
  externalScopeId: string;
  bridgeSessionId: string | null;
  providerProfileId: string | null;
  threadId: string | null;
  turnId: string | null;
  requestFingerprint: string;
  requestSummary: string;
  phase: ActiveTurnRecoveryPhase;
  previousPhase: ActiveTurnRecoveryPhase | null;
  approvalPending: boolean;
  finalDeliveryKey: string | null;
  outboxEntryId: string | null;
  reconciliationAttemptCount: number;
  lastErrorCategory: string | null;
  createdAt: number;
  updatedAt: number;
  lastReconciledAt: number | null;
  expiresAt: number;
}
```

Add this repository contract to `src/types/repository.ts`:

```ts
export interface ActiveTurnCheckpointRepository {
  getByScope(platform: string, externalScopeId: string): ActiveTurnCheckpoint | null;
  list(): ActiveTurnCheckpoint[];
  save(checkpoint: ActiveTurnCheckpoint): ActiveTurnCheckpoint;
  deleteByScope(platform: string, externalScopeId: string, expectedId?: string | null): boolean;
}
```

- [ ] **Step 4: Implement in-memory and file repositories**

The in-memory repository clones all values on write and read. The file
repository stores this envelope in `active_turn_checkpoints.json`:

```ts
interface ActiveTurnCheckpointFile {
  version: 1;
  records: unknown[];
}
```

Normalize every record separately. Require non-empty IDs and scope fields,
finite positive timestamps, known phases, bounded strings, and `version === 1`.
Keep the newest record when duplicate scope keys exist. `deleteByScope` must
return `false` when `expectedId` does not match the current record.

Wire both `createFileJsonRepositories()` and the runtime repository object to
expose `activeTurnCheckpoints`.

- [ ] **Step 5: Run repository tests and typecheck**

Run:

```powershell
npm test -- test/store/file_json_repositories.test.ts
npm run typecheck
```

Expected: both commands exit `0`.

- [ ] **Step 6: Review the task diff**

Run:

```powershell
git diff --check -- src/types/core.ts src/types/repository.ts src/store test/store/file_json_repositories.test.ts
```

Expected: exit `0`; do not create a commit.

### Task 2: Make the active-turn registry durable

**Files:**
- Modify: `src/core/active_turn_registry.ts`
- Test: `test/core/active_turn_registry.test.ts`

**Interfaces:**
- Consumes: `ActiveTurnCheckpointRepository` from Task 1.
- Produces: exported `ActiveTurnRecord` and methods `restoreCheckpoints`,
  `markCompletedPendingDelivery`, `linkOutboxDelivery`, and
  `completeDurableTurn`.
- Produces: `beginScopeTurn(scopeRef, initial, recovery)` with optional request
  fingerprint and summary.

- [ ] **Step 1: Add failing durability-order tests**

Create a recording repository and assert:

```ts
assert.throws(
  () => registry.beginScopeTurn(scopeRef, {}, {
    requestFingerprint: 'sha256:test',
    requestSummary: 'test request',
  }),
  /checkpoint write failed/u,
);
assert.equal(registry.resolveScopeTurn(scopeRef), null);
```

Also test checkpoint restoration, pending-approval restoration as expired,
guarded completion, and compatibility when no repository is passed.

- [ ] **Step 2: Run the registry test and verify failure**

Run:

```powershell
npm test -- test/core/active_turn_registry.test.ts
```

Expected: FAIL because the durable constructor and lifecycle methods do not
exist.

- [ ] **Step 3: Implement durable mutation ordering**

Extend the constructor:

```ts
interface ActiveTurnRegistryOptions {
  now?: () => number;
  locale?: string | null;
  checkpoints?: ActiveTurnCheckpointRepository | null;
  createId?: () => string;
}
```

For `beginScopeTurn`, construct the record and checkpoint, call
`checkpoints.save(checkpoint)`, then add the record to `scopeTurns`. For updates,
write the next checkpoint before mutating the map. Export record snapshots as
deep clones so callers cannot bypass persistence.

`restoreCheckpoints()` must:

- prune expired terminal records;
- restore non-expired `starting`, `running`, `reconciling`, and
  `completed_pending_delivery` records as scope locks;
- convert every `approvalPending` record to `approval_expired` and clear local
  pending approvals;
- return restored checkpoints and expired-approval checkpoints separately.

- [ ] **Step 4: Add durable completion methods**

Implement these semantics:

```ts
markCompletedPendingDelivery(scopeRef, finalDeliveryKey): ActiveTurnRecord | null
linkOutboxDelivery(scopeRef, expectedCheckpointId, outboxEntryId): boolean
completeDurableTurn(scopeRef, expectedCheckpointId): boolean
```

`completeDurableTurn` first performs guarded repository deletion and only then
removes the matching local record.

- [ ] **Step 5: Run registry and coordinator regression tests**

Run:

```powershell
npm test -- test/core/active_turn_registry.test.ts test/core/bridge_coordinator.test.ts
```

Expected: both files pass and existing in-memory behavior remains compatible.

- [ ] **Step 6: Review the task diff**

Run `git diff --check -- src/core/active_turn_registry.ts test/core/active_turn_registry.test.ts`.
Expected: exit `0`; do not create a commit.

### Task 3: Add provider-authoritative reconciliation

**Files:**
- Create: `src/core/active_turn_recovery_service.ts`
- Test: `test/core/active_turn_recovery_service.test.ts`
- Modify: `src/i18n/index.ts`

**Interfaces:**
- Consumes: active-turn checkpoints, registry, provider profiles, provider
  registry, and bridge sessions.
- Produces: `ActiveTurnRecoveryService.restoreLocks()` and
  `ActiveTurnRecoveryService.reconcileAll()`.
- Produces: callback events `completed`, `notice`, and `outboxLinked` without
  directly depending on the Weixin runtime.

- [ ] **Step 1: Add failing state-mapping tests**

Use a fake provider with `readThread({ includeTurns: true })` and cover:

```ts
const outcome = await recovery.reconcileCheckpoint(checkpoint);
assert.equal(outcome.kind, 'completed');
assert.equal(outcome.turnId, 'turn-1');
assert.equal(outcome.outputText, 'recovered final answer');
```

Add tests for a known running turn, interrupted turn, unique non-terminal
rebind, ambiguous no-ID checkpoint, missing profile, unsupported `readThread`,
expired approval, transient provider failure, and repeated reconciliation.

- [ ] **Step 2: Run recovery tests and verify failure**

Run:

```powershell
npm test -- test/core/active_turn_recovery_service.test.ts
```

Expected: FAIL because the recovery service is absent.

- [ ] **Step 3: Implement the focused recovery service**

Use explicit outcomes:

```ts
export type ActiveTurnRecoveryOutcome =
  | { kind: 'running'; checkpoint: ActiveTurnCheckpoint }
  | { kind: 'completed'; checkpoint: ActiveTurnCheckpoint; outputText: string; turnId: string }
  | { kind: 'notice'; checkpoint: ActiveTurnCheckpoint; noticeKind: 'approval_expired' | 'interrupted' | 'uncertain' }
  | { kind: 'retry'; checkpoint: ActiveTurnCheckpoint; delayMs: number };
```

Reconciliation rules must exactly match the approved design. Extract final
assistant text through one exported helper that walks the terminal turn items
and prefers the final answer. Never call `startTurn`, `resumeThread`, approval
submission, or interruption APIs from this service.

Implement retry delay as:

```ts
export function recoveryRetryDelayMs(attemptCount: number): number {
  return Math.min(30_000, 1_000 * (2 ** Math.min(5, Math.max(0, attemptCount))));
}
```

- [ ] **Step 4: Add bounded user-visible i18n messages**

Add Chinese and English keys for approval expiry, interrupted recovery,
uncertain recovery, and recovered completion. Messages must not include IDs,
prompt text, output previews, or provider errors.

- [ ] **Step 5: Run recovery tests and typecheck**

Run:

```powershell
npm test -- test/core/active_turn_recovery_service.test.ts
npm run typecheck
```

Expected: exit `0`.

- [ ] **Step 6: Review the task diff**

Run `git diff --check -- src/core/active_turn_recovery_service.ts src/i18n/index.ts test/core/active_turn_recovery_service.test.ts`.
Expected: exit `0`; do not create a commit.

### Task 4: Persist live coordinator lifecycle state

**Files:**
- Modify: `src/core/bridge_coordinator.ts`
- Test: `test/core/bridge_coordinator.test.ts`

**Interfaces:**
- Consumes: durable `ActiveTurnRegistry` methods from Task 2.
- Produces: coordinator response metadata
  `meta.activeTurnDelivery = { checkpointId, deliveryKey }` for locally completed
  turns.
- Preserves: existing `meta.codexTurn` and session metadata.

- [ ] **Step 1: Add failing live-lifecycle tests**

Test that an initial checkpoint exists before the fake provider sees
`startTurn`, that thread/turn IDs are persisted, and that a completed response
contains a stable delivery handoff:

```ts
assert.deepEqual(response.meta?.activeTurnDelivery, {
  checkpointId: checkpointIdSeenBeforeStart,
  deliveryKey: `openai-default:${threadId}:${turnId}:final`,
});
```

Also assert a checkpoint write failure prevents `startTurn`, and interrupted
results remain terminal without any automatic retry call.

- [ ] **Step 2: Run focused coordinator tests and verify failure**

Run:

```powershell
npm test -- test/core/bridge_coordinator.test.ts
```

Expected: new assertions FAIL because live turns do not create delivery
handoff metadata.

- [ ] **Step 3: Persist request identity and provider identity**

Before `beginScopeTurn`, derive a SHA-256 request fingerprint from platform,
scope, normalized text, attachment metadata, and current time-independent
session identity. Store a bounded 160-character summary only.

After session resolution, persist bridge session, profile, and thread. Whenever
`result.turnId` becomes available, persist it as `running` before building the
response.

- [ ] **Step 4: Replace early checkpoint deletion with delivery handoff**

When `isTurnResultLocallyFinished(result)` is true and the result is complete,
call `markCompletedPendingDelivery`, add `meta.activeTurnDelivery`, and retain
the checkpoint. For interrupted or failed terminal results, persist
`interrupted`, release the local lock, and retain the terminal checkpoint for
diagnostics.

Continue using `releaseActiveTurnIfStillRunning` for non-durable configurations
and for genuinely non-terminal provider turns.

- [ ] **Step 5: Run coordinator and runtime regressions**

Run:

```powershell
npm test -- test/core/bridge_coordinator.test.ts test/runtime/weixin_bridge_runtime.test.ts
```

Expected: exit `0`.

- [ ] **Step 6: Review the task diff**

Run `git diff --check -- src/core/bridge_coordinator.ts test/core/bridge_coordinator.test.ts`.
Expected: exit `0`; do not create a commit.

### Task 5: Connect recovery completion to the persistent Weixin outbox

**Files:**
- Modify: `src/runtime/weixin_delivery_outbox_store.ts`
- Modify: `src/runtime/weixin_bridge_runtime.ts`
- Test: `test/runtime/weixin_delivery_outbox_store.test.ts`
- Test: `test/runtime/weixin_bridge_runtime.test.ts`

**Interfaces:**
- Consumes: `meta.activeTurnDelivery` and recovery callbacks.
- Produces: `enqueueTextDeliveryRetry(..., { id })` support for a stable caller
  supplied outbox ID.
- Produces: runtime callback `deliverRecoveredTurn(outcome)`.

- [ ] **Step 1: Add failing stable-ID and handoff tests**

Assert the outbox deduplicates by stable `id` first, while retaining legacy
content/source deduplication. Add runtime tests for successful final delivery,
failed final delivery linked to the outbox, and another restart before outbox
success.

- [ ] **Step 2: Run focused runtime tests and verify failure**

Run:

```powershell
npm test -- test/runtime/weixin_delivery_outbox_store.test.ts test/runtime/weixin_bridge_runtime.test.ts
```

Expected: new stable-ID and durable completion assertions FAIL.

- [ ] **Step 3: Add stable outbox enqueue identity**

Extend enqueue parameters with `id?: string | null`. Normalize it through the
existing ID bound and generate a random ID only when absent. File-store
normalization deduplicates a non-empty matching ID before applying the legacy
scope/content/source fallback.

- [ ] **Step 4: Complete or link checkpoints after live delivery**

After `ensureFinalDelivered`, inspect `response.meta.activeTurnDelivery`:

- successful complete delivery calls `completeDurableTurn` with the expected
  checkpoint ID;
- failed delivery enqueues the failed continuation with the stable delivery key
  as ID, then calls `linkOutboxDelivery`;
- stale checkpoint IDs perform no deletion.

Do the same for recovered completion through `deliverRecoveredTurn`. Recovery
notices use a stable source and are sent once per terminal checkpoint phase.

- [ ] **Step 5: Remove linked checkpoints after outbox success**

When an outbox entry succeeds, notify the recovery service/registry by entry ID.
Delete only a checkpoint whose stored `outboxEntryId` matches that entry. Keep
the existing documented at-least-once crash window.

- [ ] **Step 6: Run runtime tests and checked JavaScript validation**

Run:

```powershell
npm test -- test/runtime/weixin_delivery_outbox_store.test.ts test/runtime/weixin_bridge_runtime.test.ts
npm run typecheck
npm run typecheck:js
```

Expected: all commands exit `0`.

- [ ] **Step 7: Review the task diff**

Run `git diff --check -- src/runtime test/runtime`.
Expected: exit `0`; do not create a commit.

### Task 6: Wire startup recovery and aggregate observability

**Files:**
- Modify: `src/runtime/bootstrap.ts`
- Modify: `src/cli.ts`
- Modify: `src/runtime/weixin_bridge_runtime.ts`
- Modify: `src/platforms/weixin/admin_server.ts`
- Modify: `src/platforms/weixin/admin_page.ts`
- Test: `test/store/file_json_repositories.test.ts`
- Test: `test/runtime/weixin_bridge_runtime.test.ts`
- Test: `test/platforms/weixin/admin_server.test.ts`
- Test: `test/platforms/weixin/admin_page.test.ts`

**Interfaces:**
- Produces: `runtime.services.activeTurnRecovery`.
- Produces: aggregate `turnRecovery` status with counts, oldest age,
  `lastReconciledAt`, and bounded `lastErrorCategory`.
- Consumes: `ActiveTurnCheckpointRepository` and runtime recovery delivery
  callbacks.

- [ ] **Step 1: Add failing restart and status tests**

Build runtime A with a file repository, persist a running checkpoint, then build
runtime B from the same directory. Assert the scope is locked before inbound
work and reconciliation starts after platform startup. Assert admin JSON and
HTML contain aggregate state only:

```ts
assert.deepEqual(status.turnRecovery, {
  total: 1,
  running: 1,
  reconciling: 0,
  uncertain: 0,
  oldestAgeMs: 5000,
  lastReconciledAt: null,
  lastErrorCategory: null,
});
assert.equal(JSON.stringify(status).includes('wx-secret-scope'), false);
```

- [ ] **Step 2: Run restart and admin tests and verify failure**

Run:

```powershell
npm test -- test/store/file_json_repositories.test.ts test/runtime/weixin_bridge_runtime.test.ts test/platforms/weixin/admin_server.test.ts test/platforms/weixin/admin_page.test.ts
```

Expected: new recovery service and status assertions FAIL.

- [ ] **Step 3: Wire repositories and services in bootstrap**

Add `activeTurnCheckpoints` to supplied/default repositories. Construct
`ActiveTurnRegistry` with that repository, construct
`ActiveTurnRecoveryService`, call `restoreLocks()` synchronously, and expose the
service under `runtime.services`.

- [ ] **Step 4: Start reconciliation in the correct order**

In `WeixinBridgeRuntime.start()` use this sequence:

```ts
await this.platformPlugin.start();
this.startActiveTurnRecovery();
this.startAutomationScheduler();
this.startInternalThreadCleanupScheduler();
```

`startActiveTurnRecovery()` tracks a background single-flight task and starts
bounded retry timers. `stop()` and `restart()` cancel timers without deleting
checkpoints.

- [ ] **Step 5: Add aggregate admin status**

Expose only phase counts, oldest age, and bounded timestamps/category strings.
Add a compact row to the existing runtime/diagnostics page. Do not add a new
navigation item, record table, checkpoint action, or identifier display.

- [ ] **Step 6: Run restart, admin, and full root tests**

Run:

```powershell
npm test -- test/store/file_json_repositories.test.ts test/core/active_turn_registry.test.ts test/core/active_turn_recovery_service.test.ts test/core/bridge_coordinator.test.ts test/runtime/weixin_bridge_runtime.test.ts test/platforms/weixin/admin_server.test.ts test/platforms/weixin/admin_page.test.ts
npm run typecheck
```

Expected: exit `0`.

- [ ] **Step 7: Review the task diff**

Run `git diff --check -- src/runtime/bootstrap.ts src/cli.ts src/runtime/weixin_bridge_runtime.ts src/platforms/weixin test`.
Expected: exit `0`; do not create a commit.

### Task 7: Validate end-to-end restart safety and release readiness

**Files:**
- Modify: `docs/architecture/weixin-delivery-best-practice.md`
- Modify: `docs/todo/roadmap.md`
- Test: all files added or modified by Tasks 1-6

**Interfaces:**
- Documents: recovery guarantees, at-least-once residual window, expiry policy,
  and manual recovery behavior.
- Produces: no new runtime interface.

- [ ] **Step 1: Add an end-to-end double-restart test**

The test must exercise:

1. runtime A writes a running checkpoint;
2. runtime B restores the scope and observes provider completion;
3. Weixin delivery fails and creates one stable outbox entry;
4. runtime C restores the same linked checkpoint and outbox;
5. outbox delivery succeeds;
6. the checkpoint and outbox are both empty;
7. provider `startTurn` was never called by recovery.

- [ ] **Step 2: Run the end-to-end test and verify it passes**

Run:

```powershell
npm test -- test/runtime/weixin_bridge_runtime.test.ts
```

Expected: exit `0`, one final remote send attempt per runtime recovery cycle,
and zero provider replay calls.

- [ ] **Step 3: Update architecture and roadmap documentation**

Document these exact guarantees:

- durable scope lock restoration;
- provider-authoritative reconciliation;
- no automatic replay;
- approval expiry on restart;
- stable local delivery deduplication;
- explicit at-least-once remote delivery limitation;
- 24-hour active and terminal retention windows.

Mark the corresponding P0 interrupted-turn recovery item complete without
changing paused package workstreams.

- [ ] **Step 4: Run targeted and complete verification**

Run:

```powershell
npm test -- test/store/file_json_repositories.test.ts test/core/active_turn_registry.test.ts test/core/active_turn_recovery_service.test.ts test/core/bridge_coordinator.test.ts test/runtime/weixin_delivery_outbox_store.test.ts test/runtime/weixin_bridge_runtime.test.ts test/platforms/weixin/admin_server.test.ts test/platforms/weixin/admin_page.test.ts
npm run typecheck
npm run typecheck:js
npm run verify:release
```

Expected: every command exits `0`.

- [ ] **Step 5: Build and smoke-test the packaged Windows application**

Run:

```powershell
npm run weixin:electron:dist
node scripts/release/smoke_packaged.mjs
```

Expected: distribution build exits `0`; smoke output reports HTTP `200` for
the page and state endpoints and confirms both service endpoints stop.

- [ ] **Step 6: Final safety audit**

Run:

```powershell
git diff --check
git status --short
```

Confirm no credential, state file, release artifact, private key, recovery
state, or user content was added. Do not commit, tag, push, or publish.
