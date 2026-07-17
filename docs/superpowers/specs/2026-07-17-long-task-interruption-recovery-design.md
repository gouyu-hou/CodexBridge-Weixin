# Long-Task Interruption Recovery Design

Date: 2026-07-17
Status: Approved

## Purpose

CodexBridge currently tracks active conversation turns in an in-memory
`ActiveTurnRegistry`. A service restart, lightweight update, or unexpected
process exit loses that registry even when the provider-side turn is still
running or has already completed. The bridge can then accept conflicting work,
lose the final reply, or leave the user without a clear recovery path.

This change adds durable active-turn checkpoints and startup reconciliation.
The bridge will recover provider state and final delivery without automatically
replaying a user request or carrying an old approval across a restart.

## Goals

- Persist enough active-turn identity and delivery state to survive restart.
- Restore per-scope exclusion before accepting new inbound work.
- Reconcile checkpoints against provider-authoritative thread and turn state.
- Deliver a completed provider reply through the existing Weixin delivery
  pipeline and persistent outbox.
- Expire all pre-restart approvals and require a fresh user decision.
- Make every recovery action bounded, observable, and safe to repeat.

## Non-Goals

- Exactly-once Weixin delivery. The transport has no durable idempotency key.
- Automatic replay of an interrupted, failed, or ambiguous request.
- Recovery of arbitrary provider turns that have no CodexBridge checkpoint.
- A new general-purpose workflow or event-sourcing subsystem.
- A new diagnostics page or a redesign of the existing admin console.

## Chosen Approach

Use a versioned JSON checkpoint repository backed by the existing atomic JSON
file infrastructure. Restore checkpoints into the active-turn registry during
bootstrap, then reconcile them asynchronously after the platform and providers
are available.

This approach is preferred over a complete event journal because the product
only needs the latest authoritative recovery state. It is preferred over
provider-only scanning because a provider turn alone does not reliably identify
the owning Weixin scope or delivery state.

## Components

### Active Turn Checkpoint Repository

Add an `ActiveTurnCheckpointRepository` contract with file-JSON and in-memory
implementations. The file repository stores
`<stateDir>/active_turn_checkpoints.json` through `JsonFileStore`.

The repository supports:

- `getByScope(platform, externalScopeId)`
- `list()`
- `save(checkpoint)`
- `deleteByScope(platform, externalScopeId)`

Repository reads normalize records independently so one malformed record does
not discard the complete file. Corrupt JSON is quarantined by the existing
`.corrupt-<timestamp>` behavior.

### Checkpoint Model

Each checkpoint contains:

- schema version and stable checkpoint ID
- platform and external scope ID
- bridge session ID and provider profile ID
- provider thread ID and optional provider turn ID
- request fingerprint and bounded request summary
- recovery phase
- whether an approval was pending at the last durable update
- optional final-delivery key and outbox entry ID
- creation, update, last-reconciliation, and expiry timestamps
- bounded reconciliation attempt count and last error category

The checkpoint does not persist an approval decision, API key, credential,
complete environment, or an automatically replayable request payload.

### Persistent Active Turn Registry

`ActiveTurnRegistry` remains the process-local source used by the coordinator,
but receives an optional checkpoint repository. Every lifecycle mutation that
changes recovery behavior writes the checkpoint before exposing the new local
state.

The initial checkpoint is written before invoking the provider. If that write
fails, the provider turn is not started. Once the provider returns thread or
turn identity, the registry immediately persists it. Normal completion removes
the checkpoint only after final delivery is confirmed or durably handed to the
outbox.

### Recovery Coordinator

Add a focused recovery service rather than expanding `BridgeCoordinator` with
startup orchestration. It depends on:

- the active-turn checkpoint repository
- `ActiveTurnRegistry`
- provider profiles and provider registry
- bridge sessions and platform bindings
- a recovery delivery callback supplied by `WeixinBridgeRuntime`

The service loads checkpoints, restores scope locks, queries provider state,
normalizes final output, and requests delivery. It exposes aggregate status for
the existing runtime/admin status surface.

## State Model

Durable recovery phases are:

- `starting`: checkpoint exists but no provider turn ID is confirmed
- `running`: a specific provider turn is known to be non-terminal
- `reconciling`: startup reconciliation is in progress
- `approval_expired`: a pre-restart approval was invalidated
- `completed_pending_delivery`: terminal output is ready for delivery
- `interrupted`: the provider reports failure, cancellation, or interruption
- `uncertain`: the bridge cannot safely identify the provider-side outcome

`reconciling` is a durable phase so another restart can safely repeat the same
provider lookup. The prior phase is retained in checkpoint metadata for error
reporting and timeout handling.

## Runtime Flow

### Starting a Turn

1. Resolve the bridge session, provider profile, and scope.
2. Create the local active-turn record and durable `starting` checkpoint.
3. Abort before provider invocation if the durable write fails.
4. Start the provider turn.
5. Persist thread and turn identity as soon as each becomes available.
6. Persist pending-approval presence, but never approval decisions.
7. On terminal completion, persist `completed_pending_delivery` before sending.
8. Delete the checkpoint after successful delivery, or link it to the durable
   outbox entry before considering the handoff complete.

### Startup Recovery

1. Bootstrap creates the repository and registry and loads valid checkpoints.
2. Scope locks are restored synchronously before inbound polling begins.
3. The platform starts so recovery notices and completed replies can be sent.
4. Reconciliation begins in the background and never prevents service startup.
5. Each checkpoint is processed under a per-scope recovery lock.

Provider reconciliation uses these rules:

