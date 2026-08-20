# Web Console Removal Design

## Context

CodexBridge has two desktop-facing surfaces: the Weixin Electron administration
console and a separate Next.js Web chat console under `apps/web`. The Web chat
console duplicates capabilities already available in Codex Desktop, adds a
second authentication and process-management surface, and expands CI and
release verification with an independent pnpm workspace.

The product decision is to keep the Weixin desktop administration console and
remove the Web chat console completely.

## Considered Approaches

1. Hide the Web navigation and keep the package. This has the lowest immediate
   code churn, but retains the maintenance, dependency, security, and release
   costs. It does not satisfy the removal decision.
2. Move the Web package to an archive directory. This preserves runnable code,
   but still leaves dependencies and ambiguous ownership in the active tree.
3. Delete the active Web product surface and retain historical documentation.
   This is the selected approach because it removes runtime and release costs
   while preserving the rationale and history in committed design documents.

## Scope

Delete the complete tracked `apps/web` tree, including its Next.js app, local
runtime workspace, lockfile, tests, and package documentation. Delete the three
root test files that exercise Web-only runtime behavior. Delete the obsolete
future Web UI todo document.

Remove all active Web package references from:

- root npm scripts and `verify:release`;
- GitHub Actions dependency installation;
- Dependabot package tracking;
- the current release-process guide; and
- release contract tests.

Historical release notes and completed design/implementation documents remain
unchanged. They describe past repository states and are not active product or
build instructions.

## Release Contract

The release verification test becomes the regression boundary for removal. It
must assert all of the following:

- `apps/web` does not exist;
- no root npm script name starts with `web:`;
- `verify:release` does not invoke `web:verify`;
- CI does not install dependencies under `apps/web`;
- Dependabot has no `/apps/web` entry; and
- the current release guide does not instruct maintainers to build Web.

These assertions replace the old contract that required Web type checking and
building.

## Runtime And Data

No migration is required. The Web package reads the same persisted bridge state
as the desktop runtime but does not own that state. Removing the package must
not delete or rewrite user data, provider profiles, sessions, CCSwitch state, or
the Weixin administration console assets.

The already running Weixin administration service on port `43183` is outside
this change and remains untouched.

## Verification

Use TDD for the release contract: first change the contract test and observe it
fail against the existing Web tree and scripts. Then remove the implementation
and active references until the focused contract test passes.

Final verification includes root JavaScript/TypeScript checks, the full root
test suite, all package boundary/typecheck/test/build checks, the root build,
and `git diff --check`. The resulting `verify:release` intentionally contains
no Web installation or build step.
