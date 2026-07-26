# AppClient Protocol Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the root and package Codex AppClients one canonical implementation for deterministic protocol normalization while preserving their independent lifecycle state and public APIs.

**Architecture:** Add `codex_app_protocol.ts` inside `packages/codex-native-api`, the dependency direction already accepted by the repository. The package client imports it locally and the root client imports the same source through the package boundary; only byte-equivalent pure helpers migrate in the first phase.

**Tech Stack:** TypeScript 6, Node.js 24, Node test runner through `tsx`, existing package boundary checks.

## Global Constraints

- The package must never import root `src` code.
- Root code may import the canonical package source through a relative path.
- Do not merge helpers whose current behavior differs.
- Do not move process lifecycle, callback registries, persistence, or public client state.
- Add no runtime dependency and preserve package exports.
- Use failing tests before production code.
- Do not bump version, tag, publish, or create a release.

---

### Task 1: Extract byte-equivalent normalization helpers

**Files:**
- Create: `packages/codex-native-api/src/codex_app_protocol.ts`
- Create: `packages/codex-native-api/test/codex_app_protocol.test.ts`
- Modify: `packages/codex-native-api/src/codex_app_client.ts`
- Modify: `src/providers/codex/app_client.ts`

**Interfaces:**
- Produces: `normalizeNullableString`, `normalizeStringList`,
  `normalizeOptionalBoolean`, `formatConfigKeyPath`, `normalizeFeatureList`,
  `normalizeProtocolTimestamp`, and `normalizeTurnStatusKey`.
- Consumes: no provider or client-owned type.

- [x] **Step 1: Add failing table-driven helper tests**

Assert trimming/null behavior, array filtering, strict booleans, quoted config
segments with slash/quote escaping, stable feature deduplication, seconds to
milliseconds conversion, and separator-insensitive turn status keys.

- [x] **Step 2: Verify the missing-module failure**

Run `npm run codex-native-api:test` and expect the protocol module import to
fail because the file does not exist.

- [x] **Step 3: Implement the pure protocol module**

Copy the existing behavior exactly. Functions accept `unknown` where existing
callers do, return new arrays, and have no environment or filesystem access.

- [x] **Step 4: Migrate both clients**

Import the canonical helpers, aliasing names only where needed to keep call
sites unchanged. Delete the corresponding local function bodies from both
clients. Leave `serializeCollaborationMode` local because package behavior
currently retains an unset model while root behavior omits it.

- [x] **Step 5: Run focused verification**

Run:

```powershell
npm run codex-native-api:test
npm run codex-native-api:typecheck
npm run codex-native-api:check-boundary
npm test -- test/providers/codex/app_client.test.ts
npm run typecheck
```

Expected: every command exits `0`.

- [x] **Step 6: Review and commit**

Run `git diff --check`, verify both clients import the same module, and commit
with `refactor: share Codex AppClient protocol helpers`.

### Task 2: Build a shared protocol parity fixture corpus

**Files:**
- Modify: `packages/codex-native-api/src/codex_app_protocol.ts`
- Modify: `packages/codex-native-api/test/codex_app_protocol.test.ts`
- Modify: both AppClient files only for helpers proven equivalent.

**Interfaces:**
- Produces: fixtures for turn status, feature/config normalization, and later
  notification identifier normalization.

- [x] **Step 1: Add parity fixtures for malformed and edge inputs**

Cover `null`, boxed values, whitespace-only strings, duplicate features,
sub-second/second/millisecond timestamps, and Unicode config segments.

- [x] **Step 2: Run tests and confirm any new case fails before changing code**

Use `npm run codex-native-api:test`; expected failures must identify a specific
normalization contract.

- [ ] **Step 3: Migrate only helpers with identical current results**

For any disagreement, document it in the test name and leave both local
implementations in place for a later behavioral decision.

- [x] **Step 4: Run the Task 1 verification matrix and commit**

Commit with `test: add AppClient protocol parity fixtures` after all commands
exit `0`.

### Task 3: Close the first AppClient phase

**Files:**
- Modify only if verification exposes a regression.

**Interfaces:**
- Produces: one canonical pure protocol core with both clients retaining
  independent runtime ownership.

- [ ] **Step 1: Run complete root verification**

Run `npm run verify:release` and expect exit `0`.

- [ ] **Step 2: Confirm duplication reduction**

Compare local function lists and verify no migrated helper declaration remains
in either AppClient.

- [ ] **Step 3: Commit any verification-only correction**

Use a focused commit and do not tag, publish, or modify version state.

