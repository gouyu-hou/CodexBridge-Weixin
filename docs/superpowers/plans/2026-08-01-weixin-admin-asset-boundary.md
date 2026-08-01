# Weixin Admin Asset Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Weixin admin console's inline CSS and browser JavaScript into fixed same-origin assets without changing UI behavior, API contracts, security policy, or packaging.

**Architecture:** `renderAdminHtml()` remains the HTML shell and carries only per-server values. `WeixinAdminServer` serves two fixed files from `assets/weixin-admin/` with standard security headers and no-store caching. The extraction is mechanical; browser typing and feature modules remain later phases.

**Tech Stack:** TypeScript, Node.js HTTP server, browser CSS/JavaScript, Node test runner, Electron runtime staging.

## Global Constraints

- Keep rendered UI, visible text, element IDs, browser behavior, and API paths unchanged.
- Keep the admin token in the HTML meta element and out of static assets.
- Keep the external script nonce-authorized; do not add `unsafe-inline` to `script-src`.
- Serve only `/admin/admin.css` and `/admin/admin.js`; do not add a general static-file route.
- Add no runtime or development dependency in this phase.
- Keep development, source runtime, Electron packaging, and lightweight updates compatible.
- Perform CSS and JavaScript extraction mechanically before any cleanup or renaming.
- Use tests first for every boundary change.

---

### Task 1: Extract the admin stylesheet

**Files:**
- Create: `assets/weixin-admin/admin.css`
- Modify: `src/platforms/weixin/admin_page.ts`
- Modify: `src/platforms/weixin/admin_server.ts`
- Modify: `test/platforms/weixin/admin_page.test.ts`
- Modify: `test/platforms/weixin/admin_server.test.ts`

**Interfaces:**
- Produces: GET `/admin/admin.css` with `text/css; charset=utf-8` and `cache-control: no-store`.
- Produces: an HTML `<link rel="stylesheet" href="/admin/admin.css?...">`.
- Preserves: `renderAdminHtml(adminToken: string, cspNonce: string): string`.

- [ ] **Step 1: Add failing HTML and CSS artifact tests**

Update `test/platforms/weixin/admin_page.test.ts` to read the future asset and assert the HTML uses it:

```ts
const adminCssPath = path.join(process.cwd(), 'assets', 'weixin-admin', 'admin.css');

test('renderAdminHtml loads the extracted admin stylesheet', () => {
  const html = renderAdminHtml('admin-token-123', 'nonce-456');
  assert.match(html, /<link rel="stylesheet" href="\/admin\/admin\.css\?v=\d+" \/>/u);
  assert.doesNotMatch(html, /<style nonce=/u);

  const css = fs.readFileSync(adminCssPath, 'utf8');
  assert.match(css, /@media \(max-width: 860px\)/u);
  assert.match(css, /\.provider-usage-toolbar/u);
});
```

- [ ] **Step 2: Add a failing server asset response test**

Add to `test/platforms/weixin/admin_server.test.ts`:

```ts
test('WeixinAdminServer serves the fixed admin stylesheet with security headers', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const server = new WeixinAdminServer({ accountStore, stateDir, port: 0 });
  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/admin/admin.css`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await response.text(), /\.provider-usage-toolbar/u);
  } finally {
    await server.stop();
  }
});
```

- [ ] **Step 3: Verify the new tests fail for missing extraction**

Run:

```powershell
npm test -- test/platforms/weixin/admin_page.test.ts test/platforms/weixin/admin_server.test.ts
```

Expected: failures because the external stylesheet URL and asset route do not exist.

- [ ] **Step 4: Extract the CSS and add the fixed route**

Move the exact content between the current `<style nonce="${cspNonce}">` and
`</style>` tags into `assets/weixin-admin/admin.css`. Replace the block with:

```html
<link rel="stylesheet" href="/admin/admin.css?v=${faviconVersion}" />
```

Add the fixed route in `handleRequest`:

```ts
if (req.method === 'GET' && pathname === '/admin/admin.css') {
  this.writeAdminAsset(res, 'admin.css', 'text/css; charset=utf-8');
  return;
}
```

Add an option and fixed-file writer:

```ts
interface WeixinAdminServerOptions {
  adminAssetDir?: string;
}

