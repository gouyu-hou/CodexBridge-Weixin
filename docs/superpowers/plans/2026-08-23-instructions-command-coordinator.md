# Instructions Command Coordinator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `/instructions` command orchestration and per-scope draft state out of `BridgeCoordinator` while preserving all existing user-visible behavior.

**Architecture:** Add a focused `InstructionsCommandService` that owns pending capture/draft maps and command branching. Provider/session side effects remain in `BridgeCoordinator` behind callbacks for reading/writing instructions, invoking the command skill, checking active turns, reconnecting profiles, formatting session metadata, and rendering help. The coordinator keeps only the callback implementation and delegates inbound capture and command dispatch.

**Tech Stack:** TypeScript, Node test runner, existing CodexBridge command-skill helpers and i18n translator.

## Global Constraints

- Preserve all existing `/instructions`, `/ins`, `set`, `edit`, `clear`, `ok`, `confirm`, and `cancel` behavior.
- Keep instruction writes blocked while any active turn is running.
- Keep reconnect-after-save behavior and localized response text unchanged.
- Do not change the admin UI, Web console removal, provider protocol, or runtime behavior outside instructions command routing.
- Run focused tests, type checks, and `git diff --check` before commit.

---

### Task 1: Lock The Delegation Boundary

**Files:**
- Modify: `test/core/instructions_command.test.ts`
- Modify: `src/core/bridge_coordinator.ts`

- [ ] **Step 1: Add a failing structural assertion**

Assert that `BridgeCoordinator` creates `InstructionsCommandService` and delegates pending capture and command handling through it.

- [ ] **Step 2: Run the focused structural test**

Run: `npm test -- test/core/instructions_command.test.ts`
Expected: the new delegation assertion fails because the service is not wired yet.

### Task 2: Extract The Service

**Files:**
- Create: `src/core/instructions_command_service.ts`
- Modify: `src/core/bridge_coordinator.ts`

- [ ] **Step 1: Implement the service with injected callbacks**

Move pending capture/draft state, status rendering, draft proposal/apply/cancel logic, command routing, skill-result handling, and clarification rendering into `InstructionsCommandService`.

- [ ] **Step 2: Wire the coordinator callbacks**

Instantiate the service from the coordinator and route inbound pending captures and `/instructions` command dispatch to it. Leave provider invocation and reconnect side effects injected from the coordinator.

- [ ] **Step 3: Run focused tests**

Run: `npm test -- test/core/instructions_command.test.ts test/core/bridge_coordinator.test.ts`
Expected: all existing instructions and coordinator tests pass.

### Task 3: Type And Regression Verification

**Files:**
- Modify: `test/core/instructions_command.test.ts`

- [ ] **Step 1: Run checks**

Run: `npm run typecheck` and `npm test -- test/core/instructions_command.test.ts test/core/bridge_coordinator.test.ts`.
Expected: exit code `0`, no failed tests.

- [ ] **Step 2: Check the diff**

Run: `git diff --check`.
Expected: no whitespace errors.

### Task 4: Commit

**Files:**
- `src/core/instructions_command_service.ts`
- `src/core/bridge_coordinator.ts`
- `test/core/instructions_command.test.ts`
- `docs/superpowers/plans/2026-08-23-instructions-command-coordinator.md`

- [ ] **Step 1: Commit the focused refactor**

```bash
git add src/core/instructions_command_service.ts src/core/bridge_coordinator.ts test/core/instructions_command.test.ts docs/superpowers/plans/2026-08-23-instructions-command-coordinator.md
git commit -m "refactor: extract instructions command orchestration"
```
