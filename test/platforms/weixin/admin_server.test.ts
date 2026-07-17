import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NotFoundError } from '../../../src/core/errors.js';
import { WeixinAccountStore } from '../../../src/platforms/weixin/account_store.js';
import { WeixinAdminServer, resolveWeixinAdminServerOptions } from '../../../src/platforms/weixin/admin_server.js';
import {
  _resetContextTokenStoreForTest,
  getContextToken as getOfficialContextToken,
  setContextToken as setOfficialContextToken,
} from '../../../src/platforms/weixin/official/context_tokens.js';
import { createFileJsonRepositories } from '../../../src/store/file_json/create_file_json_repositories.js';

function makeTempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-weixin-admin-'));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function makeAccountValidationCatalogFake({
  modelsByProvider = {},
  error = null,
  source = 'provider',
  stale = false,
  refreshFailed = false,
  onLoad = () => {},
}: {
  modelsByProvider?: Record<string, Array<{ id: string; supportedReasoningEfforts: string[] }>>;
  error?: Error | null;
  source?: 'provider' | 'profile';
  stale?: boolean;
  refreshFailed?: boolean;
  onLoad?: () => void;
} = {}) {
  const calls: Array<{ providerProfileId: string; forceRefresh: boolean }> = [];
  return {
    calls,
    async listModels(providerProfileId: string, options: { forceRefresh?: boolean } = {}) {
      calls.push({ providerProfileId, forceRefresh: options.forceRefresh === true });
      onLoad();
      if (error) {
        throw error;
      }
      return {
        providerProfileId,
        providerKind: 'fake',
        models: (modelsByProvider[providerProfileId] ?? []).map((item, index) => ({
          id: item.id,
          model: item.id,
          displayName: item.id,
          description: '',
          isDefault: index === 0,
          supportedReasoningEfforts: item.supportedReasoningEfforts,
          defaultReasoningEffort: null,
        })),
        source,
        fetchedAt: 100,
        expiresAt: 200,
        refreshFailed,
        stale,
      };
    },
    invalidate() {},
  };
}

function makeProviderUsageFake() {
  const calls: Array<{ providerProfileId: string; forceRefresh: boolean }> = [];
  const invalidations: Array<string | undefined> = [];
  return {
    calls,
    invalidations,
    async getUsage(providerProfileId: string, options: { forceRefresh?: boolean } = {}) {
      calls.push({ providerProfileId, forceRefresh: options.forceRefresh === true });
      return {
        providerProfileId,
        providerKind: 'openai-native',
        report: {
          provider: 'codex',
          accountId: 'private-account-id',
          userId: 'private-user-id',
          email: 'private@example.com',
          plan: 'pro',
          buckets: [{
            name: 'Codex',
            allowed: true,
            limitReached: false,
            windows: [{
              name: 'Primary',
              usedPercent: 23,
              windowSeconds: 18_000,
              resetAfterSeconds: 3_600,
              resetAtUnix: 10_000,
            }],
          }],
          credits: { hasCredits: true, unlimited: false, balance: '12.50' },
        },
        source: options.forceRefresh ? 'provider' as const : 'cache' as const,
        fetchedAt: 100,
        expiresAt: 200,
        refreshFailed: false,
      };
    },
    invalidate(providerProfileId?: string) { invalidations.push(providerProfileId); },
  };
}

test('WeixinAdminServer serves cached provider models and refreshes them with browser authorization', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const catalog = makeProviderModelCatalogFake();
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    providerModelCatalog: catalog,
    port: 0,
  });

  const binding = await server.start();
  try {
    const expectedCatalog = {
      providerProfileId: 'openai-default',
      providerKind: 'fake',
      models: [{
        id: 'gpt-5', model: 'gpt-5', displayName: 'GPT-5', description: '', isDefault: true,
        supportedReasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high',
      }],
      source: 'provider',
      fetchedAt: 100,
      expiresAt: 200,
      refreshFailed: false,
      stale: false,
    };
    const getResponse = await fetch(`${binding.url}/api/provider-profiles/openai-default/models`, {
      headers: { origin: binding.url },
    });
    assert.equal(getResponse.status, 200);
    assert.deepEqual(await getResponse.json(), expectedCatalog);
    assert.deepEqual(catalog.calls, [{ providerProfileId: 'openai-default', forceRefresh: false }]);

    const adminPage = await fetch(binding.url);
    const adminHtml = await adminPage.text();
    const adminToken = adminHtml.match(/name="codexbridge-admin-token" content="([^"]+)"/u)?.[1];
    assert.ok(adminToken);

    const unauthorizedResponse = await fetch(`${binding.url}/api/provider-profiles/openai-default/models/refresh`, {
      method: 'POST',
      headers: { origin: binding.url },
    });
    assert.equal(unauthorizedResponse.status, 403);
    assert.deepEqual(await unauthorizedResponse.json(), { error: 'missing or invalid admin token' });

    const noOriginResponse = await fetch(`${binding.url}/api/provider-profiles/openai-default/models/refresh`, {
      method: 'POST',
    });
    assert.equal(noOriginResponse.status, 403);

    const refreshResponse = await fetch(`${binding.url}/api/provider-profiles/openai-default/models/refresh`, {
      method: 'POST',
      headers: {
        origin: binding.url,
        'x-codexbridge-admin-token': adminToken,
      },
    });
    assert.equal(refreshResponse.status, 200);
    assert.deepEqual(await refreshResponse.json(), expectedCatalog);
    assert.deepEqual(catalog.calls, [
      { providerProfileId: 'openai-default', forceRefresh: false },
      { providerProfileId: 'openai-default', forceRefresh: true },
    ]);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer sanitizes provider model catalog failures', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const missingServer = new WeixinAdminServer({
    accountStore,
    stateDir,
    providerModelCatalog: {
      async listModels() {
        throw new NotFoundError('profile not found');
      },
      invalidate() {},
    },
    port: 0,
  });
  const unavailableServer = new WeixinAdminServer({
    accountStore,
    stateDir,
    providerModelCatalog: {
      async listModels() {
        throw new Error('api-key=secret upstream body');
      },
      invalidate() {},
    },
    port: 0,
  });

  const missingBinding = await missingServer.start();
  const unavailableBinding = await unavailableServer.start();
  try {
    const missingResponse = await fetch(`${missingBinding.url}/api/provider-profiles/missing/models`);
    assert.equal(missingResponse.status, 404);
    assert.deepEqual(await missingResponse.json(), { error: 'provider profile not found' });

    const unavailableResponse = await fetch(`${unavailableBinding.url}/api/provider-profiles/openai-default/models`);
    assert.equal(unavailableResponse.status, 500);
    const unavailableBody = await unavailableResponse.json() as { error: string };
    assert.deepEqual(unavailableBody, { error: 'provider model catalog unavailable' });
    assert.doesNotMatch(JSON.stringify(unavailableBody), /secret|upstream body/u);
  } finally {
    await missingServer.stop();
    await unavailableServer.stop();
  }
});

test('WeixinAdminServer serves sanitized provider usage and protects forced refresh', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const providerUsage = makeProviderUsageFake();
  const server = new WeixinAdminServer({ accountStore, stateDir, providerUsage, port: 0 });
  const binding = await server.start();
  try {
    const expected = {
      providerProfileId: 'openai-default',
      providerKind: 'openai-native',
      status: 'available',
      report: {
        provider: 'codex',
        plan: 'pro',
        buckets: [{
          name: 'Codex',
          allowed: true,
          limitReached: false,
          windows: [{
            name: 'Primary',
            usedPercent: 23,
            windowSeconds: 18_000,
            resetAfterSeconds: 3_600,
            resetAtUnix: 10_000,
          }],
        }],
        credits: { hasCredits: true, unlimited: false, balance: '12.50' },
      },
      source: 'cache',
      fetchedAt: 100,
      expiresAt: 200,
      refreshFailed: false,
    };
    const getResponse = await fetch(`${binding.url}/api/provider-profiles/openai-default/usage`);
    assert.equal(getResponse.status, 200);
    const getText = await getResponse.text();
    assert.doesNotMatch(getText, /private-account|private-user|private@example/u);
    assert.deepEqual(JSON.parse(getText), expected);

    const html = await fetch(binding.url).then((response) => response.text());
    const token = html.match(/name="codexbridge-admin-token" content="([a-f0-9]+)"/u)?.[1] ?? '';
    const unauthorized = await fetch(`${binding.url}/api/provider-profiles/openai-default/usage/refresh`, {
      method: 'POST',
      headers: { origin: binding.url },
    });
    assert.equal(unauthorized.status, 403);

    const noOrigin = await fetch(`${binding.url}/api/provider-profiles/openai-default/usage/refresh`, {
      method: 'POST',
    });
    assert.equal(noOrigin.status, 403);

    const refreshResponse = await fetch(`${binding.url}/api/provider-profiles/openai-default/usage/refresh`, {
      method: 'POST',
      headers: { origin: binding.url, 'x-codexbridge-admin-token': token },
    });
    assert.equal(refreshResponse.status, 200);
    const refreshed = await refreshResponse.json() as any;
    assert.equal(refreshed.source, 'provider');
    assert.deepEqual(providerUsage.calls, [
      { providerProfileId: 'openai-default', forceRefresh: false },
      { providerProfileId: 'openai-default', forceRefresh: true },
    ]);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer sanitizes provider usage lookup failures', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const missingServer = new WeixinAdminServer({
    accountStore,
    stateDir,
    providerUsage: {
      async getUsage() { throw new NotFoundError('private profile detail'); },
      invalidate() {},
    },
    port: 0,
  });
  const failingServer = new WeixinAdminServer({
    accountStore,
    stateDir,
    providerUsage: {
      async getUsage() { throw new Error('api-key=private usage failure'); },
      invalidate() {},
    },
    port: 0,
  });
  const missingBinding = await missingServer.start();
  const failingBinding = await failingServer.start();
  try {
    const missing = await fetch(`${missingBinding.url}/api/provider-profiles/missing/usage`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'provider profile not found' });

    const failing = await fetch(`${failingBinding.url}/api/provider-profiles/openai-default/usage`);
    assert.equal(failing.status, 500);
    const text = await failing.text();
    assert.doesNotMatch(text, /api-key|private usage/u);
    assert.deepEqual(JSON.parse(text), { error: 'provider usage unavailable' });
  } finally {
    await missingServer.stop();
    await failingServer.stop();
  }
});

