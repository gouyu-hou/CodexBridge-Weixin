# Thread Pending Operation Service Implementation Plan

**Goal:** Move pending thread-operation state and confirm/cancel orchestration into `ThreadCommandService` with no behavior change.

**Architecture:** Extend the existing generic service with a scope-keyed pending map and host callbacks for active-turn rejection, pending execution, and localized terminal responses. Keep provider and rendering side effects in `BridgeCoordinator`.

## Global Constraints

- Preserve thread command aliases, response text, metadata, and side-effect ordering.
- Confirm must check the active-turn guard before pending state.
- Failed execution must retain the pending operation; success and cancellation must clear it.
- Keep pending operations isolated by platform scope key.
- Do not change prompts, matching, provider calls, page state, persistence, UI, or releases.
- Use TDD and run the complete release gate before integration.

### Task 1: Lock The Stateful Contract

**Files:**
- Modify: `test/core/thread_command.test.ts`
- Modify: `test/core/bridge_coordinator.test.ts`

- [ ] Add direct service tests for set/get/clear scope isolation.
- [ ] Test confirm success, active-turn rejection, no-pending response, and execution failure retention.
- [ ] Test cancel success and no-pending response.
- [ ] Add structural assertions that the coordinator delegates and no longer owns the pending map.
- [ ] Run the focused test and confirm failure for the missing service contract.

### Task 2: Move State And Orchestration

**Files:**
- Modify: `src/core/thread_command.ts`
- Modify: `src/core/bridge_coordinator.ts`

- [ ] Extend `ThreadCommandHost` with scope-key and terminal-response callbacks.
- [ ] Move the pending operation map and state accessors into `ThreadCommandService`.
- [ ] Implement confirm/cancel orchestration in the service with preserved ordering.
- [ ] Delegate coordinator compatibility methods and proposal staging to the service.
- [ ] Remove the coordinator map and migrated orchestration bodies; retain thin compatibility accessors for existing callers.

### Task 3: Verify And Integrate

- [ ] Run thread-command and coordinator tests.
- [ ] Run `npm run typecheck` and `npm run typecheck:js`.
- [ ] Run `npm run verify:release` and `git diff --check`.
- [ ] Request independent review, fix Critical/Important findings, merge to `main`, rerun focused validation, and push without force.
