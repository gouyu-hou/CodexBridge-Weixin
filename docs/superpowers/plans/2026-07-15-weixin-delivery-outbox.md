# Weixin Delivery Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist failed WeChat final-text continuations so they survive process restarts and are retried without resending an already delivered prefix.

**Architecture:** Add a focused `WeixinDeliveryOutboxStore` over `JsonFileStore`, inject its small read/write interface into `WeixinBridgeRuntime`, and persist every queue mutation synchronously with best-effort error reporting. The runtime restores normalized entries at construction, starts a non-forced background flush after platform startup, and exposes only aggregate outbox metadata through status and diagnostics.

**Tech Stack:** TypeScript, Node.js `node:test`, synchronous filesystem persistence through the existing `JsonFileStore`.

## Global Constraints

- Store data at `<stateDir>/weixin/delivery-outbox.json` with schema version `1`.
- Provide at-least-once semantics; a crash after remote success and before local removal may cause one duplicate retry.
- Persist only the undelivered `failedText` continuation and never a delivered prefix.
- Retain at most 50 entries for at most 24 hours from `createdAt`.
- Cap content at 32 KiB UTF-8 without splitting surrogate pairs.
- Trim IDs to 160 characters, scope IDs to 200, sources to 80, and errors to 500.
- Reject entries missing ID, scope, content, or valid positive timestamps.
- Store failures must keep the in-memory queue active and must not fail user turns.
- Admin and diagnostics may expose only pending count, oldest creation time, and next retry time.
- Do not add media, automation, Telegram, generic-outbox, or backup-export behavior.
- Do not create commits because this workspace contains user-owned uncommitted changes and the user did not request commits.

---

### Task 1: File-backed delivery outbox store

**Files:**
- Create: `src/runtime/weixin_delivery_outbox_store.ts`
- Create: `test/runtime/weixin_delivery_outbox_store.test.ts`

**Interfaces:**
- Consumes: `new JsonFileStore<T>(filePath, emptyValue)`, `JsonFileStore.read()`, and `JsonFileStore.write(value)`.
- Produces: exported `WeixinPendingTextDelivery`, `WeixinDeliveryOutboxData`, and `WeixinDeliveryOutboxStore` with `constructor(stateDir: string)`, `read(): WeixinPendingTextDelivery[]`, and `write(entries: WeixinPendingTextDelivery[]): void`.

- [ ] **Step 1: Write failing store tests**

Cover empty initialization, normalized round trip, malformed entry filtering, duplicate collapse, expiry, newest-50 cap with retry-order preservation, corrupt JSON quarantine, deep cloning, and surrogate-safe 32 KiB truncation. Use timestamps relative to a captured `Date.now()` and inspect `weixin/delivery-outbox.json` directly where file behavior matters.

```ts
const store = new WeixinDeliveryOutboxStore(stateDir);
assert.deepEqual(store.read(), []);
store.write([makeEntry({ content: `${'a'.repeat(32767)}😀tail` })]);
const [entry] = store.read();
assert.ok(Buffer.byteLength(entry.content, 'utf8') <= 32 * 1024);
assert.equal(entry.content.endsWith('\uD83D'), false);
```

- [ ] **Step 2: Run the store tests and verify RED**

Run: `npm test -- test/runtime/weixin_delivery_outbox_store.test.ts`

Expected: FAIL because `src/runtime/weixin_delivery_outbox_store.ts` does not exist.

- [ ] **Step 3: Implement normalization and persistence**

Implement constants for all approved limits, clone every accepted entry, deduplicate by `externalScopeId + content + source`, keep the entry with the newer retry state, keep the newest 50 by `createdAt`, then restore their original retry order. `read()` normalizes `data.entries`; `write()` normalizes a fresh snapshot and writes `{ version: 1, entries }`.

```ts
export class WeixinDeliveryOutboxStore {
  private readonly store: JsonFileStore<WeixinDeliveryOutboxData>;

  constructor(stateDir: string) {
    this.store = new JsonFileStore(
      path.join(stateDir, 'weixin', 'delivery-outbox.json'),
      { version: 1, entries: [] },
    );
  }

  read(): WeixinPendingTextDelivery[] {
    return normalizeEntries(this.store.read()?.entries, Date.now());
  }

  write(entries: WeixinPendingTextDelivery[]): void {
    this.store.write({ version: 1, entries: normalizeEntries(entries, Date.now()) });
  }
}
```

