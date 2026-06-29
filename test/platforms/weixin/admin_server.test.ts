import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WeixinAccountStore } from '../../../src/platforms/weixin/account_store.js';
import { WeixinAdminServer, resolveWeixinAdminServerOptions } from '../../../src/platforms/weixin/admin_server.js';
import { WeixinAutomationStore } from '../../../src/platforms/weixin/automation_store.js';
import { createFileJsonRepositories } from '../../../src/store/file_json/create_file_json_repositories.js';

function makeTempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-weixin-admin-'));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env,
    port: 0,
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
    assert.match(html, /\/api\/service\/shutdown/u);
    assert.match(html, /new Image\(\)/u);
    assert.match(html, /window\.addEventListener\('unload', closePage\)/u);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)].map((match) => match[1]);
    assert.ok(scripts.length > 0);
    for (const script of scripts) {
      assert.doesNotThrow(() => new Function(script));
    }
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
    codexHome: path.join(stateDir, 'missing-codex-home'),
  });

  const binding = await server.start();
  try {
    const logsResponse = await fetch(`${binding.url}/api/logs?limit=1`);
    assert.equal(logsResponse.status, 200);
    const logsBody = await logsResponse.json() as any;
    assert.match(logsBody.text, /last stdout line/);
    assert.match(logsBody.text, /last stderr line/);
    assert.doesNotMatch(logsBody.text, /first stdout line/);

    const exportResponse = await fetch(`${binding.url}/api/export`);
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get('content-disposition') ?? '', /codexbridge-weixin-backup-/);
    const exportBody = await exportResponse.json() as any;
    assert.equal(exportBody.accounts[0].token, 'token-primary');
    assert.equal(exportBody.runtime.providerProfiles[0].id, 'openai-default');
    assert.equal(exportBody.runtime.bridgeSessions[0].title, 'Exported session');
    assert.match(exportBody.logs.text, /last stdout line/);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminServer exposes automation templates and keyword rules', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({
    rootDir: path.join(stateDir, 'weixin', 'accounts'),
  });
  const weixinAutomationStore = new WeixinAutomationStore(path.join(stateDir, 'weixin', 'automation.json'));
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    weixinAutomationStore,
  });

  const binding = await server.start();
  try {
    const templateResponse = await fetch(`${binding.url}/api/automation/templates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'welcome', content: 'hello {{text}}' }),
    });
    assert.equal(templateResponse.status, 200);
    const templateBody = await templateResponse.json() as any;
    assert.equal(templateBody.template.name, 'welcome');

    const ruleResponse = await fetch(`${binding.url}/api/automation/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'hi',
        keywords: ['hi'],
        replyTemplateId: templateBody.template.id,
        stopAfterMatch: true,
      }),
    });
    assert.equal(ruleResponse.status, 200);

    const automationResponse = await fetch(`${binding.url}/api/automation`);
    const automationBody = await automationResponse.json() as any;
    assert.equal(automationBody.enabled, true);
    assert.equal(automationBody.templates.length, 1);
    assert.equal(automationBody.rules.length, 1);
    assert.equal(automationBody.rules[0].name, 'hi');
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

test('WeixinAdminServer edits automation rules and renames templates', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  accountStore.saveAccount({ accountId: 'bot-1', token: 't', baseUrl: 'https://x', userId: 'u1' });
  const automation = new WeixinAutomationStore(path.join(stateDir, 'weixin', 'automation.json'));
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env: { WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-1' },
    port: 0,
    weixinAutomationStore: automation,
  });
  const binding = await server.start();
  const call = (url: string, init: any = {}) =>
    fetch(`${binding.url}${url}`, { headers: { 'content-type': 'application/json' }, ...init }).then((r) => r.json() as any);
  try {
    const tpl = await call('/api/automation/templates', { method: 'POST', body: JSON.stringify({ name: 't1', content: 'hi {{keyword}}' }) });
    const rule = await call('/api/automation/rules', { method: 'POST', body: JSON.stringify({ name: 'r1', keywords: ['a'], matchMode: 'contains', replyTemplateId: tpl.template.id }) });

    const updated = await call(`/api/automation/rules/${rule.rule.id}`, { method: 'PATCH', body: JSON.stringify({ keywords: ['a', 'b'], matchMode: 'regex', replyText: 'x', stopAfterMatch: true }) });
    assert.deepEqual(updated.rule.keywords, ['a', 'b']);
    assert.equal(updated.rule.matchMode, 'regex');
    assert.equal(updated.rule.replyText, 'x');
    assert.equal(updated.rule.stopAfterMatch, true);

    const renamed = await call(`/api/automation/templates/${tpl.template.id}`, { method: 'PATCH', body: JSON.stringify({ name: 't1-renamed', content: 'bye' }) });
    assert.equal(renamed.template.name, 't1-renamed');
    assert.equal(renamed.template.content, 'bye');
  } finally {
    await server.stop();
  }
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
  accountStore.saveAccount({ accountId: 'bot-1', token: 't', baseUrl: 'https://x', userId: 'u1' });
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime')) as any;
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    env: { WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-1' },
    port: 0,
    repositories,
  });
  const binding = await server.start();
  try {
    const backup = {
      accounts: [{ accountId: 'bot-2', token: 'tok2', base_url: 'https://y', user_id: 'u2', display_name: 'Imported' }],
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
    assert.ok(repositories.bridgeSessions.list().some((s: any) => s.id === 's2'));
  } finally {
    await server.stop();
  }
});
