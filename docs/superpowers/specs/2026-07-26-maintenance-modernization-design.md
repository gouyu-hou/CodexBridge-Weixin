# Maintenance Modernization Design

Date: 2026-07-26
Status: Approved

## Purpose

CodexBridge is functionally mature, but several maintenance boundaries still
raise release risk: the bridge coordinator owns too many command families, two
Codex AppClient implementations can drift, Web server code is not checked in
strict mode, dependency upgrades are manual, Next.js traces the repository
root, and Electron ships unpacked source because its runtime boundary crosses
the application archive.

This program addresses those risks in small, independently releasable stages.
It preserves current user-visible behavior and keeps the existing release gate
green after every stage.

## Goals

- Reduce `bridge_coordinator.ts` by moving cohesive command families behind
  focused modules.
- Share pure Codex AppClient protocol behavior without coupling package-owned
  process state.
- Introduce strict TypeScript checking for new Web server modules before
  enabling it for the complete Web application.
- Automate conservative dependency update proposals and retain full CI gates.
- Replace broad Next.js repository tracing with an explicit shared workspace
  package.
- Put Electron runtime files that need direct filesystem access in
  `extraResources`, then enable ASAR for application code.

## Non-Goals

- A rewrite of the coordinator or either AppClient.
- Changing command syntax, translations, model behavior, or provider defaults.
- Enabling Web `strict` globally in one change.
- Automatically merging dependency updates.
- Adding Telegram or mobile application support.
- Bumping the product version or publishing a release as part of this work.

## Sequence

The stages run in dependency order:

1. Extract thread-command domain and orchestration from the coordinator.
2. Extract shared pure AppClient protocol helpers and migrate both clients.
3. Add a strict Web server type-check project and expand its file coverage.
4. Add Dependabot with one npm dependency update per pull request.
5. Create a Web runtime workspace package and narrow Next.js tracing.
6. Move directly accessed Electron runtime assets to `extraResources` and
   enable ASAR.

Each stage receives its own implementation plan, focused tests, review, commit,
and CI verification. A later stage must not begin from a failing earlier stage.

## Coordinator Boundary

The first extraction targets `/threads`, `/search`, and related archive,
restore, pin, unpin, confirmation, and natural-language thread operations.

`src/core/thread_command.ts` owns:

- thread command domain types
- normalized route decisions for `/threads` arguments
- pure candidate matching and operation-kind mapping
- eventually, thread command orchestration through a narrow host interface

`BridgeCoordinator` remains responsible for constructing the host adapter and
for cross-cutting runtime capabilities such as session access, provider calls,
translation, active-turn exclusion, and response metadata. Existing public
coordinator methods remain as delegating compatibility methods until all
callers and tests use the extracted service.

The first commit intentionally extracts pure behavior before stateful methods.
That establishes an import boundary with low behavioral risk and gives later
movement a stable home.

## AppClient Boundary

Create a package-owned shared protocol core containing only deterministic
functions and small immutable types:

- JSON-RPC message classification and identifier normalization
- notification and request parsing
- bounded stderr/stdout text handling
- protocol error normalization
- process argument helpers that are identical in both clients

The root and `packages/codex-native-api` clients keep their own process
lifecycle, callbacks, persistence, and public API. A helper migrates only after
parity tests prove both existing implementations produce the same result for a
shared fixture corpus. No package may import root `src` files.

## Web Strict-Type Boundary

Add `apps/web/tsconfig.server-strict.json` with `strict: true`,
`noEmit: true`, and an explicit include list for focused server modules and
their local declarations. Add a `web:typecheck:server-strict` script to the
root release gate. Expand the include list only after each newly included
module has no suppression that hides a real type error. Global Web `strict`
remains false until the migration list is complete.

## Dependency Automation

Use GitHub Dependabot for the root npm ecosystem, GitHub Actions, and any
workspace lockfile covered by the root package manager. npm updates use a
weekly schedule, group no packages, and limit open pull requests. This yields
one dependency update per pull request so CI and Electron package smoke tests
identify the failing upgrade precisely. Updates are proposals only and are
never auto-merged.

## Web Runtime Package

Create a workspace package that owns code currently imported by the Next.js
server from repository-level runtime modules. The package must expose an
explicit export map, compile independently, and pass a boundary test preventing
imports back into `apps/web` or arbitrary root `src` modules. Once Web imports
only the package, set `outputFileTracingRoot` to the Web/package boundary and
verify the standalone trace does not include unrelated repository files.

## Electron ASAR Boundary

Inventory every path resolved from `process.resourcesPath`, `__dirname`, the
repository root, and child Node processes. Application JavaScript and normal
dependencies belong in ASAR. Source, scripts, native executables, and runtime
files that the external Node process must read directly belong in a versioned
`extraResources/runtime-app` layout. The service launcher receives the runtime
root explicitly instead of inferring an unpacked application directory.

Enable `asar: true` only after packaged smoke tests prove service start, admin
page access, state API access, and clean shutdown from the installed layout.

## Compatibility Rules

- Existing command text and response metadata remain byte-for-byte compatible
  unless a test documents an intentional correction.
- Existing imports remain available during staged migration.
- No new runtime dependency is introduced for refactoring-only stages.
- Workspace packages may depend only in the direction documented by boundary
  tests.
- Windows packaged smoke testing remains mandatory for Electron changes.
- No credential, user state, prompt, or provider output enters fixtures or
  generated diagnostics.

## Acceptance Criteria

- Focused tests cover every moved pure function and delegation boundary.
- Both AppClients pass a shared protocol fixture suite.
- The release gate invokes the strict Web server type check.
- Dependabot configuration validates and proposes isolated updates.
- Next.js production build completes without whole-repository tracing.
- Electron builds with ASAR enabled and packaged smoke tests pass.
- `npm run verify:release`, Windows NSIS packaging, and packaged smoke testing
  pass before the final push.
- Product version remains `0.1.7` and no release/tag is created.

