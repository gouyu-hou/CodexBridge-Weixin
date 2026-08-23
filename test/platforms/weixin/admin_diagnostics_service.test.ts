import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WeixinAccountStore } from '../../../src/platforms/weixin/account_store.js';
import {
  WeixinAdminDiagnosticsService,
  type WeixinAdminDiagnosticBridgeStatus,
  type WeixinAdminDiagnosticModelProviderSettings,
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
  useDefaultRequest = false,
  useDefaultProbe = false,
  modelProvider = {},
}: {
  stateDir?: string;
  env?: Record<string, string>;
  bridgeStatus?: WeixinAdminDiagnosticBridgeStatus | null;
  binding?: { port: number; url: string } | null;
  requestJson?: (url: string, options: { timeoutMs: number; headers: Record<string, string> }) => Promise<any>;
  probeTcpPort?: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
  useDefaultRequest?: boolean;
  useDefaultProbe?: boolean;
  modelProvider?: Partial<WeixinAdminDiagnosticModelProviderSettings>;
} = {}) {
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const service = new WeixinAdminDiagnosticsService({
    accountStore,
    env,
    adminPort: 43183,
    getBridgeStatus: () => bridgeStatus,
    getAdminBinding: () => binding,
    ...(!useDefaultRequest ? { requestJson } : {}),
    ...(!useDefaultProbe ? { probeTcpPort } : {}),
    resolveModelProviderSettings: () => ({
      source: 'manual' as const,
      profileId: 'openai-default',
      providerName: 'Z Token',
      baseUrl: String(env.CODEX_COMPAT_BASE_URL ?? ''),
      model: String(env.CODEX_COMPAT_DEFAULT_MODEL ?? ''),
      apiKeyConfigured: Boolean(env.CODEX_COMPAT_API_KEY),
      apiKeyMasked: 'test...key',
      capabilities: 'default',
      serviceEnvFile: 'C:/service.env',
      ...modelProvider,
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

test('WeixinAdminDiagnosticsService preserves complete service check branches', async () => {
  const cases: Array<{
    name: string;
    bridgeStatus: WeixinAdminDiagnosticBridgeStatus | null;
    expected: Record<string, unknown>;
  }> = [
    {
      name: 'has no bridge controller',
      bridgeStatus: null,
      expected: {
        id: 'service', title: '服务是否运行', status: 'warn', detail: '管理面板没有接入桥接控制器',
        reason: '当前页面能打开，但无法直接判断微信桥接进程状态。',
        actions: [{ label: '查看运行日志', action: 'open-page', target: 'logs' }],
      },
    },
    {
      name: 'is transitioning',
      bridgeStatus: { running: false, restarting: true },
      expected: {
        id: 'service', title: '服务是否运行', status: 'warn', detail: '微信桥接正在重启',
        reason: '如果长时间停在这个状态，可以手动重启桥接。',
        actions: [{ label: '重启桥接', action: 'restart-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      },
    },
    {
      name: 'is stopped',
      bridgeStatus: { running: false, lastError: 'poll stopped' },
      expected: {
        id: 'service', title: '服务是否运行', status: 'fail', detail: '微信桥接当前没有运行',
        reason: '服务停止后，微信消息不会继续转发给 Codex。',
        actions: [{ label: '启动桥接', action: 'start-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      },
    },
  ];

  for (const item of cases) {
    const { service } = makeService({ bridgeStatus: item.bridgeStatus });
    const [check] = await service.runAll();
    assert.deepEqual(check, item.expected, item.name);
  }
});

test('WeixinAdminDiagnosticsService preserves complete account check branches', async () => {
  const validAccount = (store: WeixinAccountStore) => store.saveAccount({
    accountId: 'bot-primary', token: 'token', baseUrl: 'https://ilink.example.com', userId: 'wxid-primary',
  });
  const cases: Array<{
    name: string;
    env?: Record<string, string>;
    bridgeStatus?: WeixinAdminDiagnosticBridgeStatus | null;
    setup?: (store: WeixinAccountStore) => void;
    expected: Record<string, unknown>;
  }> = [
    {
      name: 'has no accounts',
      expected: {
        id: 'weixin-account', title: '微信账号是否有效', status: 'fail', detail: '还没有添加任何微信入口',
        reason: '需要先生成二维码并用微信扫码确认，朋友或你自己才能发消息。',
        actions: [{ label: '添加微信入口', action: 'open-page', target: 'users' }, { label: '生成二维码', action: 'start-pairing' }],
      },
    },
    {
      name: 'has only disabled accounts',
      setup: (store) => { validAccount(store); store.updateAccount('bot-primary', { disabled: true }); },
      expected: {
        id: 'weixin-account', title: '微信账号是否有效', status: 'fail', detail: '1 个入口都已禁用',
        reason: '禁用后不会轮询微信消息，需要启用至少一个入口。',
        actions: [{ label: '打开用户入口', action: 'open-page', target: 'users' }],
      },
    },
    {
      name: 'has broken credentials',
      setup: (store) => store.saveAccount({ accountId: 'bot-primary', token: '', baseUrl: 'https://ilink.example.com', userId: 'wxid-primary' }),
      expected: {
        id: 'weixin-account', title: '微信账号是否有效', status: 'fail', detail: '1 个入口缺少 token、baseUrl 或 userId',
        reason: '这类入口通常是扫码保存不完整，需要删除后重新扫码。',
        actions: [{ label: '打开用户入口', action: 'open-page', target: 'users' }, { label: '重新生成二维码', action: 'start-pairing' }],
      },
    },
    {
      name: 'has a recent poll failure',
      setup: validAccount,
      bridgeStatus: { running: true, lastErrorStage: 'poll', lastError: '微信轮询失败' },
      expected: {
        id: 'weixin-account', title: '微信账号是否有效', status: 'warn', detail: '已添加 1 个可用入口，但最近轮询失败',
        reason: '微信轮询失败',
        actions: [{ label: '重启桥接', action: 'restart-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      },
    },
    {
      name: 'has a configured primary account that is missing locally',
      env: { WEIXIN_PRIMARY_ACCOUNT_ID: 'missing-primary' },
      setup: validAccount,
      expected: {
        id: 'weixin-account', title: '微信账号是否有效', status: 'warn', detail: '主账号 missing-primary 不在本地入口列表中',
        reason: '可能是配置里还保留了旧账号 ID，可以在用户入口页面重新切换主账号。',
        actions: [{ label: '打开用户入口', action: 'open-page', target: 'users' }],
      },
    },
  ];

  for (const item of cases) {
    const { accountStore, service } = makeService({ env: item.env, bridgeStatus: item.bridgeStatus });
    item.setup?.(accountStore);
    assert.deepEqual(await service.runSetupTarget('weixin'), item.expected, item.name);
  }
});

test('WeixinAdminDiagnosticsService preserves API key and CCSwitch actions', async () => {
  const cases: Array<{
    name: string;
    env: Record<string, string>;
    modelProvider?: Partial<WeixinAdminDiagnosticModelProviderSettings>;
    expected: Record<string, unknown>;
  }> = [
    {
      name: 'lists every missing field', env: {},
      expected: {
        id: 'api-key', title: 'API key 是否配置', status: 'fail', detail: '缺少：API key、Base URL、模型名称',
        reason: '模型配置不完整时，微信消息无法正常得到 Codex 回复。',
        actions: [{ label: '打开模型供应商', action: 'open-page', target: 'provider' }],
      },
    },
    {
      name: 'adds CCSwitch synchronization when configuration is incomplete', env: {}, modelProvider: { source: 'ccswitch' },
      expected: {
        id: 'api-key', title: 'API key 是否配置', status: 'fail', detail: '缺少：API key、Base URL、模型名称',
        reason: '模型配置不完整时，微信消息无法正常得到 Codex 回复。',
        actions: [{ label: '打开模型供应商', action: 'open-page', target: 'provider' }, { label: '同步 CCSwitch', action: 'sync-ccswitch' }],
      },
    },
  ];
  for (const item of cases) {
    const { service } = makeService({ env: item.env, modelProvider: item.modelProvider });
    assert.deepEqual(await service.runSetupTarget('api-key'), item.expected, item.name);
  }
});

test('WeixinAdminDiagnosticsService probes model candidates in order with the Bearer credential', async () => {
  const requests: Array<{ url: string; authorization: string | undefined }> = [];
  const modelServer = http.createServer((req, res) => {
    requests.push({ url: req.url ?? '', authorization: req.headers.authorization });
    if (req.url === '/gateway/v1/models') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'gpt-test' }] }));
  });
  await new Promise<void>((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
  const address = modelServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}/gateway`;
  const { service } = makeService({
    env: { CODEX_COMPAT_API_KEY: 'model-secret', CODEX_COMPAT_BASE_URL: baseUrl, CODEX_COMPAT_DEFAULT_MODEL: 'gpt-test', CODEX_NATIVE_API_ENABLE: '0' },
    useDefaultRequest: true,
  });
  try {
    const check = await service.runSetupTarget('api-key');
    assert.deepEqual(check, {
      id: 'model', title: '模型是否可用', status: 'ok', detail: '模型列表中找到了 gpt-test',
      reason: `接口：${baseUrl}/models`, actions: [{ label: '打开模型供应商', action: 'open-page', target: 'provider' }],
    });
    assert.deepEqual(requests, [
      { url: '/gateway/v1/models', authorization: 'Bearer model-secret' },
      { url: '/gateway/models', authorization: 'Bearer model-secret' },
    ]);
  } finally {
    await new Promise<void>((resolve) => modelServer.close(() => resolve()));
  }
});

test('WeixinAdminDiagnosticsService classifies model upstream responses and sends the 6000ms probe timeout', async () => {
  for (const item of [
    [429, 'warn', '供应商返回限流或额度不足；更换 key、充值或稍后重试。'],
    [502, 'warn', '供应商上游服务临时不可用，这通常不是本地代码问题。'],
    [503, 'warn', '供应商上游服务临时不可用，这通常不是本地代码问题。'],
  ] as const) {
    const calls: Array<{ url: string; timeoutMs: number; headers: Record<string, string> }> = [];
    const { service } = makeService({
      env: { CODEX_COMPAT_API_KEY: 'model-secret', CODEX_COMPAT_BASE_URL: 'http://provider.test', CODEX_COMPAT_DEFAULT_MODEL: 'gpt-test' },
      requestJson: async (url, options) => {
        calls.push({ url, ...options });
        return { ok: false, statusCode: item[0], body: { error: { message: 'upstream unavailable' } }, error: 'upstream unavailable', url };
      },
    });
    assert.deepEqual(await service.runSetupTarget('api-key'), {
      id: 'model', title: '模型是否可用', status: item[1], detail: `模型接口返回 HTTP ${item[0]}`,
      reason: item[2], actions: [{ label: '打开模型供应商', action: 'open-page', target: 'provider' }],
    }, `HTTP ${item[0]}`);
    assert.deepEqual(calls, [{ url: 'http://provider.test/v1/models', timeoutMs: 6000, headers: { authorization: 'Bearer model-secret' } }]);
  }
});

test('WeixinAdminDiagnosticsService preserves complete ports check branches and probe arguments', async () => {
  const cases: Array<{
    name: string;
    env: Record<string, string>;
    binding: { port: number; url: string } | null;
    open: boolean;
    expected: Record<string, unknown>;
  }> = [
    {
      name: 'has no server binding', env: { CODEX_NATIVE_API_ENABLE: '1', CODEX_NATIVE_API_HOST: '127.0.0.1', CODEX_NATIVE_API_PORT: '43182' }, binding: null, open: false,
      expected: {
        id: 'ports', title: '端口是否占用', status: 'fail', detail: '管理面板端口未绑定；Codex Native API：127.0.0.1:43182 未监听',
        reason: '当前 HTTP 服务没有监听成功。 端口 43182 没有监听，可能是 Native API 没启动，或启动时被其他程序影响。',
        actions: [{ label: '重启桥接', action: 'restart-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      },
    },
    {
      name: 'moved away from the configured admin port', env: { WEIXIN_ADMIN_PORT: '43183', CODEX_NATIVE_API_ENABLE: '0' }, binding: { port: 43184, url: 'http://127.0.0.1:43184' }, open: false,
      expected: {
        id: 'ports', title: '端口是否占用', status: 'warn', detail: '管理面板：http://127.0.0.1:43184；Codex Native API：已关闭',
        reason: '配置端口 43183 可能被占用，管理面板已自动切换到 43184。 CODEX_NATIVE_API_ENABLE 被关闭时，部分本地诊断和兼容接口不可用。',
        actions: [{ label: '重启桥接', action: 'restart-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      },
    },
    {
      name: 'has an open Native TCP port', env: { CODEX_NATIVE_API_ENABLE: '1', CODEX_NATIVE_API_HOST: '127.0.0.1', CODEX_NATIVE_API_PORT: '43210' }, binding: { port: 43183, url: 'http://127.0.0.1:43183' }, open: true,
      expected: {
        id: 'ports', title: '端口是否占用', status: 'ok', detail: '管理面板：http://127.0.0.1:43183；Codex Native API：127.0.0.1:43210 已监听',
        reason: '关键本地端口状态正常。',
        actions: [{ label: '重启桥接', action: 'restart-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      },
    },
    {
      name: 'has a closed Native TCP port', env: { CODEX_NATIVE_API_ENABLE: '1', CODEX_NATIVE_API_HOST: '127.0.0.1', CODEX_NATIVE_API_PORT: '43211' }, binding: { port: 43183, url: 'http://127.0.0.1:43183' }, open: false,
      expected: {
        id: 'ports', title: '端口是否占用', status: 'fail', detail: '管理面板：http://127.0.0.1:43183；Codex Native API：127.0.0.1:43211 未监听',
        reason: '端口 43211 没有监听，可能是 Native API 没启动，或启动时被其他程序影响。',
        actions: [{ label: '重启桥接', action: 'restart-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      },
    },
  ];
  for (const item of cases) {
    const probeCalls: Array<[string, number, number]> = [];
    const { service } = makeService({
      env: item.env, binding: item.binding,
      probeTcpPort: async (host, port, timeoutMs) => { probeCalls.push([host, port, timeoutMs]); return item.open; },
    });
    const ports = (await service.runAll()).find((check) => check.id === 'ports');
    assert.deepEqual(ports, item.expected, item.name);
    const expectedProbe = item.env.CODEX_NATIVE_API_ENABLE === '0'
      ? []
      : [[item.env.CODEX_NATIVE_API_HOST ?? '127.0.0.1', Number(item.env.CODEX_NATIVE_API_PORT ?? 43182), 1200]];
    assert.deepEqual(probeCalls, expectedProbe, item.name);
  }
});

test('WeixinAdminDiagnosticsService uses the default TCP probe against a local listener', async () => {
  const nativeServer = http.createServer();
  await new Promise<void>((resolve) => nativeServer.listen(0, '127.0.0.1', resolve));
  const address = nativeServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const { service } = makeService({
    env: { CODEX_NATIVE_API_ENABLE: '1', CODEX_NATIVE_API_HOST: '127.0.0.1', CODEX_NATIVE_API_PORT: String(port) },
    useDefaultProbe: true,
  });
  try {
    const ports = (await service.runAll()).find((check) => check.id === 'ports');
    assert.deepEqual(ports, {
      id: 'ports', title: '端口是否占用', status: 'ok', detail: `管理面板：http://127.0.0.1:43183；Codex Native API：127.0.0.1:${port} 已监听`,
      reason: '关键本地端口状态正常。',
      actions: [{ label: '重启桥接', action: 'restart-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
    });
  } finally {
    await new Promise<void>((resolve) => nativeServer.close(() => resolve()));
  }
});

test('WeixinAdminDiagnosticsService preserves complete Codex Native failure and degraded branches', async () => {
  const baseEnv = { CODEX_NATIVE_API_ENABLE: '1', CODEX_NATIVE_API_HOST: '127.0.0.1', CODEX_NATIVE_API_PORT: '43182' };
  const cases: Array<{
    name: string;
    response: Record<string, unknown>;
    modelProvider?: Partial<WeixinAdminDiagnosticModelProviderSettings>;
    expected: Record<string, unknown>;
  }> = [
    ...([401, 403] as const).map((statusCode) => ({
      name: `HTTP ${statusCode} authentication failure`,
      response: { ok: false, statusCode, body: {}, error: 'not authorized' },
      expected: {
        id: 'codex-native', title: 'Codex 是否能正常响应', status: 'fail', detail: `Native API 返回 HTTP ${statusCode}`,
        reason: 'Native API 设置了鉴权，但诊断请求没有通过，请检查 CODEX_NATIVE_API_AUTH_TOKEN。',
        actions: [{ label: '重启桥接', action: 'restart-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      },
    })),
    {
      name: 'ordinary HTTP 503', response: { ok: false, statusCode: 503, body: { status: 'unavailable' }, error: 'native unavailable' },
      expected: {
        id: 'codex-native', title: 'Codex 是否能正常响应', status: 'fail', detail: 'Native API 返回 HTTP 503', reason: 'native unavailable',
        actions: [{ label: '重启桥接', action: 'restart-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      },
    },
    {
      name: 'runtime-reachable degradation', response: { ok: false, statusCode: 503, body: { status: 'unavailable', native_runtime: { runtime_reachable: true, provider_profile_id: 'openai-default' } }, error: 'degraded' },
      expected: {
        id: 'codex-native', title: 'Codex 是否能正常响应', status: 'warn', detail: 'Native API 返回 HTTP 503（unavailable）',
        reason: '当前桥接仍可用，但健康检查显示 Provider：openai-default 处于降级状态',
        actions: [{ label: '查看运行状态', action: 'open-page', target: 'runtime' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      },
    },
    {
      name: 'compatible provider bypass', response: { ok: false, statusCode: 503, body: { status: 'degraded', native_runtime: { runtime_reachable: true, provider_profile_id: 'openai-default' } }, error: 'degraded' },
      modelProvider: { profileId: 'deepseek', capabilities: 'deepseek', providerName: 'DeepSeek', model: 'deepseek-v4' },
      expected: {
        id: 'codex-native', title: 'Codex 是否能正常响应', status: 'ok', detail: '当前使用 DeepSeek / deepseek-v4',
        reason: 'Native API 健康检查返回 openai-default 降级，但当前微信回复走 deepseek 兼容模型通道，不影响正常对话。',
        actions: [{ label: '查看运行状态', action: 'open-page', target: 'runtime' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      },
    },
  ];

  for (const item of cases) {
    const calls: Array<{ url: string; timeoutMs: number; headers: Record<string, string> }> = [];
    const { service } = makeService({
      env: { ...baseEnv, CODEX_NATIVE_API_AUTH_TOKEN: 'native-secret' }, modelProvider: item.modelProvider,
      requestJson: async (url, options) => {
        calls.push({ url, ...options });
        return { ...item.response, url } as any;
      },
    });
    assert.deepEqual(await service.runSetupTarget('codex-command'), item.expected, item.name);
    assert.deepEqual(calls, [{ url: 'http://127.0.0.1:43182/v1/health', timeoutMs: 25000, headers: { authorization: 'Bearer native-secret' } }], item.name);
  }
});

test('WeixinAdminDiagnosticsService uses default Native HTTP probes with auth against a local server', async () => {
  const requests: Array<{ url: string; authorization: string | undefined }> = [];
  const nativeServer = http.createServer((req, res) => {
    requests.push({ url: req.url ?? '', authorization: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', native_runtime: { provider_profile_id: 'openai-default' } }));
  });
  await new Promise<void>((resolve) => nativeServer.listen(0, '127.0.0.1', resolve));
  const address = nativeServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const { service } = makeService({
    env: { CODEX_NATIVE_API_ENABLE: '1', CODEX_NATIVE_API_HOST: '127.0.0.1', CODEX_NATIVE_API_PORT: String(port), CODEX_NATIVE_API_AUTH_TOKEN: 'native-secret' },
    useDefaultRequest: true,
  });
  try {
    assert.deepEqual(await service.runSetupTarget('codex-command'), {
      id: 'codex-native', title: 'Codex 是否能正常响应', status: 'ok', detail: 'Native API 响应：ok', reason: 'Provider：openai-default',
      actions: [{ label: '查看运行状态', action: 'open-page', target: 'runtime' }],
    });
    assert.deepEqual(requests, [{ url: '/v1/health', authorization: 'Bearer native-secret' }]);
  } finally {
    await new Promise<void>((resolve) => nativeServer.close(() => resolve()));
  }
});
