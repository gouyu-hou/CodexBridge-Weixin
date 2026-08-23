# Assistant Record Command Service Design

## Goal

Move assistant-record command routing, local list-intent detection, and pending update-draft state out of `BridgeCoordinator` without changing `/as`, `/log`, `/todo`, `/remind`, or `/note` behavior.

## Boundary

Add `AssistantRecordCommandService`. It owns:

- explicit subcommand routing and aliases;
- default type selection (`/as` lists todos by default);
- local natural-language list detection;
- per-scope pending update-draft storage and type filtering;
- dispatch to injected record operations and the coordinator-owned natural workflow.

`BridgeCoordinator` retains:

- Codex/provider classification and rewrite calls;
- record repository mutations and rendering;
- upload-batch handling;
- update-draft construction, preview, and application;
- all external side effects.

Shared command-name and local-query helpers move with the service and remain exported for coordinator rendering and prompts.

## Compatibility

- Preserve all command aliases and response text.
- Preserve forced-type filtering for `/log`, `/todo`, `/remind`, and `/note`.
- Preserve `/as` default list behavior and local Chinese/English list queries.
- Preserve create-request prefixes so requests such as “新增待办” never become list queries.
- Preserve update-draft lookup by current record type.
- Preserve upload-aware natural record creation in the coordinator.

## Testing

- Add structural assertions for service construction and delegation.
- Add direct tests for command-name mapping, local list intent, and pending-draft type filtering.
- Keep existing coordinator tests as end-to-end behavioral coverage.
- Run focused tests, both type checks, full release verification, and diff checks before integration.

## Non-Goals

- No prompt, parsing, matching-score, persistence, reminder, or upload behavior changes.
- No UI or provider protocol changes.
- No migration of the full assistant-record workflow in this phase.
