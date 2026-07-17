# Lightweight Update Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require signed, bounded, trusted-source lightweight update packages before downloaded code can be activated.

**Architecture:** Add a pure CommonJS security module for manifest signing, package verification, archive-path validation, and URL policy. Keep package construction in the existing builder and lifecycle/UI orchestration in the Electron main process. Missing trust disables only the optional lightweight channel.

**Tech Stack:** Node.js 24, CommonJS, `node:crypto`, `node:test`, PowerShell ZIP inspection on Windows, Electron.

## Global Constraints

- Use only Node standard-library cryptography; add no runtime dependency.
- Never commit, log, or persist the signing private key.
- Reject every schema-v1 or unsigned package.
- Allow only HTTPS GitHub download hosts and at most five redirects.
- Limit downloads to 64 MiB, archives to 5,000 entries, individual files to 64 MiB, and total package data to 256 MiB.
- Do not change normal NSIS/electron-updater behaviour.
- Do not commit, tag, push, or create a GitHub Release during implementation.

---

### Task 1: Pure Signed-Manifest Contract

**Files:**
- Create: `scripts/electron/lightweight-update-security.cjs`
- Create: `test/scripts/lightweight_update_security.test.ts`

**Interfaces:**
- Produce `createSignedLightweightManifest(options)`.
- Produce `verifyLightweightPackage(rootDir, publicKey, options?)`.
- Produce `assertTrustedLightweightUpdateUrl(value)`.
- Produce `assertSafeArchiveEntries(entries)`.
- Export fixed download/archive/package limits.

- [x] **Step 1: Write failing tests**

Cover ephemeral Ed25519 signing, deterministic payloads, tampered files,
unsigned manifests, unexpected files, unsafe archive paths, duplicate paths,
HTTP URLs, and non-GitHub hosts.

- [x] **Step 2: Verify RED**

Run: `node scripts/test.mjs test/scripts/lightweight_update_security.test.ts`

Expected: fail because the security module does not exist.

- [x] **Step 3: Implement the pure security module**

Normalize every manifest field, sort file entries, derive the public-key ID
from SPKI DER, sign/verify deterministic JSON with Ed25519, hash files with
SHA-256, reject symlinks and unexpected files, and enforce all global limits.

- [x] **Step 4: Verify GREEN**

Run: `node scripts/test.mjs test/scripts/lightweight_update_security.test.ts`

Expected: all security-contract tests pass.

### Task 2: Signed Lightweight Package Builder

**Files:**
- Modify: `scripts/electron/build-lightweight-update.cjs`
- Modify: `test/scripts/lightweight_update_security.test.ts`

**Interfaces:**
- Consume `CODEXBRIDGE_LIGHTWEIGHT_SIGNING_PRIVATE_KEY_FILE`.
- Write schema-v2 `codexbridge-lightweight.json` before ZIP creation.

- [x] **Step 1: Add failing builder-contract tests**

Assert the source requires the signing-key environment variable, calls
`createSignedLightweightManifest`, and never serializes a key into the manifest.

- [x] **Step 2: Verify RED**

Run: `node scripts/test.mjs test/scripts/lightweight_update_security.test.ts`

Expected: builder contract assertions fail.

- [x] **Step 3: Integrate signed manifest generation**

Read and validate the private key without logging its path or contents. Remove
any stale manifest before collecting files, write the signed manifest, then ZIP
the package. Fail closed when no key is configured.

- [x] **Step 4: Verify GREEN and syntax**

Run: `node scripts/test.mjs test/scripts/lightweight_update_security.test.ts`

Run: `node --check scripts/electron/build-lightweight-update.cjs`

Expected: tests and syntax checks pass.

### Task 3: Electron Download and Activation Enforcement

**Files:**
- Modify: `scripts/electron/weixin-admin-main.cjs`
- Modify: `test/scripts/lightweight_update_security.test.ts`

**Interfaces:**
- Resolve trusted public key from inline env, env file, or shipped asset.
- Validate Release asset and redirect URLs before requests.
- Enforce `LIGHTWEIGHT_MAX_DOWNLOAD_BYTES` while buffering.
- Validate ZIP entries before extraction.
- Verify package signature and complete file tree before activation.

- [x] **Step 1: Add failing integration-contract tests**

Assert source-level wiring for public-key resolution, URL validation, bounded
download, archive-entry validation, and package verification. Keep pure edge
cases in the security-module tests.

- [x] **Step 2: Verify RED**

Run: `node scripts/test.mjs test/scripts/lightweight_update_security.test.ts`

Expected: Electron wiring assertions fail.

- [x] **Step 3: Implement fail-closed updater wiring**

Return a user-visible full-installer fallback before network access when no
public key exists. Validate every redirect, abort oversized responses, inspect
ZIP entry names before extraction, reject unsigned/tampered packages, and keep
the existing activation rollback path.

- [x] **Step 4: Verify GREEN and syntax**

Run: `node scripts/test.mjs test/scripts/lightweight_update_security.test.ts`

Run: `node --check scripts/electron/weixin-admin-main.cjs`

Expected: tests and syntax checks pass.

### Task 4: Documentation and Release Gates

**Files:**
- Modify: `docs/RELEASE_PROCESS.md`
- Create: `assets/update/README.md`
- Modify: `tsconfig.checkjs.json`
- Modify: `test/scripts/release_verification.test.ts`
- Modify: `docs/superpowers/plans/2026-07-16-lightweight-update-security.md`

**Interfaces:**
- Document OpenSSL Ed25519 provisioning and environment variables.
- Include the pure security module in JavaScript type checking.
- Preserve normal release-gate and Windows package-smoke behaviour.

- [x] **Step 1: Add failing release-gate assertions**

Require JavaScript type checking to include the security module and require the
release documentation to state that private keys stay outside Git.

- [x] **Step 2: Implement documentation and typecheck integration**

Document key generation, public-key placement, private-key environment use,
unsigned-package rejection, and full-installer fallback. Do not generate a real
project signing key in this task.

- [x] **Step 3: Run focused verification**

Run: `node scripts/test.mjs test/scripts/lightweight_update_security.test.ts test/scripts/release_verification.test.ts`

Run: `npm run typecheck:js`

Expected: focused tests and JavaScript type checking pass.

- [x] **Step 4: Run complete verification**

Run: `npm run verify:release`

Run: `npm run weixin:electron:dist`

Run: `node scripts/release/smoke_packaged.mjs`

Expected: all commands exit `0` without publication.

- [x] **Step 5: Audit mutation boundaries**

Run: `git diff --check`, `git status --short --branch`,
`git diff --cached --name-only`, and `git tag --list v0.1.7`.

Expected: no staged files, no new Tag, no recovery state, and only reviewed
worktree changes.

## Self-Review

- Every security requirement maps to a task and automated check.
- Private-key provisioning and Authenticode remain explicit external steps.
- The standard installer update path is unchanged.
- Function names and limit constants are consistent across tasks.
