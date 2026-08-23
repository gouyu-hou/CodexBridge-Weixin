# Codex AppClient State Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share pending-approval state and the next pure turn-lifecycle decisions between the root and Native API AppClients.

**Architecture:** Add host-neutral state classes and pure decision helpers to `packages/codex-native-api`. Both clients retain transport, event emission, filesystem, timer, and debug integrations.

**Tech Stack:** TypeScript, EventEmitter clients, Codex app-server JSON-RPC protocol, Node test runner.

## Global Constraints

- Preserve numeric and string JSON-RPC request IDs.
- Remove pending approvals only after a successful response send.
- Preserve approval event order, idle timeout, stall diagnostics, and terminal output selection.
- Preserve transport and startup differences between clients.
- Do not adopt new Codex protocol features in this phase.

---

### Task 1: Implement And Adopt Approval Registry

**Files:**
- Create: `packages/codex-native-api/test/codex_app_approval_state.test.ts`
- Modify: `test/providers/codex/app_client.test.ts`
- Create: `packages/codex-native-api/test/codex_app_client_state_integration.test.ts`
- Create: `packages/codex-native-api/src/codex_app_approval_state.ts`
- Modify: `packages/codex-native-api/src/index.ts`
- Modify: `src/providers/codex/app_client.ts`
- Modify: `packages/codex-native-api/src/codex_app_client.ts`
- Test: `packages/codex-native-api/test/codex_app_approval_state.test.ts`
- Test: `packages/codex-native-api/test/codex_app_client_state_integration.test.ts`
- Test: `test/providers/codex/app_client.test.ts`

**Interfaces:**

```ts
export class CodexAppApprovalState {
  set(pending: PendingApproval): void;
  get(requestId: string | number): PendingApproval | null;
  list(filter?: { threadId?: string | null; turnId?: string | null }): ProviderApprovalRequest[];
  prepare(requestId: string | number, option: 1 | 2 | 3): { pending: PendingApproval; result: unknown; approvedExecution: ApprovedExecution | null };
  remove(requestId: string | number): void;
  clear(): void;
}
```

- [ ] Add unit tests for set/get/list filtering, numeric RPC IDs, response preparation, successful removal, failed-send retention, approved-execution tracking, and clear.
- [ ] Add structural parity tests requiring both clients to delegate approval storage.
- [ ] Run the focused tests and capture RED because the shared registry does not exist.
- [ ] Implement the smallest state class that passes unit tests.
- [ ] Replace both clients' pending map reads/writes and response preparation with the state class.
- [ ] Keep transport send before `remove` so failures retain pending state.
- [ ] Run both client suites, protocol tests, type checks, and boundary checks.
- [ ] Commit as `refactor: share Codex approval state`.

### Task 2: Implement And Adopt Pure Turn Lifecycle Helpers

**Files:**
- Create: `packages/codex-native-api/test/codex_app_turn_lifecycle.test.ts`
- Modify: `test/providers/codex/app_client.test.ts`
- Modify: `packages/codex-native-api/test/codex_app_client_state_integration.test.ts`
- Create: `packages/codex-native-api/src/codex_app_turn_lifecycle.ts`
- Modify: `packages/codex-native-api/src/index.ts`
- Modify: `src/providers/codex/app_client.ts`
- Modify: `packages/codex-native-api/src/codex_app_client.ts`

**Interfaces:**

```ts
export type CodexTurnLifecycleDecision =
  | { kind: 'wait'; reason: string }
  | { kind: 'complete' }
  | { kind: 'partial'; previewText: string }
  | { kind: 'missing' }
  | { kind: 'interrupted' }
  | { kind: 'provider_error'; errorMessage: string };
```

- [ ] Identify only equivalent decision blocks remaining in both `waitForTurnResult` methods.
- [ ] Add table tests for terminal complete, interrupted, provider error, partial commentary, missing output, materialization wait, and cleanup decisions.
- [ ] Add structural assertions that both clients import the lifecycle module.
- [ ] Run focused tests and capture RED because the lifecycle module does not exist.
- [ ] Implement pure decisions using normalized turn/progress/session snapshots only.
- [ ] Replace equivalent branches in both clients while leaving timers, reads, and logging local.
- [ ] Run lifecycle, event, protocol, root client, Native API, and provider tests.
- [ ] Commit as `refactor: share Codex turn lifecycle decisions`.

### Task 3: AppClient Phase Verification

- [ ] Run `npm test -- test/providers/codex/app_client.test.ts`, `npm run codex-native-api:test`, root/native typechecks, boundary checks, and `git diff --check`.
- [ ] Request independent protocol-focused review.
- [ ] Fix all Critical/Important findings and rerun the same commands.
- [ ] Record both AppClient line counts and removed duplicate blocks.