private writeAdminAsset(
  res: ServerResponse,
  filename: 'admin.css' | 'admin.js',
  contentType: 'text/css; charset=utf-8' | 'text/javascript; charset=utf-8',
) {
  const filePath = path.join(this.adminAssetDir, filename);
  try {
    const body = fs.readFileSync(filePath);
    res.writeHead(200, {
      ...this.securityHeaders(),
      'content-type': contentType,
      'cache-control': 'no-store',
      'content-length': body.length,
    });
    res.end(body);
  } catch (error) {
    this.writeJson(res, isMissingFileError(error) ? 404 : 500, {
      error: isMissingFileError(error) ? 'admin asset not found' : 'admin asset unavailable',
    });
  }
}
```

Default `adminAssetDir` to
`path.resolve(process.cwd(), 'assets', 'weixin-admin')`. Add this narrow helper:

```ts
function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'ENOENT',
  );
}
```

Update the existing CSP authorization test to read the nonce from the external
script tag and compare it with `script-src`:

```ts
const scriptNonce = html.match(/<script nonce="([^"]+)" src="\/admin\/admin\.js/u)?.[1] ?? '';
const csp = pageResponse.headers.get('content-security-policy') ?? '';
assert.ok(scriptNonce);
assert.ok(csp.includes(`script-src 'nonce-${scriptNonce}'`));
```

- [ ] **Step 5: Run focused tests and type checking**

Run:

```powershell
npm test -- test/platforms/weixin/admin_page.test.ts test/platforms/weixin/admin_server.test.ts
npm run typecheck
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 6: Commit the stylesheet boundary**

```powershell
git add -- assets/weixin-admin/admin.css src/platforms/weixin/admin_page.ts src/platforms/weixin/admin_server.ts test/platforms/weixin/admin_page.test.ts test/platforms/weixin/admin_server.test.ts
git commit -m "refactor: extract weixin admin stylesheet"
```

### Task 2: Extract the admin browser program

**Files:**
- Create: `assets/weixin-admin/admin.js`
- Modify: `src/platforms/weixin/admin_page.ts`
- Modify: `src/platforms/weixin/admin_server.ts`
- Modify: `test/platforms/weixin/admin_page.test.ts`
- Modify: `test/platforms/weixin/admin_server.test.ts`

**Interfaces:**
- Consumes: `writeAdminAsset` and `adminAssetDir` from Task 1.
- Produces: GET `/admin/admin.js` with `text/javascript; charset=utf-8` and `cache-control: no-store`.
- Produces: a nonce-authorized external script tag.

- [ ] **Step 1: Add failing HTML and JavaScript artifact tests**

Update `test/platforms/weixin/admin_page.test.ts`:

```ts
const adminScriptPath = path.join(process.cwd(), 'assets', 'weixin-admin', 'admin.js');

test('renderAdminHtml loads the extracted nonce-authorized admin script', () => {
  const html = renderAdminHtml('admin-token-123', 'nonce-456');
  assert.match(
    html,
    /<script nonce="nonce-456" src="\/admin\/admin\.js\?v=\d+"><\/script>/u,
  );
  assert.doesNotMatch(html, /<script nonce="nonce-456">/u);

  const script = fs.readFileSync(adminScriptPath, 'utf8');
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /function loadProviderUsage/u);
  assert.match(script, /function sendShutdownRequest/u);
  assert.match(script, /\/api\/delivery-outbox\/retry/u);
  assert.doesNotMatch(script, /admin-token-123|nonce-456/u);
});
```

- [ ] **Step 2: Add a failing JavaScript route test**

Add this test using the same explicit setup as the stylesheet test:

