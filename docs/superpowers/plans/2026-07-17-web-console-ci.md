# Web Console CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require Web console dependency installation, typechecking, and production building in CI and the root release gate.

**Architecture:** Keep the Web lockfile independent, install it explicitly in CI, and expose a root `web:verify` command consumed by `verify:release`. Validate the workflow, root scripts, pnpm build approval, and README with the existing release contract test.

**Tech Stack:** GitHub Actions, pnpm 11.9.0, Next.js 16, TypeScript, Node test runner.

## Global Constraints

- Use `apps/web/pnpm-lock.yaml` with `--frozen-lockfile`.
- Approve only the `sharp` dependency build script.
- Run the same Web gate locally and in CI through `verify:release`.
- Do not publish artifacts or mutate Git history.

---

### Task 1: Add the Web release contract

- [ ] Add a failing release-verification test for pnpm setup/install, root Web verification, build approval, and current README routes.
- [ ] Run the focused test and confirm it fails before workflow integration.

### Task 2: Integrate the Web gate

- [ ] Add `web:typecheck` and `web:verify` root scripts and include `web:verify` in `verify:release`.
- [ ] Install Web dependencies in both CI matrix jobs before the root gate.
- [ ] Configure pnpm 11 to allow only the `sharp` build script.
- [ ] Run the frozen install, Web typecheck, and production build.

### Task 3: Refresh documentation and verify

- [ ] Replace the obsolete first-cut README with current routes, write APIs, streaming, and deployment constraints.
- [ ] Update the fixed release process to include Web dependency installation and build verification.
- [ ] Run the release contract test, `web:verify`, and full `verify:release`.
