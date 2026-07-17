# Release Resume and Windows CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe `--resume` release mode and make CI run the full release gate plus Windows Electron packaging and smoke testing.

**Architecture:** Put recovery schema validation and atomic persistence in a focused module. The directly executed `.mjs` module uses the same-directory temp-file/rename pattern instead of importing TypeScript source at runtime. Extend the release orchestrator with explicit publish/resume state transitions and conservative Draft reconciliation. CI remains validation-only and never mutates Git or GitHub Releases.

**Tech Stack:** Node.js 24 ESM, TypeScript, `node:test`, Git, GitHub CLI, GitHub Actions, Electron Builder.

## Global Constraints

- Exactly one of `--dry-run`, `--publish`, or `--resume` is required.
- Resume requires a schema-version-1 state under `.git/codexbridge-release-recovery.json`.
- Resume never stages, commits, creates a Tag, force-pushes, deletes public data, or uploads with `--clobber`.
- State contains only relative paths and public artifact metadata, never tokens or absolute local paths.
- Publish writes `push-pending` before atomic push and advances state only after successful remote phases.
- CI uses `npm ci`, packages only on Windows, and never publishes.
- Do not commit, tag, push, or create a GitHub Release during implementation.

---

### Task 1: Recovery State Contract

**Files:**
- Create: `scripts/release/release_recovery.mjs`
- Create: `test/scripts/release_recovery.test.ts`

**Interfaces:**
- Export `createRecoveryState`, `assertRecoveryState`, `readRecoveryState`, `writeRecoveryStateAtomically`, and `updateRecoveryState`.
- State fields are `schemaVersion`, `version`, `tag`, `branch`, `remote`, `commit`, `notesFile`, `phase`, `artifacts`, `latestYmlSha256`, `createdAt`, and `updatedAt`.
- Phases are `push-pending`, `refs-pushed`, `draft-created`, and `draft-verified`.

- [x] **Step 1: Write failing state tests**

```ts
test('rejects malformed recovery state', () => {
  assert.throws(() => assertRecoveryState({ ...validState(), commit: 'short' }, '0.1.7'), /commit/u);
  assert.throws(() => assertRecoveryState({ ...validState(), phase: 'published' }, '0.1.7'), /phase/u);
  assert.throws(() => assertRecoveryState({ ...validState(), notesFile: 'C:\\secret.md' }, '0.1.7'), /repository-relative/u);
});
```

- [x] **Step 2: Verify RED**

Run: `node scripts/test.mjs test/scripts/release_recovery.test.ts`

Expected: FAIL because the recovery module does not exist.

- [x] **Step 3: Implement validation and atomic persistence**

Validate exact semver, matching Tag, `main`, `gouyu`, relative notes, 40-character Commit SHA, exactly three unique assets, positive sizes, lowercase SHA-256 values, and ISO timestamps. Write through a same-directory temporary file, rename it over the state file, clean failed temporary writes, and apply owner-only permissions where supported.

- [x] **Step 4: Verify GREEN**

Run: `node scripts/test.mjs test/scripts/release_recovery.test.ts && npm run typecheck`

Expected: tests pass and typecheck exits `0`.

---

### Task 2: Resume CLI and Step Planning

**Files:**
- Modify: `scripts/release/release_contract.mjs`
- Modify: `scripts/release/release.mjs`
- Modify: `test/scripts/release_automation.test.ts`

**Interfaces:**
- `parseReleaseArgs` returns `mode: 'dry-run' | 'publish' | 'resume'`.
- Resume steps contain preflight/local/remote verification, Draft reconciliation, Draft verification, publication, final verification, and cleanup; they contain no stage/commit/tag/push step.
- `buildPublicationCommands` builds missing-asset upload arguments without `--clobber`.

- [x] **Step 1: Write failing parser and step tests**

```ts
assert.equal(parseReleaseArgs(['--version', '0.1.7', '--resume']).mode, 'resume');
assert.ok(!buildReleaseSteps({ mode: 'resume' }).some((step) => /stage|commit|tag|push/u.test(step)));
```

- [x] **Step 2: Verify RED**

Run: `node scripts/test.mjs test/scripts/release_automation.test.ts`

Expected: FAIL because resume parsing and planning are absent.

- [x] **Step 3: Implement parser, help, step plan, and upload command**

Keep help mutation-free, require exactly one mode, and build upload arguments only from validated paths.

- [x] **Step 4: Verify GREEN**

Run: `node scripts/test.mjs test/scripts/release_automation.test.ts`

Expected: focused tests pass.

---

### Task 3: Publish Recovery Transitions

**Files:**
- Modify: `scripts/release/release.mjs`
- Modify: `test/scripts/release_automation.test.ts`

