# Update History and Key Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auditable lightweight-update history and multi-key Ed25519 trust without breaking existing single-key installations.

**Architecture:** Keep manifest signing and package validation in `lightweight-update-security.cjs`, add a focused bounded history store, and let the Electron main process orchestrate key-ring resolution and history events. Verification chooses a key by the manifest key id; installation and rollback records are persisted under the existing state directory.

**Tech Stack:** Node.js CommonJS scripts, Ed25519 via `node:crypto`, JSON files with atomic rename, Node test runner through the repository test harness.

## Global Constraints

- Preserve schema-v2 lightweight manifests and legacy single-key environment variables.
- Never store or print private signing keys.
- Remote updates must remain fail-closed when no valid trusted public key exists.
- Do not commit, tag, push, publish, or alter unrelated user changes.

---

### Task 1: Add Trusted Key-Ring Verification

**Files:**
- Modify: `scripts/electron/lightweight-update-security.cjs`
- Test: `test/scripts/lightweight_update_security.test.ts`

- [ ] Add failing tests for verifying with a two-key ring, rejecting mismatched ids/private keys, and preserving single-key verification.
- [ ] Run `npm test -- test/scripts/lightweight_update_security.test.ts` and confirm the new key-ring test fails for the missing API.
- [ ] Add key-ring parsing and key-id matching while keeping `parseLightweightUpdatePublicKey` and single PEM inputs compatible.
- [ ] Run the focused security test and confirm all cases pass.

### Task 2: Add Atomic Bounded History Store

**Files:**
- Create: `scripts/electron/lightweight_update_history.cjs`
- Test: `test/scripts/lightweight_update_history.test.ts`

- [ ] Add failing tests for append/read, newest-record bounds, atomic temp cleanup, and corrupt-file quarantine.
- [ ] Run the focused history test and confirm the module is missing or behavior fails.
- [ ] Implement serialized append, sanitized bounded records, backup/corrupt quarantine, and deep-cloned reads.
- [ ] Run the focused history test and confirm all cases pass.

### Task 3: Integrate Key Ring and History Into Electron Updates

**Files:**
- Modify: `scripts/electron/weixin-admin-main.cjs`
- Modify: `assets/update/README.md`
- Modify: `docs/RELEASE_PROCESS.md`
- Modify: `test/scripts/lightweight_update_security.test.ts`
- Modify: `test/scripts/release_verification.test.ts`

- [ ] Add source-contract tests for plural key resolution, pre-network trust resolution, history path, and all four history actions.
- [ ] Run the focused source-contract tests and confirm they fail before integration.
- [ ] Resolve key rings from the new JSON environment/shipped file with legacy fallback.
- [ ] Record verification, installation, failure, and rollback outcomes and include the signing key id in installed metadata/status.
- [ ] Document rotation order: ship new public key, release full installer, then sign lightweight packages with the new private key; retain the old key until its packages age out.
- [ ] Run all update-security, release, typecheck, and diff checks.

### Task 4: Final Verification

**Files:**
- No additional source files.

- [ ] Run `npm run verify:release`.
- [ ] Run `npm run weixin:electron:dist`.
- [ ] Run `node scripts/release/smoke_packaged.mjs`.
- [ ] Run `git diff --check` and inspect `git status --short`.
