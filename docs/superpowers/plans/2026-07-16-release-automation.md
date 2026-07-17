# Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guarded dry-run/publish command for the complete CodexBridge Weixin Windows release workflow.

**Architecture:** Keep parsing, validation, auditing, hashing, and release-plan construction in a side-effect-free module. Use a Node orchestrator for process execution and UTF-8 GitHub release creation, plus a separate packaged-smoke runner that can be executed and tested independently.

**Tech Stack:** Node.js 24 ESM, `node:test`, Git, npm, Electron Builder, GitHub CLI.

## Global Constraints

- Never push to `origin`; the only publication remote is `gouyu`.
- Never print or persist API keys, GitHub tokens, Git credential output, message content, account IDs, or local user paths.
- Exactly one of `--dry-run` and `--publish` is required.
- Release notes must reach GitHub through a UTF-8 file, not a shell text pipeline.
- Dry-run must not stage, commit, tag, push, or create/update a GitHub Release.
- Publish must stop before mutation whenever any preflight, gate, build, smoke, artifact, or audit check fails.
- Do not execute a real publish while implementing or testing this feature.

---

### Task 1: Pure release contracts

**Files:**
- Create: `scripts/release/release_contract.mjs`
- Create: `test/scripts/release_automation.test.ts`

**Interfaces:**
- Produces: `parseReleaseArgs(argv)`, `validateReleaseNotes(text)`, `findUnsafeReleasePaths(paths)`, `findSensitiveAdditions(diff)`, `artifactPaths(version)`, and `buildReleaseSteps(options)`.

- [x] **Step 1: Write failing tests**

Cover exact semver parsing, exclusive modes, default/custom notes files,
question-mark corruption, forbidden paths, high-confidence secrets, artifact
names, and proof that dry-run has no publication steps.

- [x] **Step 2: Verify RED**

Run: `node scripts/test.mjs test/scripts/release_automation.test.ts`

Expected: FAIL because `release_contract.mjs` does not exist.

- [x] **Step 3: Implement the pure contract**

Use only Node standard-library path handling and immutable return values. Error
messages must identify the invalid option/category without reproducing secret
content.

- [x] **Step 4: Verify GREEN**

Run: `node scripts/test.mjs test/scripts/release_automation.test.ts`

Expected: all contract tests pass.

### Task 2: Packaged smoke runner

**Files:**
- Create: `scripts/release/smoke_packaged.mjs`
- Modify: `test/scripts/release_automation.test.ts`

**Interfaces:**
- Consumes: versioned `release/win-unpacked/CodexBridge Weixin Admin.exe`.
- Produces: `runPackagedSmoke(options)` and a CLI that exits non-zero on timeout, missing HTTP surfaces, unclean shutdown, or unsafe temporary cleanup.

- [x] **Step 1: Add failing smoke-helper tests**

Test temporary path containment, loopback URL recognition, expected executable
path, and polling timeout behavior through injected functions.

- [x] **Step 2: Verify RED**

Run: `node scripts/test.mjs test/scripts/release_automation.test.ts`

Expected: FAIL because the smoke module is missing.

- [x] **Step 3: Implement isolated smoke execution**

Launch only the packaged executable, use placeholder provider configuration,
observe state/page HTTP 200, require self-shutdown, and target only the spawned
process tree on timeout.

- [x] **Step 4: Verify GREEN**

Run: `node scripts/test.mjs test/scripts/release_automation.test.ts`

Expected: smoke helper and contract tests pass without launching Electron.

### Task 3: Release orchestrator

**Files:**
- Create: `scripts/release/release.mjs`
- Modify: `test/scripts/release_automation.test.ts`

**Interfaces:**
- Consumes: the pure contract, npm scripts, Git, GitHub CLI, release notes, packaged smoke runner, and generated artifacts.
- Produces: `runRelease(options, dependencies)` and the `npm run release` CLI.

- [x] **Step 1: Add failing orchestration tests**

Inject a command recorder and assert command order, proxy-free `gouyu` pushes,
UTF-8 notes-file use, pre-publication stop behavior, and final verification.

- [x] **Step 2: Verify RED**

Run: `node scripts/test.mjs test/scripts/release_automation.test.ts`

Expected: FAIL because the orchestrator is missing.

- [x] **Step 3: Implement dry-run and publish flows**

Run preflight, version alignment, full gate, NSIS build, artifact validation,
packaged smoke, and source audit for both modes. Add stage/audit, commit, tag,
push, GitHub Release, digest/download verification, and clean-worktree checks
only for publish mode.

- [x] **Step 4: Verify GREEN**

Run: `node scripts/test.mjs test/scripts/release_automation.test.ts`

Expected: all orchestration tests pass without running real external commands.

### Task 4: Product integration and documentation

**Files:**
- Modify: `package.json`
- Modify: `docs/RELEASE_PROCESS.md`
- Create: `docs/releases/RELEASE_NOTES_TEMPLATE.md`
- Modify: `test/scripts/release_verification.test.ts`

**Interfaces:**
- Produces: `npm run release -- --version <version> --dry-run|--publish` and a reusable UTF-8 release-notes template.

- [x] **Step 1: Add failing package-script assertions**

Require `release` to invoke `node scripts/release/release.mjs` and require the
release gate to include the automation regression test through `npm test`.

- [x] **Step 2: Verify RED**

Run: `node scripts/test.mjs test/scripts/release_verification.test.ts`

Expected: FAIL because the package script does not exist.

- [x] **Step 3: Add npm command, template, and usage documentation**

Document exact dry-run/publish commands, notes path, mutation boundaries,
failure behavior, prerequisites, and the manual fallback process.

- [x] **Step 4: Verify focused integration**

Run: `node scripts/test.mjs test/scripts/release_automation.test.ts test/scripts/release_verification.test.ts`

Run: `node scripts/release/release.mjs --help`

Expected: tests pass and help exits zero without repository mutations.

### Task 5: Final verification and review

**Files:**
- Verify all files changed by Tasks 1-4.

**Interfaces:**
- Produces: reviewed, release-gated automation ready for the next version.

- [x] **Step 1: Run JavaScript type checking**

Run: `npm run typecheck:js`

Expected: exit 0.

- [x] **Step 2: Run the complete release gate**

Run: `npm run verify:release`

Expected: exit 0 without creating a commit, tag, push, or release.

- [x] **Step 3: Audit repository mutation**

Confirm no new tag, no remote changes, no staged files, and only reviewed source
and documentation changes in the worktree.

- [x] **Step 4: Review dangerous-operation boundaries**

Review dry-run non-mutation, command argument escaping, token secrecy, tag
cleanup before push, no-force behavior, UTF-8 notes, artifact digests, and
temporary process cleanup. Fix every accepted Critical or Important issue with
a failing test first. The final review additionally covers push URL parity,
Git push dry-run credentials, GraphQL release conflict handling, unresolved
recovery-state blocking, and a real temporary Git rollback test.

## Self-Review

- Spec coverage: every design section maps to Tasks 1-5.
- Placeholder scan: no deferred implementation steps remain.
- Type consistency: contract, smoke, and orchestrator interfaces use the same option names and mode values.
- Scope: changelog generation, release overwrite, force-push, live provider calls, and post-push rollback remain explicit non-goals.
