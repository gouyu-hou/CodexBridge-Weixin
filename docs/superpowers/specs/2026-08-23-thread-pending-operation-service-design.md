# Thread Pending Operation Service Design

## Goal

Finish the first stateful group in the existing thread-command extraction by moving pending thread-operation state and confirm/cancel orchestration from `BridgeCoordinator` into `ThreadCommandService` without changing command behavior.

## Boundary

`ThreadCommandService` owns:

- one pending `PendingThreadCommandOperation` per platform scope key;
- staging, reading, and clearing pending operations;
- `/threads confirm` ordering: reject an active turn first, require a pending operation, execute it, then clear it only after successful execution;
- `/threads cancel` ordering: require a pending operation, clear it, then render cancellation.

`BridgeCoordinator` retains:

- scope-key construction and active-turn checks;
- provider thread archive/restore and metadata pin/unpin side effects;
- localized response rendering and session metadata;
- Codex command normalization, inventory construction, target matching, and proposal rendering.

The service receives these retained capabilities through a narrow host contract. It does not import `BridgeCoordinator`, provider implementations, repositories, or translation catalogs.

## Data Flow

Natural-language management still resolves a proposal in the coordinator. The coordinator stages the resulting operation through `ThreadCommandService`. Confirmation enters the service through the existing route, checks the active-turn guard, resolves the scope-local pending operation, calls the coordinator host to apply it, and clears state only after that call succeeds. Cancellation clears only the current scope.

## Compatibility

- Preserve all response text, metadata, and command aliases.
- Preserve active-turn rejection before pending-operation lookup on confirm.
- Preserve pending state when execution throws, including pin persistence failures.
- Preserve successful clear-before-return behavior and per-scope isolation.
- Do not change prompts, provider calls, thread selection, operation eligibility, browser pagination, or storage formats.

## Testing

- Add direct service tests for scope isolation, successful confirmation, active-turn rejection, missing pending state, cancellation, and execution failure retention.
- Add a structural coordinator assertion proving the pending map and orchestration bodies migrated.
- Keep coordinator integration tests for proposal, confirm, cancel, and persistence failure.
- Run focused tests, both type checks, full release verification, and an independent review before integration.

## Non-Goals

- No migration of search, natural-language normalization, browser state, page rendering, or explicit target resolution in this phase.
- No UI, provider protocol, persistence schema, version, package, or release changes.
