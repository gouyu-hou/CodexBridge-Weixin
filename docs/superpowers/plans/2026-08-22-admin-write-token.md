# Admin Write Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Weixin administration token mandatory for every state-changing HTTP request.

**Architecture:** Centralize the decision in `WeixinAdminServer.handleRequest` before route handlers run. Keep origin validation separate from credential validation and retain the query token only for the GET page-close beacon.

**Tech Stack:** Node.js `http`, TypeScript, node:test, existing admin React API.

## Global Constraints

- Do not change the token format or persistent state.
- Do not change the admin UI except where the existing GET close beacon must carry its token.
- Keep read-only GET, HEAD, and OPTIONS routes token-free.
- Preserve same-origin and cross-site request rejection.
- Keep error responses sanitized and stable: `{ error: 'missing or invalid admin token' }`.

---

### Task 1: Add Red Authorization Coverage

**Files:**
- Modify: `test/platforms/weixin/admin_server.test.ts`

**Interfaces:**
- Consumes: existing `WeixinAdminServer` HTTP routes and generated admin token.
- Produces: regression tests for token enforcement independent of browser headers.

- [ ] **Step 1: Add a no-browser-header mutation test**

Add a test that starts a server with a controllable bridge and account store,
fetches the HTML token, and asserts:

```ts
const withoutToken = await fetch(`${binding.url}/api/bridge/stop`, { method: 'POST' });
assert.equal(withoutToken.status, 403);
assert.deepEqual(await withoutToken.json(), { error: 'missing or invalid admin token' });

const withToken = await fetch(`${binding.url}/api/bridge/stop`, {
  method: 'POST',
  headers: { 'x-codexbridge-admin-token': token },
});
assert.equal(withToken.status, 200);
```

Use the existing account/session routes to cover PATCH and DELETE, and use
`GET /api/page/close?pageId=...&shutdownOnClose=1` without a token to assert
403, followed by the same URL with `adminToken=${encodeURIComponent(token)}` to
assert 200. The test must verify that only authorized requests trigger the
injected bridge/service callbacks.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- test/platforms/weixin/admin_server.test.ts
```

Expected: the new no-header mutation assertions fail because the current
server only requires tokens for selected routes/browser-shaped requests.

### Task 2: Centralize Mutation Authorization

**Files:**
- Modify: `src/platforms/weixin/admin_server.ts`
- Modify: `src/platforms/weixin/admin_app/api/adminApi.ts` only if GET close-beacon usage needs token propagation

**Interfaces:**
- Consumes: `hasValidAdminToken`, existing origin validation, and route pathname.
- Produces: `requiresAdminToken(req, pathname)` and one pre-dispatch token guard.

- [ ] **Step 1: Implement the centralized predicate**

Use a method with this behavior:

```ts
private requiresAdminToken(req: IncomingMessage, pathname: string): boolean {
  const method = String(req.method ?? '').toUpperCase();
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    || (method === 'GET' && pathname === '/api/page/close');
}
```

Call it once after browser-origin validation and before route matching. Remove
the old selected-POST `requiresExplicitAdminToken` branch and remove token
checking from the origin-only helper, leaving that helper responsible only for
origin and cross-site validation.

- [ ] **Step 2: Update the GET close-beacon caller if needed**

If the browser lifecycle client uses a GET close beacon, append the token using
the existing `appendQuery` helper. Keep normal POST lifecycle calls on the
header path. Do not put tokens into unrelated URLs.

- [ ] **Step 3: Run the focused test and verify GREEN**

Run:

```powershell
npm test -- test/platforms/weixin/admin_server.test.ts
```

Expected: all admin server tests pass, including no-header mutations, valid
token mutations, and existing browser security tests.

### Task 3: Verify And Review

**Files:**
- Verify only; no planned production edits.

- [ ] **Step 1: Run relevant checks**

```powershell
npm run weixin:admin:typecheck
npm run typecheck
npm run test -- test/platforms/weixin/admin_server.test.ts test/platforms/weixin/admin_browser_api.test.ts
git diff --check
```

- [ ] **Step 2: Request independent review**

Review the auth diff for bypasses, accidental protection of read routes, token
leaks, and callback execution before authorization.

- [ ] **Step 3: Commit**

```powershell
git add src/platforms/weixin/admin_server.ts src/platforms/weixin/admin_app/api/adminApi.ts test/platforms/weixin/admin_server.test.ts docs/superpowers/specs/2026-08-22-admin-write-token-design.md docs/superpowers/plans/2026-08-22-admin-write-token.md
git commit -m "fix: require admin token for write requests"
```
