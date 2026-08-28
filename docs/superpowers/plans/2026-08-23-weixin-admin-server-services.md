# Weixin Admin Server Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract routing, backup transactions, diagnostics, and log maintenance from `WeixinAdminServer` while preserving the complete HTTP API.

**Architecture:** Introduce focused backend modules with typed dependency interfaces. `WeixinAdminServer` retains lifecycle, authorization, bridge controls, pairing, and HTTP serialization.

**Tech Stack:** TypeScript, Node HTTP server, filesystem repositories, Node test runner.

## Global Constraints

- Preserve every admin URL, method, authorization rule, status code, JSON field, and transaction ordering.
- Keep authentication before protected dispatch and preserve static asset precedence.
- Do not change the React admin client or release metadata.
- Use structured route and backup types; do not parse structured data with ad hoc strings.

---

### Task 1: Extract Route Resolution

**Files:**
- Create: `src/platforms/weixin/admin_route.ts`
- Create: `test/platforms/weixin/admin_route.test.ts`
- Modify: `src/platforms/weixin/admin_server.ts`
- Test: `test/platforms/weixin/admin_server.test.ts`

**Interfaces:**
- Produces: `resolveWeixinAdminRoute(method: string, pathname: string): WeixinAdminRoute`.

- [ ] Add table-driven tests for every route currently handled between lines 420-598, including parameter decoding, refresh suffixes, static assets, and not-found.
- [ ] Run the new test and confirm RED because the resolver is missing.
- [ ] Implement a discriminated union route resolver with exact precedence.
- [ ] Replace path matching in `handleRequest` with a switch over the resolved route while keeping authorization and response handlers unchanged.
- [ ] Run `npm test -- test/platforms/weixin/admin_route.test.ts test/platforms/weixin/admin_server.test.ts` and `npm run typecheck`.
- [ ] Commit as `refactor: extract weixin admin route resolution`.

### Task 2: Extract Backup Validation And Transaction Service

**Files:**
- Create: `src/platforms/weixin/admin_backup_service.ts`
- Create: `test/platforms/weixin/admin_backup_service.test.ts`
- Modify: `src/platforms/weixin/admin_server.ts`

**Interfaces:**
- Produces: `WeixinAdminBackupService.exportBackup()`, `validateImport(body)`, and `importBackup(body)` with injected repositories and env persistence.

- [ ] Add failing tests for complete validation before mutation, case-insensitive duplicate account IDs, invalid URLs, restore-point creation, record import, environment import, rollback after mid-transaction failure, and sanitized errors.
- [ ] Move import payload types and validation helpers into the service.
- [ ] Move snapshot capture, restore, record import, and export collection into the service.
- [ ] Keep `handleImport` and download response serialization as thin server adapters.
- [ ] Run backup unit tests plus the existing import/export admin integration tests.
- [ ] Commit as `refactor: extract weixin admin backup transactions`.

### Task 3: Extract Diagnostics Service

**Files:**
- Create: `src/platforms/weixin/admin_diagnostics_service.ts`
- Create: `test/platforms/weixin/admin_diagnostics_service.test.ts`
- Modify: `src/platforms/weixin/admin_server.ts`

**Interfaces:**
- Produces: `WeixinAdminDiagnosticsService.runAll()` and `runSetupTarget(target)` returning `DiagnosticCheck[]` and `DiagnosticCheck`.

- [ ] Add failing tests for service, account, API key, model, ports, and Codex Native readiness checks, including sanitized network failures.
- [ ] Move diagnostic candidates, HTTP probes, check formatting, and summary helpers into the service.
- [ ] Keep HTTP response writing and bridge status sourcing in server callbacks.
- [ ] Run diagnostics unit tests and existing diagnostics/setup integration tests.
- [ ] Commit as `refactor: extract weixin admin diagnostics service`.

### Task 4: Extract Log Maintenance Service

**Files:**
- Create: `src/platforms/weixin/admin_log_maintenance_service.ts`
- Create: `test/platforms/weixin/admin_log_maintenance_service.test.ts`
- Modify: `src/platforms/weixin/admin_server.ts`

**Interfaces:**
- Produces: `start`, `restart`, `stop`, `cleanup(reason)`, `clearActive(reason)`, and log summary helpers with injected clock/timers/filesystem paths.

- [ ] Add fake-clock failing tests for immediate cleanup, interval scheduling, restart, stop, compaction, expiry, active-log reset, and bounded summaries.
- [ ] Move scheduler state and log filesystem operations into the service.
- [ ] Make server start/stop delegate scheduler lifecycle and keep API response serialization unchanged.
- [ ] Run log unit tests and existing admin log integration tests.
- [ ] Commit as `refactor: extract weixin admin log maintenance`.

### Task 5: Admin Service Integration Gate

- [ ] Add structural tests that `handleRequest` no longer owns path matching and the server no longer owns backup, diagnostics, or log scheduler implementation blocks.
- [ ] Run `npm test -- test/platforms/weixin/admin_route.test.ts test/platforms/weixin/admin_backup_service.test.ts test/platforms/weixin/admin_diagnostics_service.test.ts test/platforms/weixin/admin_log_maintenance_service.test.ts test/platforms/weixin/admin_server.test.ts`.
- [ ] Run `npm run weixin:admin:test`, `npm run typecheck`, `npm run typecheck:js`, and `git diff --check`.
- [ ] Request independent review and fix all Critical/Important findings.
- [ ] Commit integration-only fixes as `test: lock weixin admin service boundaries`.
