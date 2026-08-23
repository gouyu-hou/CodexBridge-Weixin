# Assistant Record Command Service Phase Two Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move assistant-record confirmation, cancellation, editing, display, and natural-command orchestration out of `BridgeCoordinator` without behavior changes.

**Architecture:** Extend the existing dependency-injected `AssistantRecordCommandService`. The service owns command state and sequencing; coordinator callbacks retain provider, repository, localization-context, and response-delivery side effects.

**Tech Stack:** TypeScript, Node test runner, existing assistant-record services and command-skill adapters.

## Global Constraints

- Preserve `/as`, `/log`, `/todo`, `/remind`, and `/note` aliases, text, metadata, persistence ordering, and confirmation semantics.
- Preserve active-turn checks before mutations and retain drafts on failed mutations.
- Keep provider and repository implementations in `BridgeCoordinator` callbacks.
- Do not change release metadata or unrelated command behavior.

---

### Task 1: Move Pending Draft Terminal Orchestration

**Files:**
- Modify: `test/core/assistant_record_command.test.ts`
- Modify: `test/core/bridge_coordinator.test.ts`
- Modify: `src/core/assistant_record_command_service.ts`
- Modify: `src/core/bridge_coordinator.ts`

**Interfaces:**
- Consumes: existing `AssistantRecordCommandService<Response>` and `PendingAssistantRecordUpdateDraft`.
- Produces: service-owned confirm/cancel sequencing and typed callbacks `rejectMutation`, `applyUpdateDraft`, `renderUpdateDraft`, `renderUpdateApplied`, and `renderNoPending`.

- [ ] **Step 1: Add direct confirm and cancel orchestration tests**

Add harness callbacks that record exact sequencing and tests equivalent to:

```ts
assert.deepEqual(await service.handle(event, ['ok'], null), confirmedResponse);
assert.deepEqual(calls, ['reject-active', 'apply-update', 'render-applied']);
```

Cover no pending, forced-type mismatch, active-turn rejection, apply failure retention, successful cleanup, cancel cleanup, and scope isolation.

- [ ] **Step 2: Add coordinator structural assertions**

Assert terminal branching and pending-state manipulation are absent from `bridge_coordinator.ts`, while persistence and rendering callbacks remain.

- [ ] **Step 3: Run the focused test and capture RED**

Run:

```powershell
npm test -- test/core/assistant_record_command.test.ts test/core/bridge_coordinator.test.ts
```

Expected: new service orchestration tests fail because terminal orchestration is still coordinator-owned.

- [ ] **Step 4: Extend the typed dependency contract**

Use explicit callbacks with this shape:

```ts
rejectMutation(event: InboundTextEvent): Promise<Response | null>;
applyUpdateDraft(draft: PendingAssistantRecordUpdateDraft): AssistantRecord | null;
renderUpdateDraft(draft: PendingAssistantRecordUpdateDraft, commandName: string): string[];
renderUpdateApplied(draft: PendingAssistantRecordUpdateDraft, record: AssistantRecord, commandName: string): string[];
```

- [ ] **Step 5: Implement confirm and cancel sequencing in the service**

Check active turn before pending state, retain pending on apply failure, clear after successful apply and before terminal rendering, and clear cancellation only for the current scope.

- [ ] **Step 6: Replace coordinator bodies with callbacks and thin delegation**

Remove migrated branching from `handleAssistantConfirmCommand` and `handleAssistantCancelPendingCommand`; route through the service.

- [ ] **Step 7: Run GREEN verification**

```powershell
npm test -- test/core/assistant_record_command.test.ts test/core/bridge_coordinator.test.ts
npm run typecheck
```

- [ ] **Step 8: Commit the green implementation**

```powershell
git add src/core/assistant_record_command_service.ts src/core/bridge_coordinator.ts test/core/assistant_record_command.test.ts test/core/bridge_coordinator.test.ts
git commit -m "refactor: move assistant draft terminal orchestration"
```

### Task 2: Move Edit, Show, And Explicit Mutation Orchestration