test('WeixinAdminServer lists accounts and renders pairing QR data for the panel', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  accountStore.saveAccount({
    accountId: 'bot-primary',
    token: 'token-primary',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-primary',
  });

  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env: {
      WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-primary',
    },
    port: 0,
    qrLogin: async ({ accountStore: store, onQrCode, onStatus }) => {
      await onQrCode?.({
        qrcode: 'qr-1',
        qrcodeImageContent: 'https://liteapp.weixin.qq.com/q/?qrcode=qr-1&bot_type=3',
        raw: {} as any,
      });
      await onStatus?.({
        status: 'confirmed',
        qrcode: 'qr-1',
        raw: {} as any,
      });
      store.saveAccount({
        accountId: 'bot-friend',
        token: 'token-friend',
        baseUrl: 'https://ilink.example.com',
        userId: 'wxid-friend',
      });
      return {
        account_id: 'bot-friend',
        token: 'token-friend',
        base_url: 'https://ilink.example.com',
        user_id: 'wxid-friend',
      };
    },
  });

  const binding = await server.start();
  try {
    const startResponse = await fetch(`${binding.url}/api/pairing/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Friend A' }),
    });
    assert.equal(startResponse.status, 200);
    const startBody = await startResponse.json() as any;
    assert.equal(startBody.pairing.qrcode, 'qr-1');
    assert.equal(startBody.pairing.qrUrl, 'https://liteapp.weixin.qq.com/q/?qrcode=qr-1&bot_type=3');
    assert.match(startBody.pairing.qrImageDataUrl, /^data:image\/png;base64,/u);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const stateResponse = await fetch(`${binding.url}/api/state`);
    const stateBody = await stateResponse.json() as any;
    const friend = stateBody.accounts.find((account: any) => account.accountId === 'bot-friend');
    assert.equal(friend.displayName, 'Friend A');
    assert.equal(friend.primary, false);
    assert.equal(stateBody.accounts.find((account: any) => account.accountId === 'bot-primary')?.primary, true);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer can rename, disable, and delete non-primary accounts', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  accountStore.saveAccount({
    accountId: 'bot-primary',
    token: 'token-primary',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-primary',
  });
  accountStore.saveAccount({
    accountId: 'bot-friend',
    token: 'token-friend',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-friend',
  });
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env: {
      WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-primary',
    },
    port: 0,
  });

  const binding = await server.start();
  try {
    const patchResponse = await fetch(`${binding.url}/api/accounts/bot-friend`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Friend B', disabled: true }),
    });
    assert.equal(patchResponse.status, 200);
    assert.equal(accountStore.loadAccount('bot-friend')?.display_name, 'Friend B');
    assert.equal(accountStore.loadAccount('bot-friend')?.disabled, true);

    const primaryPatch = await fetch(`${binding.url}/api/accounts/bot-primary`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    assert.equal(primaryPatch.status, 400);

    const deleteResponse = await fetch(`${binding.url}/api/accounts/bot-friend`, {
      method: 'DELETE',
    });
    assert.equal(deleteResponse.status, 200);
    assert.equal(accountStore.loadAccount('bot-friend'), null);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer updates account group, role, permissions, and model defaults', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  accountStore.saveAccount({
    accountId: 'bot-primary',
    token: 'token-primary',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-primary',
  });
  accountStore.saveAccount({
    accountId: 'bot-friend',
    token: 'token-friend',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-friend',
  });
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env: {
      WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-primary',
    },
    port: 0,
  });

  const binding = await server.start();
  try {
    const patchResponse = await fetch(`${binding.url}/api/accounts/bot-friend`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        group: '朋友',
        role: 'viewer',
        permissions: {
          canChat: true,
          canUpload: false,
          canExecuteCommands: false,
        },
        modelProvider: {
          providerProfileId: 'deepseek',
          model: 'deepseek-v4-flash',
          reasoningEffort: 'low',
        },
      }),
    });
    assert.equal(patchResponse.status, 200);

    const saved = accountStore.loadAccount('bot-friend') as any;
    assert.equal(saved.group, '朋友');
    assert.equal(saved.role, 'viewer');
    assert.deepEqual(saved.permissions, {
      can_chat: true,
      can_upload: false,
      can_execute_commands: false,
    });
    assert.deepEqual(saved.model_provider, {
      provider_profile_id: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoning_effort: 'low',
    });

    const stateResponse = await fetch(`${binding.url}/api/state`);
    const stateBody = await stateResponse.json() as any;
    const friend = stateBody.accounts.find((account: any) => account.accountId === 'bot-friend');
    assert.equal(friend.group, '朋友');
    assert.equal(friend.role, 'viewer');
    assert.equal(friend.permissions.canUpload, false);
    assert.equal(friend.modelProvider.model, 'deepseek-v4-flash');
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer validates account model defaults against the automatic provider catalog', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  accountStore.saveAccount({
    accountId: 'bot-friend',
    token: 'token-friend',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-friend',
  });
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  const now = Date.now();
  repositories.providerProfiles.save({
    id: 'profile-1',
    providerKind: 'openai-compatible',
    displayName: 'Profile 1',
    config: {
      defaultModel: 'static-only-model',
      modelIds: ['static-only-model'],
    },
    createdAt: now,
    updatedAt: now,
  });
  const catalog = makeAccountValidationCatalogFake({
    modelsByProvider: {
      'profile-1': [
        { id: 'gpt-5', supportedReasoningEfforts: ['low', 'high'] },
        { id: 'flex-model', supportedReasoningEfforts: [] },
      ],
    },
    source: 'profile',
    stale: true,
    refreshFailed: true,
  });
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    repositories,
    providerModelCatalog: catalog,
  });

  const binding = await server.start();
  try {
    const patch = (modelProvider: Record<string, string>) => fetch(`${binding.url}/api/accounts/bot-friend`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelProvider }),
    });

    const accepted = await patch({ providerProfileId: 'profile-1', model: 'gpt-5', reasoningEffort: 'high' });
    assert.equal(accepted.status, 200);
    assert.deepEqual(catalog.calls, [{ providerProfileId: 'profile-1', forceRefresh: false }]);

    const unlisted = await patch({ providerProfileId: 'profile-1', model: 'missing-model', reasoningEffort: '' });
    assert.equal(unlisted.status, 400);
    assert.deepEqual(await unlisted.json(), {
      error: 'model is not available for provider profile',
      providerProfileId: 'profile-1',
      model: 'missing-model',
      availableModels: ['gpt-5', 'flex-model'],
    });

    const unsupportedEffort = await patch({ providerProfileId: 'profile-1', model: 'gpt-5', reasoningEffort: 'medium' });
    assert.equal(unsupportedEffort.status, 400);
    assert.deepEqual(await unsupportedEffort.json(), {
      error: 'reasoning effort is not available for model',
      providerProfileId: 'profile-1',
      model: 'gpt-5',
      reasoningEffort: 'medium',
      availableReasoningEfforts: ['low', 'high'],
    });

    const emptyModel = await patch({ providerProfileId: 'profile-1', model: '', reasoningEffort: '' });
    assert.equal(emptyModel.status, 200);

    const emptyModelUnknownProvider = await patch({
      providerProfileId: 'missing-provider',
      model: '',
      reasoningEffort: '',
    });
    assert.equal(emptyModelUnknownProvider.status, 400);
    assert.deepEqual(await emptyModelUnknownProvider.json(), {
      error: 'unknown provider profile',
      providerProfileId: 'missing-provider',
    });

    const modelWithoutProvider = await patch({ providerProfileId: '', model: 'gpt-5', reasoningEffort: 'high' });
    assert.equal(modelWithoutProvider.status, 400);

    const unknownProvider = await patch({ providerProfileId: 'missing-provider', model: 'gpt-5', reasoningEffort: 'high' });
    assert.equal(unknownProvider.status, 400);

    for (const reasoningEffort of ['', 'low', 'medium', 'high', 'xhigh']) {
      const compatible = await patch({ providerProfileId: 'profile-1', model: 'flex-model', reasoningEffort });
      assert.equal(compatible.status, 200, `expected compatibility effort ${reasoningEffort || '(empty)'} to pass`);
    }
    const invalidCompatibleEffort = await patch({
      providerProfileId: 'profile-1',
      model: 'flex-model',
      reasoningEffort: 'legacy-effort',
    });
    assert.equal(invalidCompatibleEffort.status, 400);
    assert.deepEqual((await invalidCompatibleEffort.json() as any).availableReasoningEfforts, [
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    assert.ok(catalog.calls.every((call) => call.forceRefresh === false));
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer preserves unavailable account model triples only for the unchanged account', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  for (const accountId of ['bot-legacy', 'bot-other', 'bot-orphan']) {
    accountStore.saveAccount({ accountId, token: `token-${accountId}`, baseUrl: 'https://ilink.example.com' });
  }
  accountStore.updateAccount('bot-legacy', {
    model_provider: {
      provider_profile_id: 'profile-1',
      model: 'removed-model',
      reasoning_effort: 'legacy-effort',
    },
  });
  accountStore.updateAccount('bot-orphan', {
    model_provider: {
      provider_profile_id: 'removed-provider',
      model: 'removed-model',
      reasoning_effort: 'legacy-effort',
    },
  });
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  const now = Date.now();
  for (const id of ['profile-1', 'profile-2']) {
    repositories.providerProfiles.save({
      id,
      providerKind: 'openai-compatible',
      displayName: id,
      config: {},
      createdAt: now,
      updatedAt: now,
    });
  }
  const catalog = makeAccountValidationCatalogFake({
    modelsByProvider: {
      'profile-1': [{ id: 'gpt-5', supportedReasoningEfforts: ['low', 'high'] }],
      'profile-2': [{ id: 'other-model', supportedReasoningEfforts: ['medium'] }],
    },
  });
  const server = new WeixinAdminServer({ accountStore, stateDir, repositories, providerModelCatalog: catalog, port: 0 });
  const binding = await server.start();
  const patch = (accountId: string, modelProvider: Record<string, string>, extra: Record<string, unknown> = {}) => (
    fetch(`${binding.url}/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...extra, modelProvider }),
    })
  );
  const legacyTriple = {
    providerProfileId: 'profile-1',
    model: 'removed-model',
    reasoningEffort: 'legacy-effort',
  };
  try {
    const preserved = await patch('bot-legacy', legacyTriple, {
      permissions: { canChat: true, canUpload: false, canExecuteCommands: false },
    });
    assert.equal(preserved.status, 200);
    assert.deepEqual(catalog.calls, [{ providerProfileId: 'profile-1', forceRefresh: false }]);
    assert.equal(accountStore.loadAccount('bot-legacy')?.permissions?.can_upload, false);

    const transferred = await patch('bot-other', legacyTriple);
    assert.equal(transferred.status, 400);
    assert.equal(accountStore.loadAccount('bot-other')?.model_provider, undefined);

    const changedEffort = await patch('bot-legacy', { ...legacyTriple, reasoningEffort: 'another-legacy-effort' });
    assert.equal(changedEffort.status, 400);

    const changedProvider = await patch('bot-legacy', { ...legacyTriple, providerProfileId: 'profile-2' });
    assert.equal(changedProvider.status, 400);
    assert.deepEqual((await changedProvider.json() as any).availableModels, ['other-model']);

    const orphanTriple = {
      providerProfileId: 'removed-provider',
      model: 'removed-model',
      reasoningEffort: 'legacy-effort',
    };
    const preservedOrphan = await patch('bot-orphan', orphanTriple);
    assert.equal(preservedOrphan.status, 200);
    const transferredOrphan = await patch('bot-other', orphanTriple);
    assert.equal(transferredOrphan.status, 400);

    const changedAway = await patch('bot-legacy', {
      providerProfileId: 'profile-1',
      model: 'gpt-5',
      reasoningEffort: 'high',
    });
    assert.equal(changedAway.status, 200);
    const changedBack = await patch('bot-legacy', legacyTriple);
    assert.equal(changedBack.status, 400);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer preserves an unchanged orphan triple when provider profiles are gone', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  for (const accountId of ['bot-orphan', 'bot-other']) {
    accountStore.saveAccount({ accountId, token: `token-${accountId}`, baseUrl: 'https://ilink.example.com' });
  }
  accountStore.updateAccount('bot-orphan', {
    model_provider: {
      provider_profile_id: 'removed-provider',
      model: 'removed-model',
      reasoning_effort: 'legacy-effort',
    },
  });
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  const catalog = makeAccountValidationCatalogFake();
  const server = new WeixinAdminServer({ accountStore, stateDir, repositories, providerModelCatalog: catalog, port: 0 });
  const binding = await server.start();
  const patch = (accountId: string, modelProvider: Record<string, string>) => (
    fetch(`${binding.url}/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelProvider }),
    })
  );
  const orphanTriple = {
    providerProfileId: 'removed-provider',
    model: 'removed-model',
    reasoningEffort: 'legacy-effort',
  };
  try {
    const preservedOrphan = await patch('bot-orphan', orphanTriple);
    assert.equal(preservedOrphan.status, 200);

    const transferredOrphan = await patch('bot-other', orphanTriple);
    assert.equal(transferredOrphan.status, 400);
    assert.deepEqual(await transferredOrphan.json(), {
      error: 'unknown provider profile',
      providerProfileId: 'removed-provider',
    });
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer sanitizes account catalog errors before updating the account', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  accountStore.saveAccount({ accountId: 'bot-friend', token: 'token-friend', baseUrl: 'https://ilink.example.com' });
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  const now = Date.now();
  repositories.providerProfiles.save({
    id: 'profile-1',
    providerKind: 'openai-compatible',
    displayName: 'Profile 1',
    config: {},
    createdAt: now,
    updatedAt: now,
  });
  let updateCalls = 0;
  const originalUpdateAccount = accountStore.updateAccount.bind(accountStore);
  accountStore.updateAccount = (...args) => {
    updateCalls += 1;
    return originalUpdateAccount(...args);
  };
  const catalog = makeAccountValidationCatalogFake({
    error: new Error('api-key=secret upstream body'),
    onLoad: () => assert.equal(updateCalls, 0),
  });
  const server = new WeixinAdminServer({ accountStore, stateDir, repositories, providerModelCatalog: catalog, port: 0 });
  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/accounts/bot-friend`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Changed',
        modelProvider: { providerProfileId: 'profile-1', model: 'gpt-5', reasoningEffort: 'high' },
      }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.deepEqual(body, { error: 'provider model catalog unavailable', providerProfileId: 'profile-1' });
    assert.doesNotMatch(JSON.stringify(body), /api-key|secret|upstream/iu);
    assert.deepEqual(catalog.calls, [{ providerProfileId: 'profile-1', forceRefresh: false }]);
    assert.equal(updateCalls, 0);
    assert.equal(accountStore.loadAccount('bot-friend')?.display_name, undefined);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer switches the primary account and persists service env', async () => {
  const stateDir = makeTempStateDir();
  const envFile = path.join(stateDir, 'service.env');
  fs.writeFileSync(envFile, [
    'WEIXIN_ACCOUNT_ID=bot-primary',
    'WEIXIN_PRIMARY_ACCOUNT_ID=bot-primary',
    'CODEXBRIDGE_DEBUG_WEIXIN=0',
    '',
  ].join('\n'), 'utf8');
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  accountStore.saveAccount({
    accountId: 'bot-primary',
    token: 'token-primary',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-primary',
  });
  accountStore.saveAccount({
    accountId: 'bot-friend',
    token: 'token-friend',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-friend',
  });
  accountStore.updateAccount('bot-friend', { disabled: true });
  const env: Record<string, string> = {
    WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-primary',
    CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE: envFile,
  };
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env,
    port: 0,
  });

  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/primary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'bot-friend' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as any;

    assert.equal(env.WEIXIN_PRIMARY_ACCOUNT_ID, 'bot-friend');
    assert.equal(env.WEIXIN_ACCOUNT_ID, '');
    assert.equal(accountStore.loadAccount('bot-friend')?.disabled, false);
    assert.equal(body.primaryAccountId, 'bot-friend');
    assert.equal(body.accounts.find((account: any) => account.accountId === 'bot-friend')?.primary, true);
    const envText = fs.readFileSync(envFile, 'utf8');
    assert.match(envText, /^WEIXIN_ACCOUNT_ID=$/mu);
    assert.match(envText, /^WEIXIN_PRIMARY_ACCOUNT_ID=bot-friend$/mu);
    assert.match(envText, /^CODEXBRIDGE_DEBUG_WEIXIN=0$/mu);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer controls bridge start and stop from the panel API', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  let running = true;
  const calls: string[] = [];
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    bridgeControl: {
      async start() {
        calls.push('start');
        running = true;
      },
      async stop() {
        calls.push('stop');
        running = false;
      },
      async restart() {
        calls.push('restart');
        running = true;
      },
      status() {
        return { running };
      },
    },
  });

  const binding = await server.start();
  try {
    const stopResponse = await fetch(`${binding.url}/api/bridge/stop`, { method: 'POST' });
    assert.equal(stopResponse.status, 200);
    const stopBody = await stopResponse.json() as any;
    assert.equal(stopBody.bridge.running, false);

    const startResponse = await fetch(`${binding.url}/api/bridge/start`, { method: 'POST' });
    assert.equal(startResponse.status, 200);
    const startBody = await startResponse.json() as any;
    assert.equal(startBody.bridge.running, true);
    const restartResponse = await fetch(`${binding.url}/api/bridge/restart`, { method: 'POST' });
    assert.equal(restartResponse.status, 200);
    const restartBody = await restartResponse.json() as any;
    assert.equal(restartBody.bridge.running, true);
    assert.deepEqual(calls, ['stop', 'start', 'restart']);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer retries the delivery outbox through an authorized aggregate-only API', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  let retryCalls = 0;
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    bridgeControl: {
      async start() {},
      async stop() {},
      async restart() {},
      status() {
        return {
          running: true,
          deliveryOutbox: {
            pending: retryCalls === 0 ? 2 : 1,
            oldestCreatedAt: 1_000,
            nextAttemptAt: 2_000,
          },
        };
      },
      async retryPendingDeliveries() {
        retryCalls += 1;
        return {
          before: {
            pending: 2,
            oldestCreatedAt: 1_000,
            nextAttemptAt: 2_000,
            content: 'private queued message',
            externalScopeId: 'wx-private-scope',
          },
          after: {
            pending: 1,
            oldestCreatedAt: 1_500,
            nextAttemptAt: 2_500,
            lastError: 'private retry error',
          },
        } as any;
      },
    },
  });

  const binding = await server.start();
  try {
    const html = await fetch(binding.url).then((response) => response.text());
    const token = html.match(/name="codexbridge-admin-token" content="([a-f0-9]+)"/u)?.[1] ?? '';

    const unauthorized = await fetch(`${binding.url}/api/delivery-outbox/retry`, {
      method: 'POST',
      headers: { origin: binding.url },
    });
    assert.equal(unauthorized.status, 403);

    const noOrigin = await fetch(`${binding.url}/api/delivery-outbox/retry`, {
      method: 'POST',
    });
    assert.equal(noOrigin.status, 403);

    const response = await fetch(`${binding.url}/api/delivery-outbox/retry`, {
      method: 'POST',
      headers: {
        origin: binding.url,
        'x-codexbridge-admin-token': token,
      },
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.doesNotMatch(text, /private queued|private-scope|private retry error/u);
    assert.deepEqual(JSON.parse(text), {
      ok: true,
      before: { pending: 2, oldestCreatedAt: 1_000, nextAttemptAt: 2_000 },
      after: { pending: 1, oldestCreatedAt: 1_500, nextAttemptAt: 2_500 },
    });
    assert.equal(retryCalls, 1);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer rejects delivery outbox retries while the bridge is stopped or unsupported', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  let retryCalls = 0;
  const stoppedServer = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    bridgeControl: {
      async start() {},
      async stop() {},
      async restart() {},
      status: () => ({ running: false }),
      async retryPendingDeliveries() {
        retryCalls += 1;
        return {
          before: { pending: 0, oldestCreatedAt: null, nextAttemptAt: null },
          after: { pending: 0, oldestCreatedAt: null, nextAttemptAt: null },
        };
      },
    },
  });
  const stoppedBinding = await stoppedServer.start();
  try {
    const html = await fetch(stoppedBinding.url).then((response) => response.text());
    const token = html.match(/name="codexbridge-admin-token" content="([a-f0-9]+)"/u)?.[1] ?? '';
    const response = await fetch(`${stoppedBinding.url}/api/delivery-outbox/retry`, {
      method: 'POST',
      headers: { origin: stoppedBinding.url, 'x-codexbridge-admin-token': token },
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'bridge is not running' });
    assert.equal(retryCalls, 0);
  } finally {
    await stoppedServer.stop();
  }

  const unsupportedServer = new WeixinAdminServer({ accountStore, stateDir, port: 0 });
  const unsupportedBinding = await unsupportedServer.start();
  try {
    const html = await fetch(unsupportedBinding.url).then((response) => response.text());
    const token = html.match(/name="codexbridge-admin-token" content="([a-f0-9]+)"/u)?.[1] ?? '';
    const response = await fetch(`${unsupportedBinding.url}/api/delivery-outbox/retry`, {
      method: 'POST',
      headers: { origin: unsupportedBinding.url, 'x-codexbridge-admin-token': token },
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'delivery retry is unavailable' });
  } finally {
    await unsupportedServer.stop();
  }

  const failingServer = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    bridgeControl: {
      async start() {},
      async stop() {},
      async restart() {},
      status: () => ({
        running: true,
        deliveryOutbox: { pending: 1, oldestCreatedAt: 3_000, nextAttemptAt: 4_000 },
      }),
      async retryPendingDeliveries() {
        throw new Error('private retry failure');
      },
    },
  });
  const failingBinding = await failingServer.start();
  try {
    const html = await fetch(failingBinding.url).then((response) => response.text());
    const token = html.match(/name="codexbridge-admin-token" content="([a-f0-9]+)"/u)?.[1] ?? '';
    const response = await fetch(`${failingBinding.url}/api/delivery-outbox/retry`, {
      method: 'POST',
      headers: { origin: failingBinding.url, 'x-codexbridge-admin-token': token },
    });
    assert.equal(response.status, 500);
    const text = await response.text();
    assert.doesNotMatch(text, /private retry failure/u);
    assert.deepEqual(JSON.parse(text), {
      error: 'delivery retry failed',
      deliveryOutbox: { pending: 1, oldestCreatedAt: 3_000, nextAttemptAt: 4_000 },
    });
  } finally {
    await failingServer.stop();
  }

  let statusCalls = 0;
  const statusFailingServer = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    bridgeControl: {
      async start() {},
      async stop() {},
      async restart() {},
      status() {
        statusCalls += 1;
        if (statusCalls > 1) {
          throw new Error('private status failure');
        }
        return { running: true };
      },
      async retryPendingDeliveries() {
        throw new Error('private retry failure');
      },
    },
  });
  const statusFailingBinding = await statusFailingServer.start();
  try {
    const html = await fetch(statusFailingBinding.url).then((response) => response.text());
    const token = html.match(/name="codexbridge-admin-token" content="([a-f0-9]+)"/u)?.[1] ?? '';
    const response = await fetch(`${statusFailingBinding.url}/api/delivery-outbox/retry`, {
      method: 'POST',
      headers: {
        origin: statusFailingBinding.url,
        'x-codexbridge-admin-token': token,
      },
    });
    assert.equal(response.status, 500);
    const text = await response.text();
    assert.doesNotMatch(text, /private status|private retry/u);
    assert.deepEqual(JSON.parse(text), {
      error: 'delivery retry failed',
      deliveryOutbox: { pending: 0, oldestCreatedAt: null, nextAttemptAt: null },
    });
  } finally {
    await statusFailingServer.stop();
  }
});

