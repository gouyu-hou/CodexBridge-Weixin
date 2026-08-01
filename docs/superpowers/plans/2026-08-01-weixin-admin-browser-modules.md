# Weixin Admin Browser Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generated 3,100-line Weixin admin browser asset with maintainable, type-checked source modules while preserving one fixed runtime script and current UI behavior.

**Architecture:** Global classic-script fragments live in `src/platforms/weixin/admin_browser/` and are concatenated in an explicit order into the committed `assets/weixin-admin/admin.js`. A dedicated DOM-aware JavaScript typecheck and a packaged Chromium smoke protect source, runtime, and interaction boundaries without adding a bundler or more static routes.

**Tech Stack:** Node.js 24, JavaScript with JSDoc and TypeScript `checkJs`, Node test runner, Electron 41, Chromium DevTools Protocol.

## Global Constraints

- Preserve visible text, element IDs, API paths, initialization order, and current browser execution semantics.
- Continue serving only `/admin/admin.css` and `/admin/admin.js`.
- Keep the admin token in HTML meta and keep token/nonce values out of static sources and generated assets.
- Do not add a runtime or development dependency.
- Do not use native ESM or enable strict mode during the mechanical split.
- Keep the generated `assets/weixin-admin/admin.js` committed and reproducible.
- Do not bump version, tag, publish, or create a GitHub Release.

---

### Task 1: Establish the deterministic browser build boundary

**Files:**
- Create: `src/platforms/weixin/admin_browser/00_bootstrap.js`
- Create: `scripts/weixin/build-admin-browser.mjs`
- Create: `test/platforms/weixin/admin_browser_build.test.ts`
- Modify: `package.json`
- Modify: `assets/weixin-admin/admin.js`

**Interfaces:**
- Produces: `buildAdminBrowser({ outputPath?: string }): Promise<string>`.
- Produces: `ADMIN_BROWSER_SOURCES: readonly string[]` in exact concatenation order.
- Preserves: byte-equivalent browser program after LF normalization.

- [ ] **Step 1: Add failing generated-asset tests**

Import the future builder, write to a temporary output, and assert the result
equals the committed asset, parses with `new Function`, includes
`loadProviderUsage`, and excludes test token/nonce values. Also assert
`package.json` exposes `weixin:admin:build`.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- test/platforms/weixin/admin_browser_build.test.ts
```

Expected: fail because `scripts/weixin/build-admin-browser.mjs` is absent.

- [ ] **Step 3: Move the current script and implement the builder**

Move the current asset content mechanically to
`src/platforms/weixin/admin_browser/00_bootstrap.js`. Implement:

```js
export const ADMIN_BROWSER_SOURCES = Object.freeze(['00_bootstrap.js']);

