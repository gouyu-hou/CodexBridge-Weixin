# CodexBridge Weixin v0.1.6 Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the current worktree, add bounded outbox and provider-usage operations, create maintainable admin/usage boundaries, and publish v0.1.6 through the fixed release process.

**Architecture:** Keep the existing WeChat runtime and admin HTTP contracts. Add one shared provider-usage service, one sanitized outbox action, one page-renderer module, and test-only cross-package catalog protection. Treat packaging and publication as a gated final task.

**Tech Stack:** TypeScript 6, Node.js 25, `node:test`, Electron 41, electron-builder/NSIS, PowerShell, Git, GitHub CLI.

## Global Constraints

- Preserve all pre-existing user and Codex worktree changes.
- Do not restore paused package roadmaps or add unrelated features.
- Use tests before production behavior changes.
- Never expose outbox content, scope IDs, raw errors, provider identity fields, API keys, or tokens.
- Keep the admin page server-rendered with the current CSP nonce and admin-token model.
- Keep Gateway and Provider Relay as separate packages.
- Create one final release commit only, after complete verification and packaging.
- Push only to the `gouyu` remote.

---

### Task 1: Stabilize the baseline port-selection test

**Files:**
- Modify: `test/platforms/weixin/cli.test.ts`

**Interfaces:**
- Consumes: `resolveEmbeddedCodexNativeApiOptions()` scanning up to 50 ports.
- Produces: concurrency-safe assertions that validate the scan window instead of assuming the first candidate is free.

- [x] **Step 1: Reproduce the full-suite failure**

Run: `npm test`

Observed: one failure because an unrelated parallel test temporarily occupied `busyPort + 1`.

- [x] **Step 2: Confirm the focused test passes alone**

Run: `node scripts/test.mjs test/platforms/weixin/cli.test.ts`

Observed: 18/18 pass, proving the failure depends on cross-file port concurrency.

- [x] **Step 3: Correct both fixed-port assumptions**

Assert the selected port is within `[preferredPort, preferredPort + 49]`, and
for an intentionally busy preferred port assert the result is greater than the
busy port.

- [x] **Step 4: Stress the focused test concurrently**

Run four focused test processes in parallel.

Expected: all four processes report 18/18 pass.

### Task 2: Add release and model-catalog gates

**Files:**
- Modify: `package.json`
- Create: `test/packages/cliproxy_model_catalog_consistency.test.ts`
- Create: `test/scripts/release_verification.test.ts`
- Modify: `docs/RELEASE_PROCESS.md`

**Interfaces:**
- Produces: `npm run verify:release` and a structured catalog equality contract.

- [x] **Step 1: Add failing release-script coverage**

Read `package.json` and assert `scripts['verify:release']` includes root checks,
all four package typecheck/test/build scripts, root build, and
`git diff --check`.

- [x] **Step 2: Verify RED**

Run: `node scripts/test.mjs test/scripts/release_verification.test.ts`

Expected: FAIL because `verify:release` does not exist.

- [x] **Step 3: Add the canonical script**

Add a cross-platform npm script chaining the exact existing commands. Keep
individual scripts unchanged.

- [x] **Step 4: Add the catalog contract**

Import both exported `CLIPROXY_COMPAT_MODEL_CATALOG` values and compare their
structured data with `assert.deepEqual`.

- [x] **Step 5: Verify GREEN**

Run: `node scripts/test.mjs test/scripts/release_verification.test.ts test/packages/cliproxy_model_catalog_consistency.test.ts`

Expected: both tests pass.

### Task 3: Add sanitized outbox retry and backlog alerts

**Files:**
- Modify: `src/runtime/weixin_bridge_runtime.ts`
- Modify: `src/cli.ts`
- Modify: `src/platforms/weixin/admin_server.ts`
- Modify: `test/runtime/weixin_bridge_runtime.test.ts`
- Modify: `test/platforms/weixin/admin_server.test.ts`

**Interfaces:**
- Produces: `retryPendingDeliveries()` on bridge control and `POST /api/delivery-outbox/retry`.

- [x] **Step 1: Write failing runtime alert tests**

Inject thresholds of one pending entry and zero age. Assert one sanitized
`delivery_outbox_backlog` payload, fifteen-minute debounce, and no content,
scope, or raw error text.

- [x] **Step 2: Verify runtime RED**

Run: `node scripts/test.mjs test/runtime/weixin_bridge_runtime.test.ts`

Expected: the new alert assertions fail.

- [x] **Step 3: Implement aggregate alert policy**

Add threshold/age/min-interval options and invoke a best-effort alert check
after enqueue and after a flush leaves pending entries.

- [x] **Step 4: Write failing admin route tests**

Cover token authorization, unavailable control, stopped bridge, successful
before/after summary, failed send retention, and absence of private fields.

- [x] **Step 5: Verify admin RED**

Run: `node scripts/test.mjs test/platforms/weixin/admin_server.test.ts`

Expected: route requests return 404.

- [x] **Step 6: Implement control, route, and UI button**

Delegate to the existing runtime flush method. Return only aggregate summaries
and add a stable-size `立即补发` button near the delivery metric.

- [x] **Step 7: Verify GREEN**

Run: `node scripts/test.mjs test/runtime/weixin_bridge_runtime.test.ts test/platforms/weixin/admin_server.test.ts`

Expected: all focused tests pass.

### Task 4: Extract the admin page renderer

**Files:**
- Create: `src/platforms/weixin/admin_page.ts`
- Modify: `src/platforms/weixin/admin_server.ts`
- Modify: `test/platforms/weixin/admin_server.test.ts`

**Interfaces:**
- Produces: exported `renderAdminHtml(adminToken: string, cspNonce: string): string`.

