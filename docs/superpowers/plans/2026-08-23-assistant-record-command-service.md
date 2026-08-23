# Assistant Record Command Service Implementation Plan

**Goal:** Extract assistant-record routing, local list intent, and pending update-draft state from `BridgeCoordinator` with no behavior change.

**Architecture:** Create `AssistantRecordCommandService` with narrow callbacks for explicit record actions and the coordinator-owned natural workflow. Export command-name and local-query helpers from the service. Keep provider, repository, upload, and rendering side effects in `BridgeCoordinator`.

## Global Constraints

- Preserve `/as`, `/log`, `/todo`, `/remind`, and `/note` behavior and aliases.
- Preserve default todo listing, forced-type filtering, and pending-draft type isolation.
- Preserve all existing response text and side-effect ordering.
- Do not change classifier prompts, matching rules, storage, uploads, or providers.
- Use TDD and run full release verification before integration.

### Task 1: Lock The Boundary

**Files:**
- Create: `test/core/assistant_record_command.test.ts`

- [ ] Assert coordinator import, construction, command delegation, and pending-state delegation.
- [ ] Add desired helper and state API tests.
- [ ] Run the focused test and confirm failure because the service does not exist.

### Task 2: Extract The Service

**Files:**
- Create: `src/core/assistant_record_command_service.ts`
- Modify: `src/core/bridge_coordinator.ts`

- [ ] Implement explicit routing and local query detection.
- [ ] Move pending update-draft map ownership into the service.
- [ ] Add coordinator callbacks and a focused natural-workflow method.
- [ ] Remove migrated helpers and map state from the coordinator.

### Task 3: Verify And Integrate

- [ ] Run assistant command and coordinator tests.
- [ ] Run `npm run typecheck` and `npm run typecheck:js`.
- [ ] Run `npm run verify:release` and `git diff --check`.
- [ ] Request independent review, merge to `main`, rerun focused validation, and push without force.