- [ ] **Step 4: Run the store tests and verify GREEN**

Run: `npm test -- test/runtime/weixin_delivery_outbox_store.test.ts`

Expected: all outbox-store tests PASS.

- [ ] **Step 5: Refactor only while green**

Keep UTF-8 truncation and numeric normalization in private helpers, rerun the same command, and confirm no behavior changes.

### Task 2: Runtime restoration and durable mutation handling

**Files:**
- Modify: `src/runtime/weixin_bridge_runtime.ts`
- Modify: `test/runtime/weixin_bridge_runtime.test.ts`

**Interfaces:**
- Consumes: an optional injected store shaped as `{ read(): WeixinPendingTextDelivery[]; write(entries: WeixinPendingTextDelivery[]): void }`.
- Produces: `getStatus().deliveryOutbox` shaped as `{ pending: number; oldestCreatedAt: number | null; nextAttemptAt: number | null }` while preserving `pendingDeliveryRetries` for compatibility.

- [ ] **Step 1: Extend the runtime harness and write failing persistence tests**

Allow `makeRuntime()` to receive `deliveryOutboxStore`, `onError`, startup controls, and an empty poll stream. Add tests proving enqueue writes only failed continuation text, a second runtime restores and flushes it, success durably removes it, failure durably updates attempt/backoff/error, duplicates persist as one entry, startup respects a future `nextAttemptAt`, store failure does not fail a turn, and status contains no entry content/error/scope.

```ts
const persisted: WeixinPendingTextDelivery[][] = [];
const store = {
  read: () => persisted.at(-1) ?? [],
  write: (entries: WeixinPendingTextDelivery[]) => persisted.push(structuredClone(entries)),
};
const runtime = makeRuntime({ deliveryOutboxStore: store, /* failing send */ });
await runtime.runOnce();
assert.equal(persisted.at(-1)?.length, 1);
assert.equal(persisted.at(-1)?.[0]?.content, 'undelivered continuation');
```

- [ ] **Step 2: Run focused runtime tests and verify RED**

Run: `npm test -- test/runtime/weixin_bridge_runtime.test.ts`

Expected: new tests FAIL because the injected store is ignored and `deliveryOutbox` is absent.

- [ ] **Step 3: Restore the queue and report read failures safely**

Add a store field and constructor option, initialize `deliveryRetryQueue` from `read()`, and defer read-error reporting until metrics/runtime state is initialized. The error path calls `recordRuntimeError(error, 'runtime')` and best-effort `onError(error)` without throwing from construction.

```ts
let deliveryOutboxReadError: unknown = null;
try {
  this.deliveryRetryQueue = deliveryOutboxStore?.read?.() ?? [];
} catch (error) {
  this.deliveryRetryQueue = [];
  deliveryOutboxReadError = error;
}
```

- [ ] **Step 4: Persist every queue mutation**

Add a `persistDeliveryRetryQueue()` helper that snapshots entries, catches writes, records the runtime error, and invokes `onError` best-effort. Call it after new enqueue, duplicate update, queue cap/expiry pruning, retry failure metadata update, success removal, startup normalization, and stop.

```ts
persistDeliveryRetryQueue(): void {
  if (!this.deliveryOutboxStore) return;
  try {
    this.deliveryOutboxStore.write(this.deliveryRetryQueue.map((entry) => ({ ...entry })));
  } catch (error) {
    this.reportDeliveryOutboxError(error);
  }
}
```

- [ ] **Step 5: Start a non-forced background flush and expose aggregate status**

After `platformPlugin.start()` succeeds, call `flushDeliveryRetryQueue()` without `force`; keep `deliveryRetryPumpPromise` as the serializer. Add a helper that calculates pending count, minimum `createdAt`, and minimum `nextAttemptAt`; do not expose queue entries.

