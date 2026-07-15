# Provider Model Management Design

## Purpose

Add provider-backed model discovery to the Weixin administration UI so account defaults are selected from the models actually exposed by the selected provider profile. The feature must preserve existing account settings, avoid exposing provider credentials to the HTTP layer, and remain usable when live discovery fails.

## Scope

This change covers account-level provider and model selection in the Weixin admin server.

It includes:

- automatic model loading when the account editor is rendered or its provider changes;
- an explicit manual refresh action;
- a five-minute in-process cache;
- stale-last-successful fallback when a refresh temporarily fails;
- a 15-second discovery timeout and a 500-model result limit;
- provider-backed model metadata, including supported reasoning efforts;
- profile-configured fallback models when provider discovery is unavailable;
- server-side validation for all account model updates;
- preservation and clear display of an already-saved model that is no longer available.

It does not include:

- arbitrary custom model input;
- persistent model-cache files;
- editing provider profiles from the account table;
- periodic background refreshes;
- refactoring the full admin HTML into separate assets.

## Architecture

Introduce a focused `ProviderModelCatalogService` outside the HTTP server. It receives the existing provider profile repository and provider registry, resolves a profile to its plugin, and calls the plugin's existing `listModels({ providerProfile })` contract.

`WeixinAdminServer` receives a small `providerModelCatalog` dependency. The server only knows how to request a catalog DTO and validate a selection; it does not receive provider credentials, construct provider plugins, or call provider HTTP endpoints directly.

The CLI wires the service from the runtime's existing provider profile repository and provider registry. Tests may inject a small fake catalog without constructing a full runtime.

## Catalog Contract

The service exposes:

```ts
interface ProviderModelCatalog {
  listModels(
    providerProfileId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<ProviderModelCatalogResult>;
  invalidate(providerProfileId?: string): void;
}

interface ProviderModelCatalogResult {
  providerProfileId: string;
  providerKind: string;
  models: ProviderModelInfo[];
  source: 'provider' | 'profile';
  fetchedAt: number;
  expiresAt: number;
  refreshFailed: boolean;
  stale: boolean;
}
```

The result never contains an API key, Base URL, raw provider response, or raw exception text.

## Discovery And Caching

1. Resolve the provider profile by exact ID. Unknown IDs fail with a not-found result.
2. Build a cache identity from profile ID and `updatedAt`. Admin settings and CCSwitch synchronization explicitly call `invalidate(providerProfileId)` whenever Base URL, API key, or model configuration changes; repository `updatedAt` changes provide a second invalidation boundary.
3. For automatic loads, return a non-expired cache entry when available.
4. For manual refresh, bypass the completed cache entry.
5. Merge concurrent requests for the same cache identity into one in-flight provider call, including a refresh arriving while an automatic load is still running.
6. Call the provider plugin's `listModels()` when available, with a 15-second service-level timeout. The timeout releases the admin request even when a provider implementation cannot cancel its underlying operation.
7. Normalize and deduplicate returned models by model ID while preserving provider order, then cap the result at 500 models.
8. Keep the last successful provider catalog separately from its normal expiry time.
9. When a refresh throws, times out, or returns no models, return the last successful provider catalog with `stale: true` and `refreshFailed: true`.
10. When no successful provider catalog has ever been loaded, construct a fallback catalog from `config.modelCatalog`, `config.modelIds`, and `config.defaultModel` with `source: 'profile'`.
11. Cache successful provider and profile fallback results for five minutes. Failures never return raw exception text.

For OpenAI-compatible providers, `listModels()` already performs a live `/models` request and falls back internally when needed. The admin service treats a successful plugin result as provider-owned catalog data rather than duplicating that protocol logic.

## Admin API

Add two routes:

```text
GET  /api/provider-profiles/:providerProfileId/models
POST /api/provider-profiles/:providerProfileId/models/refresh
```

The GET route performs the cached automatic load. The POST route requests a refresh and is protected by the existing browser Origin, Fetch Metadata, and admin-token mutation checks.

Both successful routes return the catalog DTO. Unknown profiles return `404`. A profile with no provider or configured models returns `200` with an empty model list and `refreshFailed: true`, allowing the UI to show a stable unavailable state.

Provider failures do not become raw `500` responses when a stale successful catalog or profile fallback exists. Unexpected service failures return a generic error without credentials or upstream response bodies.

## Selection Validation

Account PATCH handling performs server-side validation using the catalog service.

- A new model value must exactly match a model ID in the current catalog.
- An empty model remains valid and means "use provider default".
- A previously saved model that is absent from the current catalog may remain unchanged when the same account is saved for unrelated permission or role changes.
- An unavailable saved model cannot be newly assigned to another account or reselected after changing away from it.
- Changing the provider always validates the selected model against the new provider catalog.
- When the catalog uses profile fallback data, selections from that fallback remain valid.
- A model selection is rejected when no catalog entry exists.
- Saving an account reuses the same cached or stale catalog used by the UI and never forces a provider refresh.
- When no catalog has been loaded for that profile, saving performs one automatic catalog load before validation.

