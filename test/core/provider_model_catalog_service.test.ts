import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderModelCatalogService } from '../../src/core/provider_model_catalog_service.js';
import { NotFoundError } from '../../src/core/errors.js';
import { PluginRegistry } from '../../src/runtime/plugin_registry.js';
import { InMemoryProviderProfileRepository } from '../../src/store/in_memory/in_memory_provider_profile_repository.js';
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

function setup(
  listModels: (() => Promise<ProviderModelInfo[]>) | undefined,
  options: Record<string, unknown> = {},
) {
  const providerProfiles = new InMemoryProviderProfileRepository();
  providerProfiles.save(profile());
  const providerRegistry = new PluginRegistry();
  providerRegistry.registerProvider({ kind: 'fake', listModels } as any);
  return {
    providerProfiles,
    providerRegistry,
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

test('ProviderModelCatalogService uses stale provider data before profile fallback', async () => {
  let calls = 0;
  let fail = false;
  let now = 1_000;
  const { service } = setup(async () => {
    calls += 1;
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

  const cachedStale = await service.listModels('profile-1');
  assert.equal(calls, 2);
  assert.deepEqual(cachedStale, result);
});

test('ProviderModelCatalogService falls back to configured models', async () => {
  const { service, providerProfiles } = setup(async () => []);
  providerProfiles.save(profile({
    config: {
      modelCatalog: [{
        id: 'catalog-model',
        displayName: 'Catalog Model',
        description: 'Catalog description',
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: ['medium'],
      }],
      modelIds: ['list-model'],
      defaultModel: 'default-model',
    },
  }));

  const result = await service.listModels('profile-1');
  assert.equal(result.source, 'profile');
  assert.equal(result.refreshFailed, true);
  assert.deepEqual(result.models.map((item) => item.id), ['catalog-model', 'list-model', 'default-model']);
  assert.equal(result.models[0]?.displayName, 'Catalog Model');
  assert.equal(result.models[0]?.defaultReasoningEffort, 'medium');
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

test('ProviderModelCatalogService clamps configured model limits to the hard cap', async () => {
  const { service } = setup(
    async () => Array.from({ length: 501 }, (_, index) => model(`model-${index}`)),
    { maxModels: 501 },
  );

  const result = await service.listModels('profile-1');
  assert.equal(result.models.length, 500);
});

test('ProviderModelCatalogService refreshes after a profile version change', async () => {
  let calls = 0;
  const { service, providerProfiles } = setup(async () => [model(`model-${++calls}`)]);
  await service.listModels('profile-1');
  providerProfiles.save(profile({ updatedAt: 101 }));
  const result = await service.listModels('profile-1');

  assert.equal(calls, 2);
  assert.deepEqual(result.models.map((item) => item.id), ['model-2']);
});

test('ProviderModelCatalogService invalidates one profile without changing its version', async () => {
  let calls = 0;
  const { service } = setup(async () => [model(`model-${++calls}`)]);
  await service.listModels('profile-1');
  service.invalidate('profile-1');
  const result = await service.listModels('profile-1');

  assert.equal(calls, 2);
  assert.deepEqual(result.models.map((item) => item.id), ['model-2']);
});

test('ProviderModelCatalogService cannot reuse stale provider data after invalidation', async () => {
  let fail = false;
  const { service, providerProfiles } = setup(async () => {
    if (fail) throw new Error('secret pre-invalidation data');
    return [model('live-model')];
  });
  providerProfiles.save(profile({ config: { modelIds: ['configured-model'] } }));
  await service.listModels('profile-1');
  service.invalidate('profile-1');
  fail = true;

  const result = await service.listModels('profile-1');
  assert.equal(result.source, 'profile');
  assert.equal(result.refreshFailed, true);
  assert.deepEqual(result.models.map((item) => item.id), ['configured-model']);
  assert.doesNotMatch(JSON.stringify(result), /secret pre-invalidation data/u);
});

test('ProviderModelCatalogService invalidates every profile', async () => {
  let calls = 0;
  const { service, providerProfiles } = setup(async () => [model(`model-${++calls}`)]);
  providerProfiles.save(profile({ id: 'profile-2' }));
  await service.listModels('profile-1');
  await service.listModels('profile-2');
  service.invalidate();
  await service.listModels('profile-1');
  await service.listModels('profile-2');

  assert.equal(calls, 4);
});

test('ProviderModelCatalogService does not cache an invalidated in-flight request', async () => {
  let calls = 0;
  let release!: (models: ProviderModelInfo[]) => void;
  const { service } = setup(() => {
    calls += 1;
    if (calls === 1) return new Promise((resolve) => { release = resolve; });
    return Promise.resolve([model('current-model')]);
  });

  const oldRequest = service.listModels('profile-1');
  service.invalidate('profile-1');
  release([model('old-model')]);
  assert.deepEqual((await oldRequest).models.map((item) => item.id), ['old-model']);

  const current = await service.listModels('profile-1');
  assert.equal(calls, 2);
  assert.deepEqual(current.models.map((item) => item.id), ['current-model']);
});

test('ProviderModelCatalogService uses fallback when a provider cannot list models', async () => {
  const { service, providerProfiles } = setup(undefined);
  providerProfiles.save(profile({ config: { modelIds: ['configured-model'] } }));

  const result = await service.listModels('profile-1');
  assert.equal(result.source, 'profile');
  assert.equal(result.refreshFailed, false);
  assert.deepEqual(result.models.map((item) => item.id), ['configured-model']);
});

test('ProviderModelCatalogService rejects unknown profiles', async () => {
  const { service } = setup(async () => [model('unused')]);
  await assert.rejects(service.listModels('missing'), NotFoundError);
});

test('ProviderModelCatalogService returns deep clones of cached entries', async () => {
  const { service } = setup(async () => [model('gpt-5', { supportedReasoningEfforts: ['low'] })]);
  const first = await service.listModels('profile-1');
  first.models.push(model('injected'));
  first.models[0]!.displayName = 'changed';
  first.models[0]!.supportedReasoningEfforts.push('high');

  const second = await service.listModels('profile-1');
  assert.deepEqual(second.models, [model('gpt-5', { supportedReasoningEfforts: ['low'] })]);
});

test('ProviderModelCatalogService normalizes untrusted provider and profile data', async () => {
  const { service, providerProfiles } = setup(async () => [
    {
      id: '  ',
      model: '  canonical-model  ',
      displayName: '  Display Name  ',
      description: 42,
      isDefault: 'yes',
      supportedReasoningEfforts: [' low ', 'low', 3, 'high', ' '],
      defaultReasoningEffort: 7,
      extra: 'ignored',
    },
    null,
  ] as any);
  providerProfiles.save(profile({ config: {
    modelCatalog: [{ id: ' ignored-provider-result ' }],
  } }));

  const result = await service.listModels('profile-1');
  assert.deepEqual(result.models, [{
    id: 'canonical-model',
    model: 'canonical-model',
    displayName: 'Display Name',
    description: '',
    isDefault: false,
    supportedReasoningEfforts: ['low', 'high'],
    defaultReasoningEffort: null,
  }]);
});