- Known turn ID and non-terminal turn: restore `running` and continue polling.
- Known turn ID and completed turn: extract final output and hand it to delivery.
- Known turn ID and failed/interrupted turn: mark `interrupted` and notify once.
- Missing turn ID with exactly one non-terminal turn on the expected thread:
  bind that turn and continue recovery.
- Missing turn ID with no unique match: mark `uncertain`; never infer or replay.
- Missing provider profile, session, binding, or thread: mark `uncertain` and
  retain the evidence until expiry.
- Provider temporarily unavailable: retain the checkpoint and retry with
  bounded exponential backoff.

### Approval Recovery

Any checkpoint that indicates a pending approval is changed to
`approval_expired` on startup. The in-memory approval list is cleared. The user
receives one notice that the old approval is no longer valid and must re-run the
operation. No allow/deny result is reconstructed or submitted.

### Completion Delivery

Recovered completion uses the same provider-turn output extraction and artifact
normalization as a live turn. A stable local delivery key is derived from the
provider profile, thread ID, turn ID, and delivery stage. That key prevents
duplicate local enqueue operations across repeated reconciliation.

The existing Weixin outbox remains at-least-once. A process crash after remote
success but before the local success write can still produce one duplicate
message. This residual window is explicit because the remote API does not
support a reliable idempotency key.

## Concurrency

- Restored checkpoints acquire their scope in `ActiveTurnRegistry` before the
  inbound poller starts.
- New conversation turns for a recovering scope receive the existing busy
  response and may not run concurrently.
- Recovery reconciliation is single-flight per scope.
- Repeated startup, timer, and manual-status triggers converge on the same
  checkpoint state.
- Checkpoint deletion verifies the expected checkpoint ID so stale completion
  cannot delete a newer turn for the same scope.

## Retry and Timeout Policy

- Temporary provider failures use exponential delays capped at 30 seconds.
- A checkpoint may remain actively reconciling for up to 24 hours.
- After 24 hours without an authoritative terminal result, it becomes
  `uncertain`, releases the scope lock, and sends one user-visible notice.
- `interrupted`, `approval_expired`, and `uncertain` records are retained for a
  further 24 hours for diagnostics and then deleted.
- Completed checkpoints linked to an outbox entry remain until the outbox no
  longer contains the entry or the existing outbox retention expires.

The bridge never converts a timeout into an automatic request replay. `/retry`
continues to work only when an existing replayable request snapshot is
available; otherwise the notice asks the user to resend the request.

## Error Handling

- Initial checkpoint write failure: fail closed before provider invocation and
  return a clear chat-visible error.
- Later checkpoint write failure: record a runtime error, keep the local turn
  locked, and do not claim durable recovery.
- Provider read timeout or transient error: retain state and retry.
- Unsupported provider thread reads: mark `uncertain` and notify once.
- Output extraction failure: retain `completed_pending_delivery`, record a
  bounded error, and retry without rerunning the provider turn.
- Delivery failure: enqueue the failed continuation in the existing outbox.
- Corrupt checkpoint file: quarantine it and start with no inferred turns;
  surface the recovery-store failure in runtime diagnostics.

## Observability

Extend aggregate runtime status with:

- total recovery checkpoints
- running/reconciling/uncertain counts
- oldest checkpoint age
- last reconciliation time and bounded error category

Do not expose prompt text, provider output, scope identifiers, credentials, or
checkpoint file contents in metrics, logs, alerts, or diagnostic exports.
Diagnostic exports may include only aggregate counts and redacted state names.

The existing admin runtime/diagnostics surface displays a compact recovery
summary and does not add a separate page.

## Compatibility and Migration

- An absent checkpoint file initializes as an empty version-1 repository.
- Unknown schema versions and malformed records are ignored independently and
  reported through aggregate diagnostics.
- Existing in-memory repository configurations continue to work through an
  in-memory checkpoint implementation.
- Provider implementations without `readThread(... includeTurns: true)` remain
  usable for live turns; their restart checkpoints become `uncertain` rather
  than being replayed.
- Existing delivery outbox files remain compatible.

## Testing

### Repository Tests

- empty initialization and versioned persistence
- normalization and deep-clone behavior
- independent malformed-record rejection
- corrupt-file quarantine and reinitialization
- expected-ID guarded deletion
- terminal retention and stale-record cleanup

### Registry and Recovery Tests

- mutation ordering writes durable state before local exposure
- checkpoint write failure prevents provider start
- known running turn restoration
- known completed turn extraction and delivery handoff
- interrupted and failed terminal states
- unique running-turn rebinding when turn ID was not persisted
- ambiguous, missing, and unsupported provider states become `uncertain`
- pending approval expiration without provider approval submission
- provider outage backoff and later recovery
- repeat reconciliation is idempotent
- recovery timeout releases the scope without replay

### Runtime and Delivery Tests

- restored scope blocks concurrent inbound conversation turns
- completed recovery creates one local delivery entry
- delivery failure enters the existing persistent outbox
- outbox handoff survives another restart
- successful outbox completion removes the linked checkpoint
- aggregate admin status contains no sensitive identifiers or content

### Verification

- targeted repository, coordinator, runtime, and admin tests
- root TypeScript and checked-JavaScript validation
- complete release verification
- Windows Electron distribution build and packaged smoke test

## Rollout

The feature is always enabled when the file-JSON runtime is used. It requires no
new environment variable. Failures degrade to explicit `uncertain` status and
manual user action; they never cause automatic replay. Standard full updates and
lightweight updates use the same state directory, so both exercise the same
recovery path.