```ts
deliveryOutbox: {
  pending: this.deliveryRetryQueue.length,
  oldestCreatedAt: minOrNull(this.deliveryRetryQueue.map((entry) => entry.createdAt)),
  nextAttemptAt: minOrNull(this.deliveryRetryQueue.map((entry) => entry.nextAttemptAt)),
},
```

- [ ] **Step 6: Run runtime tests and verify GREEN**

Run: `npm test -- test/runtime/weixin_bridge_runtime.test.ts`

Expected: all runtime tests PASS, including the existing recovery-command test.

### Task 3: CLI wiring and sanitized admin visibility

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/platforms/weixin/admin_server.ts`
- Modify: `test/platforms/weixin/admin_server.test.ts`
- Modify: `test/store/file_json_repositories.test.ts`

**Interfaces:**
- Consumes: `new WeixinDeliveryOutboxStore(stateDir)` and runtime `deliveryOutbox` status.
- Produces: CLI injection through `deliveryOutboxStore`, and diagnostic serialization of only `pending`, `oldestCreatedAt`, and `nextAttemptAt`.

- [ ] **Step 1: Write failing wiring and privacy tests**

Add an integration-level file-location test for `WeixinDeliveryOutboxStore`, plus admin state/diagnostic tests asserting aggregate values survive serialization while unique message text, scope IDs, and error strings are absent from JSON responses.

```ts
assert.deepEqual(payload.service.bridge.deliveryOutbox, {
  pending: 1,
  oldestCreatedAt: 1000,
  nextAttemptAt: 2000,
});
assert.doesNotMatch(JSON.stringify(payload), /private queued message|wx-secret|send failed/);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- test/platforms/weixin/admin_server.test.ts test/store/file_json_repositories.test.ts`

Expected: new assertions FAIL because the status type/serializer and real CLI store wiring are absent.

- [ ] **Step 3: Wire the real store and sanitize admin diagnostics**

Construct `WeixinDeliveryOutboxStore` beside `WeixinMetricsStore` in `runWeixinServe()` and inject it into `WeixinBridgeRuntime`. Extend `WeixinBridgeControl.status()` and `serializeDiagnosticBridgeStatus()` with the three numeric aggregate fields only. Reuse pending count in the existing UI and show oldest/next timestamps only in a tooltip or compact status text; do not add content fields.

```ts
const weixinDeliveryOutboxStore = new WeixinDeliveryOutboxStore(stateDir);
// ...
deliveryOutboxStore: weixinDeliveryOutboxStore,
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- test/platforms/weixin/admin_server.test.ts test/store/file_json_repositories.test.ts test/runtime/weixin_bridge_runtime.test.ts test/runtime/weixin_delivery_outbox_store.test.ts`

Expected: all focused tests PASS.

### Task 4: Review and regression verification

**Files:**
- Review all files changed by Tasks 1-3 and preserve unrelated dirty-worktree changes.

**Interfaces:**
- Consumes: complete outbox implementation and tests.
- Produces: review findings resolved and fresh verification evidence.

- [ ] **Step 1: Review against the approved design**

Check every persistence mutation, startup/stop behavior, continuation-only semantics, at-least-once caveat, privacy boundary, retention, size limits, and compatibility field. Request an independent code review and address all accepted Critical/Important findings with a failing regression test first.

- [ ] **Step 2: Run type and build verification**

Run: `npm run typecheck`

Expected: exit code 0.

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 3: Run the complete test suite**

Run: `npm test`

Expected: exit code 0 with no failed tests.

- [ ] **Step 4: Check patch hygiene**

Run: `git diff --check`

Expected: no new whitespace errors; existing CRLF warnings may remain.

Run: `git status --short`

Expected: only intended new outbox files plus the user's pre-existing modified/untracked files.

## Self-Review

- Spec coverage: storage, normalization, retention, runtime restoration, every queue mutation, startup/stop, sanitized status, CLI wiring, corruption, and regressions are each assigned to a task.
- Placeholder scan: no `TBD`, `TODO`, deferred implementation, or unspecified error-handling steps remain.
- Type consistency: the shared entry fields and injected `read()`/`write()` signatures match between the store, runtime, CLI, and tests.
