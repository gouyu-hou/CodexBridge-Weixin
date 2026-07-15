# Provider Model Management Implementation Plan

Status: complete on 2026-07-15. Independent review found no Critical issues; all accepted Important findings were fixed and the final verification matrix passed.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cached provider-backed model discovery, strict account model/reasoning validation, and automatic plus manual model loading to the Weixin administration UI.

**Architecture:** A new `ProviderModelCatalogService` owns profile resolution, provider plugin calls, timeout, normalization, cache, stale data, and profile fallback behavior. The runtime constructs that service from the existing provider profile repository and `PluginRegistry`, while `WeixinAdminServer` consumes only the sanitized catalog contract for API responses, account validation, cache invalidation, and browser UI data.

**Tech Stack:** TypeScript 6, Node.js 24 built-in test runner, existing HTTP admin server and inline browser JavaScript, existing provider plugin registry/contracts.

## Global Constraints

- Automatic loads use a five-minute in-memory cache; manual refresh bypasses only completed cache entries.
- Same-profile concurrent automatic and refresh requests share one in-flight provider call.
- Provider discovery times out after 15 seconds and returns at most 500 normalized, deduplicated models.
- Keep the last successful provider catalog beyond normal expiry; on refresh failure prefer it over profile fallback.
- Fall back to `config.modelCatalog`, `config.modelIds`, and `config.defaultModel` only when no successful provider catalog exists.
- New account selections must come from the catalog. Empty model means provider default.
- Preserve an unchanged unavailable model or reasoning effort, but never allow it to be newly assigned or reselected.
- Provider settings and CCSwitch synchronization explicitly invalidate the affected profile catalog.
- Do not expose API keys, Base URLs, raw provider payloads, or raw provider exceptions in API results.
- Do not add persistent model caches, periodic refresh, custom model text input, new dependencies, or a broad admin HTML refactor.
- Preserve all pre-existing dirty-worktree changes. Do not create commits unless the user explicitly requests them.

## File Map

- Create `src/core/provider_model_catalog_service.ts`: catalog contract, provider discovery, normalization, cache, timeout, stale and profile fallback behavior.
- Create `test/core/provider_model_catalog_service.test.ts`: deterministic unit coverage for all catalog service branches.
- Modify `src/runtime/bootstrap.ts`: construct and expose `runtime.services.providerModelCatalog`.
- Modify `src/cli.ts`: inject the runtime catalog service into `WeixinAdminServer`.
- Modify `src/platforms/weixin/admin_server.ts`: dependency type, model endpoints, strict account validation, invalidation calls, and account editor UI.
- Modify `test/platforms/weixin/admin_server.test.ts`: API, validation, invalidation, security, HTML, and inline-script regression tests.
- Modify `test/store/file_json_repositories.test.ts`: assert runtime wiring uses the registered provider plugin.

---

### Task 1: Provider Model Catalog Service

**Files:**
- Create: `src/core/provider_model_catalog_service.ts`
- Create: `test/core/provider_model_catalog_service.test.ts`

**Interfaces:**
- Consumes: `ProviderProfileRepository.getById(id)`, `PluginRegistry.getProvider<ProviderPluginContract>(providerKind)`, and `ProviderPluginContract.listModels({ providerProfile })`.
- Produces: `ProviderModelCatalog`, `ProviderModelCatalogResult`, and `ProviderModelCatalogService`.

- [ ] **Step 1: Write failing tests for provider results, normalization, cache, refresh, and in-flight deduplication**

Create helpers that use an in-memory profile repository, a real `PluginRegistry`, and a tiny provider stub. The first test group must assert exact normalized output and call counts:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderModelCatalogService } from '../../src/core/provider_model_catalog_service.js';
import { InMemoryProviderProfileRepository } from '../../src/store/in_memory/in_memory_provider_profile_repository.js';
import { PluginRegistry } from '../../src/runtime/plugin_registry.js';
import type { ProviderModelInfo, ProviderProfile } from '../../src/types/provider.js';

function model(id: string, overrides: Partial<ProviderModelInfo> = {}): ProviderModelInfo {
  return {
    id,
    model: id,
    displayName: id,
    description: '',
    isDefault: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
    ...overrides,
  };
}