test('WeixinAdminServer sanitizes unexpected request failures', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    bridgeControl: {
      async start() {},
      async stop() {},
      async restart() {},
      status() { throw new Error('api-key=private unexpected failure'); },
    },
  });
  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/state`);
    assert.equal(response.status, 500);
    const text = await response.text();
    assert.doesNotMatch(text, /api-key|private unexpected|WeixinAdminServer/u);
    assert.deepEqual(JSON.parse(text), { error: 'internal server error' });
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer protects browser mutations with same-origin token checks and security headers', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const server = new WeixinAdminServer({ accountStore, stateDir, port: 0 });
  const binding = await server.start();
  try {
    const pageResponse = await fetch(binding.url);
    const html = await pageResponse.text();
    assert.equal(pageResponse.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(pageResponse.headers.get('x-frame-options'), 'DENY');
    assert.match(pageResponse.headers.get('content-security-policy') ?? '', /default-src 'self'/u);
    const token = html.match(/name="codexbridge-admin-token" content="([a-f0-9]+)"/u)?.[1] ?? '';
    assert.ok(token.length >= 32);
    const styleNonce = html.match(/<style nonce="([^"]+)">/u)?.[1] ?? '';
    const csp = pageResponse.headers.get('content-security-policy') ?? '';
    assert.ok(styleNonce);
    assert.ok(csp.includes(`style-src-elem 'self' 'nonce-${styleNonce}'`));

    const foreignOrigin = await fetch(`${binding.url}/api/pairing/cancel`, {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(foreignOrigin.status, 403);

    const missingToken = await fetch(`${binding.url}/api/pairing/cancel`, {
      method: 'POST',
      headers: { origin: binding.url },
    });
    assert.equal(missingToken.status, 403);

    const crossSiteSubresource = await fetch(`${binding.url}/api/page/close`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(crossSiteSubresource.status, 403);

    const authorized = await fetch(`${binding.url}/api/pairing/cancel`, {
      method: 'POST',
      headers: {
        origin: binding.url,
        'x-codexbridge-admin-token': token,
      },
    });
    assert.equal(authorized.status, 200);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer accepts browser mutations on the IPv4 loopback range', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const server = new WeixinAdminServer({ accountStore, stateDir, host: '127.0.0.2', port: 0 });
  const binding = await server.start();
  try {
    const html = await fetch(binding.url).then((response) => response.text());
    const token = html.match(/name="codexbridge-admin-token" content="([a-f0-9]+)"/u)?.[1] ?? '';
    const response = await fetch(`${binding.url}/api/pairing/cancel`, {
      method: 'POST',
      headers: {
        origin: binding.url,
        'x-codexbridge-admin-token': token,
      },
    });

    assert.equal(response.status, 200);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer updates concurrency settings and persists service env', async () => {
  const stateDir = makeTempStateDir();
  const envFile = path.join(stateDir, 'service.env');
  fs.writeFileSync(envFile, 'WEIXIN_MAX_CONCURRENT_TURNS=3\n', 'utf8');
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  let configured: any = null;
  const env: Record<string, string> = {
    CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE: envFile,
  };
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env,
    port: 0,
    bridgeControl: {
      async start() {},
      async stop() {},
      async restart() {},
      async configureConcurrency(settings) {
        configured = settings;
      },
      status() {
        return {
          running: true,
          maxConcurrentTurns: configured?.maxConcurrentTurns ?? 3,
          eventDispatchConcurrency: configured?.eventDispatchConcurrency ?? 12,
          weixin: {
            attachmentProcessingConcurrency: configured?.attachmentProcessingConcurrency ?? 3,
            accountPollConcurrency: configured?.accountPollConcurrency ?? 4,
          },
        };
      },
    },
  });

  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        concurrency: {
          maxConcurrentTurns: 5,
          eventDispatchConcurrency: 10,
          attachmentProcessingConcurrency: 4,
          accountPollConcurrency: 6,
        },
        logCleanup: {
          enabled: true,
          retentionDays: 9,
          maxBytes: 123456,
          intervalMinutes: 30,
        },
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as any;

    assert.deepEqual(configured, {
      maxConcurrentTurns: 5,
      eventDispatchConcurrency: 10,
      attachmentProcessingConcurrency: 4,
      accountPollConcurrency: 6,
    });
    assert.equal(body.settings.concurrency.maxConcurrentTurns, 5);
    assert.equal(body.settings.logCleanup.retentionDays, 9);
    const envText = fs.readFileSync(envFile, 'utf8');
    assert.match(envText, /^WEIXIN_MAX_CONCURRENT_TURNS=5$/mu);
    assert.match(envText, /^WEIXIN_EVENT_DISPATCH_CONCURRENCY=10$/mu);
    assert.match(envText, /^WEIXIN_ATTACHMENT_CONCURRENCY=4$/mu);
    assert.match(envText, /^WEIXIN_ACCOUNT_POLL_CONCURRENCY=6$/mu);
    assert.match(envText, /^WEIXIN_LOG_RETENTION_DAYS=9$/mu);
    assert.match(envText, /^WEIXIN_LOG_MAX_BYTES=123456$/mu);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer exposes structured metrics and resets counters', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  let resetCalled = false;
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    bridgeControl: {
      async start() {},
      async stop() {},
      async restart() {},
      getMetrics() {
        return resetCalled
          ? {
            messagesReceived: 0,
            turnsCompleted: 0,
            turnsFailed: 0,
            deliveriesSucceeded: 0,
            deliveriesFailed: 0,
            replyFailures: 0,
            errors: 0,
            errorsRecentHour: 0,
            errorBreakdown: { poll: 0, runtime: 0, commit: 0 },
            currentError: null,
          }
          : {
            messagesReceived: 3,
            turnsCompleted: 2,
            turnsFailed: 1,
            deliveriesSucceeded: 2,
            deliveriesFailed: 1,
            replyFailures: 2,
            errors: 7,
            errorsRecentHour: 4,
            errorBreakdown: { poll: 5, runtime: 2, commit: 0 },
            currentError: { at: Date.now(), stage: 'poll', message: 'socket hang up' },
          };
      },
      resetMetrics() {
        resetCalled = true;
        return this.getMetrics?.() ?? {};
      },
      status() {
        return { running: true };
      },
    },
  });

  const binding = await server.start();
  try {
    const metricsResponse = await fetch(`${binding.url}/api/metrics`);
    assert.equal(metricsResponse.status, 200);
    const metrics = await metricsResponse.json() as any;
    assert.equal(metrics.errorsRecentHour, 4);
    assert.equal(metrics.errorBreakdown.poll, 5);
    assert.equal(metrics.replyFailures, 2);

    const resetResponse = await fetch(`${binding.url}/api/metrics/reset`, { method: 'POST' });
    assert.equal(resetResponse.status, 200);
    const resetBody = await resetResponse.json() as any;
    assert.equal(resetBody.ok, true);
    assert.equal(resetBody.metrics.errors, 0);
    assert.equal(resetBody.metrics.replyFailures, 0);
    assert.equal(resetCalled, true);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer runs diagnostics for service, account, provider, ports, and Codex health', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  accountStore.saveAccount({
    accountId: 'bot-primary',
    token: 'token-primary',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-primary',
  });
  const modelServer = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'gpt-test' }] }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  await new Promise<void>((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
  const address = modelServer.address();
  const modelPort = typeof address === 'object' && address ? address.port : 0;
  const env: Record<string, string> = {
    WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-primary',
    CODEX_COMPAT_API_KEY: 'test-key',
    CODEX_COMPAT_BASE_URL: `http://127.0.0.1:${modelPort}`,
    CODEX_COMPAT_DEFAULT_MODEL: 'gpt-test',
    CODEX_COMPAT_PROVIDER_NAME: 'Z Token',
    CODEX_NATIVE_API_ENABLE: '0',
  };
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env,
    port: 0,
    bridgeControl: {
      async start() {},
      async stop() {},
      async restart() {},
      status() {
        return {
          running: true,
          activeTurns: 0,
          queuedTurns: 0,
          lastPollAt: Date.now(),
          lastError: null,
          lastErrorStage: null,
        };
      },
    },
  });

  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/diagnostics/run`, { method: 'POST' });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.summary.failed, 0);
    assert.equal(body.summary.warned, 2);
    const byId = new Map<string, any>(body.checks.map((check: any) => [check.id, check]));
    assert.equal(byId.get('service')?.status, 'ok');
    assert.equal(byId.get('weixin-account')?.status, 'ok');
    assert.equal(byId.get('api-key')?.status, 'ok');
    assert.equal(byId.get('model')?.status, 'ok');
    assert.equal(byId.get('ports')?.status, 'warn');
    assert.equal(byId.get('codex-native')?.status, 'warn');
  } finally {
    await server.stop();
    await new Promise<void>((resolve) => modelServer.close(() => resolve()));
  }
});

test('WeixinAdminServer exposes focused first-run setup tests with Chinese repair hints', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  accountStore.saveAccount({
    accountId: 'bot-primary',
    token: 'token-primary',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-primary',
  });
  const modelServer = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'gpt-test' }] }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  await new Promise<void>((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
  const address = modelServer.address();
  const modelPort = typeof address === 'object' && address ? address.port : 0;
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env: {
      WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-primary',
      CODEX_COMPAT_API_KEY: 'test-key',
      CODEX_COMPAT_BASE_URL: `http://127.0.0.1:${modelPort}`,
      CODEX_COMPAT_DEFAULT_MODEL: 'gpt-test',
      CODEX_COMPAT_PROVIDER_NAME: 'Z Token',
      CODEX_NATIVE_API_ENABLE: '0',
    },
    port: 0,
    bridgeControl: {
      async start() {},
      async stop() {},
      async restart() {},
      status() {
        return { running: true };
      },
    },
  });

  const binding = await server.start();
  try {
    for (const target of ['api-key', 'weixin', 'codex-command']) {
      const response = await fetch(`${binding.url}/api/setup/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      assert.equal(response.status, 200);
      const body = await response.json() as any;
      assert.equal(body.target, target);
      assert.ok(['ok', 'warn'].includes(body.check.status));
      assert.ok(String(body.message).includes('测试'));
      assert.ok(String(body.repairHint).length > 0);
    }
  } finally {
    await server.stop();
    await new Promise<void>((resolve) => modelServer.close(() => resolve()));
  }
});

test('WeixinAdminServer treats Codex Native API degraded health as a warning instead of a failure', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  accountStore.saveAccount({
    accountId: 'bot-primary',
    token: 'token-primary',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-primary',
  });
  const modelServer = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'gpt-test' }] }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  await new Promise<void>((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
  const address = modelServer.address();
  const modelPort = typeof address === 'object' && address ? address.port : 0;
  const nativeServer = http.createServer((req, res) => {
    if (req.url === '/v1/health') {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        status: 'degraded',
        native_runtime: {
          runtime_reachable: true,
          ready: false,
          provider_profile_id: 'deepseek',
        },
      }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  await new Promise<void>((resolve) => nativeServer.listen(0, '127.0.0.1', resolve));
  const nativeAddress = nativeServer.address();
  const nativePort = typeof nativeAddress === 'object' && nativeAddress ? nativeAddress.port : 0;
  const env: Record<string, string> = {
    WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-primary',
    CODEX_COMPAT_API_KEY: 'test-key',
    CODEX_COMPAT_BASE_URL: `http://127.0.0.1:${modelPort}`,
    CODEX_COMPAT_DEFAULT_MODEL: 'gpt-test',
    CODEX_COMPAT_PROVIDER_NAME: 'Z Token',
    CODEX_NATIVE_API_ENABLE: '1',
    CODEX_NATIVE_API_HOST: '127.0.0.1',
    CODEX_NATIVE_API_PORT: String(nativePort),
  };
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env,
    port: 0,
    bridgeControl: {
      async start() {},
      async stop() {},
      async restart() {},
      status() {
        return {
          running: true,
          activeTurns: 0,
          queuedTurns: 0,
          lastPollAt: Date.now(),
          lastError: null,
          lastErrorStage: null,
        };
      },
    },
  });

  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/diagnostics/run`, { method: 'POST' });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    const byId = new Map<string, any>(body.checks.map((check: any) => [check.id, check]));
    assert.equal(byId.get('codex-native')?.status, 'warn');
    assert.match(byId.get('codex-native')?.detail ?? '', /HTTP 503/u);
    assert.equal(body.summary.failed, 0);
  } finally {
    await server.stop();
    await new Promise<void>((resolve) => modelServer.close(() => resolve()));
    await new Promise<void>((resolve) => nativeServer.close(() => resolve()));
  }
});

test('WeixinAdminServer ignores degraded native openai-default health when a compatible provider is active', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  accountStore.saveAccount({
    accountId: 'bot-primary',
    token: 'token-primary',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-primary',
  });
  const modelServer = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }] }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  await new Promise<void>((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
  const address = modelServer.address();
  const modelPort = typeof address === 'object' && address ? address.port : 0;
  const nativeServer = http.createServer((req, res) => {
    if (req.url === '/v1/health') {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        status: 'degraded',
        native_runtime: {
          runtime_reachable: true,
          ready: false,
          provider_profile_id: 'openai-default',
        },
      }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  await new Promise<void>((resolve) => nativeServer.listen(0, '127.0.0.1', resolve));
  const nativeAddress = nativeServer.address();
  const nativePort = typeof nativeAddress === 'object' && nativeAddress ? nativeAddress.port : 0;
  const env: Record<string, string> = {
    WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-primary',
    CODEX_DEFAULT_PROVIDER_PROFILE_ID: 'deepseek',
    CODEX_COMPAT_PROVIDER_NAME: 'DeepSeek',
    CODEX_COMPAT_CAPABILITIES: 'deepseek',
    CODEX_COMPAT_API_KEY: 'test-key',
    CODEX_COMPAT_BASE_URL: `http://127.0.0.1:${modelPort}`,
    CODEX_COMPAT_DEFAULT_MODEL: 'deepseek-v4-flash',
    CODEX_NATIVE_API_ENABLE: '1',
    CODEX_NATIVE_API_HOST: '127.0.0.1',
    CODEX_NATIVE_API_PORT: String(nativePort),
  };
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env,
    port: 0,
    bridgeControl: {
      async start() {},
      async stop() {},
      async restart() {},
      status() {
        return {
          running: true,
          activeTurns: 0,
          queuedTurns: 0,
          lastPollAt: Date.now(),
          lastError: null,
          lastErrorStage: null,
        };
      },
    },
  });

  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/diagnostics/run`, { method: 'POST' });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    const byId = new Map<string, any>(body.checks.map((check: any) => [check.id, check]));
    assert.equal(byId.get('codex-native')?.status, 'ok');
    assert.match(byId.get('codex-native')?.detail ?? '', /DeepSeek/u);
    assert.equal(body.summary.failed, 0);
  } finally {
    await server.stop();
    await new Promise<void>((resolve) => modelServer.close(() => resolve()));
    await new Promise<void>((resolve) => nativeServer.close(() => resolve()));
  }
});

test('WeixinAdminServer updates model provider settings and preserves blank API keys', async () => {
  const stateDir = makeTempStateDir();
  const envFile = path.join(stateDir, 'service.env');
  fs.writeFileSync(envFile, 'CODEX_COMPAT_API_KEY=old-key\n', 'utf8');
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const env: Record<string, string> = {
    CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE: envFile,
    CODEX_COMPAT_API_KEY: 'old-key',
  };
  const catalog = makeProviderModelCatalogFake();
  const providerUsage = makeProviderUsageFake();
  let restartCount = 0;
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  repositories.bridgeSessions.save({
    id: 'session-1',
    providerProfileId: 'openai-default',
    codexThreadId: 'thread-1',
    cwd: null,
    title: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  repositories.sessionSettings.save({
    bridgeSessionId: 'session-1',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    serviceTier: null,
    locale: 'zh-CN',
    metadata: {},
    updatedAt: Date.now(),
  });
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env,
    repositories,
    providerModelCatalog: catalog,
    providerUsage,
    port: 0,
    bridgeControl: {
      async start() {},
      async stop() {},
      async restart() {
        restartCount += 1;
      },
      status() {
        return {
          running: true,
          lastPollAt: Date.now(),
          lastError: null,
          lastErrorStage: null,
        };
      },
    },
  });

  const binding = await server.start();
  try {
    const firstResponse = await fetch(`${binding.url}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        modelProvider: {
          profileId: 'qwen',
          providerId: 'qwen',
          providerName: 'Qwen',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
          model: 'qwen-plus',
          modelIds: 'qwen-plus',
          capabilities: 'qwen',
          apiKey: 'new-key',
          serviceEnvFile: envFile,
        },
      }),
    });
    assert.equal(firstResponse.status, 200);
    const firstBody = await firstResponse.json() as any;
    assert.equal(firstBody.restartRequired, true);
    assert.equal(firstBody.settings.modelProvider.profileId, 'qwen');
    assert.equal(firstBody.settings.modelProvider.providerName, 'Qwen');
    assert.equal(firstBody.settings.modelProvider.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
    assert.equal(firstBody.settings.modelProvider.model, 'qwen-plus');
    assert.equal(firstBody.settings.modelProvider.apiKeyConfigured, true);

    const firstEnvText = fs.readFileSync(envFile, 'utf8');
    assert.match(firstEnvText, /^CODEX_DEFAULT_PROVIDER_PROFILE_ID=qwen$/mu);
    assert.match(firstEnvText, /^CODEX_COMPAT_PROVIDER_ID=qwen$/mu);
    assert.match(firstEnvText, /^CODEX_COMPAT_PROVIDER_NAME=Qwen$/mu);
    assert.match(firstEnvText, /^CODEX_COMPAT_BASE_URL=https:\/\/dashscope\.aliyuncs\.com\/compatible-mode\/v1$/mu);
    assert.match(firstEnvText, /^CODEX_COMPAT_DEFAULT_MODEL=qwen-plus$/mu);
    assert.match(firstEnvText, /^CODEX_COMPAT_API_KEY=new-key$/mu);
    assert.equal(restartCount, 1);
    const clearedSettings = repositories.sessionSettings.getByBridgeSessionId('session-1');
    assert.equal(clearedSettings?.model, null);
    assert.equal(clearedSettings?.reasoningEffort, null);
    assert.equal(clearedSettings?.metadata.modelOverrideClearedReason, 'model-provider-updated');
    const qwenProfile = repositories.providerProfiles.getById('qwen');
    assert.equal((qwenProfile?.config as any)?.relayProfileMode, 'pure-api');
    assert.ok(catalog.invalidations.includes('qwen'));
    assert.ok(providerUsage.invalidations.includes('qwen'));

    const secondResponse = await fetch(`${binding.url}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        modelProvider: {
          profileId: 'qwen',
          providerId: 'qwen',
          providerName: 'Qwen',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          model: 'qwen-max',
          modelIds: 'qwen-max',
          capabilities: 'qwen',
          apiKey: '',
          serviceEnvFile: envFile,
        },
      }),
    });
    assert.equal(secondResponse.status, 200);
    const secondEnvText = fs.readFileSync(envFile, 'utf8');
    assert.match(secondEnvText, /^CODEX_COMPAT_DEFAULT_MODEL=qwen-max$/mu);
    assert.match(secondEnvText, /^CODEX_COMPAT_API_KEY=new-key$/mu);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer renders separated Z Token and official provider presets', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env: {},
    port: 0,
  });

  const binding = await server.start();
  try {
    const response = await fetch(binding.url);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<option value="default">Z Token - Codex<\/option>/u);
    assert.match(html, /<option value="ztoken-claude">Z Token - Claude<\/option>/u);
    assert.match(html, /<option value="official-codex">官网 Codex<\/option>/u);
    assert.match(html, /<option value="official-claude-code">官网 Claude Code<\/option>/u);
    assert.match(html, /models: \['gpt-5\.6-sol', 'gpt-5\.6-terra', 'gpt-5\.6-luna', 'gpt-5\.5', 'gpt-5\.4', 'gpt-5\.4-mini', 'gpt-5\.3-codex', 'gpt-5\.2'\]/u);
    assert.match(html, /models: \['claude-fable-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-5-20251101', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-6'\]/u);
    assert.match(html, /capabilities: 'claude'/u);
    assert.match(html, /id="refresh-btn">刷新列表<\/button>/u);
    assert.match(html, /\.refresh-spin/u);
    assert.match(html, /function runRefreshList\(\)/u);
    assert.match(html, /刷新中\.\.\./u);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer preserves official Claude provider capabilities when saving settings', async () => {
  const stateDir = makeTempStateDir();
  const envFile = path.join(stateDir, 'service.env');
  fs.writeFileSync(envFile, 'CODEX_COMPAT_API_KEY=claude-key\n', 'utf8');
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  const env: Record<string, string> = {
    CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE: envFile,
    CODEX_COMPAT_API_KEY: 'claude-key',
  };
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env,
    repositories,
    port: 0,
  });

  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        modelProvider: {
          profileId: 'claude-official',
          providerId: 'claude',
          providerName: '官网 Claude Code',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4-6',
          modelIds: 'claude-sonnet-4-6',
          capabilities: 'claude',
          apiKey: '',
          serviceEnvFile: envFile,
        },
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.settings.modelProvider.profileId, 'claude-official');
    assert.equal(body.settings.modelProvider.providerId, 'claude');
    assert.equal(body.settings.modelProvider.capabilities, 'claude');
    assert.equal(body.settings.modelProvider.model, 'claude-sonnet-4-6');
    const envText = fs.readFileSync(envFile, 'utf8');
    assert.match(envText, /^CODEX_DEFAULT_PROVIDER_PROFILE_ID=claude-official$/mu);
    assert.match(envText, /^CODEX_COMPAT_PROVIDER_ID=claude$/mu);
    assert.match(envText, /^CODEX_COMPAT_PROVIDER_NAME=官网 Claude Code$/mu);
    assert.match(envText, /^CODEX_COMPAT_CAPABILITIES=claude$/mu);
    assert.match(envText, /^CODEX_COMPAT_DEFAULT_MODEL=claude-sonnet-4-6$/mu);
    const profile = repositories.providerProfiles.getById('claude-official');
    assert.equal(profile?.id, 'claude-official');
    assert.equal((profile?.config as any)?.providerLabel, 'claude');
    assert.equal((profile?.config as any)?.defaultModel, 'claude-sonnet-4-6');
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer exposes and completes first-run setup state', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env: {},
    port: 0,
  });

  const binding = await server.start();
  try {
    const stateResponse = await fetch(`${binding.url}/api/state`);
    assert.equal(stateResponse.status, 200);
    const stateBody = await stateResponse.json() as any;
    assert.equal(stateBody.setup.needsSetup, true);
    assert.equal(stateBody.setup.checks.modelProvider.ok, false);
    assert.equal(stateBody.setup.checks.weixinAccount.ok, false);
    assert.match(stateBody.setup.checks.node.label, /^Node v/u);
    assert.equal(stateBody.setup.checks.dataDir.path, stateDir);

    const completeResponse = await fetch(`${binding.url}/api/setup/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skipped: true }),
    });
    assert.equal(completeResponse.status, 200);
    const completeBody = await completeResponse.json() as any;
    assert.equal(completeBody.setup.needsSetup, false);
    assert.equal(typeof completeBody.setup.skippedAt, 'string');
    assert.equal(completeBody.state.setup.needsSetup, false);

    const preference = JSON.parse(fs.readFileSync(path.join(stateDir, 'runtime', 'weixin-admin-preferences.json'), 'utf8'));
    assert.equal(typeof preference.firstRunSkippedAt, 'string');
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer quarantines and reinitializes corrupt admin preferences', async () => {
  const stateDir = makeTempStateDir();
  const runtimeDir = path.join(stateDir, 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const preferencesFile = path.join(runtimeDir, 'weixin-admin-preferences.json');
  fs.writeFileSync(preferencesFile, '{ private corrupt preferences', 'utf8');
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const server = new WeixinAdminServer({ accountStore, stateDir, env: {}, port: 0 });
  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/state`);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(preferencesFile, 'utf8')), {});
    const quarantined = fs.readdirSync(runtimeDir)
      .filter((name) => name.startsWith('weixin-admin-preferences.json.corrupt-'));
    assert.equal(quarantined.length, 1);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer syncs model provider settings from Codex/CCSwitch config', async () => {
  const stateDir = makeTempStateDir();
  const envFile = path.join(stateDir, 'service.env');
  const codexHome = path.join(stateDir, 'codex-home');
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), [
    'model = "gpt-5.5"',
    'model_provider = "ztoken"',
    '',
    '[model_providers.ztoken]',
    'name = "ZToken"',
    'base_url = "https://ztoken.app/v1"',
    'env_key = "OPENAI_API_KEY"',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({
    OPENAI_API_KEY: 'ccswitch-key',
  }, null, 2), 'utf8');
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const env: Record<string, string> = {
    CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE: envFile,
    CODEX_DEFAULT_PROVIDER_PROFILE_ID: 'openai-default',
  };
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  const catalog = makeProviderModelCatalogFake();
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env,
    repositories,
    providerModelCatalog: catalog,
    codexHome,
    port: 0,
  });

  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/model-provider/sync-ccswitch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codexHome, persistSource: true }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.model, 'gpt-5.5');
    assert.equal(body.baseUrl, 'https://ztoken.app/v1');
    assert.equal(body.settings.modelProvider.source, 'ccswitch');
    assert.equal(body.settings.modelProvider.apiKeyConfigured, true);
    assert.equal(body.settings.modelProvider.providerName, 'Z Token');
    assert.equal(env.CODEX_COMPAT_API_KEY, 'ccswitch-key');
    assert.equal(env.CODEX_COMPAT_PROVIDER_NAME, 'Z Token');
    assert.equal(env.CODEX_COMPAT_BASE_URL, 'https://ztoken.app/v1');
    assert.equal(env.CODEX_COMPAT_DEFAULT_MODEL, 'gpt-5.5');
    assert.match(fs.readFileSync(envFile, 'utf8'), /^CODEX_COMPAT_API_KEY=ccswitch-key$/mu);
    const profile = repositories.providerProfiles.getById('openai-default');
    assert.equal(profile?.providerKind, 'openai-compatible');
    assert.equal((profile?.config as any)?.defaultModel, 'gpt-5.5');
    assert.ok(catalog.invalidations.includes('openai-default'));
    const preference = JSON.parse(fs.readFileSync(path.join(stateDir, 'runtime', 'weixin-admin-preferences.json'), 'utf8'));
    assert.equal(preference.modelProviderSource, 'ccswitch');
    assert.equal(preference.ccswitchCodexHome, codexHome);

    const invalidationsAfterManualSync = catalog.invalidations.length;
    const unchangedSync = (server as any).syncCcswitchProvider({ codexHome, reason: 'interval' });
    assert.equal(unchangedSync.changed, false);
    assert.equal(catalog.invalidations.length, invalidationsAfterManualSync);

    const saveResponse = await fetch(`${binding.url}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        modelProvider: {
          profileId: 'openai-default',
          providerId: 'openai-compatible',
          providerName: 'Z Token',
          baseUrl: 'https://ztoken.app/v1',
          model: 'gpt-5.5',
          modelIds: 'gpt-5.5',
          capabilities: 'default',
          apiKey: '',
          serviceEnvFile: envFile,
          source: 'ccswitch',
          ccswitchCodexHome: codexHome,
          ccswitchSyncIntervalMs: 10000,
        },
      }),
    });
    assert.equal(saveResponse.status, 200);
    const saveBody = await saveResponse.json() as any;
    assert.equal(saveBody.settings.modelProvider.source, 'ccswitch');
    const savedPreference = JSON.parse(fs.readFileSync(path.join(stateDir, 'runtime', 'weixin-admin-preferences.json'), 'utf8'));
    assert.equal(savedPreference.modelProviderSource, 'ccswitch');
    assert.equal(savedPreference.ccswitchCodexHome, codexHome);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer normalizes DeepSeek CCSwitch configs to canonical DeepSeek endpoint and model', async () => {
  const stateDir = makeTempStateDir();
  const envFile = path.join(stateDir, 'service.env');
  const codexHome = path.join(stateDir, 'codex-home');
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), [
    'model = "gpt-5.5"',
    'model_provider = "deepseek"',
    '',
    '[model_providers.deepseek]',
    'name = "DeepSeek"',
    'base_url = "http://127.0.0.1:15721/v1/responses"',
    'env_key = "DEEPSEEK_API_KEY"',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({
    DEEPSEEK_API_KEY: 'deepseek-key',
  }, null, 2), 'utf8');
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const env: Record<string, string> = {
    CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE: envFile,
    CODEX_DEFAULT_PROVIDER_PROFILE_ID: 'openai-default',
  };
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env,
    repositories,
    codexHome,
    port: 0,
  });

  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/model-provider/sync-ccswitch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codexHome, persistSource: true }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.baseUrl, 'https://api.deepseek.com');
    assert.equal(body.model, 'deepseek-v4-flash');
    assert.equal(body.settings.modelProvider.capabilities, 'deepseek');
    assert.equal(env.CODEX_COMPAT_BASE_URL, 'https://api.deepseek.com');
    assert.equal(env.CODEX_COMPAT_DEFAULT_MODEL, 'deepseek-v4-flash');
    assert.equal(env.CODEX_COMPAT_CAPABILITIES, 'deepseek');
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer can move model provider settings to a custom service env file', async () => {
  const stateDir = makeTempStateDir();
  const oldEnvFile = path.join(stateDir, 'service.env');
  const newEnvFile = path.join(stateDir, 'custom', 'new-service.env');
  fs.writeFileSync(oldEnvFile, 'CODEX_COMPAT_API_KEY=old-key\n', 'utf8');
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const env: Record<string, string> = {
    CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE: oldEnvFile,
    CODEX_COMPAT_API_KEY: 'old-key',
  };
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env,
    port: 0,
  });

  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        modelProvider: {
          profileId: 'openai-default',
          providerId: 'openai-compatible',
          providerName: 'OpenAI Compatible',
          baseUrl: 'https://ztoken.app/',
          model: 'gpt-5.5',
          modelIds: 'gpt-5.5',
          capabilities: 'default',
          apiKey: '',
          serviceEnvFile: newEnvFile,
        },
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as any;

    assert.equal(env.CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE, newEnvFile);
    assert.equal(body.settings.modelProvider.serviceEnvFile, newEnvFile);
    assert.match(fs.readFileSync(newEnvFile, 'utf8'), /^CODEX_COMPAT_DEFAULT_MODEL=gpt-5\.5$/mu);
    assert.match(fs.readFileSync(newEnvFile, 'utf8'), /^CODEX_COMPAT_API_KEY=old-key$/mu);
    assert.doesNotMatch(fs.readFileSync(oldEnvFile, 'utf8'), /^CODEX_COMPAT_DEFAULT_MODEL=/mu);
    const preference = JSON.parse(fs.readFileSync(path.join(stateDir, 'runtime', 'weixin-admin-preferences.json'), 'utf8'));
    assert.equal(preference.serviceEnvFile, newEnvFile);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer compacts large logs and deletes expired rotated logs', async () => {
  const stateDir = makeTempStateDir();
  const logDir = path.join(stateDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const outLog = path.join(logDir, 'weixin-bridge.out.log');
  const rotatedLog = path.join(logDir, 'weixin-bridge.old.log.1');
  fs.writeFileSync(outLog, [
    'early line',
    ...Array.from({ length: 20 }, (_, index) => `middle line ${index}`),
    'latest important line',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(rotatedLog, 'expired rotated log\n', 'utf8');
  const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  fs.utimesSync(rotatedLog, oldDate, oldDate);
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env: {
      WEIXIN_LOG_CLEANUP_ENABLE: '0',
    },
    port: 0,
  });

  const binding = await server.start();
  try {
    const settingsResponse = await fetch(`${binding.url}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        logCleanup: {
          enabled: true,
          retentionDays: 1,
          maxBytes: 200,
          intervalMinutes: 60,
        },
      }),
    });
    assert.equal(settingsResponse.status, 200);
    const body = await settingsResponse.json() as any;
    assert.equal(body.cleanup.actions.some((action: any) => action.action === 'compacted_large_log'), true);
    assert.equal(body.cleanup.actions.some((action: any) => action.action === 'deleted_old_log'), true);

    const compactedText = fs.readFileSync(outLog, 'utf8');
    assert.match(compactedText, /log compacted/);
    assert.match(compactedText, /latest important line/);
    assert.doesNotMatch(compactedText, /early line/);
    assert.equal(fs.existsSync(rotatedLog), false);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer manually clears active logs for the panel', async () => {
  const stateDir = makeTempStateDir();
  const logDir = path.join(stateDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const outLog = path.join(logDir, 'weixin-bridge.out.log');
  const errLog = path.join(logDir, 'weixin-bridge.err.log');
  fs.writeFileSync(outLog, 'old stdout line\n', 'utf8');
  fs.writeFileSync(errLog, 'old stderr line\n', 'utf8');
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
  });

  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/logs/cleanup`, { method: 'POST' });
    assert.equal(response.status, 200);
    const body = await response.json() as any;

    assert.equal(body.cleanup.actions.filter((action: any) => action.action === 'reset_active_log_with_summary').length, 1);
    assert.equal(body.cleanup.actions.filter((action: any) => action.action === 'cleared_active_log').length, 1);
    const outText = fs.readFileSync(outLog, 'utf8');
    assert.match(outText, /\[CodexBridge\] running log reset/u);
    assert.match(outText, /state_dir:/u);
    assert.doesNotMatch(outText, /old stdout line/u);
    assert.equal(fs.readFileSync(errLog, 'utf8'), '');
    assert.match(body.logs.text, /running log reset/u);
    assert.doesNotMatch(body.logs.text, /old stderr line/u);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer shuts down the service after an opted-in admin page closes', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const shutdownReasons: string[] = [];
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    pageCloseShutdownGraceMs: 5,
    serviceControl: {
      shutdown(reason) {
        shutdownReasons.push(String(reason ?? ''));
      },
    },
  });

  const binding = await server.start();
  try {
    const heartbeatResponse = await fetch(`${binding.url}/api/page/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId: 'page-1', shutdownOnClose: true }),
    });
    assert.equal(heartbeatResponse.status, 200);

    const closeResponse = await fetch(`${binding.url}/api/page/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId: 'page-1', shutdownOnClose: true }),
    });
    assert.equal(closeResponse.status, 200);

    await sleep(5);
    assert.deepEqual(shutdownReasons, ['admin-page-closed']);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer accepts a GET close beacon when the admin page unloads', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const shutdownReasons: string[] = [];
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    pageCloseShutdownGraceMs: 5,
    serviceControl: {
      shutdown(reason) {
        shutdownReasons.push(String(reason ?? ''));
      },
    },
  });

  const binding = await server.start();
  try {
    const closeResponse = await fetch(`${binding.url}/api/page/close?pageId=page-1&shutdownOnClose=1`);
    assert.equal(closeResponse.status, 200);

    await sleep(5);
    assert.deepEqual(shutdownReasons, ['admin-page-closed']);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer deduplicates close and shutdown requests from the same page unload', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const shutdownReasons: string[] = [];
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    pageCloseShutdownGraceMs: 5,
    serviceControl: {
      shutdown(reason) {
        shutdownReasons.push(String(reason ?? ''));
      },
    },
  });

  const binding = await server.start();
  try {
    const closeResponse = await fetch(`${binding.url}/api/page/close?pageId=page-1&shutdownOnClose=1`);
    assert.equal(closeResponse.status, 200);
    const shutdownResponse = await fetch(`${binding.url}/api/service/shutdown`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'admin-page-closed' }),
    });
    assert.equal(shutdownResponse.status, 200);

    await sleep(5);
    assert.deepEqual(shutdownReasons, ['admin-page-closed']);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer admin page enables shutdown-on-close by default', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
  });

  const binding = await server.start();
  try {
    const response = await fetch(binding.url);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /rel="icon" type="image\/png" href="\/favicon\.png\?v=/u);
    assert.match(html, /rel="icon" type="image\/x-icon" href="\/favicon\.ico\?v=/u);
    assert.match(html, /rel="shortcut icon" href="\/favicon\.ico\?v=/u);
    assert.match(html, /rel="apple-touch-icon" href="\/favicon\.png\?v=/u);
    assert.match(html, /shutdownOnClose:\s*queryParams\.get\('shutdownOnClose'\)\s*!==\s*'0'/u);
    assert.match(html, /function pageLifecycleUrl/u);
    assert.match(html, /function sendShutdownRequest/u);
    assert.match(html, /id="setup-modal"/u);
    assert.match(html, /id="setup-open"/u);
    assert.match(html, /function renderSetup/u);
    assert.match(html, /\/api\/setup\/complete/u);
    assert.match(html, /id="provider-source"/u);
    assert.match(html, /id="provider-ccswitch-sync"/u);
    assert.match(html, /id="setup-provider-key-status"/u);
    assert.match(html, /function providerKeyStatusText/u);
    assert.match(html, /renderSetupProvider\(syncedProvider\)/u);
    assert.match(html, /\/api\/model-provider\/sync-ccswitch/u);
    assert.match(html, /providerModelCatalogs:\s*new Map\(\)/u);
    assert.match(html, /providerModelCatalogPromises:\s*new Map\(\)/u);
    assert.match(html, /providerModelCatalogGenerations:\s*new Map\(\)/u);
    assert.match(html, /function reloadAccountsAfterProviderChange/u);
    assert.equal([...html.matchAll(/reloadAccountsAfterProviderChange\(/gu)].length, 4);
    assert.match(html, /\/api\/provider-profiles\//u);
    assert.match(html, /\/models\/refresh/u);
    assert.match(html, /account-model-control/u);
    assert.match(html, /account-model-refresh/u);
    assert.match(html, /id="delivery-retry-now"/u);
    assert.match(html, /\/api\/delivery-outbox\/retry/u);
    assert.match(html, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*34px/u);
    assert.match(html, /\.table-wrap\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/su);
    assert.match(html, /if\s*\(provider\.value\s*!==\s*requestedProviderProfileId\)\s*return/u);
    assert.match(html, /setAttribute\('aria-label',\s*'刷新模型'\)/u);
    for (const visibleText of [
      '正在刷新模型列表...',
      '正在加载模型列表...',
      '模型刷新失败，已保留当前选择',
      '模型加载失败，已保留当前选择',
      '（不可用）',
      '支持的推理强度',
      '推理默认',
      '模型刷新失败，使用备用列表',
      '已使用缓存模型',
      '已使用配置模型',
    ]) {
      assert.equal(html.includes(visibleText), true, `missing visible Task 5 string: ${visibleText}`);
    }
    for (const mojibake of [
      '姝ｅ湪鍒锋柊妯″瀷鍒楄〃...',
      '姝ｅ湪鍔犺浇妯″瀷鍒楄〃...',
      '妯″瀷鍒锋柊澶辫触锛屽凡淇濈暀宸蹭繚瀛樺€�',
      '妯″瀷鍔犺浇澶辫触锛屽凡淇濈暀宸蹭繚瀛樺€�',
      '涓嶅彲鐢?',
      '鏀寔鐨勬帹鐞嗗己搴?',
      '鎺ㄧ悊榛樿',
      '妯″瀷鍒锋柊澶辫触锛屼娇鐢ㄥ鐢ㄥ垪琛?',
      '宸蹭娇鐢ㄧ紦瀛樻ā鍨嬪垪琛?',
      '宸蹭娇鐢ㄧ悗澶囨ā鍨嬪垪琛?',
    ]) {
      assert.equal(html.includes(mojibake), false, `unexpected Task 5 mojibake: ${mojibake}`);
    }
    assert.match(html, /supportedReasoningEfforts/u);
    assert.match(html, /setAccountModelStatus\(modelStatus,\s*'',\s*false\);\s*setAccountModelControlsLoading\(rowState,\s*false\);\s*updateAccountModelSaveState\(rowState\);\s*return;/u);
    assert.match(html, /populateAccountModelOptions\(model,\s*requestedProviderProfileId,\s*null,\s*selectedModel\)/u);
    assert.match(html, /populateAccountReasoningEffortOptions\(effort,\s*null,\s*selectedEffort\)/u);
    assert.match(html, /data-page="diagnostics"/u);
    assert.match(html, /id="diagnostics-run"/u);
    assert.match(html, /\/api\/diagnostics\/run/u);
    assert.match(html, /function renderDiagnostics/u);
    assert.match(html, /data-page="updates"/u);
    assert.match(html, /id="update-check"/u);
    assert.match(html, /id="update-download"/u);
    assert.match(html, /id="update-install"/u);
    assert.match(html, /window\.codexbridgeUpdater/u);
    assert.match(html, /data-page="phone-guide"/u);
    assert.match(html, /手机使用 Codex/u);
    assert.match(html, /Claude Code（Z Token）/u);
    assert.match(html, /CC-Switch-v3\.14\.1-Windows\.msi/u);
    assert.match(html, /CC-Switch-v3\.14\.1-macOS\.dmg/u);
    assert.match(html, /\/project D:\\IT_learn\\codex_weixin\\CodexBridge/u);
    assert.match(html, /id="metrics-reset"/u);
    assert.match(html, /id="metric-errors-hour"/u);
    assert.match(html, /id="metric-errors-total"/u);
    assert.match(html, /id="metric-reply-failures"/u);
    assert.match(html, /\/api\/metrics\/reset/u);
    assert.match(html, /角色说明/u);
    assert.match(html, /主账号：<\/b>你的账号，权限最高/u);
    assert.match(html, /管理员：<\/b>适合可信任的人/u);
    assert.match(html, /普通用户：<\/b>适合一般朋友/u);
    assert.match(html, /只读用户：<\/b>限制最多/u);
    assert.match(html, /实际权限以“可聊天 \/ 可上传 \/ 可执行命令”三个开关为准/u);
    assert.match(html, /\/api\/service\/shutdown/u);
    assert.match(html, /new Image\(\)/u);
    assert.match(html, /window\.addEventListener\('unload', closePage\)/u);
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gu)].map((match) => match[1]);
    assert.ok(scripts.length > 0);
    for (const script of scripts) {
      assert.doesNotThrow(() => new Function(script));
    }
    const accountScript = scripts.find((script) => script.includes('function findAccountCatalogModel'));
    assert.ok(accountScript);
    const catalogHelperStart = accountScript.indexOf('function invalidateProviderModelCatalogCache');
    const catalogHelperEnd = accountScript.indexOf('function accountModelDisplayText', catalogHelperStart);
    assert.ok(catalogHelperStart >= 0);
    assert.ok(catalogHelperEnd > catalogHelperStart);
    const browserCatalogState = {
      providerModelCatalogs: new Map([['profile-1', { models: [{ id: 'expired' }], expiresAt: Date.now() - 1 }]]),
      providerModelCatalogPromises: new Map(),
      providerModelCatalogGenerations: new Map(),
    };
    const pendingCatalogRequests: Array<(catalog: any) => void> = [];
    const browserCatalogHelpers = new Function(
      'state',
      'requestJson',
      `${accountScript.slice(catalogHelperStart, catalogHelperEnd)}\nreturn { invalidateProviderModelCatalogCache, loadProviderModelCatalog };`,
    )(
      browserCatalogState,
      () => new Promise((resolve) => pendingCatalogRequests.push(resolve)),
    ) as {
      invalidateProviderModelCatalogCache(providerProfileId: string): void;
      loadProviderModelCatalog(providerProfileId: string, forceRefresh: boolean): Promise<any>;
    };
    const invalidatedRequest = browserCatalogHelpers.loadProviderModelCatalog('profile-1', false);
    assert.equal(pendingCatalogRequests.length, 1);
    browserCatalogHelpers.invalidateProviderModelCatalogCache('profile-1');
    const currentRequest = browserCatalogHelpers.loadProviderModelCatalog('profile-1', false);
    assert.equal(pendingCatalogRequests.length, 2);
    pendingCatalogRequests[0]?.({ models: [{ id: 'old' }], expiresAt: Date.now() + 60_000 });
    await assert.rejects(invalidatedRequest, /invalidated/u);
    const currentCatalog = { models: [{ id: 'current' }], expiresAt: Date.now() + 60_000 };
    pendingCatalogRequests[1]?.(currentCatalog);
    assert.deepEqual(await currentRequest, currentCatalog);
    assert.deepEqual(await browserCatalogHelpers.loadProviderModelCatalog('profile-1', false), currentCatalog);
    assert.equal(pendingCatalogRequests.length, 2);
    const helperStart = accountScript.indexOf('function findAccountCatalogModel');
    const helperEnd = accountScript.indexOf('function syncAccountModelControlState', helperStart);
    assert.ok(helperStart >= 0);
    assert.ok(helperEnd > helperStart);
    const canSaveAccountModelSelection = new Function(
      'state',
      `${accountScript.slice(helperStart, helperEnd)}\nreturn canSaveAccountModelSelection(state.rowState);`,
    )({
      providerProfiles: [{ providerProfileId: 'profile-1' }],
      rowState: {
        provider: { value: 'profile-1' },
        model: { value: '' },
        effort: { value: 'high' },
        savedTriple: {
          providerProfileId: 'profile-1',
          model: 'saved-model',
          reasoningEffort: 'medium',
        },
        catalog: { models: [] },
      },
    });
    assert.equal(canSaveAccountModelSelection, true);
    const faviconResponse = await fetch(`${binding.url}/favicon.ico`);
    assert.equal(faviconResponse.status, 200);
    assert.equal(faviconResponse.headers.get('content-type'), 'image/x-icon');
    const faviconBytes = Buffer.from(await faviconResponse.arrayBuffer());
    assert.ok(faviconBytes.length > 0);
    const faviconPngResponse = await fetch(`${binding.url}/favicon.png`);
    assert.equal(faviconPngResponse.status, 200);
    assert.equal(faviconPngResponse.headers.get('content-type'), 'image/png');
    const faviconPngBytes = Buffer.from(await faviconPngResponse.arrayBuffer());
    assert.ok(faviconPngBytes.length > 0);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer does not shut down for normal admin page heartbeats', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const shutdownReasons: string[] = [];
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    pageCloseShutdownGraceMs: 5,
    serviceControl: {
      shutdown(reason) {
        shutdownReasons.push(String(reason ?? ''));
      },
    },
  });

  const binding = await server.start();
  try {
    await fetch(`${binding.url}/api/page/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId: 'page-1', shutdownOnClose: false }),
    });
    await fetch(`${binding.url}/api/page/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId: 'page-1', shutdownOnClose: false }),
    });

    await sleep(40);
    assert.deepEqual(shutdownReasons, []);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer exposes searchable session summaries for the panel', async () => {
  const stateDir = makeTempStateDir();
  const codexHome = path.join(stateDir, 'codex-home');
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  accountStore.saveAccount({
    accountId: 'bot-primary',
    token: 'token-primary',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-primary',
  });
  accountStore.updateAccount('bot-primary', { display_name: 'Main' });
  accountStore.saveAccount({
    accountId: 'bot-friend',
    token: 'token-friend',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-friend',
  });
  accountStore.updateAccount('bot-friend', { display_name: 'Friend A' });

  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  const now = Date.now();
  const threadId = '00000000-0000-4000-8000-000000000001';
  repositories.providerProfiles.save({
    id: 'openai-default',
    providerKind: 'openai-native',
    displayName: 'OpenAI Default',
    config: {},
    createdAt: now - 5000,
    updatedAt: now - 5000,
  });
  repositories.bridgeSessions.save({
    id: 'session-friend',
    providerProfileId: 'openai-default',
    codexThreadId: threadId,
    cwd: 'C:/repo',
    title: '手机买球分析',
    createdAt: now - 4000,
    updatedAt: now - 1000,
  });
  repositories.platformBindings.save({
    platform: 'weixin',
    externalScopeId: 'bot-friend:wxid-peer',
    bridgeSessionId: 'session-friend',
    updatedAt: now - 900,
  });
  repositories.sessionSettings.save({
    bridgeSessionId: 'session-friend',
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    serviceTier: null,
    collaborationMode: null,
    personality: null,
    permissionsMode: null,
    accessPreset: null,
    approvalPolicy: null,
    sandboxMode: null,
    approvalsReviewer: null,
    locale: 'zh-CN',
    metadata: {},
    updatedAt: now - 800,
  });
  repositories.threadMetadata.save({
    providerProfileId: 'openai-default',
    threadId,
    alias: '手机买球分析',
    pinnedAt: now - 700,
    archivedAt: null,
    updatedAt: now - 700,
  });
  const sessionPath = path.join(codexHome, 'sessions', `${threadId}.jsonl`);
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, `${JSON.stringify({
    type: 'response_item',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '最新问题：今天怎么分析' }],
    },
  })}\n`, 'utf8');
  fs.writeFileSync(path.join(codexHome, 'session_index.jsonl'), `${JSON.stringify({
    id: threadId,
    thread_name: 'Codex title',
    updated_at: new Date(now - 600).toISOString(),
    cwd: 'C:/repo',
    path: sessionPath,
  })}\n`, 'utf8');

  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env: {
      WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-primary',
    },
    port: 0,
    repositories,
    codexHome,
  });

  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/sessions?query=${encodeURIComponent('最新问题')}&accountId=bot-friend`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.total, 1);
    assert.equal(body.sessions[0].title, '手机买球分析');
    assert.equal(body.sessions[0].preview, '最新问题：今天怎么分析');
    assert.deepEqual(body.sessions[0].accountIds, ['bot-friend']);
    assert.equal(body.sessions[0].model, 'gpt-5.5');
    assert.equal(body.sessions[0].reasoningEffort, 'high');
    assert.equal(body.sessions[0].pinned, true);
    assert.equal(body.filters.accounts.find((account: any) => account.accountId === 'bot-friend')?.displayName, 'Friend A');
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer resolves the effective model for session summaries', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  accountStore.saveAccount({
    accountId: 'bot-primary',
    token: 'token-primary',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-primary',
  });
  accountStore.updateAccount('bot-primary', {
    model_provider: {
      provider_profile_id: 'openai-default',
      model: 'gpt-5.4',
      reasoning_effort: 'high',
    },
  });

  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  const now = Date.now();
  repositories.providerProfiles.save({
    id: 'openai-default',
    providerKind: 'openai-native',
    displayName: 'OpenAI Default',
    config: {
      defaultModel: 'gpt-5.5',
    },
    createdAt: now - 5000,
    updatedAt: now - 5000,
  });
  repositories.bridgeSessions.save({
    id: 'session-effective-model',
    providerProfileId: 'openai-default',
    codexThreadId: 'thread-effective-model',
    cwd: 'C:/repo',
    title: 'Effective Model',
    createdAt: now - 4000,
    updatedAt: now - 1000,
  });
  repositories.platformBindings.save({
    platform: 'weixin',
    externalScopeId: 'bot-primary:wxid-peer',
    bridgeSessionId: 'session-effective-model',
    updatedAt: now - 900,
  });
  repositories.sessionSettings.save({
    bridgeSessionId: 'session-effective-model',
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    collaborationMode: null,
    personality: null,
    permissionsMode: null,
    accessPreset: null,
    approvalPolicy: null,
    sandboxMode: null,
    approvalsReviewer: null,
    locale: 'zh-CN',
    metadata: {},
    updatedAt: now - 800,
  });

  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env: {
      WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-primary',
      CODEX_DEFAULT_PROVIDER_PROFILE_ID: 'openai-default',
      CODEX_COMPAT_DEFAULT_MODEL: 'gpt-5.3-codex',
    },
    port: 0,
    repositories,
  });

  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/sessions?query=Effective`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.total, 1);
    assert.equal(body.sessions[0].model, 'gpt-5.4');
    assert.equal(body.sessions[0].modelSource, 'account');
    assert.equal(body.sessions[0].reasoningEffort, 'high');
    assert.equal(body.sessions[0].reasoningEffortSource, 'account');
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer shows the remembered Weixin account when the live scope binding moved away', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  accountStore.saveAccount({
    accountId: 'bot-primary',
    token: 'token-primary',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-primary',
  });
  accountStore.updateAccount('bot-primary', { display_name: 'Owner A' });
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  const now = Date.now();
  repositories.providerProfiles.save({
    id: 'openai-default',
    providerKind: 'openai-native',
    displayName: 'OpenAI Default',
    config: {},
    createdAt: now,
    updatedAt: now,
  });
  repositories.bridgeSessions.save({
    id: 'session-unbound-history',
    providerProfileId: 'openai-default',
    codexThreadId: 'thread-unbound-history',
    cwd: 'D:/repo',
    title: 'Historical Project',
    createdAt: now - 1000,
    updatedAt: now - 100,
  });
  repositories.sessionSettings.save({
    bridgeSessionId: 'session-unbound-history',
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    collaborationMode: null,
    personality: null,
    permissionsMode: null,
    accessPreset: null,
    approvalPolicy: null,
    sandboxMode: null,
    approvalsReviewer: null,
    locale: 'zh-CN',
    metadata: {
      weixinAccountId: 'bot-primary',
    },
    updatedAt: now - 100,
  });

  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env: {
      WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-primary',
    },
    port: 0,
    repositories,
  });

  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/sessions?query=Historical`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.sessions[0]?.accountIds[0], 'bot-primary');
    assert.equal(body.sessions[0]?.scopes[0]?.accountDisplayName, 'Owner A');
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer falls back to the primary account for legacy unbound sessions', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  accountStore.saveAccount({
    accountId: 'bot-primary',
    token: 'token-primary',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-primary',
  });
  accountStore.updateAccount('bot-primary', { display_name: 'Owner A' });
  accountStore.saveAccount({
    accountId: 'bot-other',
    token: 'token-other',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-other',
  });
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  const now = Date.now();
  repositories.providerProfiles.save({
    id: 'openai-default',
    providerKind: 'openai-native',
    displayName: 'OpenAI Default',
    config: {},
    createdAt: now,
    updatedAt: now,
  });
  repositories.bridgeSessions.save({
    id: 'session-legacy-unbound',
    providerProfileId: 'openai-default',
    codexThreadId: 'thread-legacy-unbound',
    cwd: 'D:/repo',
    title: 'Legacy Project',
    createdAt: now - 1000,
    updatedAt: now - 100,
  });
  repositories.sessionSettings.save({
    bridgeSessionId: 'session-legacy-unbound',
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    collaborationMode: null,
    personality: null,
    permissionsMode: null,
    accessPreset: null,
    approvalPolicy: null,
    sandboxMode: null,
    approvalsReviewer: null,
    locale: 'zh-CN',
    metadata: {},
    updatedAt: now - 100,
  });

  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env: {
      WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-primary',
    },
    port: 0,
    repositories,
  });

  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/sessions?query=Legacy`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.sessions[0]?.accountIds[0], 'bot-primary');
    assert.equal(body.sessions[0]?.scopes[0]?.accountDisplayName, 'Owner A');
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer archives and restores sessions from the panel API', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  repositories.providerProfiles.save({
    id: 'openai-default',
    providerKind: 'openai-native',
    displayName: 'OpenAI Default',
    config: {},
    createdAt: 1,
    updatedAt: 1,
  });
  repositories.bridgeSessions.save({
    id: 'session-archive',
    providerProfileId: 'openai-default',
    codexThreadId: 'thread-archive',
    cwd: null,
    title: 'Archive me',
    createdAt: 2,
    updatedAt: 3,
  });

  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    repositories,
    codexHome: path.join(stateDir, 'missing-codex-home'),
  });

  const binding = await server.start();
  try {
    const archiveResponse = await fetch(`${binding.url}/api/sessions/session-archive`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    assert.equal(archiveResponse.status, 200);
    const archivedMetadata = repositories.threadMetadata.getByThread('openai-default', 'thread-archive');
    assert.equal(typeof archivedMetadata?.archivedAt, 'number');

    const sessionsResponse = await fetch(`${binding.url}/api/sessions`);
    const sessionsBody = await sessionsResponse.json() as any;
    assert.equal(sessionsBody.sessions.find((session: any) => session.id === 'session-archive')?.archived, true);

    const restoreResponse = await fetch(`${binding.url}/api/sessions/session-archive`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: false }),
    });
    assert.equal(restoreResponse.status, 200);
    const restoredMetadata = repositories.threadMetadata.getByThread('openai-default', 'thread-archive');
    assert.equal(restoredMetadata?.archivedAt, null);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer deletes only local bridge session records from the panel API', async () => {
  const stateDir = makeTempStateDir();
  const codexHome = path.join(stateDir, 'codex-home');
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  repositories.providerProfiles.save({
    id: 'openai-default',
    providerKind: 'openai-native',
    displayName: 'OpenAI Default',
    config: {},
    createdAt: 1,
    updatedAt: 1,
  });
  repositories.bridgeSessions.save({
    id: 'session-delete',
    providerProfileId: 'openai-default',
    codexThreadId: 'thread-delete',
    cwd: 'C:/repo',
    title: 'Delete local record',
    createdAt: 2,
    updatedAt: 3,
  });
  repositories.platformBindings.save({
    platform: 'weixin',
    externalScopeId: 'bot-primary:wxid-peer',
    bridgeSessionId: 'session-delete',
    updatedAt: 4,
  });
  repositories.sessionSettings.save({
    bridgeSessionId: 'session-delete',
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    serviceTier: null,
    collaborationMode: null,
    personality: null,
    permissionsMode: null,
    accessPreset: null,
    approvalPolicy: null,
    sandboxMode: null,
    approvalsReviewer: null,
    locale: 'zh-CN',
    metadata: {},
    updatedAt: 5,
  });
  repositories.threadMetadata.save({
    providerProfileId: 'openai-default',
    threadId: 'thread-delete',
    alias: 'Local alias',
    pinnedAt: null,
    archivedAt: null,
    updatedAt: 6,
  });
  const codexSessionPath = path.join(codexHome, 'sessions', 'thread-delete.jsonl');
  fs.mkdirSync(path.dirname(codexSessionPath), { recursive: true });
  fs.writeFileSync(codexSessionPath, '{"type":"session"}\n', 'utf8');

  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    repositories,
    codexHome,
  });

  const binding = await server.start();
  try {
    const deleteResponse = await fetch(`${binding.url}/api/sessions/session-delete`, {
      method: 'DELETE',
    });
    assert.equal(deleteResponse.status, 200);
    assert.equal(repositories.bridgeSessions.getById('session-delete'), null);
    assert.equal(repositories.platformBindings.list().some((binding) => binding.bridgeSessionId === 'session-delete'), false);
    assert.equal(repositories.sessionSettings.getByBridgeSessionId('session-delete'), null);
    assert.equal(repositories.threadMetadata.getByThread('openai-default', 'thread-delete'), null);
    assert.equal(fs.existsSync(codexSessionPath), true);

    const sessionsResponse = await fetch(`${binding.url}/api/sessions`);
    const sessionsBody = await sessionsResponse.json() as any;
    assert.equal(sessionsBody.total, 0);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer exposes recent logs and JSON export for the panel', async () => {
  const stateDir = makeTempStateDir();
  const logDir = path.join(stateDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, 'weixin-bridge.out.log'), [
    'first stdout line',
    'last stdout line',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(logDir, 'weixin-bridge.err.log'), [
    'first stderr line',
    'last stderr line',
    '',
  ].join('\n'), 'utf8');
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  accountStore.saveAccount({
    accountId: 'bot-primary',
    token: 'token-primary',
    baseUrl: 'https://ilink.example.com',
    userId: 'wxid-primary',
  });
  accountStore.setContextToken('bot-primary', 'peer-secret', 'context-token-secret');
  accountStore.saveSyncCursor('bot-primary', 'saved-sync-cursor');
  const serviceEnvFile = path.join(stateDir, 'service.env');
  const env = {
    CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE: serviceEnvFile,
    CODEX_DEFAULT_PROVIDER_PROFILE_ID: 'openai-default',
    CODEX_COMPAT_API_KEY: 'model-api-key-secret',
  };
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  repositories.providerProfiles.save({
    id: 'openai-default',
    providerKind: 'openai-native',
    displayName: 'OpenAI Default',
    config: {},
    createdAt: 1,
    updatedAt: 1,
  });
  repositories.bridgeSessions.save({
    id: 'session-1',
    providerProfileId: 'openai-default',
    codexThreadId: '00000000-0000-4000-8000-000000000002',
    cwd: null,
    title: 'Exported session',
    createdAt: 2,
    updatedAt: 3,
  });

  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    repositories,
    env,
    codexHome: path.join(stateDir, 'missing-codex-home'),
    bridgeControl: {
      async start() {},
      async stop() {},
      async restart() {},
      status() {
        return {
          running: true,
          lastPollSyncCursor: 'sync-cursor-secret',
          lastError: 'provider-secret-error',
          pendingDeliveryRetries: 2,
          deliveryOutbox: {
            pending: 2,
            oldestCreatedAt: 1_000,
            nextAttemptAt: 2_000,
            content: 'private-outbox-message',
            lastError: 'private-outbox-error',
            externalScopeId: 'wx-private-outbox-scope',
          },
          turnRecovery: {
            total: 2,
            running: 1,
            reconciling: 0,
            uncertain: 1,
            completedPendingDelivery: 0,
            interrupted: 0,
            approvalExpired: 0,
            oldestAgeMs: 5_000,
            lastReconciledAt: 4_000,
            lastErrorCategory: 'provider_unavailable',
            externalScopeId: 'wx-private-recovery-scope',
            prompt: 'private recovery prompt',
          },
          weixin: {
            running: true,
            accountCount: 1,
            activeAccountIds: ['secret-account-id'],
          },
        };
      },
    },
  });

  const binding = await server.start();
  try {
    const logsResponse = await fetch(`${binding.url}/api/logs?limit=1`);
    assert.equal(logsResponse.status, 200);
    const logsBody = await logsResponse.json() as any;
    assert.match(logsBody.text, /last stdout line/);
    assert.match(logsBody.text, /last stderr line/);
    assert.doesNotMatch(logsBody.text, /first stdout line/);

    const stateResponse = await fetch(`${binding.url}/api/state`);
    const stateText = await stateResponse.text();
    assert.doesNotMatch(stateText, /private-outbox-message|private-outbox-error|wx-private-outbox-scope|wx-private-recovery-scope|private recovery prompt/u);
    const stateBody = JSON.parse(stateText) as any;
    assert.deepEqual(stateBody.bridge.deliveryOutbox, {
      pending: 2,
      oldestCreatedAt: 1_000,
      nextAttemptAt: 2_000,
    });
    assert.deepEqual(stateBody.bridge.turnRecovery, {
      total: 2,
      running: 1,
      reconciling: 0,
      uncertain: 1,
      completedPendingDelivery: 0,
      interrupted: 0,
      approvalExpired: 0,
      oldestAgeMs: 5_000,
      lastReconciledAt: 4_000,
      lastErrorCategory: 'provider_unavailable',
    });

    const exportResponse = await fetch(`${binding.url}/api/export`);
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get('content-disposition') ?? '', /codexbridge-weixin-backup-/);
    const exportBody = await exportResponse.json() as any;
    assert.equal(exportBody.kind, 'full-backup');
    assert.equal(exportBody.containsSecrets, true);
    assert.equal(exportBody.accounts[0].token, 'token-primary');
    assert.equal(exportBody.accounts[0].context_tokens['peer-secret'], 'context-token-secret');
    assert.equal(exportBody.accounts[0].sync_cursor, 'saved-sync-cursor');
    assert.equal(exportBody.configuration.serviceEnv.CODEX_COMPAT_API_KEY, 'model-api-key-secret');
    assert.equal(exportBody.runtime.providerProfiles[0].id, 'openai-default');
    assert.equal(exportBody.runtime.bridgeSessions[0].title, 'Exported session');
    assert.match(exportBody.logs.text, /last stdout line/);
    assert.doesNotMatch(
      JSON.stringify(exportBody),
      /private-outbox-message|deliveryOutbox|pendingDeliveryRetries/u,
    );

    const diagnosticResponse = await fetch(`${binding.url}/api/export/diagnostic`);
    assert.equal(diagnosticResponse.status, 200);
    assert.match(diagnosticResponse.headers.get('content-disposition') ?? '', /codexbridge-weixin-diagnostic-/);
    const diagnosticText = await diagnosticResponse.text();
    assert.doesNotMatch(
      diagnosticText,
      /token-primary|wxid-primary|ilink\.example\.com|last stdout line|sync-cursor-secret|provider-secret-error|secret-account-id|context-token-secret|saved-sync-cursor|model-api-key-secret|wx-private-recovery-scope|private recovery prompt/u,
    );
    const diagnosticBody = JSON.parse(diagnosticText) as any;
    assert.equal(diagnosticBody.kind, 'diagnostic');
    assert.equal(diagnosticBody.containsSecrets, false);
    assert.equal(diagnosticBody.accounts.count, 1);
    assert.equal(diagnosticBody.runtime.providerProfiles, 1);
    assert.equal(diagnosticBody.runtime.bridgeSessions, 1);
    assert.deepEqual(diagnosticBody.service.bridge.deliveryOutbox, {
      pending: 2,
      oldestCreatedAt: 1_000,
      nextAttemptAt: 2_000,
    });
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer sanitizes full backup failures when a runtime repository cannot be read', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime')) as any;
  repositories.providerProfiles.list = () => {
    throw new Error('repository read failed');
  };
  const server = new WeixinAdminServer({ accountStore, stateDir, repositories, port: 0 });
  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/export`);
    const body = await response.json() as any;

    assert.equal(response.status, 500);
    assert.deepEqual(body, { error: 'internal server error' });
    assert.doesNotMatch(JSON.stringify(body), /repository read failed/u);
  } finally {
    await server.stop();
  }
});

test('resolveWeixinAdminServerOptions reads env overrides', () => {
  assert.deepEqual(resolveWeixinAdminServerOptions({
    env: {
      WEIXIN_ADMIN_ENABLE: '0',
      WEIXIN_ADMIN_HOST: '127.0.0.2',
      WEIXIN_ADMIN_PORT: '5001',
    },
  }), {
    enabled: false,
    host: '127.0.0.2',
    port: 5001,
  });
});

test('WeixinAdminServer tests the alert webhook and reports configuration', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  accountStore.saveAccount({ accountId: 'bot-1', token: 't', baseUrl: 'https://x', userId: 'u1' });
  let received = 0;
  const catcher = http.createServer((_req, res) => {
    received += 1;
    res.end('ok');
  });
  await new Promise<void>((resolve) => catcher.listen(0, '127.0.0.1', () => resolve()));
  const catcherPort = (catcher.address() as any).port;
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env: { WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-1' },
    port: 0,
  });
  const binding = await server.start();
  const call = (url: string, init: any = {}) =>
    fetch(`${binding.url}${url}`, { headers: { 'content-type': 'application/json' }, ...init }).then((r) => r.json() as any);
  try {
    const ok = await call('/api/alert/test', { method: 'POST', body: JSON.stringify({ url: `http://127.0.0.1:${catcherPort}/hook` }) });
    assert.equal(ok.configured, true);
    assert.equal(ok.ok, true);
    assert.equal(received, 1);

    const unconfigured = await call('/api/alert/test', { method: 'POST', body: JSON.stringify({ url: '' }) });
    assert.equal(unconfigured.configured, false);
    assert.equal(unconfigured.ok, false);
  } finally {
    await server.stop();
    await new Promise<void>((resolve) => catcher.close(() => resolve()));
  }
});