**Interfaces:**
- Add `write-push-pending`, `mark-refs-pushed`, `mark-draft-created`, and `mark-draft-verified` around remote operations.
- Capture Commit and artifact manifest after local verification.
- Pre-push failure clears state and restores only this run's local commit/Tag; post-push failure retains state.

- [x] **Step 1: Write failing transition-order and failure tests**

Assert the sequence `write-push-pending -> push-refs-atomic -> mark-refs-pushed -> create-release-remote -> mark-draft-created -> verify-draft-remote -> mark-draft-verified` and assert post-push errors never call local reset.

- [x] **Step 2: Verify RED**

Run: `node scripts/test.mjs test/scripts/release_automation.test.ts`

Expected: FAIL because transition handlers are absent.

- [x] **Step 3: Implement safe state transitions**

Write state before push, advance only after successful commands, and preserve the last safe phase when remote operations fail.

- [x] **Step 4: Verify GREEN**

Run: `node scripts/test.mjs test/scripts/release_automation.test.ts && npm run typecheck:js`

Expected: tests and JS typecheck pass.

---

### Task 4: Resume and Draft Reconciliation

**Files:**
- Modify: `scripts/release/release.mjs`
- Modify: `scripts/release/release_recovery.mjs`
- Modify: `test/scripts/release_automation.test.ts`

**Interfaces:**
- Local verification checks clean worktree, Commit, Tag, notes, and artifact hashes.
- Remote verification requires both `main` and Tag at the recorded Commit.
- Draft reconciliation returns `created`, `reused`, or `already-public`.
- Existing assets require matching name, size, uploaded state, and digest; only missing assets are uploaded.

- [x] **Step 1: Write failing resume scenarios**

Cover missing-asset upload without clobber, mismatched-asset rejection before mutation, remote ref mismatch rejection, and an already-public matching Release.

- [x] **Step 2: Verify RED**

Run: `node scripts/test.mjs test/scripts/release_automation.test.ts`

Expected: FAIL because resume handlers are absent.

- [x] **Step 3: Implement conservative resume**

Inspect `tagName,isDraft,isPrerelease,body,assets`; create a Draft only when absent, upload only missing assets, reject mismatches, verify before publishing, verify final metadata, and clear state. Never silently rebuild changed/missing recorded assets.

- [x] **Step 4: Verify GREEN**

Run: `node scripts/test.mjs test/scripts/release_automation.test.ts`

Expected: all resume tests pass.

---

### Task 5: Windows CI Full Gate

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `test/scripts/release_verification.test.ts`

- [x] **Step 1: Write failing workflow assertions**

Assert UTF-8 workflow text includes `npm ci`, `npm run verify:release`, Windows-only `npm run weixin:electron:dist`, and `node scripts/release/smoke_packaged.mjs`; reject `--publish`, `git push`, and `gh release create`.

- [x] **Step 2: Verify RED**

Run: `node scripts/test.mjs test/scripts/release_verification.test.ts`

Expected: FAIL because current CI uses `npm install` and has no packaging/smoke step.

- [x] **Step 3: Update CI**

Use `npm ci`, run the complete gate on both platforms, add Windows-only packaging/smoke steps, and raise timeout to 45 minutes. Do not upload artifacts or mutate Releases.

- [x] **Step 4: Verify GREEN**

Run: `node scripts/test.mjs test/scripts/release_verification.test.ts`

Expected: workflow contract tests pass.

---

### Task 6: Documentation and Final Verification

**Files:**
- Modify: `docs/RELEASE_PROCESS.md`
- Modify: `docs/superpowers/plans/2026-07-16-release-resume-ci.md`

- [x] **Step 1: Document `--resume`, mismatch handling, and validation-only CI**

- [x] **Step 2: Run focused verification**

Run: `node scripts/test.mjs test/scripts/release_recovery.test.ts test/scripts/release_automation.test.ts test/scripts/release_verification.test.ts`

Expected: all focused tests pass.

- [x] **Step 3: Run complete verification**

Run: `npm run verify:release`

Expected: exit `0` without a Commit, Tag, push, or Release.

- [x] **Step 4: Audit mutation boundaries**

Run `git diff --check`, `git status --short --branch`, `git diff --cached --name-only`, `git tag --list v0.1.7`, and `git ls-remote gouyu refs/heads/main refs/tags/v0.1.7`.

Expected: no staged files, no new Tag, unchanged remote `main`, and only reviewed worktree changes.

## Self-Review

- Schema, transitions, reconciliation, CI, docs, and verification each have a task.
- No task permits force-push, clobbering, unattended publication, or secret persistence.
- Phase names and interfaces are consistent.
- Existing JSON, model-catalog, latency, and preview behavior remains unchanged.