```ts
test('WeixinAdminServer serves the fixed admin script with security headers', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const server = new WeixinAdminServer({ accountStore, stateDir, port: 0 });
  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/admin/admin.js`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await response.text(), /function loadProviderUsage/u);
  } finally {
    await server.stop();
  }
});
```

- [ ] **Step 3: Verify RED**

Run the two focused admin test files. Expected: failures because the script
asset and route do not exist.

- [ ] **Step 4: Extract the browser script mechanically**

Move the exact content between the main `<script nonce="${cspNonce}">` and
`</script>` tags to `assets/weixin-admin/admin.js`. Replace it with:

```html
<script nonce="${cspNonce}" src="/admin/admin.js?v=${faviconVersion}"></script>
```

Add the fixed GET route using:

```ts
this.writeAdminAsset(res, 'admin.js', 'text/javascript; charset=utf-8');
```

Do not rename functions, reformat the extracted script, change API paths, or
change initialization order.

- [ ] **Step 5: Verify GREEN and compatibility**

Run:

```powershell
npm test -- test/platforms/weixin/admin_page.test.ts test/platforms/weixin/admin_server.test.ts
npm run typecheck
npm run typecheck:js
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 6: Commit the browser program boundary**

```powershell
git add -- assets/weixin-admin/admin.js src/platforms/weixin/admin_page.ts src/platforms/weixin/admin_server.ts test/platforms/weixin/admin_page.test.ts test/platforms/weixin/admin_server.test.ts
git commit -m "refactor: extract weixin admin browser script"
```

### Task 3: Enforce packaged asset presence

**Files:**
- Modify: `scripts/release/smoke_packaged.mjs`
- Modify: `test/scripts/electron_asar_runtime.test.ts`

**Interfaces:**
- Consumes: the two `assets/weixin-admin` files from Tasks 1 and 2.
- Produces: packaged smoke preflight failure when either staged asset is absent.

- [ ] **Step 1: Add a failing packaged-boundary test**

Extend `packaged smoke preflight reports incomplete ASAR runtime boundaries`.
After creating all existing required files but before creating admin assets,
assert:

```ts
assert.throws(
  () => assertPackagedRuntimeBoundary(tempRoot),
  /weixin admin asset|admin\.css|admin\.js/u,
);
```

Then create:

```ts
path.join('runtime-app', 'assets', 'weixin-admin', 'admin.css')
path.join('runtime-app', 'assets', 'weixin-admin', 'admin.js')
```

and retain the final `doesNotThrow` assertion.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm test -- test/scripts/electron_asar_runtime.test.ts
```

Expected: the new missing-admin-asset assertion fails because the preflight
does not yet require those files.

- [ ] **Step 3: Add both assets to packaged preflight requirements**

In `assertPackagedRuntimeBoundary`, add the two exact runtime-app relative
paths and use an error label that identifies missing Weixin admin assets.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm test -- test/scripts/electron_asar_runtime.test.ts
npm run typecheck:js
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 5: Commit packaged enforcement**

```powershell
git add -- scripts/release/smoke_packaged.mjs test/scripts/electron_asar_runtime.test.ts
git commit -m "test: require packaged weixin admin assets"
```

### Task 4: Review and release verification

**Files:**
- Modify only when verification or review exposes a regression.

**Interfaces:**
- Consumes: all asset-boundary changes.
- Produces: a reviewed, release-gate-clean phase ready for browser typing.

- [ ] **Step 1: Run focused and root verification**

```powershell
npm test -- test/platforms/weixin/admin_page.test.ts test/platforms/weixin/admin_server.test.ts test/scripts/electron_asar_runtime.test.ts
npm run verify:release
npm audit --omit=dev --registry=https://registry.npmjs.org
git diff --check
```

Expected: every command exits `0`; audit reports zero production
vulnerabilities.

- [ ] **Step 2: Request independent code review**

Review the complete phase against the design, emphasizing CSP, token secrecy,
fixed-path routing, extraction fidelity, and packaged runtime behavior. Fix
every Critical or Important finding with a failing regression test first.

- [ ] **Step 3: Build and smoke-test the Windows package**

```powershell
npm run weixin:electron:dist
node scripts/release/smoke_packaged.mjs
```

Expected: installer build exits `0`; smoke output reports page and state HTTP
status `200` and both service stop flags `true`.

- [ ] **Step 4: Push and wait for CI**

Push `main` to `gouyu` with local Git proxy bypass, identify the workflow run
for the pushed commit, and wait for Ubuntu and Windows jobs to pass. Do not
bump the version, tag, publish, or create a GitHub Release.
