# Low Risk Dependency Upgrades Design

## Goal

Upgrade the three approved dependencies independently and verify runtime and packaging compatibility after each change.

## Upgrade Sequence

1. Change Electron from `^41.10.5` to `^41.10.6`, update the lockfile, run the release gate, and build the Windows Electron distribution.
2. Change `@testing-library/user-event` from `^14.6.4` to `^14.6.6`, update the lockfile, and run admin UI tests plus the release gate.
3. Change `@openai/codex` from `^0.144.6` to `^0.149.0`, update the lockfile, and run AppClient, provider, Native API, bridge, and full release regressions.

Each upgrade receives its own commit. No dependency is upgraded transitively by manually changing unrelated manifest entries.

## Compatibility Rules

- Keep Node and npm engine requirements unchanged.
- Do not change Electron Builder configuration unless `41.10.6` requires a demonstrated compatibility fix.
- Do not adopt new Codex protocol features in the dependency-upgrade commit.
- Do not mix source refactors with dependency commits.
- Do not upgrade Electron 43, TypeScript 7, Vite 8, or `@openai/agents`.

## Failure Policy

If an upgrade causes a reproducible incompatibility that cannot be resolved with a narrowly scoped compatibility patch, revert that dependency commit and record the blocker. Successful earlier upgrades remain intact.

## Success Criteria

The manifest and lockfile resolve the exact approved versions, tests and builds pass, and the Windows distribution artifact is produced after the Electron upgrade.
