# Assistant Record Command Service Phase Two Design

## Goal

Move assistant-record draft, confirmation, cancellation, editing, display, and natural-command orchestration out of `BridgeCoordinator` while preserving all current behavior.

## Boundary

`AssistantRecordCommandService` owns command routing, scope-keyed pending update drafts, explicit command orchestration, confirmation/cancellation state transitions, edit orchestration, and command-facing rendering decisions.

`BridgeCoordinator` remains responsible for provider invocation, command-skill execution, persistence through `AssistantRecordService`, session resolution, localization context, and final response delivery. These responsibilities are exposed to the service through typed host callbacks; provider and repository implementations do not move into the service.

Pure assistant-record draft formatting and selection helpers may move to a focused companion module when that keeps the service readable. They must not depend on `BridgeCoordinator`.

## Behavior Contract

- Preserve command aliases and default `/as` type behavior.
- Preserve active-turn checks before mutations.
- Preserve pending-draft scope isolation and type filtering.
- Preserve update, complete, cancel, and archive persistence ordering.
- Preserve failed-operation draft retention and successful-operation cleanup.
- Preserve all localized text and session metadata.
- Keep direct record creation and provider normalization behavior unchanged.

## Tests

Add direct service tests for confirmation, cancellation, editing, no-pending paths, active-turn rejection, apply failure retention, scope isolation, and rendering. Keep coordinator integration tests for provider and persistence effects. Add structural assertions that migrated orchestration no longer lives in `BridgeCoordinator`.

## Success Criteria

The coordinator delegates the migrated assistant-record workflows through typed callbacks, focused tests pass, and no command output snapshot changes.