function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'profile-1',
    providerKind: 'fake',
    displayName: 'Fake',
    config: {},
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function setup(listModels: () => Promise<ProviderModelInfo[]>, options = {}) {
  const providerProfiles = new InMemoryProviderProfileRepository();
  providerProfiles.save(profile());
  const providerRegistry = new PluginRegistry();
  providerRegistry.registerProvider({ kind: 'fake', listModels });
  return {
    providerProfiles,
    service: new ProviderModelCatalogService({
      providerProfiles,
      providerRegistry,
      ...options,
    }),
  };
}

test('ProviderModelCatalogService normalizes and caches provider models', async () => {
  let calls = 0;
  let now = 1_000;
  const { service } = setup(async () => {
    calls += 1;
    return [
      model('gpt-5', { displayName: 'GPT-5', supportedReasoningEfforts: ['low', 'low', 'high'] }),
      model('gpt-5', { displayName: 'duplicate' }),
      model('gpt-4.1'),
    ];
  }, { now: () => now });

  const first = await service.listModels('profile-1');
  const second = await service.listModels('profile-1');

  assert.equal(calls, 1);
  assert.equal(first.source, 'provider');
  assert.equal(first.refreshFailed, false);
  assert.equal(first.stale, false);
  assert.deepEqual(first.models.map((item) => item.id), ['gpt-5', 'gpt-4.1']);
  assert.deepEqual(first.models[0]?.supportedReasoningEfforts, ['low', 'high']);
  assert.deepEqual(second, first);

  now += 300_001;
  await service.listModels('profile-1');
  assert.equal(calls, 2);
});

test('ProviderModelCatalogService force refreshes and deduplicates in-flight work', async () => {
  let calls = 0;
  let firstCall = true;
  let release!: (models: ProviderModelInfo[]) => void;
  const { service } = setup(() => {
    calls += 1;
    if (firstCall) {
      firstCall = false;
      return new Promise((resolve) => { release = resolve; });
    }
    return Promise.resolve([model('gpt-5.1')]);
  });

  const automatic = service.listModels('profile-1');
  const refresh = service.listModels('profile-1', { forceRefresh: true });
  assert.equal(calls, 1);
  release([model('gpt-5')]);
  assert.deepEqual(await automatic, await refresh);

  await service.listModels('profile-1', { forceRefresh: true });
  assert.equal(calls, 2);
});
```

- [ ] **Step 2: Run the new test and verify it fails because the service does not exist**

Run: `node scripts/test.mjs test/core/provider_model_catalog_service.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/core/provider_model_catalog_service.js`.

- [ ] **Step 3: Add failing tests for fallback, stale-on-error, timeout, limits, profile version changes, invalidation, and unknown profiles**

Add focused tests with short injected timing values. Required assertions:

```ts
test('ProviderModelCatalogService uses stale provider data before profile fallback', async () => {
  let fail = false;
  let now = 1_000;
  const { service } = setup(async () => {
    if (fail) throw new Error('secret upstream body');
    return [model('live-model')];
  }, { now: () => now });
  await service.listModels('profile-1');
  now += 300_001;
  fail = true;

  const result = await service.listModels('profile-1', { forceRefresh: true });
  assert.equal(result.source, 'provider');
  assert.equal(result.stale, true);
  assert.equal(result.refreshFailed, true);
  assert.deepEqual(result.models.map((item) => item.id), ['live-model']);
  assert.doesNotMatch(JSON.stringify(result), /secret upstream body/u);
});

test('ProviderModelCatalogService falls back to configured models', async () => {
  const { service, providerProfiles } = setup(async () => []);
  providerProfiles.save(profile({
    config: {
      modelCatalog: [{ id: 'catalog-model', displayName: 'Catalog Model', supportedReasoningEfforts: ['medium'] }],
      modelIds: ['list-model'],
      defaultModel: 'default-model',
    },
  }));
  const result = await service.listModels('profile-1');
  assert.equal(result.source, 'profile');
  assert.equal(result.refreshFailed, true);
  assert.deepEqual(result.models.map((item) => item.id), ['catalog-model', 'list-model', 'default-model']);
  assert.equal(result.models[2]?.isDefault, true);
});

