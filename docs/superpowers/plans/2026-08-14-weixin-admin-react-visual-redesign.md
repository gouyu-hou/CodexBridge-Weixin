# Weixin Admin React Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Weixin desktop admin browser with a polished React 19 interface matching the approved Codex++ visual direction while preserving every current route, API call, and Electron behavior.

**Architecture:** A Vite-built React application lives under `src/platforms/weixin/admin_app/` and emits deterministic `admin.js` and `admin.css` assets into the existing server and Electron packaging boundary. Typed API functions isolate the existing HTTP contract, feature pages own local operation state, and a shared shell owns routing, theme, service status, dialogs, and feedback. The legacy browser modules remain active until the final parity task, when `admin_page.ts` is reduced to a CSP-safe mount shell and the old modules are removed.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest, React Testing Library, jsdom, `lucide-react`, Node test runner, Electron CDP smoke tests.

## Global Constraints

- Change only the Weixin desktop admin UI; do not change backend API contracts or service behavior.
- Do not remove or redesign `apps/web`.
- Keep `#overview`, `#users`, `#runtime`, `#diagnostics`, `#metrics`, `#settings`, `#updates`, `#provider`, `#phone-guide`, `#sessions`, `#logs`, and `#backup` compatible.
- Emit deterministic self-contained assets at `assets/weixin-admin/admin.js` and `assets/weixin-admin/admin.css`; no CDN or runtime package loading.
- Follow the approved Codex++ light and dark token sets, use Lucide icons, and keep the support action visually secondary.
- Apply route transitions for 180 ms, make rapid navigation latest-wins, and disable motion for `prefers-reduced-motion`.
- Apply a valid persisted theme before the first React paint; invalid values fall back to the system preference.
- Preserve current request headers, polling, refresh, save, retry, pairing, restart, update, backup, shutdown, and confirmation behavior.
- Keep compatibility element identifiers required by packaged Electron smoke until smoke assertions have been migrated to semantic React-ready selectors.
- Every feature batch follows red-green-refactor and ends with focused tests plus a small commit.

## File Map

- `vite.admin.config.ts`: deterministic browser build configuration.
- `vitest.admin.config.ts`: isolated jsdom/component test configuration.
- `tsconfig.admin-app.json`: strict React application typecheck boundary.
- `src/platforms/weixin/admin_app/main.tsx`: theme bootstrap, React root, ready marker, and error capture.
- `src/platforms/weixin/admin_app/App.tsx`: providers, global status loading, route selection, and feature composition.
- `src/platforms/weixin/admin_app/types/admin.ts`: current API response and mutation payload contracts.
- `src/platforms/weixin/admin_app/api/adminApi.ts`: token-aware request client and endpoint methods.
- `src/platforms/weixin/admin_app/routes/adminRoutes.ts`: route parsing, metadata, grouping, and hash navigation.
- `src/platforms/weixin/admin_app/hooks/useAdminRoute.ts`: hash subscription and bounded page transitions.
- `src/platforms/weixin/admin_app/hooks/useTheme.ts`: system theme, persistence, and explicit theme changes.
- `src/platforms/weixin/admin_app/hooks/useAsyncResource.ts`: retained-data refresh state for feature pages.
- `src/platforms/weixin/admin_app/context/ToastContext.tsx`: non-blocking operation feedback.
- `src/platforms/weixin/admin_app/components/ui/`: buttons, fields, panels, badges, tables, feedback, progress, dialogs, and skeletons.
- `src/platforms/weixin/admin_app/layouts/AdminShell.tsx`: fixed desktop shell, responsive drawer, header actions, and support entry.
- `src/platforms/weixin/admin_app/pages/`: page modules grouped by existing route and API ownership.
- `src/platforms/weixin/admin_app/styles/`: tokens, reset, shell, components, and feature styles.
- `src/platforms/weixin/admin_app/test/`: jsdom setup, API fixtures, and render helpers.
- `src/platforms/weixin/admin_page.ts`: final minimal HTML/CSP shell.
- `scripts/weixin/build-admin-browser.mjs`: Vite wrapper and deterministic output checks.
- `scripts/release/smoke_packaged.mjs`: React-ready and semantic packaged UI smoke.
- `test/platforms/weixin/admin_page.test.ts`: HTML shell and asset boundary tests.
- `test/platforms/weixin/admin_browser_build.test.ts`: deterministic React asset build tests.

---

