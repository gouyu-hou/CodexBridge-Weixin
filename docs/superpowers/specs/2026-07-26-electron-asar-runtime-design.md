# Electron ASAR Runtime Boundary Design

## Goal

Enable Electron ASAR packaging while keeping the external Node.js service able
to execute CodexBridge TypeScript sources and load production dependencies.

## Chosen Architecture

The packaged application has three explicit roots:

- `appRoot`: Electron-owned files inside `app.asar`, including the main
  process, preload, icons, and lightweight-update security code.
- `builtInRuntimeRoot`: service-owned sources under
  `resources/runtime-app`; in development this is the repository root.
- `dependencyRoot`: unpacked production dependencies under
  `resources/app.asar.unpacked`; in development this is the repository root.

The active runtime root remains switchable between the built-in runtime and a
verified lightweight update. The service runner receives the built-in root and
dependency root explicitly, so no spawned external Node process needs to read
from `app.asar`.

## Packaging

Electron Builder uses `asar: true`. Electron-owned files remain in the ASAR.
The service source surface (`src`, runtime packages, service runner, package
metadata, and TypeScript configuration) is copied to
`extraResources/runtime-app`. Production `node_modules` are unpacked by
Electron Builder so native binaries and the bundled Node process can access
them as ordinary files. The existing bundled Node runtime remains at
`resources/runtime/node`.

## Runtime Flow

1. The Electron main process resolves all three roots from `app.isPackaged`,
   `app.getAppPath()`, and `process.resourcesPath`.
2. The service command executes the runner from the active runtime root.
3. The runner launches `src/cli.ts` from that root and resolves `tsx` from the
   active root first, then the explicit dependency root.
4. `NODE_PATH`, Codex binary discovery, lightweight dependency linking, and
   lightweight verification all use the dependency root.
5. Electron UI assets and preload continue to resolve from the app root.

## Failure Handling

Startup fails with a direct missing-runner error if `runtime-app` is incomplete.
Lightweight update verification or startup failures continue to roll back to
the built-in runtime. Packaged smoke testing must prove that the unpacked app
can start the local admin service and shut itself down cleanly.

## Verification

- Unit tests cover development and packaged root resolution.
- Structural tests enforce ASAR, runtime-app resources, and unpacked runtime
  dependencies.
- Service-runner tests enforce explicit dependency-root resolution.
- Full release verification, installer build, and packaged smoke testing run
  before push.

## Constraints

- Keep version `0.1.7`.
- Do not tag, publish, or create a GitHub release.
- Preserve lightweight update and rollback behavior.
- Preserve development-mode Electron startup.