test('WeixinAdminServer imports a backup into accounts and repositories', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  _resetContextTokenStoreForTest();
  accountStore.saveAccount({ accountId: 'bot-1', token: 't', baseUrl: 'https://x', userId: 'u1' });
  setOfficialContextToken(accountStore.rootDir, 'bot-2', 'peer-2', 'stale-context');
  setOfficialContextToken(accountStore.rootDir, 'bot-2', 'old-peer', 'old-context');
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime')) as any;
  const serviceEnvFile = path.join(stateDir, 'service.env');
  const env: Record<string, string> = {
    CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE: serviceEnvFile,
    CODEX_COMPAT_API_KEY: 'old-key',
  };
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env,
    port: 0,
    repositories,
  });
  const binding = await server.start();
  try {
    const backup = {
      accounts: [{
        accountId: 'bot-2',
        token: 'tok2',
        base_url: 'https://y',
        user_id: 'u2',
        display_name: 'Imported',
        context_tokens: { 'peer-2': 'context-2' },
        sync_cursor: 'sync-2',
      }],
      configuration: {
        serviceEnv: {
          CODEX_DEFAULT_PROVIDER_PROFILE_ID: 'imported-provider',
          CODEX_COMPAT_API_KEY: 'imported-key',
        },
      },
      runtime: {
        providerProfiles: [],
        bridgeSessions: [{ id: 's2', providerProfileId: 'p', codexThreadId: 'th2', cwd: '/c', createdAt: 1, updatedAt: 2 }],
        platformBindings: [],
        sessionSettings: [],
        threadMetadata: [],
      },
    };
    const result = await fetch(`${binding.url}/api/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(backup),
    }).then((r) => r.json() as any);
    assert.equal(result.imported.accounts, 1);
    assert.equal(result.imported.bridgeSessions, 1);
    assert.equal((result.errors || []).length, 0);
    assert.equal(accountStore.loadAccount('bot-2')?.display_name, 'Imported');
    assert.equal(accountStore.getContextToken('bot-2', 'peer-2'), 'context-2');
    assert.equal(getOfficialContextToken(accountStore.rootDir, 'bot-2', 'peer-2'), 'context-2');
    assert.equal(getOfficialContextToken(accountStore.rootDir, 'bot-2', 'old-peer'), null);
    assert.equal(accountStore.loadSyncCursor('bot-2'), 'sync-2');
    assert.equal(env.CODEX_COMPAT_API_KEY, 'imported-key');
    assert.match(fs.readFileSync(serviceEnvFile, 'utf8'), /CODEX_COMPAT_API_KEY=imported-key/u);
    assert.ok(repositories.bridgeSessions.list().some((s: any) => s.id === 's2'));
  } finally {
    _resetContextTokenStoreForTest();
    await server.stop();
  }
});

test('WeixinAdminServer validates the complete backup before importing any records', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  accountStore.saveAccount({ accountId: 'bot-1', token: 'original', baseUrl: 'https://x', userId: 'u1' });
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime')) as any;
  const server = new WeixinAdminServer({ accountStore, stateDir, port: 0, repositories });
  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accounts: [
          { accountId: 'bot-2', token: 'valid', base_url: 'https://y' },
          { accountId: '../../outside', token: 'invalid', base_url: 'https://z' },
        ],
        runtime: {},
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(accountStore.loadAccount('bot-2'), null);
    assert.equal(fs.existsSync(path.join(stateDir, 'outside.json')), false);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer rejects non-http account Base URLs before importing any records', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const server = new WeixinAdminServer({ accountStore, stateDir, port: 0 });
  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accounts: [{ accountId: 'bot-file-url', token: 'token', base_url: 'file:///etc/passwd' }],
        runtime: {},
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(accountStore.loadAccount('bot-file-url'), null);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer rejects case-insensitive duplicate account ids before import', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const server = new WeixinAdminServer({ accountStore, stateDir, port: 0 });
  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accounts: [
          { accountId: 'Bot-Duplicate', token: 'one', base_url: 'https://one.example' },
          { accountId: 'bot-duplicate', token: 'two', base_url: 'https://two.example' },
        ],
        runtime: {},
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(accountStore.listAccounts(), []);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer rejects service environment values containing line breaks', async () => {
  const stateDir = makeTempStateDir();
  const serviceEnvFile = path.join(stateDir, 'service.env');
  const env: Record<string, string> = { CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE: serviceEnvFile };
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const server = new WeixinAdminServer({ accountStore, stateDir, env, port: 0 });
  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accounts: [],
        configuration: {
          serviceEnv: {
            CODEX_COMPAT_API_KEY: 'key\nWEIXIN_PRIMARY_ACCOUNT_ID=injected',
          },
        },
        runtime: {},
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(fs.existsSync(serviceEnvFile), false);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer rolls back a failed import and keeps a pre-import restore point', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  _resetContextTokenStoreForTest();
  accountStore.saveAccount({ accountId: 'bot-1', token: 'original', baseUrl: 'https://x', userId: 'u1' });
  setOfficialContextToken(accountStore.rootDir, 'bot-1', 'peer-1', 'old-context');
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime')) as any;
  repositories.bridgeSessions.save = () => {
    throw new Error('simulated repository failure');
  };
  const server = new WeixinAdminServer({ accountStore, stateDir, port: 0, repositories });
  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accounts: [
          {
            accountId: 'bot-1',
            token: 'changed-token',
            base_url: 'https://changed.example',
            context_tokens: { 'peer-1': 'new-context' },
          },
          { accountId: 'bot-2', token: 'new-token', base_url: 'https://y' },
        ],
        runtime: {
          bridgeSessions: [{ id: 's2', providerProfileId: 'p', codexThreadId: 'th2', cwd: '/c', createdAt: 1, updatedAt: 2 }],
        },
      }),
    });
    assert.equal(response.status, 409);
    assert.equal(accountStore.loadAccount('bot-2'), null);
    assert.equal(accountStore.loadAccount('bot-1')?.token, 'original');
    assert.equal(getOfficialContextToken(accountStore.rootDir, 'bot-1', 'peer-1'), 'old-context');
    const restorePoints = fs.readdirSync(path.join(stateDir, 'backups'))
      .filter((file) => file.startsWith('pre-import-') && file.endsWith('.json'));
    assert.equal(restorePoints.length, 1);
  } finally {
    _resetContextTokenStoreForTest();
    await server.stop();
  }
});