**Files:**
- Modify: `src/core/assistant_record_command_service.ts`
- Modify: `src/core/bridge_coordinator.ts`
- Test: `test/core/assistant_record_command.test.ts`

**Interfaces:**
- Consumes: typed callbacks for record lookup, update, archive, cancel, and draft editing.
- Produces: service-owned explicit command sequencing and argument validation.

- [ ] **Step 1: Add failing tests for edit/show/done/delete/cancel-record paths**

Assert numeric selection, invalid selection, missing edit text, provider-assisted edit, and direct lifecycle mutations retain existing responses and call ordering.

- [ ] **Step 2: Add narrowly typed host callbacks**

Use callbacks that return domain values rather than rendered responses where practical:

```ts
resolveRecord(args: unknown[], type: AssistantRecordType | null): AssistantRecord | null;
saveRecord(record: AssistantRecord): AssistantRecord;
normalizeEdit(event: InboundTextEvent, draft: PendingAssistantRecordUpdateDraft, input: string): Promise<PendingAssistantRecordUpdateDraft | null>;
```

- [ ] **Step 3: Move branching and draft replacement into the service**

Keep actual repository writes and provider normalization in coordinator callbacks.

- [ ] **Step 4: Run focused tests and type checks**

```powershell
npm test -- test/core/assistant_record_command.test.ts test/core/bridge_coordinator.test.ts
npm run typecheck
npm run typecheck:js
```

- [ ] **Step 5: Commit**

```powershell
git add src/core/assistant_record_command_service.ts src/core/bridge_coordinator.ts test/core/assistant_record_command.test.ts test/core/bridge_coordinator.test.ts
git commit -m "refactor: move assistant explicit command orchestration"
```

### Task 3: Move Natural Draft And Rendering Decisions

**Files:**
- Create: `src/core/assistant_record_command_view.ts`
- Modify: `src/core/assistant_record_command_service.ts`
- Modify: `src/core/bridge_coordinator.ts`
- Create: `test/core/assistant_record_command_view.test.ts`
- Modify: `test/core/assistant_record_command.test.ts`

**Interfaces:**
- Consumes: the existing normalized `create | update | complete | cancel | archive | none` route decisions from coordinator callbacks.
- Produces: pure formatting helpers and service-owned routing of normalized decisions.

- [ ] **Step 1: Add failing pure rendering and decision-routing tests**

Cover list items, pending create, saved record, update draft, update applied, detail, and local list outcomes in both supported locales already represented by integration tests. Preserve the legacy `none` route as the pending-create fallback; do not introduce new route actions or user-visible responses.

- [ ] **Step 2: Extract pure view helpers**

Export typed functions such as:

```ts
export function renderAssistantRecordDetail(record: AssistantRecord, i18n: Translator): string[];
export function renderAssistantUpdateDraft(draft: PendingAssistantRecordUpdateDraft, commandName: string, i18n: Translator): string[];
```

- [ ] **Step 3: Move natural-decision orchestration into the service**

Coordinator callbacks return normalized decisions and perform provider calls; the service chooses staging, persistence callback, or rendering path.

- [ ] **Step 4: Remove migrated coordinator helpers and verify**

```powershell
npm test -- test/core/assistant_record_command.test.ts test/core/assistant_record_command_view.test.ts test/core/bridge_coordinator.test.ts
npm run typecheck
npm run typecheck:js
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add src/core/assistant_record_command_service.ts src/core/assistant_record_command_view.ts src/core/bridge_coordinator.ts test/core/assistant_record_command.test.ts test/core/assistant_record_command_view.test.ts test/core/bridge_coordinator.test.ts
git commit -m "refactor: complete assistant record command extraction"
```

### Task 4: Phase Verification And Review

- [ ] Run focused tests, `npm run typecheck`, `npm run typecheck:js`, and `git diff --check`.
- [ ] Request independent review against the phase base commit.
- [ ] Fix all Critical and Important findings with regression tests.
- [ ] Record final coordinator and service line counts in the task report.
