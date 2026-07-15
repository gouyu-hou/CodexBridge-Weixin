# CodexBridge Weixin v0.1.6 Stabilization Design

Status: approved by the user on 2026-07-15

## Goal

Turn the current uncommitted model-management, JSON-recovery, GPT-5.6, and
delivery-outbox work into a traceable v0.1.6 release while adding only the
small operational controls and maintenance boundaries needed to support it.

## Scope

The release contains five bounded improvements:

1. A single release-verification command that covers the root project and all
   workspace packages included in the Electron distribution.
2. A sanitized admin action for forcing all pending WeChat text deliveries to
   retry, plus aggregate backlog alerts.
3. Extraction of the embedded admin page renderer from the HTTP server without
   changing the page, CSP, routes, or browser behavior.
4. A cached provider-usage service shared by `/usage` and a new admin usage
   panel.
5. A contract check that prevents the Gateway and Provider Relay Cliproxy model
   catalogs from drifting apart.

## Non-Goals

- No fast-response mode.
- No Telegram transport work.
- No new slash commands or aliases.
- No restart of Gateway, Mission Control, or Codex Native API roadmap work.
- No frontend-framework migration.
- No full BridgeCoordinator rewrite or automation/agent state-machine move.
- No outbox message viewer, editor, delete action, or per-recipient action.
- No release automation service, signing-system redesign, or CI migration.

## Release Verification

Add `npm run verify:release` as the canonical pre-release gate. It runs:

- root TypeScript and JavaScript checks;
- root tests;
- Gateway, Provider Relay, Native API, and Mission Control typechecks/tests;
- root and package builds;
- `git diff --check`.

The existing individual scripts remain available. The release guide points to
the canonical command while retaining the explicit command list for recovery.

The Gateway and Provider Relay catalogs remain separate package-owned files.
A root contract test compares their exported structured catalog values. This
guards model metadata without merging the paused packages or introducing a new
shared runtime dependency.

## Delivery Outbox Operations

Extend `WeixinBridgeControl` with:

```ts
retryPendingDeliveries?(): Promise<{
  before: DeliveryOutboxSummary;
  after: DeliveryOutboxSummary;
}>;
```

The CLI implementation calls the existing serialized runtime method:

```ts
await bridgeRuntime.flushDeliveryRetryQueue({ force: true });
```

The admin server exposes `POST /api/delivery-outbox/retry`. It is protected by
the existing loopback, same-origin, and admin-token checks. It returns only the
pending count, oldest creation time, and next attempt time before and after the
operation. A stopped or unavailable bridge returns a sanitized conflict
response.

The page shows the aggregate summary and an `立即补发` button. It never receives
message content, scope IDs, recipient identifiers, or raw errors.

The runtime emits a debounced `delivery_outbox_backlog` alert when either:

- at least three deliveries are pending; or
- the oldest delivery has waited at least five minutes.

Alerts are limited to one every fifteen minutes and contain only count and
age-oriented aggregate text. The existing webhook layer still applies its own
debounce.

## Admin Page Boundary

Move `renderAdminHtml(adminToken, cspNonce)` unchanged into:

```text
src/platforms/weixin/admin_page.ts
```

The renderer remains a server-generated page so the per-process admin token
and CSP nonce stay injected in the same response. `admin_server.ts` imports the
renderer and continues serving it at `/`. This extraction does not create
static public assets or change Electron packaging paths.

The first extraction deliberately keeps the existing HTML, CSS, and browser
JavaScript together. Splitting those three assets is deferred until the page
has a stable asset-loading and CSP contract.

## Provider Usage Service

Add `ProviderUsageService` under `src/core`. It owns provider-profile lookup,
provider capability checks, timeout handling, normalization, in-flight request
deduplication, and a sixty-second cache.

```ts
interface ProviderUsageSnapshot {
  providerProfileId: string;
  providerKind: string;
  report: ProviderUsageReport | null;
  source: 'provider' | 'cache';
  fetchedAt: number;
  expiresAt: number;
  refreshFailed: boolean;
}

interface ProviderUsageCatalog {
  getUsage(
    providerProfileId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<ProviderUsageSnapshot>;
  invalidate(providerProfileId?: string): void;
}
```

Provider exceptions and timeouts become `report: null` with
`refreshFailed: true`; exception text is never returned. Unsupported providers
return `report: null` with `refreshFailed: false`. Cached snapshots are deep
clones.

`BridgeCoordinator` receives this service and uses forced refresh for `/usage`
and status rendering, preserving current chat freshness while removing direct
provider-usage calls from the coordinator.

The admin server exposes cached GET and forced POST endpoints mirroring the
model-catalog route shape:

```text
GET  /api/provider-profiles/:id/usage
POST /api/provider-profiles/:id/usage/refresh
```

HTTP responses exclude `accountId`, `userId`, and `email` entirely. They expose
only provider, plan, normalized buckets/windows, credits, timestamps, source,
and refresh state. The page automatically loads the selected profile once and
offers manual refresh. Unsupported providers show `暂不支持用量查询`; no values
are estimated.

## Error Handling And Security

- All new mutations reuse existing browser authorization.
- Raw provider, delivery, token, scope, and account-identity data stay out of
  HTTP responses, diagnostics, backups, alerts, and release notes.
- Usage cache failures do not affect normal turns or admin state loading.
- Outbox retry failures leave entries queued and return the updated aggregate
  count.
- Admin page extraction must preserve CSP nonces and token metadata exactly.
- Release stops if any verification, package build, installer build, artifact
  check, install smoke, push, or GitHub release step fails.

## Testing

- Reproduce and stabilize the existing parallel port-selection test.
- Add release-script coverage and a cross-package catalog contract test.
- Add outbox retry route authorization, stopped-runtime, success, failure, and
  privacy tests.
- Add runtime aggregate-alert threshold, age, debounce, and privacy tests.
- Add a renderer boundary test before extracting the page.
- Add provider-usage cache, force refresh, timeout, normalization, clone,
  invalidation, and unknown-profile tests.
- Add admin usage route authorization/privacy tests and rendered-page markers.
- Keep existing `/usage` and `/status` behavior tests green after coordinator
  delegation.
- Run the complete release gate, build the NSIS distribution, and smoke-test
  the packaged application before commit and tag.

## Release Semantics

The final release follows `docs/RELEASE_PROCESS.md`:

1. Inspect branch, changes, remotes, and sensitive paths.
2. Bump `0.1.5` to `0.1.6` without creating a tag.
3. Run `npm run verify:release`.
4. Build the NSIS installer and verify the executable, blockmap, and
   `latest.yml`.
5. Perform a packaged-app/install smoke test.
6. Stage only reviewed release content and inspect it again.
7. Commit `release: v0.1.6` and create tag `v0.1.6`.
8. Push `main` and the tag to `gouyu`.
9. Create the GitHub release and upload all three update artifacts.
10. Verify repository, tag, release assets, and update metadata.