The response uses `400` for invalid model selections and includes the provider profile ID, requested model ID, and currently available model IDs. It does not expose provider errors.

## Reasoning Effort

The reasoning-effort control follows the selected model's `supportedReasoningEfforts` metadata.

- The empty option always remains available and means provider/model default.
- A model with declared efforts only permits those values.
- A model with no declared effort metadata keeps the existing fixed values as a compatibility fallback.
- An already-saved unavailable effort is displayed as unavailable and may remain unchanged, following the same legacy-preservation rule as models.
- Server-side validation enforces declared effort values when model metadata is available.

## Admin UI

Each account editor keeps the existing provider and model selects.

- Provider change immediately disables the model and effort controls and starts automatic catalog loading.
- Model options display the provider model display name and retain the model ID as the submitted value.
- The default option remains first.
- A compact refresh icon button sits next to the model select with an accessible label and tooltip.
- While loading, dimensions remain fixed and controls are disabled to avoid table layout shifts.
- A failed refresh keeps the stale last-successful catalog when available, otherwise displays profile fallback models, and shows a restrained status indicator.
- A saved model missing from the catalog appears once as an unavailable, selected option.
- The UI never silently clears a saved unavailable value.
- Selecting a model updates the reasoning-effort options immediately.

The browser maintains one catalog promise/result per provider profile so multiple account rows using the same profile do not issue duplicate requests.

## Error Handling

- Unknown provider profile: return `404`; keep the current account value visible.
- Provider plugin without `listModels`: return profile fallback data.
- Provider timeout, upstream error, or empty provider result: return the last successful catalog with `stale: true`; when no successful catalog exists, return profile fallback data with `refreshFailed: true`.
- Empty provider and profile catalogs: disable non-default model selection.
- Save attempted before loading completes: keep Save disabled for that row.
- Stale response after a provider switch: ignore it by comparing the row's current provider ID with the request provider ID.
- More than 500 provider models: keep the first 500 normalized entries and report the bounded catalog without expanding the table indefinitely.

## Security

- Provider credentials remain in provider plugin configuration and process environment.
- Catalog responses contain model metadata only.
- Manual refresh uses the existing mutation authorization path.
- Provider IDs are decoded and resolved by exact repository lookup; they are not used as filesystem paths.
- Raw provider errors and response payloads are not returned to the browser.
- Existing CSP and same-origin rules remain unchanged.

## Testing

### Catalog Service

- returns provider models and normalizes duplicate IDs;
- uses a five-minute cache for automatic loads;
- bypasses completed cache entries for manual refresh;
- deduplicates concurrent requests;
- invalidates cache when profile `updatedAt` changes;
- invalidates cache when provider connection or model configuration changes;
- returns the last successful catalog as stale after a temporary refresh failure;
- times out discovery after 15 seconds;
- deduplicates and limits catalogs to 500 models;
- falls back to profile models on unsupported, empty, or failed discovery;
- rejects unknown profiles;
- never includes provider exception text in its result.

### Admin API

- GET returns the cached catalog;
- POST refresh invokes forced service refresh and requires browser authorization;
- unknown profiles return `404`;
- catalog failures return sanitized fallback responses;
- account PATCH accepts listed models and declared reasoning efforts;
- account PATCH rejects unlisted models and unsupported efforts;
- account PATCH reuses cached validation data and does not force a provider request;
- account PATCH performs one automatic load when no validation catalog exists;
- an unchanged legacy model remains valid;
- changing provider revalidates the model.

### Admin UI

- rendered HTML includes the refresh control and catalog endpoints;
- provider changes trigger model loading;
- stale async responses cannot overwrite a newer provider selection;
- unavailable saved models remain visible;
- reasoning-effort options follow model metadata;
- inline scripts remain syntactically valid under the CSP nonce.

### Regression

Run targeted provider, admin-server, and bridge-coordinator tests, followed by typecheck, build, and the complete test suite.

## Success Criteria

- Account rows automatically show models supplied by their selected provider profile.
- Manual refresh performs a fresh catalog request without page reload.
- Temporary refresh failures preserve the last successful catalog and mark it stale.
- No account can newly save a model outside the returned or fallback catalog.
- Existing unavailable model values are preserved and clearly marked.
- Provider discovery failures do not prevent editing unrelated account permissions.
- Provider discovery cannot hold an admin request longer than 15 seconds and cannot return more than 500 models.
- No API response exposes API keys, Base URLs, raw provider responses, or raw provider exceptions.
- Existing provider commands and runtime model selection continue to pass their regression tests.