export async function buildAdminBrowser({
  outputPath = path.resolve('assets', 'weixin-admin', 'admin.js'),
} = {}) {
  const parts = await Promise.all(ADMIN_BROWSER_SOURCES.map(async (filename) => {
    const sourcePath = path.join(sourceDir, filename);
    return normalizeSource(await fs.readFile(sourcePath, 'utf8'));
  }));
  const output = `${parts.join('\n')}\n`;
  const tempPath = `${outputPath}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(tempPath, output, 'utf8');
  await fs.rename(tempPath, outputPath);
  return output;
}
```

Add `"weixin:admin:build": "node scripts/weixin/build-admin-browser.mjs"`.

- [ ] **Step 4: Verify GREEN**

```powershell
npm run weixin:admin:build
npm test -- test/platforms/weixin/admin_browser_build.test.ts test/platforms/weixin/admin_page.test.ts
node --check assets/weixin-admin/admin.js
git diff --check
```

Expected: all commands exit `0`, and rebuilding does not change the asset.

- [ ] **Step 5: Commit**

```powershell
git add -- src/platforms/weixin/admin_browser/00_bootstrap.js scripts/weixin/build-admin-browser.mjs test/platforms/weixin/admin_browser_build.test.ts package.json assets/weixin-admin/admin.js
git commit -m "build: add weixin admin browser source boundary"
```

### Task 2: Split the browser program by page responsibility

**Files:**
- Create: `src/platforms/weixin/admin_browser/10_api_client.js`
- Create: `src/platforms/weixin/admin_browser/20_updates.js`
- Create: `src/platforms/weixin/admin_browser/30_runtime_metrics.js`
- Create: `src/platforms/weixin/admin_browser/40_sessions.js`
- Create: `src/platforms/weixin/admin_browser/50_setup_runtime.js`
- Create: `src/platforms/weixin/admin_browser/60_accounts.js`
- Create: `src/platforms/weixin/admin_browser/70_provider.js`
- Create: `src/platforms/weixin/admin_browser/80_logs_backup.js`
- Create: `src/platforms/weixin/admin_browser/90_pairing_setup.js`
- Create: `src/platforms/weixin/admin_browser/99_events.js`
- Modify: `src/platforms/weixin/admin_browser/00_bootstrap.js`
- Modify: `scripts/weixin/build-admin-browser.mjs`
- Modify: `test/platforms/weixin/admin_browser_build.test.ts`
- Modify: `assets/weixin-admin/admin.js`

**Interfaces:**
- Consumes: `ADMIN_BROWSER_SOURCES` and existing global browser contracts.
- Produces: eleven ordered source fragments behaviorally identical to the pre-split asset.

- [ ] **Step 1: Add a failing manifest and ownership test**

Assert the manifest equals the exact filename list above. Assert each page
module contains its anchor function (`requestJson`, `checkForUpdate`,
`loadMetrics`, `loadSessions`, `renderSetup`, `renderAccounts`,
`saveProviderSettings`, `importBackup`, `startPairing`) and `99_events.js`
contains `initThemeMode()` plus the final `loadState()` call.

- [ ] **Step 2: Verify RED**

Run the browser build test. Expected: fail because the manifest still contains
only `00_bootstrap.js`.

- [ ] **Step 3: Mechanically split at stable anchors**

Keep declarations and statements in original order:

```text
00_bootstrap.js       start .. before async function requestJson
10_api_client.js      requestJson .. before async function runSetupTest
20_updates.js         runSetupTest .. before async function loadState
30_runtime_metrics.js loadState .. before function renderSessionFilters
40_sessions.js        renderSessionFilters .. before function openDonateModal
50_setup_runtime.js   openDonateModal .. before function renderAccounts
60_accounts.js        renderAccounts .. before const CUSTOM_MODEL_OPTION
70_provider.js        CUSTOM_MODEL_OPTION .. before async function importBackup
80_logs_backup.js     importBackup .. before function renderPairing
90_pairing_setup.js   renderPairing .. before initThemeMode();
99_events.js          initThemeMode(); .. end of file
```

Do not rename, reindent, or reorder content. Update `ADMIN_BROWSER_SOURCES` in
the numeric order shown above and rebuild the asset.

- [ ] **Step 4: Verify behavior preservation**

```powershell
npm run weixin:admin:build
npm test -- test/platforms/weixin/admin_browser_build.test.ts test/platforms/weixin/admin_page.test.ts test/platforms/weixin/admin_server.test.ts
npm run typecheck
node --check assets/weixin-admin/admin.js
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add -- src/platforms/weixin/admin_browser scripts/weixin/build-admin-browser.mjs test/platforms/weixin/admin_browser_build.test.ts assets/weixin-admin/admin.js
git commit -m "refactor: split weixin admin browser modules"
```

### Task 3: Add browser type checking and type the API boundary

**Files:**
- Create: `tsconfig.admin-browser.json`
- Create: `src/platforms/weixin/admin_browser/browser_types.d.ts`
- Create: `test/platforms/weixin/admin_browser_api.test.ts`
- Modify: `src/platforms/weixin/admin_browser/00_bootstrap.js`
- Modify: `src/platforms/weixin/admin_browser/10_api_client.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run weixin:admin:typecheck`.
- Produces: JSDoc `AdminRequestOptions`, `AdminJson`, and typed `$()` lookup.

- [ ] **Step 1: Add failing typecheck boundary tests**

Assert the package script exists, the browser tsconfig includes DOM and every
source fragment, no fragment contains `@ts-nocheck`, and `requestJson` has an
explicit generic return annotation and response error handling.

- [ ] **Step 2: Verify RED**

Run the API test. Expected: fail because the dedicated typecheck is absent.

- [ ] **Step 3: Add the incremental DOM-aware configuration**

Create `tsconfig.admin-browser.json` with `allowJs`, `checkJs`, `noEmit`, target
ES2023, libraries `ES2023`, `DOM`, `DOM.Iterable`, `module: "None"`, empty
`types`, `strict: false`, and an explicit `files` list containing the declaration
file and all eleven fragments. Add:

```json
"weixin:admin:typecheck": "tsc -p tsconfig.admin-browser.json"
```

- [ ] **Step 4: Type shared DOM and request contracts**

Give `$()` a checked HTMLElement contract that throws for a missing required
control. Define JSON object and request option typedefs, then annotate:

```js
/**
 * @template {AdminJson} T
 * @param {string} url
 * @param {AdminRequestOptions} [options]
 * @returns {Promise<T>}
 */
async function requestJson(url, options = {}) { /* preserve existing body */ }
```

Use local casts for known input/select/button IDs. Do not add `@ts-ignore` or
`@ts-nocheck`.

- [ ] **Step 5: Verify GREEN and commit**

Run browser typecheck, browser/API/admin tests, browser build, and
`git diff --check`. Commit as `refactor: type weixin admin browser boundary`.

### Task 4: Integrate generation into release and Electron staging

**Files:**
- Modify: `package.json`
- Modify: `test/scripts/electron_asar_runtime.test.ts`

**Interfaces:**
- Consumes: `weixin:admin:build` and `weixin:admin:typecheck`.
- Produces: release and Electron builds that cannot package a stale script.

- [ ] **Step 1: Add failing script-chain assertions**

Assert `verify:release` runs browser build and typecheck before root tests, and
`weixin:electron:prepare-runtime` runs browser build before runtime staging.

- [ ] **Step 2: Verify RED**

Run the Electron runtime test. Expected: fail because scripts are not chained.

- [ ] **Step 3: Update package scripts**

Prefix `verify:release` with
`npm run weixin:admin:build && npm run weixin:admin:typecheck &&`. Set
`weixin:electron:prepare-runtime` to
`npm run weixin:admin:build && node scripts/electron/prepare-windows-runtime.cjs`.

- [ ] **Step 4: Verify GREEN and commit**

Run the Electron runtime test, browser typecheck, browser build, and diff check.
Commit as `build: verify weixin admin browser assets`.

### Task 5: Add packaged Chromium DOM interaction smoke

**Files:**
- Create: `scripts/release/chromium-cdp-client.mjs`
- Create: `test/scripts/chromium_cdp_client.test.ts`
- Modify: `scripts/release/smoke_packaged.mjs`
- Modify: `test/scripts/electron_asar_runtime.test.ts`

**Interfaces:**
- Produces: `connectCdp({ endpointUrl, timeoutMs })` with `evaluate()` and `close()`.
- Extends: packaged smoke result with `domStatus: 'ok'`.

- [ ] **Step 1: Add failing CDP and packaged-smoke tests**

Use a local fake WebSocket server to assert request IDs, result routing, error
propagation, and close behavior. Assert packaged smoke passes a reserved
loopback `--remote-debugging-port`, finds the admin target, evaluates DOM state,
and returns `domStatus: 'ok'`.

- [ ] **Step 2: Verify RED**

Run both script tests. Expected: fail because the CDP client and DOM smoke are absent.

- [ ] **Step 3: Implement the bounded CDP client**

Use Node 24's global `WebSocket`, monotonically increasing request IDs, a pending
map, per-command timeout, and rejection of pending requests on close. Bind the
DevTools endpoint only to `127.0.0.1`.

- [ ] **Step 4: Verify real DOM state without persistent mutations**

Launch with the reserved debugging port. Find the target whose URL equals the
admin loopback URL. Evaluate stylesheet/script presence, service-state text,
active panel, required control IDs, and captured page errors. Click the runtime
navigation link and the non-mutating refresh button. Reject missing controls,
loading-only state, page errors, or failed navigation.

- [ ] **Step 5: Verify GREEN and commit**

Run focused script tests, build the Windows installer, and run packaged smoke.
Expected output includes HTTP `200`, `domStatus: "ok"`, and both stop flags
`true`. Commit as `test: smoke weixin admin browser interactions`.

### Task 6: Final review and release verification

**Files:**
- Modify only if verification exposes a regression.

**Interfaces:**
- Produces: reviewed, release-clean admin browser module phase.

- [ ] **Step 1: Run complete verification**

```powershell
npm run verify:release
npm audit --omit=dev --registry=https://registry.npmjs.org
npm run weixin:electron:dist
node scripts/release/smoke_packaged.mjs
git diff --check
```

- [ ] **Step 2: Request independent review**

Review generated-source fidelity, type suppression use, static-route scope,
token secrecy, CDP loopback binding, smoke cleanup, and packaged behavior. Fix
every Critical or Important issue with a failing regression test first.

- [ ] **Step 3: Push and wait for CI**

Push `main` to `gouyu` with Git proxy bypass and wait for Ubuntu and Windows jobs.
Do not bump version, tag, publish, or create a GitHub Release.