- [x] **Step 1: Add a failing module-boundary test**

Import `renderAdminHtml` from `admin_page.ts` and assert token metadata, CSP
nonce attributes, favicon URLs, and valid inline browser scripts.

- [x] **Step 2: Verify RED**

Run: `node scripts/test.mjs test/platforms/weixin/admin_server.test.ts`

Expected: FAIL because the module does not exist.

- [x] **Step 3: Move the renderer mechanically**

Move the existing function from its declaration to end-of-file without editing
its body. Export it from `admin_page.ts` and import it in `admin_server.ts`.

- [x] **Step 4: Verify behavior and type boundaries**

Run: `node scripts/test.mjs test/platforms/weixin/admin_server.test.ts`

Run: `npm run typecheck`

Expected: admin tests and typecheck pass.

### Task 5: Add shared provider usage service and admin panel

**Files:**
- Create: `src/core/provider_usage_service.ts`
- Create: `test/core/provider_usage_service.test.ts`
- Modify: `src/core/bridge_coordinator.ts`
- Modify: `src/runtime/bootstrap.ts`
- Modify: `src/cli.ts`
- Modify: `src/platforms/weixin/admin_server.ts`
- Modify: `src/platforms/weixin/admin_page.ts`
- Modify: `test/core/bridge_coordinator.test.ts`
- Modify: `test/platforms/weixin/admin_server.test.ts`

**Interfaces:**
- Produces: `ProviderUsageCatalog.getUsage()` and `invalidate()` plus cached GET and forced-refresh POST admin routes.

- [x] **Step 1: Write service tests first**

Cover profile lookup, unsupported provider, normalization, cache TTL, force
refresh, in-flight deduplication, timeout, invalidation, and deep clones.

- [x] **Step 2: Verify service RED**

Run: `node scripts/test.mjs test/core/provider_usage_service.test.ts`

Expected: FAIL because the service module does not exist.

- [x] **Step 3: Implement the minimal service**

Use a sixty-second cache, fifteen-second timeout, profile-version cache
identity, normalized bounded data, and sanitized failures.

- [x] **Step 4: Delegate Coordinator usage resolution**

Inject the service from bootstrap. Use forced refresh in existing chat paths so
`/usage` and `/status` retain current behavior and formatting.

- [x] **Step 5: Write admin API/privacy tests**

Cover cache/refresh calls, authorization, unknown profiles, generic failures,
unsupported providers, and complete omission of `email`, `accountId`, and
`userId`.

- [x] **Step 6: Implement endpoints and page controls**

Add a profile selector, automatic load, manual refresh, normalized usage
windows, unavailable state, and fixed-size controls. Do not add account identity
to browser state.

- [x] **Step 7: Verify GREEN**

Run: `node scripts/test.mjs test/core/provider_usage_service.test.ts test/core/bridge_coordinator.test.ts test/platforms/weixin/admin_server.test.ts`

Expected: all focused tests pass.

### Task 6: Documentation, review, and release

**Files:**
- Modify: `README.md`
- Modify: `docs/RELEASE_PROCESS.md`
- Modify: relevant usage documentation
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] **Step 1: Update user and release documentation**

Document outbox retry, usage visibility, privacy limits, and the canonical
release gate. Do not include local paths, tokens, account IDs, or raw logs.

- [x] **Step 2: Request independent code review**

Review authorization, privacy, cache races, alert debounce, CSP preservation,
test isolation, and unrelated-diff preservation. Fix every accepted Critical or
Important finding with a failing regression test first.

- [x] **Step 3: Perform release preflight and version bump**

Confirm `main`, inspect remotes/status/diff, scan sensitive files, stop running
CodexBridge services, then run:

```powershell
npm version patch --no-git-tag-version
```

Expected version: `0.1.6`.

- [x] **Step 4: Run the complete release gate**

Run: `npm run verify:release`

Expected: every stage exits 0.

- [x] **Step 5: Build and verify artifacts**

Run: `npm run weixin:electron:dist`

Verify:

```text
release/CodexBridge-Weixin-Admin-Setup-0.1.6.exe
release/CodexBridge-Weixin-Admin-Setup-0.1.6.exe.blockmap
release/latest.yml
```

- [x] **Step 6: Smoke-test the packaged application**

Launch the packaged/installed application with an isolated temporary state
directory, verify the admin page and state endpoint, then stop it cleanly.

Observed: the packaged app returned HTTP 200 for both surfaces and its built-in
smoke lifecycle stopped the service, released the port, and removed temporary
state without leaving child processes.

- [x] **Step 7: Stage and inspect release content**

Run `git add -A`, inspect `git status --short`, staged diff/stat, and sensitive
patterns. Unstage and remove any generated or private data before continuing.

- [ ] **Step 8: Commit, tag, and push**

```powershell
git commit -m "release: v0.1.6"
git tag v0.1.6
git push gouyu main
git push gouyu v0.1.6
```

- [ ] **Step 9: Create GitHub release**

Create `v0.1.6` with reviewed release notes and upload the installer, blockmap,
and `latest.yml`.

- [ ] **Step 10: Post-release verification**

Verify remote `main`, tag commit, release assets, `latest.yml` version/hash,
installer availability, and a clean local worktree.

## Self-Review

- Spec coverage: every design section maps to a task and final release gate.
- Placeholder scan: no TBD, TODO, or unspecified implementation steps remain.
- Type consistency: outbox and usage interfaces match their server, runtime,
  bootstrap, and test consumers.
- Scope: each implementation task is independently testable and the only
  cross-task dependency is the deliberate admin-page extraction before usage UI
  edits.
