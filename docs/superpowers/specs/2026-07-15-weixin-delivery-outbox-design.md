# Weixin Delivery Outbox Design

Status: approved for implementation on 2026-07-15

## Goal

Persist failed normal WeChat text deliveries so an undelivered final continuation survives a bridge restart and can be retried later. Preserve the current continuation-aware delivery behavior and never resend a prefix that the platform already reported as delivered.

## Non-Goals

- No media or artifact outbox in this iteration.
- No automation-job delivery changes; automation already owns its retry state.
- No Telegram or cross-platform generic outbox abstraction.
- No exactly-once guarantee because the WeChat send API has no idempotency key or delivery lookup.
- No message-content display in the admin panel.

## Delivery Semantics

The outbox provides at-least-once delivery for queued text continuations.

The runtime persists an entry before a later retry attempt and removes it only after the platform reports success. A crash after remote success but before local removal can therefore cause one duplicate retry after restart. This is preferable to permanently losing the final continuation, and the limitation must be documented in code and tests.

The runtime continues to enqueue only `delivery.failedText` when available. Already delivered prefixes are not stored or resent.

## Storage

Add `WeixinDeliveryOutboxStore` backed by the existing `JsonFileStore` at:

```text
<stateDir>/weixin/delivery-outbox.json
```

The file shape is:

```ts
interface WeixinDeliveryOutboxData {
  version: 1;
  entries: WeixinPendingTextDelivery[];
}

interface WeixinPendingTextDelivery {
  id: string;
  externalScopeId: string;
  content: string;
  source: string;
  createdAt: number;
  nextAttemptAt: number;
  attemptCount: number;
  lastError: string;
  lastErrorCode: number | null;
}
```

The store exposes `read()` and `write(entries)`. Both normalize into fresh objects. The store uses atomic replacement and corrupt-file quarantine through `JsonFileStore`.

## Normalization And Retention

The outbox applies these limits at every read and write boundary:

- maximum 50 entries;
- retain entries for 24 hours from `createdAt`;
- trim IDs to 160 characters;
- trim scope IDs to 200 characters;
- trim sources to 80 characters;
- trim content to 32 KiB of UTF-8 without breaking a surrogate pair;
- trim errors to 500 characters;
- clamp attempt counts to a non-negative integer;
- normalize invalid error codes to `null`;
- reject entries missing ID, scope, content, or valid timestamps;
- deduplicate by `externalScopeId + content + source`, keeping the newer retry state.

When more than 50 valid entries remain, preserve the newest 50 by `createdAt` while retaining their retry order.

## Runtime Integration

`WeixinBridgeRuntimeOptions` gains an optional injected `deliveryOutboxStore` with `read()` and `write(entries)` methods. The CLI constructs the real store from `stateDir` beside `WeixinMetricsStore`.

During runtime construction:

1. Read and normalize persisted entries.
2. Initialize `deliveryRetryQueue` from the normalized result.
3. If reading fails, start with an empty in-memory queue and record a best-effort runtime warning after runtime state is initialized.

Persist a fresh queue snapshot after every mutation:

- new enqueue;
- duplicate-entry metadata update;
- max-size or expiry pruning;
- failed retry attempt and backoff update;
- successful retry removal;
- explicit runtime stop.

Persistence failure never fails a user turn. The queue remains active in memory, the failure is recorded through the existing runtime error path, and later mutations retry persistence.

After `platformPlugin.start()` succeeds, the runtime starts one non-forced outbox flush in the background. Existing poll-success and recovery-command flush triggers remain unchanged. `nextAttemptAt` is respected unless an existing force path requests otherwise.

The existing `deliveryRetryPumpPromise` continues to serialize flushes. Snapshot writes happen in the same JavaScript turn as queue mutations, so no separate mutex is required.

## Admin Visibility

Extend runtime status with a sanitized outbox summary:

```ts
deliveryOutbox: {
  pending: number;
  oldestCreatedAt: number | null;
  nextAttemptAt: number | null;
}
```

The admin runtime-status area may show these three values. It must never include `content`, `lastError`, credentials, or scope IDs.

## Privacy And Security

The outbox contains generated reply text and therefore stays under the existing local `stateDir` trust boundary. Entries are deleted immediately after success and expire after 24 hours. Backup export does not include the outbox because it is transient delivery state, not canonical user data.

HTTP APIs and diagnostics expose only aggregate outbox metadata. Logs continue to use truncated content previews and must not log full entries.

## Error Handling

- Corrupt JSON follows the existing quarantine-and-reinitialize behavior.
- Invalid entries are dropped independently instead of invalidating the whole file.
- A store read failure starts with an empty queue.
- A store write failure keeps the in-memory queue and records a runtime error.
- A platform retry failure updates and persists attempt metadata and backoff.
- A successful retry removes and persists the entry before processing the next one.
- Expired entries are pruned without sending and persisted on the next mutation or startup normalization.

## Testing

### Store Tests

- empty initialization;
- normalized round trip;
- malformed-entry filtering;
- duplicate collapse;
- 24-hour expiry;
- 50-entry cap;
- corrupt JSON quarantine;
- deep-clone behavior.

### Runtime Tests

- failed final text is written to the outbox;
- a new runtime instance restores and successfully flushes it;
- successful retry removes the persisted entry;
- failed retry persists attempt count, error, and next-attempt time;
- duplicate enqueue updates one persisted entry;
- startup flush respects `nextAttemptAt`;
- persistence failure does not fail the turn;
- status exposes only sanitized outbox summary;
- existing recovery-command behavior remains unchanged.

### Wiring And Regression Tests

- CLI/runtime wiring constructs the store under the selected `stateDir`;
- typecheck, build, focused runtime/store tests, and the complete suite pass;
- `git diff --check` remains clean apart from existing line-ending warnings.

## Success Criteria

- A queued final continuation survives process restart.
- Successfully delivered prefixes are never stored or resent.
- Successful retries are removed durably.
- Failed retries retain their backoff state durably.
- Balanced runtime behavior is unchanged when no store is injected.
- Store corruption or failure cannot stop normal WeChat processing.
- Pending-delivery content never appears in admin state or HTTP responses.
