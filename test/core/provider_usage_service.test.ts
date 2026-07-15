import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundError } from '../../src/core/errors.js';
import { ProviderUsageService } from '../../src/core/provider_usage_service.js';
import { PluginRegistry } from '../../src/runtime/plugin_registry.js';
import { InMemoryProviderProfileRepository } from '../../src/store/in_memory/in_memory_provider_profile_repository.js';
import type { ProviderProfile, ProviderUsageReport } from '../../src/types/provider.js';

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

function report(overrides: Partial<ProviderUsageReport> = {}): ProviderUsageReport {
  return {
    provider: 'fake',
    accountId: 'account-1',
    userId: 'user-1',
    email: 'user@example.com',
    plan: 'pro',
    buckets: [{
      name: 'codex',
      allowed: true,
      limitReached: false,
      windows: [{
        name: 'five_hour',
        usedPercent: 23,
        windowSeconds: 18_000,
        resetAfterSeconds: 3_600,
        resetAtUnix: 10_000,
      }],
    }],
    credits: { hasCredits: true, unlimited: false, balance: '12.50' },
    ...overrides,
  };
}

function setup(
  getUsage: ((input: { providerProfile: ProviderProfile }) => Promise<ProviderUsageReport | null>) | undefined,
  options: Record<string, unknown> = {},
) {
  const providerProfiles = new InMemoryProviderProfileRepository();
  providerProfiles.save(profile());
  const providerRegistry = new PluginRegistry();
  providerRegistry.registerProvider({ kind: 'fake', getUsage } as any);
  return {
    providerProfiles,
    providerRegistry,
    service: new ProviderUsageService({ providerProfiles, providerRegistry, ...options }),
  };
}

test('ProviderUsageService normalizes, caches, and deep-clones provider usage', async () => {
  let calls = 0;
  let now = 1_000;
  const { service } = setup(async () => {
    calls += 1;
    return report({
      provider: '  fake-provider  ',
      plan: '  pro plan  ',
      buckets: [{
        name: '  codex  ',
        allowed: true,
        limitReached: false,
        windows: [{
          name: '  five_hour  ',
          usedPercent: 130,
          windowSeconds: 18_000.9,
          resetAfterSeconds: -10,
          resetAtUnix: 10_000.8,
        }],
      }],
    });
  }, { now: () => now, cacheTtlMs: 60_000 });

  const first = await service.getUsage('profile-1');
  assert.equal(calls, 1);
  assert.equal(first.source, 'provider');
  assert.equal(first.refreshFailed, false);
  assert.equal(first.report?.provider, 'fake-provider');
  assert.equal(first.report?.plan, 'pro plan');
  assert.deepEqual(first.report?.buckets[0]?.windows[0], {
    name: 'five_hour',
    usedPercent: 100,
    windowSeconds: 18_000,
    resetAfterSeconds: 0,
    resetAtUnix: 10_000,
  });

  first.report!.buckets[0]!.windows[0]!.usedPercent = 1;
  const cached = await service.getUsage('profile-1');
  assert.equal(calls, 1);
  assert.equal(cached.source, 'cache');
  assert.equal(cached.report?.buckets[0]?.windows[0]?.usedPercent, 100);

  now += 60_001;
  await service.getUsage('profile-1');
  assert.equal(calls, 2);
});

test('ProviderUsageService force refreshes and deduplicates in-flight work', async () => {
  let calls = 0;
  let release!: (value: ProviderUsageReport | null) => void;
  const { service } = setup(() => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  });

  const automatic = service.getUsage('profile-1');
  const forced = service.getUsage('profile-1', { forceRefresh: true });
  assert.equal(calls, 1);
  release(report());
  assert.deepEqual(await forced, await automatic);
});

test('ProviderUsageService distinguishes unsupported usage from sanitized failures', async () => {
  const unsupported = setup(undefined);
  const unsupportedResult = await unsupported.service.getUsage('profile-1');
  assert.equal(unsupportedResult.report, null);
  assert.equal(unsupportedResult.refreshFailed, false);

  const failed = setup(async () => {
    throw new Error('api-key=private upstream response');
  });
  const failedResult = await failed.service.getUsage('profile-1');
  assert.equal(failedResult.report, null);
  assert.equal(failedResult.refreshFailed, true);
  assert.doesNotMatch(JSON.stringify(failedResult), /private upstream|api-key/u);

  const timedOut = setup(() => new Promise(() => {}), { timeoutMs: 5 });
  const timedOutResult = await timedOut.service.getUsage('profile-1');
  assert.equal(timedOutResult.report, null);
  assert.equal(timedOutResult.refreshFailed, true);
});

test('ProviderUsageService treats a missing provider plugin as unsupported usage', async () => {
  const providerProfiles = new InMemoryProviderProfileRepository();
  providerProfiles.save(profile({ providerKind: 'not-registered' }));
  const service = new ProviderUsageService({
    providerProfiles,
    providerRegistry: new PluginRegistry(),
  });

  const result = await service.getUsage('profile-1');

  assert.equal(result.report, null);
  assert.equal(result.refreshFailed, false);
});

test('ProviderUsageService refreshes after profile changes and explicit invalidation', async () => {
  let calls = 0;
  const { service, providerProfiles } = setup(async () => report({ plan: `plan-${++calls}` }));

  await service.getUsage('profile-1');
  providerProfiles.save(profile({ updatedAt: 101 }));
  assert.equal((await service.getUsage('profile-1')).report?.plan, 'plan-2');

  service.invalidate('profile-1');
  assert.equal((await service.getUsage('profile-1')).report?.plan, 'plan-3');
});

test('ProviderUsageService rejects unknown profiles', async () => {
  const { service } = setup(async () => report());
  await assert.rejects(service.getUsage('missing'), NotFoundError);
});
