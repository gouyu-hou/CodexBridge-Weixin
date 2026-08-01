# Weixin Admin Browser Modules Design

## Goal

Turn the extracted Weixin admin browser program into maintainable, type-checked
source modules while continuing to serve one fixed `/admin/admin.js` asset with
the same browser semantics, CSP authorization, API paths, and packaged behavior.

## Selected Approach

Use dependency-free classic-script source fragments and a deterministic Node.js
concatenation build. The fragments remain global scripts, so function hoisting,
shared state, initialization order, non-module execution, and current DOM event
behavior stay unchanged. A dedicated browser `tsconfig` checks the fragments
with DOM libraries and `checkJs`; focused modules receive JSDoc types as they are
extracted.

This is preferred over introducing a bundler or native ESM in this phase. Both
alternatives create additional runtime changes at the same time as the physical
split. A future migration can add scoped ESM modules after the global contracts
have explicit types and browser coverage.

## Source And Build Boundary

Browser sources live under `src/platforms/weixin/admin_browser/`. An explicit
manifest controls concatenation order and produces
`assets/weixin-admin/admin.js`. The generated asset remains committed because
source runtime, lightweight updates, and Electron packaging already consume the
`assets` tree directly.

The build must be deterministic and atomic. It writes a temporary file beside
the destination, then renames it. Verification rebuilds the asset and relies on
`git diff --check` plus an up-to-date artifact test to catch drift. Electron
runtime staging invokes the browser build before copying runtime files.

## Module Boundaries

The first split preserves statement order and uses these responsibility groups:

- `bootstrap.js`: shared state, theme, page navigation, lifecycle, formatting,
  and initialization primitives.
- `api_client.js`: authenticated same-origin JSON requests and shared request
  error normalization.
- `updates.js`: Electron and lightweight updater state and commands.
- `runtime_metrics.js`: runtime state, metrics, usage, diagnostics, and charts.
- `sessions.js`: session filtering, rows, archive/delete, and history dialog.
- `accounts.js`: account rows, permissions, provider/model selectors, and model
  catalog cache.
- `provider.js`: provider presets, payload normalization, CCSwitch sync, and
  provider/settings saves.
- `logs_backup.js`: log rendering, cleanup/copy, import, and alert webhook.
- `pairing_setup.js`: pairing QR flow and first-run setup state.
- `events.js`: DOM listener registration, timers, and final startup calls.

Initial extraction is mechanical. Functions are not renamed and statements are
not reordered. Cross-module globals are documented as temporary contracts and
then narrowed incrementally, beginning with the API client and pure formatters.

## Type Checking

`tsconfig.admin-browser.json` uses `allowJs`, `checkJs`, `noEmit`, ES2023, and DOM
libraries without Node globals. The complete browser program starts with
incremental checking so the extraction remains behavior-preserving. The API
client and newly isolated pure helpers receive explicit JSDoc request, response,
and DOM types first. Suppressions must be local and explain the browser contract;
blanket `@ts-nocheck` is not allowed.

## Browser Smoke

The packaged smoke continues to validate HTML, state, CSS, and JavaScript over
HTTP. A second Chromium-level smoke launches the packaged Electron app with a
loopback DevTools endpoint, waits for the admin document, and verifies:

- the stylesheet and script loaded without console or uncaught page errors;
- the service status element leaves its loading state;
- page navigation changes the active panel;
- the refresh command can be clicked and settles without breaking the page;
- key Provider, account, session, update, log, and setup controls exist.

The smoke does not mutate persistent user state. It uses an isolated temporary
state directory and the same placeholder provider configuration as the existing
packaged smoke.

## Security And Error Handling

The server still exposes only `/admin/admin.css` and `/admin/admin.js`. Static
sources and generated assets must not contain an admin token or CSP nonce. The
external script remains nonce-authorized. Build errors fail before packaging;
missing fragments, duplicate manifest entries, or a generated syntax error are
fatal and leave the previous asset intact.

## Verification

Each extraction slice follows RED-GREEN-REFACTOR. Tests cover deterministic
generation, script syntax, token secrecy, fixed server routes, browser type
checking, packaged resource loading, and Chromium DOM interaction. The phase
finishes with root release verification, production audit, Windows installer
build, packaged HTTP smoke, and Chromium interaction smoke.

## Non-Goals

- No visual redesign or user-facing text changes.
- No API endpoint or response contract changes.
- No general static file server.
- No native ESM or bundler dependency in this phase.
- No release version bump, tag, GitHub Release, or publication.