test('ProviderModelCatalogService times out and caps normalized models', async () => {
  const timeoutSetup = setup(() => new Promise(() => {}), { timeoutMs: 5 });
  const timedOut = await timeoutSetup.service.listModels('profile-1');
  assert.equal(timedOut.refreshFailed, true);
  assert.deepEqual(timedOut.models, []);

  const limitSetup = setup(async () => Array.from({ length: 510 }, (_, index) => model(`model-${index}`)));
  const limited = await limitSetup.service.listModels('profile-1');
  assert.equal(limited.models.length, 500);
});
```

Also test these exact state transitions:

- saving the same profile ID with a different `updatedAt` causes another provider call;
- `invalidate('profile-1')` causes another call even when `updatedAt` is unchanged;
- after `invalidate('profile-1')`, a failed load cannot reuse that profile's pre-invalidation last-successful catalog;
- `invalidate()` invalidates every profile;
- a provider without `listModels` returns profile fallback;
- `listModels('missing')` rejects with `NotFoundError`;
- mutating a returned `models` array cannot mutate a later cached response.

- [ ] **Step 4: Implement the catalog contract and service**

Create `src/core/provider_model_catalog_service.ts` with these public types and constructor defaults:

```ts
import { NotFoundError } from './errors.js';
import type { PluginRegistry } from '../runtime/plugin_registry.js';
import type { ProviderModelInfo, ProviderPluginContract, ProviderProfile } from '../types/provider.js';
import type { ProviderProfileRepository } from '../types/repository.js';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_MODELS = 500;

export interface ProviderModelCatalogResult {
  providerProfileId: string;
  providerKind: string;
  models: ProviderModelInfo[];
  source: 'provider' | 'profile';
  fetchedAt: number;
  expiresAt: number;
  refreshFailed: boolean;
  stale: boolean;
}

