# Codex AppClient State Sharing Design

## Goal

Remove the next safe layer of duplicate AppClient approval and turn-lifecycle state logic while keeping transport-specific client behavior separate.

## Shared Approval State

Add a host-neutral approval registry in `packages/codex-native-api` that owns pending approval indexing, filtering, decision-result construction, successful removal, and approved-execution tracking. Event emission and JSON-RPC transport remain in each AppClient.

## Shared Turn Lifecycle

Add pure lifecycle helpers for terminal classification transitions, materialization wait decisions, partial/missing/error outcomes, and cleanup decisions that are still duplicated after the existing event/output/settle extractions. Helpers consume normalized snapshots and return decisions; they do not read files, timers, sockets, or child processes.

## Compatibility Contract

- Preserve request IDs including numeric JSON-RPC IDs.
- Preserve approval event ordering and remove pending entries only after a response is successfully sent.
- Preserve approved-execution idle timeout and stall diagnostics.
- Preserve final-answer, partial, missing, interrupted, timeout, and provider-error selection.
- Preserve root-client and Native API differences in startup, transport fallback, session-log access, and debug output.

## Tests

Add shared-unit tests for approval state and lifecycle transitions, parity tests proving both clients delegate to the shared layer, and existing client regression suites for protocol behavior. Extraction must not change public exports except for the new shared helpers.

## Success Criteria

Both AppClients use the shared state layer, duplicate state-transition blocks are removed, and all protocol and provider tests pass without snapshot changes.