### Task 1: React Build And Test Boundary

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vite.admin.config.ts`
- Create: `vitest.admin.config.ts`
- Create: `tsconfig.admin-app.json`
- Create: `src/platforms/weixin/admin_app/main.tsx`
- Create: `src/platforms/weixin/admin_app/App.tsx`
- Create: `src/platforms/weixin/admin_app/test/setup.ts`
- Modify: `scripts/weixin/build-admin-browser.mjs`
- Modify: `test/platforms/weixin/admin_browser_build.test.ts`

**Interfaces:**
- Consumes: existing `/admin/admin.js` and `/admin/admin.css` asset URLs.
- Produces: `buildAdminBrowser(): Promise<{ js: string; css: string }>` and strict React scripts `weixin:admin:build`, `weixin:admin:typecheck`, and `weixin:admin:test`.

- [ ] **Step 1: Change the build test to require a Vite source entry and both deterministic assets**

```ts
test('Weixin admin React build deterministically reproduces committed assets', async () => {
  const { buildAdminBrowser } = await loadBuilder();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-admin-react-'));
  const generated = await buildAdminBrowser({ outputDir });
  assert.equal(generated.js, fs.readFileSync(path.join(process.cwd(), 'assets/weixin-admin/admin.js'), 'utf8'));
  assert.equal(generated.css, fs.readFileSync(path.join(process.cwd(), 'assets/weixin-admin/admin.css'), 'utf8'));
  assert.match(generated.js, /createRoot/u);
});
```

- [ ] **Step 2: Run the focused test and confirm the old concatenation builder fails the new contract**

Run: `npm test -- test/platforms/weixin/admin_browser_build.test.ts`

Expected: FAIL because `buildAdminBrowser` does not accept `outputDir` or return `{ js, css }`.

- [ ] **Step 3: Install the approved browser dependencies and define strict scripts**

Run: `npm install react@^19 react-dom@^19 lucide-react@^0.468 && npm install --save-dev vite@^7 @vitejs/plugin-react@^5 vitest@^3 jsdom@^26 @testing-library/react@^16 @testing-library/user-event@^14 @testing-library/jest-dom@^6 @types/react@^19 @types/react-dom@^19`

Add scripts:

```json
"weixin:admin:test": "vitest run --config vitest.admin.config.ts",
"weixin:admin:typecheck": "tsc -p tsconfig.admin-app.json --noEmit"
```

- [ ] **Step 4: Add the Vite, Vitest, and TypeScript boundaries and a minimal mountable React entry**

```tsx
// src/platforms/weixin/admin_app/main.tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/index.css';