export interface ProviderModelCatalog {
  listModels(
    providerProfileId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<ProviderModelCatalogResult>;
  invalidate(providerProfileId?: string): void;
}

interface ProviderModelCatalogServiceOptions {
  providerProfiles: Pick<ProviderProfileRepository, 'getById'>;
  providerRegistry: Pick<PluginRegistry, 'getProvider'>;
  cacheTtlMs?: number;
  timeoutMs?: number;
  maxModels?: number;
  now?: () => number;
}
```

Implement maps for completed results, last successful provider results, in-flight promises, per-profile generations, and one global generation. Build cache identity from global generation, profile ID, profile `updatedAt`, and profile generation. `invalidate(profileId)` must increment that profile generation and remove its completed/last-successful entries; `invalidate()` must increment the global generation and clear all completed/last-successful entries. Old in-flight promises may finish, but their old identity must never satisfy a new request.

Implement discovery in this order:

```ts
const provider = this.providerRegistry.getProvider<ProviderPluginContract>(profile.providerKind);
if (typeof provider.listModels !== 'function') {
  return this.profileFallback(profile, now);
}
const rawModels = await withTimeout(
  provider.listModels({ providerProfile: profile }),
  this.timeoutMs,
);
const models = normalizeModels(rawModels, this.maxModels);
if (models.length === 0) {
  throw new Error('empty provider model catalog');
}
```

Catch every provider lookup/list/timeout error inside the service. Return a cloned last-successful provider result with `stale: true` and `refreshFailed: true` when available for the current cache identity; otherwise return a profile fallback with `source: 'profile'` and `refreshFailed: true`. Never include the caught error in a result.

Normalize each provider model to a fresh object. Trim IDs and text, use `id || model` as the canonical ID, deduplicate by canonical ID while preserving first-seen order, deduplicate effort strings, and stop at `maxModels`. Build profile fallback models in `modelCatalog`, `modelIds`, `defaultModel` order and preserve object metadata when present. Return deep clones from cache so callers cannot mutate service state.

- [ ] **Step 5: Run catalog tests and typecheck**

Run:

```powershell
node scripts/test.mjs test/core/provider_model_catalog_service.test.ts
npm run typecheck
```

Expected: all catalog tests PASS and TypeScript exits with code 0.

- [ ] **Step 6: Review the task diff without committing**

Run: `git diff -- src/core/provider_model_catalog_service.ts test/core/provider_model_catalog_service.test.ts`

Expected: only the new service and focused tests appear. Do not commit unless the user explicitly requests it.

---

### Task 2: Runtime Construction and CLI Injection

**Files:**
- Modify: `src/runtime/bootstrap.ts`
- Modify: `src/cli.ts`
- Modify: `src/platforms/weixin/admin_server.ts`
- Modify: `test/store/file_json_repositories.test.ts`

**Interfaces:**
- Consumes: `new ProviderModelCatalogService({ providerProfiles, providerRegistry })` and `ProviderModelCatalog` from Task 1.
- Produces: `runtime.services.providerModelCatalog` and the injected `WeixinAdminServer.providerModelCatalog` dependency.

- [ ] **Step 1: Write a failing runtime wiring test**

Add a provider plugin with `listModels` to `test/store/file_json_repositories.test.ts`, create a runtime, and verify the exposed service resolves through the registered plugin:

```ts
test('runtime exposes a provider model catalog backed by registered providers', async () => {
  const providerProfile = makeProviderProfile('catalog-profile', 'catalog-provider', 'Catalog Provider');
  let calls = 0;
  const runtime = createCodexBridgeRuntime({
    providerProfiles: [providerProfile],
    providerPlugins: [{
      kind: 'catalog-provider',
      async listModels() {
        calls += 1;
        return [{
          id: 'catalog-model', model: 'catalog-model', displayName: 'Catalog Model',
          description: '', isDefault: true,
          supportedReasoningEfforts: ['medium'], defaultReasoningEffort: 'medium',
        }];
      },
    }],
  });

  const result = await runtime.services.providerModelCatalog.listModels('catalog-profile');
  assert.equal(calls, 1);
  assert.deepEqual(result.models.map((item) => item.id), ['catalog-model']);
});
```

- [ ] **Step 2: Run the test and verify the runtime service is missing**

Run: `node scripts/test.mjs test/store/file_json_repositories.test.ts`

Expected: FAIL because `runtime.services.providerModelCatalog` is undefined.

- [ ] **Step 3: Construct and expose the service in bootstrap**

In `src/runtime/bootstrap.ts`, import the service, instantiate it after provider repositories and registry are ready, and expose it:

```ts
import { ProviderModelCatalogService } from '../core/provider_model_catalog_service.js';

const providerModelCatalog = new ProviderModelCatalogService({
  providerProfiles: providerProfilesRepository,
  providerRegistry: registry,
});

services: {
  activeTurns,
  providerModelCatalog,
  sessionRouter,
  // existing services unchanged
}
```

- [ ] **Step 4: Add the admin dependency type and inject the service from CLI**

In `src/platforms/weixin/admin_server.ts`, add the type-only import, optional constructor input for isolated tests, constructor assignment, and class field:

```ts
import type { ProviderModelCatalog } from '../../core/provider_model_catalog_service.js';

interface WeixinAdminServerOptions {
  // existing fields unchanged
  providerModelCatalog?: ProviderModelCatalog | null;
}

// constructor destructuring/default and assignment
providerModelCatalog = null,
this.providerModelCatalog = providerModelCatalog;

// class field
providerModelCatalog: ProviderModelCatalog | null;
```

In `src/cli.ts`, add one option beside `repositories`:

```ts
const adminServer = adminOptions.enabled
  ? new WeixinAdminServer({
    // existing options unchanged
    repositories,
    providerModelCatalog: runtime.services.providerModelCatalog,
    codexHome: process.env.CODEX_HOME,
  })
  : null;
```

- [ ] **Step 5: Run wiring tests and typecheck**

Run:

```powershell
node scripts/test.mjs test/store/file_json_repositories.test.ts
npm run typecheck
```

Expected: runtime tests PASS and TypeScript exits with code 0.

- [ ] **Step 6: Review the task diff without committing**

Run: `git diff -- src/runtime/bootstrap.ts src/cli.ts src/platforms/weixin/admin_server.ts test/store/file_json_repositories.test.ts`

Expected: only service construction, exposure, injection, and its wiring test appear.

---

### Task 3: Sanitized Admin Model API and Cache Invalidation

**Files:**
- Modify: `src/platforms/weixin/admin_server.ts`
- Modify: `test/platforms/weixin/admin_server.test.ts`

**Interfaces:**
- Consumes: `ProviderModelCatalog.listModels()` and `ProviderModelCatalog.invalidate()` from Task 1.
- Produces: `GET /api/provider-profiles/:providerProfileId/models` and `POST /api/provider-profiles/:providerProfileId/models/refresh`.

- [ ] **Step 1: Write failing API and authorization tests with an injected fake catalog**

Add a reusable fake near the top of `admin_server.test.ts`:

```ts
function makeProviderModelCatalogFake() {
  const calls: Array<{ providerProfileId: string; forceRefresh: boolean }> = [];
  const invalidations: Array<string | undefined> = [];
  return {
    calls,
    invalidations,
    async listModels(providerProfileId: string, options: { forceRefresh?: boolean } = {}) {
      calls.push({ providerProfileId, forceRefresh: options.forceRefresh === true });
      return {
        providerProfileId,
        providerKind: 'fake',
        models: [{
          id: 'gpt-5', model: 'gpt-5', displayName: 'GPT-5', description: '', isDefault: true,
          supportedReasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high',
        }],
        source: 'provider' as const,
        fetchedAt: 100,
        expiresAt: 200,
        refreshFailed: false,
        stale: false,
      };
    },
    invalidate(providerProfileId?: string) { invalidations.push(providerProfileId); },
  };
}
```

Test that GET records `{ forceRefresh: false }`, POST records `{ forceRefresh: true }`, and both responses contain only the catalog fields. For POST, fetch `/` to extract the admin token and assert same-origin without the token returns `403`, while same-origin with `x-codexbridge-admin-token` succeeds.

Add a fake that throws `new NotFoundError('profile not found')` and assert `404 { error: 'provider profile not found' }`. Add another fake that throws `new Error('api-key=secret upstream body')` and assert `500 { error: 'provider model catalog unavailable' }` without the secret text.

- [ ] **Step 2: Run the focused admin tests and verify route failures**

Run: `node scripts/test.mjs test/platforms/weixin/admin_server.test.ts`

Expected: new endpoint assertions FAIL with 404 because routes are not implemented.

- [ ] **Step 3: Add endpoint handlers using the injected dependency**

Import `NotFoundError`; the catalog dependency, constructor assignment, and class field already exist from Task 2:

```ts
import { NotFoundError } from '../../core/errors.js';
```

Match only exact decoded paths with one profile segment. Dispatch GET to cached load and POST to forced refresh. The existing `browserAuthorizationError` already protects POST, so do not add a second authorization scheme.

```ts
const modelRoute = pathname.match(/^\/api\/provider-profiles\/([^/]+)\/models(\/refresh)?$/u);
if (modelRoute && req.method === 'GET' && !modelRoute[2]) {
  await this.handleProviderModels(res, modelRoute[1] ?? '', false);
  return;
}
if (modelRoute && req.method === 'POST' && modelRoute[2] === '/refresh') {
  await this.handleProviderModels(res, modelRoute[1] ?? '', true);
  return;
}
```

The handler must sanitize failures at its boundary:

```ts
private async handleProviderModels(res: ServerResponse, providerProfileId: string, forceRefresh: boolean) {
  if (!this.providerModelCatalog) {
    this.writeJson(res, 503, { error: 'provider model catalog unavailable' });
    return;
  }
  try {
    const catalog = await this.providerModelCatalog.listModels(providerProfileId, { forceRefresh });
    this.writeJson(res, 200, catalog);
  } catch (error) {
    if (error instanceof NotFoundError) {
      this.writeJson(res, 404, { error: 'provider profile not found' });
      return;
    }
    this.writeJson(res, 500, { error: 'provider model catalog unavailable' });
  }
}
```

- [ ] **Step 4: Add failing invalidation tests and implement invalidation**

Extend existing provider settings and CCSwitch synchronization tests by injecting the fake catalog. After a provider profile is saved, assert:

```ts
assert.ok(catalog.invalidations.includes('openai-default'));
```

In `saveCompatibleProviderProfile`, invalidate the requested profile whether or not the optional repository can save; after a save, invalidate the actual `profile.id`:

```ts
if (typeof this.repositories?.providerProfiles?.save !== 'function') {
  this.providerModelCatalog?.invalidate(profileId);
  return;
}
// build and save profile
this.repositories.providerProfiles.save(profile);
this.providerModelCatalog?.invalidate(profile.id);
```

This single boundary covers manual settings saves, manual CCSwitch sync, and scheduled CCSwitch sync.

- [ ] **Step 5: Run admin API tests and typecheck**

Run:

```powershell
node scripts/test.mjs test/platforms/weixin/admin_server.test.ts
npm run typecheck
```

Expected: endpoint, authorization, sanitization, and invalidation tests PASS; TypeScript exits with code 0.

- [ ] **Step 6: Review the task diff without committing**

Run: `git diff -- src/platforms/weixin/admin_server.ts test/platforms/weixin/admin_server.test.ts`

Expected: the API/dependency/invalidation changes coexist with earlier dirty-worktree security and backup changes; none of those earlier edits are reverted.

---

### Task 4: Strict Account Model and Reasoning-Effort Validation

**Files:**
- Modify: `src/platforms/weixin/admin_server.ts`
- Modify: `test/platforms/weixin/admin_server.test.ts`

**Interfaces:**
- Consumes: non-forced `ProviderModelCatalog.listModels(providerProfileId)` and `ProviderModelInfo.supportedReasoningEfforts`.
- Produces: asynchronous catalog-backed account PATCH validation with legacy-value preservation.

- [ ] **Step 1: Replace the static validation test with failing catalog-backed cases**

Inject a fake catalog containing `gpt-5` with `['low', 'high']`, and cover each request independently:

```ts
const accepted = await patch({ providerProfileId: 'profile-1', model: 'gpt-5', reasoningEffort: 'high' });
assert.equal(accepted.status, 200);

const unlisted = await patch({ providerProfileId: 'profile-1', model: 'missing-model', reasoningEffort: '' });
assert.equal(unlisted.status, 400);
assert.deepEqual((await unlisted.json()).availableModels, ['gpt-5']);

const unsupportedEffort = await patch({ providerProfileId: 'profile-1', model: 'gpt-5', reasoningEffort: 'medium' });
assert.equal(unsupportedEffort.status, 400);

assert.ok(catalog.calls.every((call) => call.forceRefresh === false));
```

Add cases for empty model, model without provider, unknown provider, and a model whose effort metadata is empty: only `low`, `medium`, `high`, and `xhigh` plus empty are allowed for that compatibility branch.

- [ ] **Step 2: Add failing legacy-preservation and provider-change cases**

Seed one account with `removed-model` and `legacy-effort`. Assert a permissions-only save that submits the same provider/model/effort succeeds even when the catalog lacks both. Then assert assigning `removed-model` to another account fails, changing away and back fails, changing provider revalidates the model, and changing only `legacy-effort` to another unsupported value fails.

Also make the fake count loads and assert a PATCH triggers exactly one automatic load with no forced refresh. A fake catalog rejection must produce a generic `400` validation response without raw exception text.

- [ ] **Step 3: Run focused admin tests and verify current static validation fails the new behavior**

Run: `node scripts/test.mjs test/platforms/weixin/admin_server.test.ts`

Expected: FAIL because validation still uses `extractProviderProfileModelIds()` and does not enforce reasoning metadata.

- [ ] **Step 4: Make account validation asynchronous and catalog-backed**

Pass the existing saved value into validation:

```ts
const modelProvider = await this.normalizeAccountModelProviderPatch(
  body.modelProvider,
  account.model_provider ?? null,
);
```

Change the method to `async` and normalize the requested/current triples. Apply rules in this order:

1. Empty model is valid; model with no provider is invalid.
2. Resolve the provider from `listRawProviderProfiles()`; an unknown provider is valid only when the complete requested provider/model/effort triple is unchanged from the saved triple.
3. Load the catalog without `forceRefresh` and find the exact model ID.
4. If absent, accept only when the complete provider/model/effort triple is unchanged from the saved triple.
5. If present with declared efforts, empty or an exact declared effort is valid.
6. If present without declared efforts, empty or one of `low`, `medium`, `high`, `xhigh` is valid.
7. An invalid unchanged saved effort may remain unchanged, but cannot be newly selected.

Return these sanitized errors:

```ts
{
  error: 'model is not available for provider profile',
  providerProfileId,
  model,
  availableModels: catalog.models.map((item) => item.id),
}

{
  error: 'reasoning effort is not available for model',
  providerProfileId,
  model,
  reasoningEffort,
  availableReasoningEfforts,
}
```

Catch catalog failures and return `{ error: 'provider model catalog unavailable', providerProfileId }`; do not pass through exception messages. Keep the existing static fallback path only when `providerModelCatalog` is absent, so isolated legacy admin tests remain constructible while the production CLI always injects the strict service.

- [ ] **Step 5: Run account validation tests and typecheck**

Run:

```powershell
node scripts/test.mjs test/platforms/weixin/admin_server.test.ts
npm run typecheck
```

Expected: all strict selection, effort, legacy preservation, and no-force assertions PASS.

- [ ] **Step 6: Review the task diff without committing**

Run: `git diff -- src/platforms/weixin/admin_server.ts test/platforms/weixin/admin_server.test.ts`

Expected: account PATCH remains atomic: validation finishes before `accountStore.updateAccount()` is called.

---

### Task 5: Automatic Loading and Manual Refresh in the Account Editor

**Files:**
- Modify: `src/platforms/weixin/admin_server.ts`
- Modify: `test/platforms/weixin/admin_server.test.ts`

**Interfaces:**
- Consumes: the two model API routes and `ProviderModelCatalogResult.models`.
- Produces: one browser promise/result cache per profile, automatic model loading, manual refresh, stale-response protection, unavailable-value display, and dynamic reasoning-effort options.

- [ ] **Step 1: Add failing rendered-HTML and script-syntax assertions**

Extend the existing admin HTML test to assert these implementation signals exist:

```ts
assert.match(html, /providerModelCatalogs:\s*new Map\(\)/u);
assert.match(html, /providerModelCatalogPromises:\s*new Map\(\)/u);
assert.match(html, /\/api\/provider-profiles\/.*\/models/u);
assert.match(html, /\/models\/refresh/u);
assert.match(html, /aria-label.*刷新模型/u);
assert.match(html, /if \(provider\.value !== requestedProviderProfileId\) return/u);
assert.match(html, /支持的推理强度/u);
```

Keep the existing loop that runs every inline script through `new Function(script)`; it is the CSP-compatible syntax regression check.

- [ ] **Step 2: Run the admin HTML test and verify the UI markers are missing**

Run: `node scripts/test.mjs test/platforms/weixin/admin_server.test.ts`

Expected: FAIL on the new catalog cache/refresh assertions.

- [ ] **Step 3: Add fixed-size model control styles**

Beside `.account-config-row`, add styles with stable dimensions:

```css
.account-model-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  gap: 6px;
  min-width: 0;
}
.account-model-refresh {
  width: 34px;
  height: 34px;
  padding: 0;
  font-size: 18px;
}
.account-model-status {
  min-height: 16px;
  font-size: 11.5px;
  color: #64708a;
}
.account-model-status.warn { color: #b45309; }
```

Do not alter the table's overall column model or introduce nested cards.

- [ ] **Step 4: Add browser catalog caches and loader**

Add to the existing browser `state` object:

```js
providerModelCatalogs: new Map(),
providerModelCatalogPromises: new Map(),
```

Implement a loader that shares in-flight automatic requests and bypasses the browser result cache for manual refresh:

```js
async function loadProviderModelCatalog(providerProfileId, forceRefresh) {
  const id = String(providerProfileId || '').trim();
  if (!id) return null;
  if (!forceRefresh && state.providerModelCatalogs.has(id)) {
    return state.providerModelCatalogs.get(id);
  }
  if (state.providerModelCatalogPromises.has(id)) {
    return state.providerModelCatalogPromises.get(id);
  }
  const suffix = forceRefresh ? '/models/refresh' : '/models';
  const promise = requestJson('/api/provider-profiles/' + encodeURIComponent(id) + suffix, {
    method: forceRefresh ? 'POST' : 'GET'
  }).then((catalog) => {
    state.providerModelCatalogs.set(id, catalog);
    return catalog;
  }).finally(() => {
    state.providerModelCatalogPromises.delete(id);
  });
  state.providerModelCatalogPromises.set(id, promise);
  return promise;
}
```

- [ ] **Step 5: Rebuild account model/effort controls around asynchronous catalog data**

For each account row:

- keep provider and model as `<select>` elements;
- wrap model plus a 34px refresh icon button in `.account-model-control`;
- set refresh button text to the familiar refresh symbol, `title = '刷新模型'`, and `setAttribute('aria-label', '刷新模型')`;
- preserve the saved provider/model/effort values in row-local constants;
- disable model, effort, refresh, and Save while a catalog request is active;
- on provider change, clear only newly selected values, then automatically load that provider;
- after awaiting, compare `provider.value` with `requestedProviderProfileId` before touching controls;
- on manual refresh, call `loadProviderModelCatalog(id, true)` and keep the current selected model;
- show `已使用缓存模型` or `模型刷新失败，使用备用列表` in `.account-model-status` from `stale`, `refreshFailed`, and `source`;
- when loading fails with no catalog result, keep model/effort values visible and disabled; re-enable Save only while the provider/model/effort triple still equals that account's saved triple, so unrelated permission edits remain possible without allowing a new unvalidated selection.

Replace static `populateAccountModelOptions` with catalog-model rendering. The default option stays first. Use `displayName + ' (' + id + ')'` when display name differs from ID. If the saved selected model is absent, append exactly one selected option with text `id + '（不可用）'`; never clear it silently.

Add `populateAccountReasoningEffortOptions(select, modelInfo, selectedEffort)`:

```js
function populateAccountReasoningEffortOptions(select, modelInfo, selectedEffort) {
  const wanted = String(selectedEffort || '').trim();
  const declared = Array.isArray(modelInfo && modelInfo.supportedReasoningEfforts)
    ? modelInfo.supportedReasoningEfforts.slice()
    : [];
  const efforts = declared.length > 0 ? declared : ['low', 'medium', 'high', 'xhigh'];
  select.textContent = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '推理默认';
  select.appendChild(empty);
  for (const effort of efforts) {
    const option = document.createElement('option');
    option.value = effort;
    option.textContent = effort;
    select.appendChild(option);
  }
  if (wanted && !efforts.includes(wanted)) {
    const missing = document.createElement('option');
    missing.value = wanted;
    missing.textContent = wanted + '（不可用）';
    select.appendChild(missing);
  }
  select.value = wanted;
}
```

On model change, find the model metadata in the current catalog and call this helper immediately. When no model is selected, use compatibility efforts. Add a concise `title` to the effort select such as `支持的推理强度`.

- [ ] **Step 6: Run UI/admin tests and typecheck**

Run:

```powershell
node scripts/test.mjs test/platforms/weixin/admin_server.test.ts
npm run typecheck
```

Expected: HTML markers and inline script syntax PASS; all prior admin behavior remains green.

- [ ] **Step 7: Review the task diff without committing**

Run: `git diff --check`

Expected: no whitespace errors. Existing CRLF warnings, if any, are informational and must not trigger whole-file line-ending rewrites.

---

### Task 6: Regression Verification and Independent Review

**Files:**
- Verify all files changed in Tasks 1-5.
- No new production files unless review identifies a concrete defect.

**Interfaces:**
- Consumes: complete provider model management feature.
- Produces: verified build/test evidence and a review finding list.

- [ ] **Step 1: Run targeted model, provider, admin, and bridge tests**

Run:

```powershell
node scripts/test.mjs test/core/provider_model_catalog_service.test.ts
node scripts/test.mjs test/platforms/weixin/admin_server.test.ts
node scripts/test.mjs test/providers/codex/plugin.test.ts test/providers/openai_compatible/plugin.test.ts
node scripts/test.mjs test/core/bridge_coordinator.test.ts
```

Expected: every command exits 0 with no failed tests.

- [ ] **Step 2: Run static verification and build**

Run:

```powershell
npm run typecheck
npm run build
git diff --check
```

Expected: typecheck/build exit 0; diff check reports no whitespace errors.

- [ ] **Step 3: Run the complete suite**

Run: `npm test`

Expected: all non-skipped tests pass with zero failures.

- [ ] **Step 4: Perform an independent code review**

Use the `requesting-code-review` skill. Review specifically for:

- stale or invalidated in-flight results repopulating an active cache identity;
- force refresh issuing duplicate calls while an automatic request is in flight;
- account legacy exceptions accidentally allowing unavailable values on another account;
- reasoning efforts being validated against a different model than the submitted model;
- raw provider exceptions or profile secrets entering HTTP responses;
- provider settings/CCSwitch updates missing catalog invalidation;
- browser race conditions after rapid provider switches;
- Save becoming enabled before loading finishes;
- mutation authorization missing from refresh POST.

- [ ] **Step 5: Fix review findings with a new failing test first**

For every accepted finding, add the smallest reproducing test to the relevant test file, run it to observe failure, apply the minimal fix, and rerun that focused test. If there are no findings, make no speculative changes.

- [ ] **Step 6: Re-run final verification after any review fixes**

Run:

```powershell
npm run typecheck
npm run build
npm test
git diff --check
git status --short
```

Expected: typecheck/build/tests pass, diff check is clean, and status lists only the intentional pre-existing changes plus provider model management files. Do not commit unless the user explicitly requests it.
