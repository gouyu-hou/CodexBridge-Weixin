# Model Command Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `/models` and `/model` orchestration out of `BridgeCoordinator` while preserving all existing behavior.

**Architecture:** Add `ModelCommandService` as the stateful orchestration layer above the pure helpers in `model_command.ts`. Inject scope, provider, session, active-turn, effective-model, translation, metadata, and settings callbacks from `BridgeCoordinator`; keep provider-turn error recovery and unrelated settings commands in the coordinator.

**Tech Stack:** TypeScript, Node test runner, existing provider registry, bridge session service, model command helpers, and i18n translator.

## Global Constraints

- Preserve all `/models` and `/model` output text, ordering, aliases, and validation behavior.
- Preserve pending `/new` session handling and active-turn mutation blocking.
- Keep `model_command.ts` free of provider registry and session repository dependencies.
- Do not change model catalogs, provider defaults, admin UI, or provider-turn error recovery.
- Use TDD and run focused tests, type checks, full release verification, and `git diff --check` before integration.

---

### Task 1: Lock The Delegation Boundary

**Files:**
- Modify: `test/core/model_command.test.ts`
- Inspect: `src/core/bridge_coordinator.ts`

- [ ] Add a structural assertion that `BridgeCoordinator` imports, constructs, and delegates both model commands to `ModelCommandService`.
- [ ] Run `npm test -- test/core/model_command.test.ts` and confirm the new assertion fails for the missing service.

### Task 2: Extract And Wire The Service

**Files:**
- Create: `src/core/model_command_service.ts`
- Modify: `src/core/bridge_coordinator.ts`

- [ ] Define narrow dependency and event interfaces in the service module.
- [ ] Move `/models` and `/model` orchestration into the service without changing branches or response ordering.
- [ ] Instantiate the service once in `BridgeCoordinator` and delegate command routing.
- [ ] Remove imports from the coordinator that are now service-only.
- [ ] Run `npm test -- test/core/model_command.test.ts test/core/bridge_coordinator.test.ts`.

### Task 3: Verify Behavior And Types

**Files:**
- Modify as needed: `test/core/model_command.test.ts`

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run typecheck:js`.
- [ ] Run `npm test -- test/core/model_command.test.ts test/core/bridge_coordinator.test.ts`.
- [ ] Run `git diff --check`.

### Task 4: Review And Integrate

- [ ] Review the complete branch diff for accidental behavior changes.
- [ ] Run `npm run verify:release`.
- [ ] Commit the focused refactor.
- [ ] Merge into `main`, rerun focused validation, and push without force.