const root = document.getElementById('admin-root');
if (!root) throw new Error('Missing Weixin admin root');
createRoot(root).render(<App />);
document.documentElement.dataset.adminReady = 'true';
```

Configure Rollup with `entryFileNames: 'admin.js'`, `assetFileNames: 'admin.css'`, no sourcemap, no code splitting, and `assets/weixin-admin` as the default output directory. Make `buildAdminBrowser({ outputDir })` invoke Vite programmatically and return normalized UTF-8 asset contents.

- [ ] **Step 5: Build twice and run focused tests and strict typecheck**

Run: `npm run weixin:admin:build`

Run: `npm run weixin:admin:build`

Run: `npm run weixin:admin:typecheck`

Run: `npm test -- test/platforms/weixin/admin_browser_build.test.ts`

Expected: both builds leave identical tracked assets; typecheck and focused tests PASS.

- [ ] **Step 6: Commit the build boundary**

```powershell
git add package.json package-lock.json vite.admin.config.ts vitest.admin.config.ts tsconfig.admin-app.json scripts/weixin/build-admin-browser.mjs src/platforms/weixin/admin_app test/platforms/weixin/admin_browser_build.test.ts assets/weixin-admin
git commit -m "build: add React Weixin admin pipeline"
```

### Task 2: Theme, Routing, And Application Shell

**Files:**
- Create: `src/platforms/weixin/admin_app/routes/adminRoutes.ts`
- Create: `src/platforms/weixin/admin_app/routes/adminRoutes.test.ts`
- Create: `src/platforms/weixin/admin_app/hooks/useAdminRoute.ts`
- Create: `src/platforms/weixin/admin_app/hooks/useTheme.ts`
- Create: `src/platforms/weixin/admin_app/hooks/useTheme.test.tsx`
- Create: `src/platforms/weixin/admin_app/layouts/AdminShell.tsx`
- Create: `src/platforms/weixin/admin_app/layouts/AdminShell.test.tsx`
- Modify: `src/platforms/weixin/admin_app/App.tsx`

**Interfaces:**
- Consumes: the twelve stable hash route identifiers and `localStorage['codexbridge-admin-theme']`.
- Produces: `parseAdminRoute(hash): AdminRouteId`, `useAdminRoute()`, `useTheme()`, and `AdminShell` slots for page content and page actions.

- [ ] **Step 1: Write failing route, theme, and shell tests**

```ts
expect(parseAdminRoute('#provider')).toBe('provider');
expect(parseAdminRoute('#unknown')).toBe('overview');
expect(screen.getByRole('navigation', { name: '管理页面' })).toBeVisible();
expect(document.documentElement.dataset.theme).toBe('dark');
```

Cover invalid stored themes, system fallback, explicit persistence, narrow drawer semantics, active route state, and the small sidebar support button.

- [ ] **Step 2: Run component tests and verify missing modules fail**

Run: `npm run weixin:admin:test -- src/platforms/weixin/admin_app/routes/adminRoutes.test.ts src/platforms/weixin/admin_app/hooks/useTheme.test.tsx src/platforms/weixin/admin_app/layouts/AdminShell.test.tsx`

Expected: FAIL with unresolved route, theme, and shell modules.

- [ ] **Step 3: Implement immutable route metadata and latest-wins hash navigation**

```ts
export type AdminRouteId = 'overview' | 'users' | 'runtime' | 'diagnostics' | 'metrics' | 'settings' | 'updates' | 'provider' | 'phone-guide' | 'sessions' | 'logs' | 'backup';
export function parseAdminRoute(hash: string): AdminRouteId {
  const value = hash.replace(/^#/, '');
  return ADMIN_ROUTE_IDS.includes(value as AdminRouteId) ? value as AdminRouteId : 'overview';
}
```

Use `document.startViewTransition` when available and an immediate active navigation state; cancel stale transition completion by comparing a monotonically increasing navigation sequence.

- [ ] **Step 4: Implement pre-paint-compatible theme state and the responsive shell**

Render grouped navigation with Lucide icons, a fixed 248 px desktop sidebar, an 88 px header, responsive drawer controls, theme and refresh icon buttons, page title/subtitle, a contextual primary action, and a compact outlined `支持项目` action at the bottom of the sidebar.

- [ ] **Step 5: Run tests and accessibility assertions**

Run: `npm run weixin:admin:test -- src/platforms/weixin/admin_app/routes src/platforms/weixin/admin_app/hooks src/platforms/weixin/admin_app/layouts`

Run: `npm run weixin:admin:typecheck`

Expected: PASS with accessible navigation, named icon buttons, and theme persistence.

- [ ] **Step 6: Commit the application shell**

```powershell
git add src/platforms/weixin/admin_app
git commit -m "feat: add React admin shell and routing"
```

### Task 3: Codex++ Tokens And Shared Components

**Files:**
- Create: `src/platforms/weixin/admin_app/styles/tokens.css`
- Create: `src/platforms/weixin/admin_app/styles/base.css`
- Create: `src/platforms/weixin/admin_app/styles/shell.css`
- Create: `src/platforms/weixin/admin_app/styles/components.css`
- Create: `src/platforms/weixin/admin_app/styles/index.css`
- Create: `src/platforms/weixin/admin_app/components/ui/Button.tsx`
- Create: `src/platforms/weixin/admin_app/components/ui/IconButton.tsx`
- Create: `src/platforms/weixin/admin_app/components/ui/Panel.tsx`
- Create: `src/platforms/weixin/admin_app/components/ui/StatusBadge.tsx`
- Create: `src/platforms/weixin/admin_app/components/ui/DataTable.tsx`
- Create: `src/platforms/weixin/admin_app/components/ui/Fields.tsx`
- Create: `src/platforms/weixin/admin_app/components/ui/Feedback.tsx`
- Create: `src/platforms/weixin/admin_app/components/ui/ProgressBar.tsx`
- Create: `src/platforms/weixin/admin_app/components/ui/Dialog.tsx`
- Create: `src/platforms/weixin/admin_app/components/ui/ui.test.tsx`

**Interfaces:**
- Consumes: semantic status values `success | warning | error | info | neutral` and standard React HTML attributes.
- Produces: typed visual primitives used by every page without feature-specific API logic.

- [ ] **Step 1: Write failing shared component interaction tests**

Test keyboard dialog close/focus restore, icon button accessible labels, busy button protection, status text plus icon, table empty/loading states, field errors, and progress `aria-valuenow`.

- [ ] **Step 2: Run the component test and confirm missing primitives fail**

Run: `npm run weixin:admin:test -- src/platforms/weixin/admin_app/components/ui/ui.test.tsx`

Expected: FAIL with missing component imports.

- [ ] **Step 3: Implement the typed primitives**

```tsx
export function Button({ busy = false, disabled, children, ...props }: ButtonProps) {
  return <button disabled={disabled || busy} aria-busy={busy || undefined} {...props}>{children}</button>;
}
```

Keep dialogs as top-level overlays, prevent card nesting, trap focus, close on Escape when allowed, and restore focus to the invoker.

- [ ] **Step 4: Implement independently designed light and dark tokens**

Define all approved colors as semantic custom properties. Use 8 px panel radii, 24 px panel padding, stable 52 px table rows, restrained shadows, visible two-pixel focus rings, 100-140 ms control transitions, and a 180 ms reduced-motion-aware route animation. Do not use gradients, decorative blobs, negative letter spacing, or viewport-scaled typography.

- [ ] **Step 5: Run component tests, typecheck, and build**

Run: `npm run weixin:admin:test -- src/platforms/weixin/admin_app/components/ui`

Run: `npm run weixin:admin:typecheck`

Run: `npm run weixin:admin:build`

Expected: PASS and deterministic CSS/JS assets.

- [ ] **Step 6: Commit the design system**

```powershell
git add src/platforms/weixin/admin_app assets/weixin-admin
git commit -m "feat: add Codex++ admin design system"
```

### Task 4: Typed API Client And Global Feedback

**Files:**
- Create: `src/platforms/weixin/admin_app/types/admin.ts`
- Create: `src/platforms/weixin/admin_app/api/adminApi.ts`
- Create: `src/platforms/weixin/admin_app/api/adminApi.test.ts`
- Create: `src/platforms/weixin/admin_app/hooks/useAsyncResource.ts`
- Create: `src/platforms/weixin/admin_app/hooks/useAsyncResource.test.tsx`
- Create: `src/platforms/weixin/admin_app/context/ToastContext.tsx`
- Create: `src/platforms/weixin/admin_app/components/AppErrorBoundary.tsx`
- Modify: `src/platforms/weixin/admin_app/App.tsx`

**Interfaces:**
- Consumes: token from `meta[name='codexbridge-admin-token']` and all existing `/api/*` responses.
- Produces: `createAdminApi(fetchFn, token)`, typed endpoint methods, retained-data resource state, toasts, global failure banner, and sanitized error rendering.

- [ ] **Step 1: Write request-contract tests against existing endpoint fixtures**

```ts
await api.restartBridge();
expect(fetchFn).toHaveBeenCalledWith('/api/bridge/restart', expect.objectContaining({
  method: 'POST',
  headers: expect.objectContaining({ 'x-codexbridge-admin-token': 'token' }),
}));
```

Cover GET, JSON POST/PATCH, DELETE, text/blob export, non-JSON errors, secret redaction, aborted requests, and local refresh retaining previous data.

- [ ] **Step 2: Run API and hook tests and verify missing client fails**

Run: `npm run weixin:admin:test -- src/platforms/weixin/admin_app/api src/platforms/weixin/admin_app/hooks/useAsyncResource.test.tsx`

Expected: FAIL with missing API and resource modules.

- [ ] **Step 3: Implement exact endpoint wrappers and response types**

Model response types from `admin_server.ts` and the legacy render functions. Centralize JSON parsing, HTTP status handling, admin token injection, and `content-type: application/json`; do not transform payload field names.

- [ ] **Step 4: Implement bounded feedback and an application error boundary**

Successful commands produce short toasts, page failures stay inside their panels, global state failure displays below the header, and unexpected rendering failures offer reload and diagnostics without exposing secrets or raw unbounded stderr.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm run weixin:admin:test -- src/platforms/weixin/admin_app/api src/platforms/weixin/admin_app/hooks src/platforms/weixin/admin_app/context`

Run: `npm run weixin:admin:typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the API boundary**

```powershell
git add src/platforms/weixin/admin_app
git commit -m "feat: add typed Weixin admin API client"
```

### Task 5: Overview, Runtime, Metrics, And Diagnostics

**Files:**
- Create: `src/platforms/weixin/admin_app/pages/overview/OverviewPage.tsx`
- Create: `src/platforms/weixin/admin_app/pages/overview/OverviewPage.test.tsx`
- Create: `src/platforms/weixin/admin_app/pages/runtime/RuntimePage.tsx`
- Create: `src/platforms/weixin/admin_app/pages/metrics/MetricsPage.tsx`
- Create: `src/platforms/weixin/admin_app/pages/diagnostics/DiagnosticsPage.tsx`
- Create: `src/platforms/weixin/admin_app/pages/operations.test.tsx`
- Create: `src/platforms/weixin/admin_app/styles/operations.css`
- Modify: `src/platforms/weixin/admin_app/App.tsx`

**Interfaces:**
- Consumes: `GET /api/state`, `GET /api/metrics`, bridge start/restart/stop, diagnostics run, metrics reset, delivery retry, alert test, heartbeat, close, and shutdown methods.
- Produces: the `overview`, `runtime`, `metrics`, and `diagnostics` route views plus global service commands.

- [ ] **Step 1: Write failing feature interaction tests**

Render state and metric fixtures; test retained refresh, diagnostics expansion, reset confirmation, delivery retry busy state, start/restart/stop commands, and service status badges. Assert compatibility IDs such as `service-state`, `metric-turns`, `status-updated`, and `refresh-btn` remain present.

- [ ] **Step 2: Run feature tests and verify routes still show placeholders**

Run: `npm run weixin:admin:test -- src/platforms/weixin/admin_app/pages/overview src/platforms/weixin/admin_app/pages/operations.test.tsx`

Expected: FAIL because operation pages are not implemented.

- [ ] **Step 3: Implement the four operational pages**

Use aligned description rows and restrained status panels. Preserve meaningful charts as CSS/SVG-free HTML progress and bar structures, keep error details expandable, and isolate command loading states to their initiating controls.

- [ ] **Step 4: Implement lifecycle requests**

Start periodic `/api/page/heartbeat` only after mount, send `/api/page/close` during controlled teardown, and leave service shutdown behind an explicit destructive confirmation dialog.

- [ ] **Step 5: Run feature tests, typecheck, and build**

Run: `npm run weixin:admin:test -- src/platforms/weixin/admin_app/pages/overview src/platforms/weixin/admin_app/pages/operations.test.tsx`

Run: `npm run weixin:admin:typecheck`

Run: `npm run weixin:admin:build`

Expected: PASS.

- [ ] **Step 6: Commit operational pages**

```powershell
git add src/platforms/weixin/admin_app assets/weixin-admin
git commit -m "feat: migrate admin operational pages to React"
```

### Task 6: Accounts, Pairing, And Permissions

**Files:**
- Create: `src/platforms/weixin/admin_app/pages/accounts/AccountsPage.tsx`
- Create: `src/platforms/weixin/admin_app/pages/accounts/AccountEditor.tsx`
- Create: `src/platforms/weixin/admin_app/pages/accounts/PairingDialog.tsx`
- Create: `src/platforms/weixin/admin_app/pages/accounts/AccountsPage.test.tsx`
- Create: `src/platforms/weixin/admin_app/styles/accounts.css`
- Modify: `src/platforms/weixin/admin_app/App.tsx`

**Interfaces:**
- Consumes: accounts list, account PATCH/DELETE, primary account, pairing current/start/cancel, and validated provider/model fields.
- Produces: the `users` route with account table, focused editor, QR pairing dialog, permission switches, and protected primary-account behavior.

- [ ] **Step 1: Write failing account workflow tests**

Test empty and populated tables, editor hydration, permission toggles, model selection, save payload, delete confirmation, primary account restrictions, pairing start/refresh/cancel, QR rendering, and polling cleanup.

- [ ] **Step 2: Run account tests and confirm the route is incomplete**

Run: `npm run weixin:admin:test -- src/platforms/weixin/admin_app/pages/accounts`

Expected: FAIL with missing account components.

- [ ] **Step 3: Implement the dense account table and focused editing flow**

Keep role and status as badges, actions as named icon buttons in a fixed-width right-aligned column, and edit permissions in a dialog or side panel. Do not place an editor card inside the account table panel.

- [ ] **Step 4: Implement pairing with bounded polling**

Open pairing on demand, retain the existing display-name payload, disable duplicate starts, render the returned QR safely, stop polling on success/cancel/unmount, and return focus to the pairing button when closed.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm run weixin:admin:test -- src/platforms/weixin/admin_app/pages/accounts`

Run: `npm run weixin:admin:typecheck`

Expected: PASS.

- [ ] **Step 6: Commit accounts and pairing**

```powershell
git add src/platforms/weixin/admin_app
git commit -m "feat: migrate account management to React"
```

### Task 7: Providers, Models, And Usage

**Files:**
- Create: `src/platforms/weixin/admin_app/pages/provider/ProviderPage.tsx`
- Create: `src/platforms/weixin/admin_app/pages/provider/ProviderEditor.tsx`
- Create: `src/platforms/weixin/admin_app/pages/provider/ProviderUsage.tsx`
- Create: `src/platforms/weixin/admin_app/pages/provider/ProviderPage.test.tsx`
- Create: `src/platforms/weixin/admin_app/styles/provider.css`
- Modify: `src/platforms/weixin/admin_app/App.tsx`

**Interfaces:**
- Consumes: provider profiles from state, `GET /api/provider-profiles/:id/models`, `GET /api/provider-profiles/:id/usage`, setup test/complete, settings save, and CCSwitch sync.
- Produces: the `provider` route with validated provider/model selection, profile usage, connection testing, and sync feedback.

- [ ] **Step 1: Write failing provider workflow tests**

Test model autoload when a profile changes, manual refresh, list-only selection, unsupported-usage state, usage refresh, provider save, setup connection test, and CCSwitch sync confirmation.

- [ ] **Step 2: Run provider tests and verify missing views fail**

Run: `npm run weixin:admin:test -- src/platforms/weixin/admin_app/pages/provider`

Expected: FAIL with missing provider components.

- [ ] **Step 3: Implement provider list, editor, and model catalog behavior**

Use a provider table as the primary surface, load models automatically and through a named refresh icon, reject values absent from the returned catalog, and keep secrets masked after save.

- [ ] **Step 4: Implement usage and connection feedback**

Display usage as status rows and progress bars, show unsupported usage as a neutral bounded state, keep old data during refresh, and surface connection failures inside the editor.

- [ ] **Step 5: Run tests, typecheck, and build**

Run: `npm run weixin:admin:test -- src/platforms/weixin/admin_app/pages/provider`

Run: `npm run weixin:admin:typecheck`

Run: `npm run weixin:admin:build`

Expected: PASS.

- [ ] **Step 6: Commit provider management**

```powershell
git add src/platforms/weixin/admin_app assets/weixin-admin
git commit -m "feat: migrate provider management to React"
```

### Task 8: Sessions, History, And Logs

**Files:**
- Create: `src/platforms/weixin/admin_app/pages/sessions/SessionsPage.tsx`
- Create: `src/platforms/weixin/admin_app/pages/sessions/SessionHistoryDialog.tsx`
- Create: `src/platforms/weixin/admin_app/pages/sessions/SessionsPage.test.tsx`
- Create: `src/platforms/weixin/admin_app/pages/logs/LogsPage.tsx`
- Create: `src/platforms/weixin/admin_app/pages/logs/LogsPage.test.tsx`
- Create: `src/platforms/weixin/admin_app/styles/sessions-logs.css`
- Modify: `src/platforms/weixin/admin_app/App.tsx`

**Interfaces:**
- Consumes: sessions list, session history, session PATCH/DELETE, logs list, and log cleanup.
- Produces: dense `sessions` and bounded monospace `logs` route views.

- [ ] **Step 1: Write failing session and log interaction tests**

Test session filtering, pagination, rename/save, history open/close, delete confirmation, log level/text filtering, refresh retaining logs, cleanup confirmation, and long-line containment.

- [ ] **Step 2: Run focused tests and verify missing pages fail**

Run: `npm run weixin:admin:test -- src/platforms/weixin/admin_app/pages/sessions src/platforms/weixin/admin_app/pages/logs`

Expected: FAIL with missing page modules.

- [ ] **Step 3: Implement session management and history dialog**

Keep stable row dimensions, truncate visual thread identifiers without truncating accessible names, use icon-only row actions, and render history in a focus-trapped dialog with loading, empty, and error states.

- [ ] **Step 4: Implement the bounded log viewer**

Use a stable-height monospace region, wrap or horizontally scroll long lines without resizing the shell, preserve current filters, and require confirmation before cleanup.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm run weixin:admin:test -- src/platforms/weixin/admin_app/pages/sessions src/platforms/weixin/admin_app/pages/logs`

Run: `npm run weixin:admin:typecheck`

Expected: PASS.

- [ ] **Step 6: Commit sessions and logs**

```powershell
git add src/platforms/weixin/admin_app
git commit -m "feat: migrate sessions and logs to React"
```

### Task 9: Settings, Updates, Backup, Guide, Setup, And Support

**Files:**
- Create: `src/platforms/weixin/admin_app/pages/settings/SettingsPage.tsx`
- Create: `src/platforms/weixin/admin_app/pages/settings/SettingsPage.test.tsx`
- Create: `src/platforms/weixin/admin_app/pages/updates/UpdatesPage.tsx`
- Create: `src/platforms/weixin/admin_app/pages/updates/UpdatesPage.test.tsx`
- Create: `src/platforms/weixin/admin_app/pages/backup/BackupPage.tsx`
- Create: `src/platforms/weixin/admin_app/pages/backup/BackupPage.test.tsx`
- Create: `src/platforms/weixin/admin_app/pages/guide/PhoneGuidePage.tsx`
- Create: `src/platforms/weixin/admin_app/components/SetupDialog.tsx`
- Create: `src/platforms/weixin/admin_app/components/SupportDialog.tsx`
- Create: `src/platforms/weixin/admin_app/components/dialog-workflows.test.tsx`
- Create: `src/platforms/weixin/admin_app/styles/maintenance.css`
- Modify: `src/platforms/weixin/admin_app/App.tsx`

**Interfaces:**
- Consumes: settings save, update state/actions/history, backup export/import, setup refresh/test/complete, alert test, and existing support image/content assets.
- Produces: remaining route views and global setup/support dialogs, completing user-facing parity.

- [ ] **Step 1: Write failing maintenance workflow tests**

Test settings dirty/save state, invalid numeric fields, update check/install/progress/history/rollback display, backup export/import confirmation, file rejection, phone-guide rendering, setup step navigation, and small support entry/dialog behavior.

- [ ] **Step 2: Run tests and verify remaining workflows fail**

Run: `npm run weixin:admin:test -- src/platforms/weixin/admin_app/pages/settings src/platforms/weixin/admin_app/pages/updates src/platforms/weixin/admin_app/pages/backup src/platforms/weixin/admin_app/components/dialog-workflows.test.tsx`

Expected: FAIL with missing feature modules.

- [ ] **Step 3: Implement settings, updates, and backup pages**

Use full-width unframed page composition with panel sections, keep save/progress state local, render update history in one hierarchy, use file APIs for backup, and isolate destructive import/rollback actions behind explicit target confirmation.

- [ ] **Step 4: Implement phone guide, setup, and support dialogs**

Keep the guide operational rather than promotional, preserve current setup requests and validation, and render support content in a focused dialog launched by the compact sidebar button.

- [ ] **Step 5: Run all React tests, typecheck, and build**

Run: `npm run weixin:admin:test`

Run: `npm run weixin:admin:typecheck`

Run: `npm run weixin:admin:build`

Expected: PASS with all twelve routes represented.

- [ ] **Step 6: Commit remaining pages**

```powershell
git add src/platforms/weixin/admin_app assets/weixin-admin
git commit -m "feat: complete React admin feature parity"
```

### Task 10: React Cutover And Legacy Removal

**Files:**
- Modify: `src/platforms/weixin/admin_page.ts`
- Modify: `test/platforms/weixin/admin_page.test.ts`
- Modify: `test/platforms/weixin/admin_browser_api.test.ts`
- Modify: `test/platforms/weixin/admin_browser_build.test.ts`
- Delete: `src/platforms/weixin/admin_browser/00_bootstrap.js`
- Delete: `src/platforms/weixin/admin_browser/10_api_client.js`
- Delete: `src/platforms/weixin/admin_browser/20_updates.js`
- Delete: `src/platforms/weixin/admin_browser/30_runtime_metrics.js`
- Delete: `src/platforms/weixin/admin_browser/40_sessions.js`
- Delete: `src/platforms/weixin/admin_browser/50_setup_runtime.js`
- Delete: `src/platforms/weixin/admin_browser/60_accounts.js`
- Delete: `src/platforms/weixin/admin_browser/70_provider.js`
- Delete: `src/platforms/weixin/admin_browser/80_logs_backup.js`
- Delete: `src/platforms/weixin/admin_browser/90_pairing_setup.js`
- Delete: `src/platforms/weixin/admin_browser/99_events.js`
- Delete: `src/platforms/weixin/admin_browser/browser_types.d.ts`

**Interfaces:**
- Consumes: completed React assets and CSP nonce/token values.
- Produces: a minimal server-rendered HTML shell and a React-only browser implementation.

- [ ] **Step 1: Replace legacy string assertions with shell and ready-marker assertions**

```ts
assert.match(html, /<div id="admin-root"><\/div>/u);
assert.match(html, /data-theme-bootstrap/u);
assert.match(html, /<script nonce="nonce-456" src="\/admin\/admin\.js\?v=\d+"><\/script>/u);
assert.doesNotMatch(html, /id="accounts-body"/u);
assert.match(adminScript, /adminReady/u);
```

Assert token and nonce values are HTML-attribute escaped, theme bootstrap accepts only `light`/`dark`, and no credential appears in generated assets.

- [ ] **Step 2: Run old shell/build tests and confirm they fail against the legacy page**

Run: `npm test -- test/platforms/weixin/admin_page.test.ts test/platforms/weixin/admin_browser_api.test.ts test/platforms/weixin/admin_browser_build.test.ts`

Expected: FAIL because `admin_page.ts` still embeds the old DOM and old JS source assertions remain.

- [ ] **Step 3: Reduce `admin_page.ts` to the CSP-safe React mount shell**

Emit metadata, icons, stylesheet, `#admin-root`, a nonce-authorized pre-paint theme bootstrap, and a nonce-authorized external module script. Escape `adminToken` and `cspNonce` before HTML insertion.

- [ ] **Step 4: Remove legacy modules and rewrite the browser boundary test for strict TSX**

Delete `admin_browser/*.js` and `browser_types.d.ts`. Assert `tsconfig.admin-app.json` has `strict: true`, DOM libraries, React JSX, no emit, and includes every `admin_app` TypeScript file.

- [ ] **Step 5: Run shell, React, type, build, and server tests**

Run: `npm run weixin:admin:build`

Run: `npm run weixin:admin:test`

Run: `npm run weixin:admin:typecheck`

Run: `npm test -- test/platforms/weixin/admin_page.test.ts test/platforms/weixin/admin_browser_api.test.ts test/platforms/weixin/admin_browser_build.test.ts test/platforms/weixin/admin_server.test.ts`

Expected: PASS with no legacy source directory dependency.

- [ ] **Step 6: Commit the React cutover**

```powershell
git add src/platforms/weixin/admin_page.ts src/platforms/weixin/admin_app scripts/weixin test/platforms/weixin assets/weixin-admin package.json tsconfig.admin-app.json
git add -u src/platforms/weixin/admin_browser
git commit -m "refactor: switch Weixin admin to React"
```

### Task 11: Packaged Smoke And Visual Verification

**Files:**
- Modify: `scripts/release/smoke_packaged.mjs`
- Modify: `test/scripts/electron_asar_runtime.test.ts`
- Create: `scripts/weixin/capture-admin-screenshots.mjs`
- Create: `test/platforms/weixin/admin_visual_contract.test.ts`
- Create: `docs/weixin-admin-ui.md`

**Interfaces:**
- Consumes: packaged Electron CDP endpoint and React `data-admin-ready="true"` marker.
- Produces: packaged navigation/interaction smoke, light/dark screenshots, and maintainable UI build documentation.

- [ ] **Step 1: Write failing smoke-contract tests for React readiness and semantic controls**

Require `document.documentElement.dataset.adminReady === 'true'`, no browser errors/unhandled rejections, all twelve routes, theme persistence, refresh, provider model selection, account controls, sessions, logs, settings, setup, and loaded `/admin/admin.css` and `/admin/admin.js` resources.

- [ ] **Step 2: Run smoke-contract tests and verify legacy ID polling fails**

Run: `npm test -- test/scripts/electron_asar_runtime.test.ts test/platforms/weixin/admin_visual_contract.test.ts`

Expected: FAIL until smoke waits for the React marker and verifies the new semantic UI.

- [ ] **Step 3: Update packaged CDP smoke and add screenshot capture**

Wait for React readiness, query controls by stable `data-testid` only where roles/names are insufficient, exercise route/theme/actions without changing backend expectations, capture browser console failures, and save PNGs for light and dark at 1920x1080, 1440x900, 1280x720, and 1024x768.

- [ ] **Step 4: Build the unpacked Electron application and run packaged smoke**

Run: `npm run weixin:electron:pack`

Run: `node scripts/release/smoke_packaged.mjs --app-dir release/win-unpacked`

Expected: PASS with the React-ready marker and zero browser errors.

- [ ] **Step 5: Inspect all eight screenshots and correct visual defects**

Verify sidebar/header geometry, page hierarchy, light/dark contrast, stable tables, Chinese text, icons, dialogs, scroll boundaries, and absence of overlap, clipping, blank panels, nested cards, gradients, or oversized support controls. Rebuild and recapture after each correction.

- [ ] **Step 6: Document development and verification commands**

Document `npm run weixin:admin:build`, `npm run weixin:admin:test`, `npm run weixin:admin:typecheck`, deterministic assets, route ownership, theme behavior, and packaged screenshot workflow in `docs/weixin-admin-ui.md`.

- [ ] **Step 7: Run the full release verification gate**

Run: `npm run verify:release`

Run: `git diff --check`

Expected: PASS with no generated asset drift.

- [ ] **Step 8: Commit verification and documentation**

```powershell
git add scripts/release/smoke_packaged.mjs scripts/weixin/capture-admin-screenshots.mjs test/scripts/electron_asar_runtime.test.ts test/platforms/weixin/admin_visual_contract.test.ts docs/weixin-admin-ui.md assets/weixin-admin
git commit -m "test: verify React Weixin admin UI"
```

## Self-Review

- Spec coverage: all twelve routes, shared service commands, theme behavior, transitions, responsive navigation, API preservation, setup/support dialogs, packaged Electron, and eight visual targets map to Tasks 1-11.
- Placeholder scan: implementation instructions contain no deferred work markers; each step names concrete behavior, files, commands, and expected outcomes.
- Type consistency: route IDs originate in `adminRoutes.ts`, endpoint types originate in `types/admin.ts`, all pages consume `createAdminApi`, and the packaged smoke consumes the `data-admin-ready` marker created in `main.tsx`.
- Migration safety: legacy browser modules are removed only in Task 10 after every route has React interaction coverage.
