# Web Console Release Gate

## Goal

Make the existing Next.js Web console a required CI and release-gate surface,
and make its README describe the functionality that is already implemented.

## Design

The Web app retains its independent `apps/web/pnpm-lock.yaml`. CI installs it
with pnpm 11.9.0 and a frozen lockfile before invoking the root release gate.
The root package exposes `web:typecheck` and `web:verify`; `verify:release`
calls `web:verify`, so local releases and both CI operating systems enforce the
same TypeScript and Next.js production-build gate.

pnpm 11 requires explicit non-interactive build approval for `sharp`. The Web
workspace records `allowBuilds.sharp: true` in `pnpm-workspace.yaml`; no other
dependency build scripts are approved.

The README documents authentication, deployment constraints, installation,
the main routes, reply streaming, thread creation/settings, automations, and
runtime status. A release contract test prevents CI commands and these current
capabilities from silently disappearing.
