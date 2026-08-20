# Provider Configuration CCSwitch Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Provider configuration action that imports the current CCSwitch/Codex provider into CodexBridge and immediately activates it by restarting the Weixin bridge.

**Architecture:** Extend the existing manual CCSwitch sync endpoint so only explicit API-triggered synchronization activates the imported configuration. Add a React action that consumes the endpoint's returned Provider settings, updates the local draft immediately, and then refreshes shared admin state.

**Tech Stack:** TypeScript, Node.js HTTP server, React 19, Vitest, Testing Library, Vite.

## Global Constraints

- Reuse `POST /api/model-provider/sync-ccswitch`; do not add a new endpoint.
- Call synchronization with `{ persistSource: true }`.
- Explicit synchronization replaces unsaved form values and immediately activates the imported configuration.
- Automatic interval synchronization must not gain unconditional bridge restarts.
- Never expose the imported API key in browser state or error text.
- Keep the existing lower model-settings synchronization action.

---

### Task 1: Activate Manually Synchronized Provider

**Files:**
- Modify: `test/platforms/weixin/admin_server.test.ts`
- Modify: `src/platforms/weixin/admin_server.ts`

**Interfaces:**
- Consumes: `syncCcswitchProvider({ force: true, persistSource: true })` and `WeixinBridgeControl.restart()`.
- Produces: `handleSyncCcswitchProvider()` that persists, clears stale model overrides, restarts, and then serializes updated state.

- [ ] **Step 1: Write the failing server regression assertions**

Add a `restartCount` bridge-control fake and persisted session model override to the existing `syncs model provider settings from Codex/CCSwitch config` test, then assert:

```ts
assert.equal(restartCount, 1);
assert.equal(repositories.sessionSettings.getByBridgeSessionId('session-1')?.model, null);
assert.equal(
  repositories.sessionSettings.getByBridgeSessionId('session-1')?.metadata.modelOverrideClearedReason,
  'model-provider-updated',
);
```

- [ ] **Step 2: Run the server test and verify RED**

Run:

```powershell
npx tsx --test --test-name-pattern "syncs model provider settings from Codex/CCSwitch config" test/platforms/weixin/admin_server.test.ts
```

Expected: FAIL because manual synchronization does not call `restart()` and does not clear the session override.

- [ ] **Step 3: Implement manual activation**

After `syncCcswitchProvider()` succeeds and reports a change in `handleSyncCcswitchProvider`, run activation before building the response:

```ts
if (result.ok && result.changed) {
  this.clearSessionModelOverrides();
  await this.bridgeControl?.restart?.();
}
```

Keep `syncCcswitchProvider()` itself synchronous so startup and interval calls do not inherit restart behavior.

- [ ] **Step 4: Run the focused server test and verify GREEN**

Run the Step 2 command again. Expected: one matching test passes with zero failures.

- [ ] **Step 5: Commit the server activation**

```powershell
git add -- src/platforms/weixin/admin_server.ts test/platforms/weixin/admin_server.test.ts
git commit -m "fix: activate manually synced CCSwitch provider"
```

### Task 2: Add the Provider Configuration Sync Action

**Files:**
- Modify: `src/platforms/weixin/admin_app/pages/provider/ProviderPage.test.tsx`
- Modify: `src/platforms/weixin/admin_app/pages/provider/ProviderConfiguration.tsx`
- Modify: `src/platforms/weixin/admin_app/styles/provider.css`
- Regenerate: `assets/weixin-admin/admin.js`
- Regenerate: `assets/weixin-admin/admin.css`

**Interfaces:**
- Consumes: `AdminApi.syncCcswitch({ persistSource: true })` and response paths `state.settings.modelProvider` or `settings.modelProvider`.
- Produces: a `同步 CCSwitch` footer action with immediate draft reconciliation and sanitized error handling.

- [ ] **Step 1: Write failing React synchronization tests**

Add a success test that supplies a DeepSeek Provider in the mutation response and verifies:

```ts
await userEvent.click(screen.getByRole('button', { name: '同步 CCSwitch' }));
expect(api.syncCcswitch).toHaveBeenCalledWith({ persistSource: true });
expect(screen.getByLabelText('供应商预设')).toHaveValue('deepseek');
expect(screen.getByLabelText('供应商名称')).toHaveValue('DeepSeek');
expect(screen.getByLabelText('接口地址 Base URL')).toHaveValue('https://api.deepseek.com/v1');
expect(onChanged).toHaveBeenCalledOnce();
```

Add a failure test that rejects with `new Error('token=sync-secret')`, verifies the visible error contains `token=[redacted]`, and verifies an unsaved Provider name remains unchanged.

- [ ] **Step 2: Run the Provider test and verify RED**

Run:

```powershell
npx vitest run --config vitest.admin.config.ts src/platforms/weixin/admin_app/pages/provider/ProviderPage.test.tsx
```

Expected: FAIL because the Provider configuration footer has no `同步 CCSwitch` button.

- [ ] **Step 3: Implement the React action**

Import `useEffect` and `Shuffle`; add `syncing` state, a guarded response reader, and one reconciliation helper:

```ts
const applyProvider = (provider: ModelProviderSettings) => {
  setPresetKey(findProviderPreset(provider)?.key ?? CUSTOM_PROVIDER_PRESET);
  setDraft(draftFromCurrent(provider));
  const profileId = String(provider.profileId || '');
  if (profileId) onConfigured(profileId);
};
```

The action calls `api.syncCcswitch({ persistSource: true })`, applies returned Provider settings when present, calls `onChanged()`, sanitizes failures, and always clears its busy state. Add a secondary `同步 CCSwitch` button beside save; disable each mutation while the other is busy.

- [ ] **Step 4: Keep external state refreshes coherent**

Use an effect keyed by `current` to reconcile successful shared-state refreshes:

```ts
useEffect(() => {
  applyProvider(current);
}, [current]);
```

The API key field remains blank because `draftFromCurrent()` never imports key material.

- [ ] **Step 5: Run the Provider test and verify GREEN**

Run the Step 2 command again. Expected: all Provider tests pass.

- [ ] **Step 6: Regenerate and verify the complete admin app**

Run:

```powershell
npm run weixin:admin:build
npm run weixin:admin:test
npm run weixin:admin:typecheck
```

Expected: deterministic assets regenerate, all admin tests pass, and strict typecheck exits zero.

- [ ] **Step 7: Commit the React action and generated assets**

```powershell
git add -- assets/weixin-admin/admin.css assets/weixin-admin/admin.js src/platforms/weixin/admin_app/pages/provider/ProviderConfiguration.tsx src/platforms/weixin/admin_app/pages/provider/ProviderPage.test.tsx src/platforms/weixin/admin_app/styles/provider.css
git commit -m "feat: sync CCSwitch from provider configuration"
```

### Task 3: Full Verification

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: committed manual activation and React synchronization behavior.
- Produces: release-gate evidence for merge readiness.

- [ ] **Step 1: Run full release verification**

```powershell
npm run verify:release
```

Expected: exit code `0`, zero test failures, all production builds complete, and committed admin assets remain deterministic.

- [ ] **Step 2: Verify the final diff**

```powershell
git status --short --branch
git diff main...HEAD --check
git log --oneline main..HEAD
```

Expected: clean feature branch with the design, server activation, and React action commits only.
