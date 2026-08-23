import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WeixinAccountStore } from '../../../src/platforms/weixin/account_store.js';
import {
  WeixinAdminDiagnosticsService,
  type WeixinAdminDiagnosticBridgeStatus,
} from '../../../src/platforms/weixin/admin_diagnostics_service.js';

function makeTempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-weixin-admin-diagnostics-'));
}

function makeService({
  stateDir = makeTempStateDir(),
  env = {},
  bridgeStatus = null,
  binding = { port: 43183, url: 'http://127.0.0.1:43183' },
  requestJson = async () => ({ ok: true, statusCode: 200, body: { data: [{ id: 'gpt-test' }] }, error: '', url: 'http://provider.test/v1/models' }),
  probeTcpPort = async () => false,
}: {
  stateDir?: string;
  env?: Record<string, string>;
  bridgeStatus?: WeixinAdminDiagnosticBridgeStatus | null;
  binding?: { port: number; url: string } | null;
  requestJson?: (url: string, options: { timeoutMs: number; headers: Record<string, string> }) => Promise<any>;
  probeTcpPort?: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
} = {}) {
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const service = new WeixinAdminDiagnosticsService({
    accountStore,
    env,
    adminPort: 43183,
    getBridgeStatus: () => bridgeStatus,
    getAdminBinding: () => binding,
    requestJson,
    probeTcpPort,
    resolveModelProviderSettings: () => ({
      source: 'manual',
      profileId: 'openai-default',
      providerName: 'Z Token',
      baseUrl: String(env.CODEX_COMPAT_BASE_URL ?? ''),
      model: String(env.CODEX_COMPAT_DEFAULT_MODEL ?? ''),
      apiKeyConfigured: Boolean(env.CODEX_COMPAT_API_KEY),
      apiKeyMasked: 'test...key',
      capabilities: 'default',
      serviceEnvFile: 'C:/service.env',
    }),
  });
  return { accountStore, service };
}

test('WeixinAdminDiagnosticsService runs service, account, API key, model, port, and Codex Native checks in the established order', async () => {
  const env = {
    WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-primary',
    CODEX_COMPAT_API_KEY: 'test-key',
    CODEX_COMPAT_BASE_URL: 'http://provider.test',
    CODEX_COMPAT_DEFAULT_MODEL: 'gpt-test',
    CODEX_NATIVE_API_ENABLE: '0',
  };
  const { accountStore, service } = makeService({
    env,
    bridgeStatus: { running: true, activeTurns: 2, queuedTurns: 1 },
  });
  accountStore.saveAccount({
    accountId: 'bot-primary', token: 'token', baseUrl: 'https://ilink.example.com', userId: 'wxid-primary',
  });

  const checks = await service.runAll();

  assert.deepEqual(checks.map((check) => check.id), [
    'service', 'weixin-account', 'api-key', 'model', 'ports', 'codex-native',
  ]);
  assert.deepEqual(checks.map((check) => check.status), ['ok', 'ok', 'ok', 'ok', 'warn', 'warn']);
  assert.equal(checks[0]?.detail, '微信桥接正在运行，当前 2 个回复中，1 个排队中。');
  assert.equal(checks[1]?.reason, '当前主账号：bot-primary');
  assert.equal(checks[3]?.detail, '模型列表中找到了 gpt-test');
  assert.equal(checks[4]?.detail, '管理面板：http://127.0.0.1:43183；Codex Native API：已关闭');
  assert.equal(checks[5]?.detail, 'Codex Native API 已关闭');
});

test('WeixinAdminDiagnosticsService routes setup targets and preserves degraded Codex Native readiness semantics', async () => {
  const env = {
    CODEX_COMPAT_API_KEY: 'test-key',
    CODEX_COMPAT_BASE_URL: 'http://provider.test',
    CODEX_COMPAT_DEFAULT_MODEL: 'gpt-test',
    CODEX_NATIVE_API_ENABLE: '1',
  };
  const { service } = makeService({
    env,
    requestJson: async (url) => url.endsWith('/v1/health')
      ? {
        ok: false,
        statusCode: 503,
        body: { status: 'degraded', native_runtime: { runtime_reachable: true, provider_profile_id: 'openai-default' } },
        error: 'degraded',
        url,
      }
      : { ok: true, statusCode: 200, body: { data: [{ id: 'gpt-test' }] }, error: '', url },
  });

  const apiKey = await service.runSetupTarget('api-key');
  const weixin = await service.runSetupTarget('weixin');
  const native = await service.runSetupTarget('codex-command');

  assert.equal(apiKey.id, 'model');
  assert.equal(weixin.id, 'weixin-account');
  assert.equal(native.id, 'codex-native');
  assert.equal(native.status, 'warn');
  assert.equal(native.detail, 'Native API 返回 HTTP 503（degraded）');
  await assert.rejects(() => service.runSetupTarget('unknown'), /unknown setup test target/u);
});

test('WeixinAdminDiagnosticsService sanitizes model and Native API network failures', async () => {
  const env = {
    CODEX_COMPAT_API_KEY: 'secret-api-key',
    CODEX_COMPAT_BASE_URL: 'http://provider.test',
    CODEX_COMPAT_DEFAULT_MODEL: 'gpt-test',
    CODEX_NATIVE_API_ENABLE: '1',
  };
  const { service } = makeService({
    env,
    requestJson: async (url) => ({
      ok: false,
      statusCode: null,
      body: null,
      error: `connect ECONNREFUSED Authorization: Bearer ${env.CODEX_COMPAT_API_KEY}`,
      url,
    }),
  });

  const checks = await service.runAll();
  const rendered = JSON.stringify(checks);
  const model = checks.find((check) => check.id === 'model');
  const native = checks.find((check) => check.id === 'codex-native');

  assert.equal(model?.status, 'fail');
  assert.equal(model?.reason, '模型接口不可访问，请检查网络、Base URL 和 API key。');
  assert.equal(native?.status, 'fail');
  assert.equal(native?.reason, '请重启桥接后再检查。');
  assert.doesNotMatch(rendered, /secret-api-key|ECONNREFUSED|Authorization/iu);
});
