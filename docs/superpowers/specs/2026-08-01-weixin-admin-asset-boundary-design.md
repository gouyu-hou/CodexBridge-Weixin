# Weixin Admin Asset Boundary Design

## Purpose

Reduce the maintenance risk of `src/platforms/weixin/admin_page.ts` without
changing the Weixin admin console's appearance, behavior, API contract, or
packaging model. The first phase extracts the existing inline CSS and browser
JavaScript into explicit same-origin static assets. It does not redesign the
page or introduce a frontend framework.

This is deliberately a boundary-only phase. Strict browser typing and
feature-level client modules become safer follow-up work after the asset
boundary is stable.

## Current Problem

`admin_page.ts` currently owns about 6,600 lines of HTML, CSS, and browser
JavaScript in one template literal. The browser script alone starts around the
middle of the file and contains the account, provider, model, update, metrics,
session, log, pairing, setup, and service-control workflows.

The existing tests verify selected markup, responsive CSS fragments, and
JavaScript syntax. They cannot test or type-check the browser code as a
separate artifact, and small template-literal escaping mistakes can affect
unrelated parts of the page.

## Goals

- Keep the rendered UI and all visible text unchanged.
- Keep every existing admin API request and response unchanged.
- Keep the admin token in the HTML meta element and out of static assets.
- Extract the inline stylesheet into a same-origin CSS asset.
- Extract the inline browser program into a same-origin JavaScript asset.
- Preserve the current Content Security Policy or make it stricter.
- Preserve development, source-runtime, Electron packaged-runtime, and
  lightweight-update compatibility.
- Add direct tests for the HTML shell and both static asset responses.
- Make a later strict browser type-check phase possible without another page
  architecture change.

## Non-Goals

- No visual redesign or copy changes.
- No React, Next.js, Vite, or other admin-console framework migration.
- No new runtime dependency.
- No API route refactor in `admin_server.ts` during this phase.
- No attempt to split the browser program into feature modules yet.
- No broad CSP relaxation such as adding `unsafe-inline` to `script-src`.
- No change to page-close shutdown, pairing, updater, or bridge lifecycle
  semantics.

## Considered Approaches

### 1. Same-origin static assets (selected)

Store the extracted stylesheet and browser script under a dedicated
`assets/weixin-admin/` directory and serve them through fixed GET routes in
`WeixinAdminServer`.

Advantages:

- no build tool or runtime dependency;
- assets are already covered by the Electron runtime staging boundary;
- the browser receives ordinary CSS and JavaScript;
- the HTML renderer becomes substantially smaller;
- later JavaScript checking can target the extracted file directly.

Trade-off: the first phase improves ownership and testability but does not yet
make the entire browser script strictly typed.

### 2. Add a browser bundler now

Convert the client to TypeScript and bundle it with esbuild or Vite.

This gives the strongest module and type boundary immediately, but it adds a
new build product, development workflow, packaged-runtime input, and failure
mode at the same time as the extraction. That is too much change for a
behavior-preserving first phase.

### 3. Move the admin console into the Next.js Web application

This would unify frontend tooling but also couples the local Weixin service
console to the separate Web console deployment/runtime boundary. It expands
the blast radius and does not match the admin console's local service-control
ownership.

## Architecture

### HTML shell

`renderAdminHtml(adminToken, cspNonce)` remains the only HTML entry point. It
continues to render:

- the admin token meta element;
- the existing favicon and donation image references;
- all current HTML elements and element IDs;
- a stylesheet link to the fixed admin CSS route;
- a script tag pointing to the fixed admin JavaScript route.

The external script tag retains the per-server CSP nonce. The script reads the
admin token from the same meta element as before. Static assets never contain
the token or any per-request secret.

The HTML shell must not retain executable inline script or the extracted main
stylesheet. Existing element-level `style` attributes may remain because the
current CSP and markup already permit them; removing those attributes is a
separate visual cleanup.

### Static assets

Add two source-controlled files:

- `assets/weixin-admin/admin.css`
- `assets/weixin-admin/admin.js`

Their first committed contents are mechanical extractions of the current
inline blocks. No formatting rewrite, naming cleanup, or behavior refactor is
combined with extraction.

The asset URLs are fixed and accept an optional ignored cache-busting query
parameter. Responses use `cache-control: no-store`, so development and
packaged reloads do not retain stale client code.

### Server routes

`WeixinAdminServer` handles exactly two new GET routes before the API route
dispatch:

- `/admin/admin.css`
- `/admin/admin.js`

The routes resolve fixed files only. They do not accept a user-provided file
path and therefore cannot become a general static-file server.

Responses use the existing security header set plus these content types:

- `text/css; charset=utf-8`
- `text/javascript; charset=utf-8`

Missing or unreadable assets return a sanitized `404` or `500` response
without exposing local paths. The startup process does not silently generate
fallback assets because doing so could hide an incomplete packaged runtime.

### CSP and authorization

The current policy already permits same-origin styles and nonce-authorized
scripts. The HTML script element keeps the nonce, and no `unsafe-inline` script
source is added.

Static asset GET requests do not require the admin token. They contain no
secret and remain protected by loopback-only access, same-origin response
policy, and the server's standard security headers. All mutating API requests
continue to use the existing origin and token checks.

### Packaging

The Electron runtime staging process already copies `assets`, and Electron
Builder already includes that directory. The implementation must add
regression assertions proving both admin assets survive runtime staging rather
than relying only on that assumption.

The lightweight updater signs staged source/runtime files through its existing
manifest flow. The new assets follow the same signed package boundary and do
not need an update-specific exception.

## Data Flow

1. The browser requests `/`.
2. `WeixinAdminServer` renders the HTML shell with the admin token and nonce.
3. The browser loads `/admin/admin.css` and `/admin/admin.js` from the same
   loopback origin.
4. The extracted script reads the token meta element and initializes the same
   state, event handlers, timers, and API requests as before.
5. Existing API authorization and response handling remain unchanged.

## Error Handling

- Invalid methods on asset routes receive the existing not-found behavior.
- Missing assets produce sanitized responses with standard security headers.
- Browser request failures remain visible through the existing page behavior;
  no silent inline fallback is added.
- Packaging tests fail when either asset is absent from the staged runtime.

## Testing Strategy

Implementation follows test-driven extraction.

### HTML renderer tests

- assert the token meta element and favicon references remain present;
- assert the stylesheet URL is present;
- assert the external script URL and nonce are present;
- assert the old main inline style and script blocks are absent;
- keep the existing critical element-ID and responsive-layout assertions,
  reading CSS from the extracted asset where appropriate.

### Asset tests

- parse the extracted JavaScript with `new Function` before serving it;
- assert critical API paths and lifecycle functions remain in the script;
- assert critical responsive CSS rules remain in the stylesheet;
- verify the asset files contain no rendered admin token or nonce.

### Server tests

- GET both assets and assert `200`, content type, `no-store`, and security
  headers;
- assert unknown admin asset paths are not served;
- assert missing-asset failures are sanitized;
- keep all existing mutation authorization tests unchanged.

### Packaging and release verification

- add a runtime-staging assertion for both asset files;
- run focused admin page and admin server tests;
- run root type checks and the complete release gate;
- build the Windows installer and run the packaged smoke test.

## Migration Sequence

1. Add failing HTML-shell and static-route tests.
2. Extract CSS without changing its contents and serve it from the fixed route.
3. Extract JavaScript without changing its contents and serve it from the
   fixed route.
4. Update existing tests to inspect the appropriate artifact instead of the
   old combined HTML string.
5. Add staging/package boundary coverage.
6. Run focused, root, and packaged verification.

Each extraction is a separate reviewable commit or commit-sized checkpoint.
If JavaScript extraction exposes template-literal escaping differences, fix
only those differences required to preserve the browser program and cover them
with regression tests.

## Follow-Up Phases

After this boundary is shipped and stable:

1. add a dedicated browser JavaScript type-check configuration;
2. type the shared state, DOM lookup, and JSON request helpers first;
3. split provider/model, account, sessions, diagnostics, updates, and lifecycle
   behavior into bounded client modules;
4. add real browser interaction smoke coverage for the highest-value workflows.

Those phases require separate designs because they change the client module
and build model. They are intentionally not hidden inside this extraction.

## Acceptance Criteria

- The admin page looks and behaves the same in development and packaged mode.
- `admin_page.ts` no longer embeds the main stylesheet or browser program.
- The admin token and CSP nonce remain per-server values in the HTML only.
- The two fixed assets are served with correct content types, no-store caching,
  and the standard security headers.
- No general-purpose static file route is introduced.
- Existing admin APIs and authorization behavior are byte-compatible at their
  public boundaries.
- Runtime staging and Windows packaged smoke verification include the assets.
- Focused tests and `npm run verify:release` pass.
