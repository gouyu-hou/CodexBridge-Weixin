# GPT-5.6 Model Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the verified GPT-5.6 Sol/Terra/Luna models to current catalogs and make Sol the preferred ordinary Codex model when available.

**Architecture:** Keep live provider discovery authoritative. Upgrade the bundled Codex CLI, then update only the static compatibility catalogs, ChatGPT preference ordering, admin/electron preset lists, and current user-facing examples; preserve older models, OpenAI-compatible preset defaults, and automation routing.

**Tech Stack:** TypeScript 6, Node.js test runner, Electron CommonJS bootstrap, server-rendered admin HTML.

## Global Constraints

- Preserve all existing model IDs.
- Use only `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`; do not add a bare `gpt-5.6` alias.
- Do not change API request shapes, prompts, or reasoning-effort semantics.
- Keep automation jobs on `gpt-5.4-mini`.

---

### Task 1: Lock Catalog And Preference Behavior

**Files:**
- Modify: `test/providers/codex/plugin.test.ts`
- Modify: `packages/codex-provider-relay/test/capabilities.test.ts`
- Modify: `packages/codex-gateway/test/capabilities.test.ts`
- Modify: `test/platforms/weixin/admin_server.test.ts`

**Interfaces:**
- Consumes: `CodexProviderPlugin`, `buildCliproxyModelIds()`, and rendered admin HTML.
- Produces: regression coverage for GPT-5.6 discovery, preference, capabilities, and preset ordering.

- [x] **Step 1: Write failing tests**

Add the three verified GPT-5.6 IDs to the fake Codex `model/list` response, expect them in `buildCliproxyModelIds(['codex-free'])`, and require the admin preset list to begin with them.

- [x] **Step 2: Verify the tests fail**

Run the focused Codex provider, relay capability, gateway capability, and admin-server tests. Expect failures showing that the GPT-5.6 family is not preferred or cataloged yet.

### Task 2: Update Runtime Catalogs And Presets

**Files:**
- Modify: `src/providers/codex/plugin.ts`
- Modify: `packages/codex-provider-relay/src/capabilities/cliproxy_model_catalog.ts`
- Modify: `packages/codex-gateway/src/capabilities/cliproxy_model_catalog.ts`
- Modify: `src/platforms/weixin/admin_server.ts`
- Modify: `scripts/electron/weixin-admin-main.cjs`
- Modify: `src/i18n/index.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `docs/usage/phone-codex-guide.md`

**Interfaces:**
- Consumes: existing model metadata and provider preset structures.
- Produces: GPT-5.6 catalog entries with the model-specific efforts returned by Codex `0.144.4`, plus current defaults and examples.

- [x] **Step 1: Implement the minimal catalog update**

Upgrade `@openai/codex` to `^0.144.4`; insert Sol, Terra, and Luna ahead of `gpt-5.5`; set the ordinary ChatGPT preference to Sol; and update current preset defaults/examples. Leave all earlier entries intact.

- [x] **Step 2: Verify focused tests pass**

Run the same focused tests and confirm all new assertions pass.

### Task 3: Regression Verification

**Files:**
- Verify all modified files.

**Interfaces:**
- Consumes: repository test/build scripts.
- Produces: evidence that the model update does not break provider, admin, or package behavior.

- [x] **Step 1: Run static and regression checks**

Run `npm run typecheck`, `npm run build`, relevant package typechecks/tests, and `git diff --check`.

- [x] **Step 2: Review the final diff**

Confirm only GPT-5.6 catalog/default/example changes and their tests are present in this task's diff.
