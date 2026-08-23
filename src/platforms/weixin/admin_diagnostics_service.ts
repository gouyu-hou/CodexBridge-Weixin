import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { WeixinAccountStore } from './account_store.js';

const DEFAULT_NATIVE_API_HOST = '127.0.0.1';
const DEFAULT_NATIVE_API_PORT = 43182;

export type DiagnosticStatus = 'ok' | 'warn' | 'fail';

export interface DiagnosticAction {
  label: string;
  action: string;
  target?: string;
}

export interface DiagnosticCheck {
  id: string;
  title: string;
  status: DiagnosticStatus;
  detail: string;
  reason: string;
  actions: DiagnosticAction[];
}

export interface WeixinAdminDiagnosticBridgeStatus {
  running: boolean;
  starting?: boolean;
  stopping?: boolean;
  restarting?: boolean;
  activeTurns?: number;
  queuedTurns?: number;
  lastError?: string | null;
  lastErrorStage?: string | null;
}

export interface WeixinAdminDiagnosticModelProviderSettings {
  source: 'manual' | 'ccswitch';
  profileId?: string;
  providerName: string;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
  capabilities?: string;
  serviceEnvFile: string;
}

export interface WeixinAdminDiagnosticBinding {
  port: number;
  url: string;
}

export interface DiagnosticJsonRequestResult {
  ok: boolean;
  statusCode: number | null;
  body: unknown;
  error: string;
  url: string;
}

export interface WeixinAdminDiagnosticsServiceOptions {
  accountStore: WeixinAccountStore;
  env?: NodeJS.ProcessEnv | Record<string, unknown>;
  adminPort: number;
  getBridgeStatus(): WeixinAdminDiagnosticBridgeStatus | null;
  getAdminBinding(): WeixinAdminDiagnosticBinding | null;
  resolveModelProviderSettings(): WeixinAdminDiagnosticModelProviderSettings;
  requestJson?: (url: string, options: { timeoutMs: number; headers: Record<string, string> }) => Promise<DiagnosticJsonRequestResult>;
  probeTcpPort?: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
}

export class WeixinAdminDiagnosticsService {
  constructor({
    accountStore,
    env = process.env,
    adminPort,
    getBridgeStatus,
    getAdminBinding,
    resolveModelProviderSettings,
    requestJson = requestJsonUrl,
    probeTcpPort = probeTcp,
  }: WeixinAdminDiagnosticsServiceOptions) {
    this.accountStore = accountStore;
    this.env = env;
    this.adminPort = adminPort;
    this.getBridgeStatus = getBridgeStatus;
    this.getAdminBinding = getAdminBinding;
    this.resolveModelProviderSettings = resolveModelProviderSettings;
    this.requestJson = requestJson;
    this.probeTcpPort = probeTcpPort;
  }

  accountStore: WeixinAccountStore;
  env: NodeJS.ProcessEnv | Record<string, unknown>;
  adminPort: number;
  getBridgeStatus: () => WeixinAdminDiagnosticBridgeStatus | null;
  getAdminBinding: () => WeixinAdminDiagnosticBinding | null;
  resolveModelProviderSettings: () => WeixinAdminDiagnosticModelProviderSettings;
  requestJson: (url: string, options: { timeoutMs: number; headers: Record<string, string> }) => Promise<DiagnosticJsonRequestResult>;
  probeTcpPort: (host: string, port: number, timeoutMs: number) => Promise<boolean>;

  async runAll(): Promise<DiagnosticCheck[]> {
    const checks: DiagnosticCheck[] = [
      this.diagnoseService(),
      this.diagnoseWeixinAccounts(),
      this.diagnoseApiKey(),
    ];
    const [modelAvailability, ports, codexNative] = await Promise.all([
      this.diagnoseModelAvailability(),
      this.diagnosePorts(),
      this.diagnoseCodexNative(),
    ]);
    checks.push(modelAvailability, ports, codexNative);
    return checks;
  }

  async runSetupTarget(target: string): Promise<DiagnosticCheck> {
    if (target === 'api-key') {
      const apiKey = this.diagnoseApiKey();
      return apiKey.status === 'fail' ? apiKey : this.diagnoseModelAvailability();
    }
    if (target === 'weixin') return this.diagnoseWeixinAccounts();
    if (target === 'codex-command') return this.diagnoseCodexNative();
    throw new Error('unknown setup test target');
  }

  private diagnoseService(): DiagnosticCheck {
    const bridge = this.getBridgeStatus();
    if (!bridge) {
      return makeDiagnosticCheck({
        id: 'service', title: '服务是否运行', status: 'warn', detail: '管理面板没有接入桥接控制器',
        reason: '当前页面能打开，但无法直接判断微信桥接进程状态。',
        actions: [{ label: '查看运行日志', action: 'open-page', target: 'logs' }],
      });
    }
    if (bridge.running) {
      return makeDiagnosticCheck({
        id: 'service', title: '服务是否运行', status: 'ok',
        detail: `微信桥接正在运行，当前 ${bridge.activeTurns ?? 0} 个回复中，${bridge.queuedTurns ?? 0} 个排队中。`,
        reason: bridge.lastError ? `最近错误：${bridge.lastError}` : '服务主循环可用。',
        actions: [{ label: '重启桥接', action: 'restart-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      });
    }
    if (bridge.starting || bridge.restarting || bridge.stopping) {
      return makeDiagnosticCheck({
        id: 'service', title: '服务是否运行', status: 'warn',
        detail: bridge.restarting ? '微信桥接正在重启' : (bridge.starting ? '微信桥接正在启动' : '微信桥接正在停止'),
        reason: '如果长时间停在这个状态，可以手动重启桥接。',
        actions: [{ label: '重启桥接', action: 'restart-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      });
    }
    return makeDiagnosticCheck({
      id: 'service', title: '服务是否运行', status: 'fail', detail: '微信桥接当前没有运行',
      reason: '服务停止后，微信消息不会继续转发给 Codex。',
      actions: [{ label: '启动桥接', action: 'start-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
    });
  }

  private diagnoseWeixinAccounts(): DiagnosticCheck {
    const accountIds = this.accountStore.listAccounts();
    const primaryAccountId = resolvePrimaryAccountId(this.accountStore, this.env);
    const records = accountIds.map((accountId) => ({ accountId, account: this.accountStore.loadAccount(accountId) }));
    if (records.length === 0) {
      return makeDiagnosticCheck({
        id: 'weixin-account', title: '微信账号是否有效', status: 'fail', detail: '还没有添加任何微信入口',
        reason: '需要先生成二维码并用微信扫码确认，朋友或你自己才能发消息。',
        actions: [{ label: '添加微信入口', action: 'open-page', target: 'users' }, { label: '生成二维码', action: 'start-pairing' }],
      });
    }
    const enabled = records.filter(({ account }) => account && !account.disabled);
    if (enabled.length === 0) {
      return makeDiagnosticCheck({
        id: 'weixin-account', title: '微信账号是否有效', status: 'fail', detail: `${records.length} 个入口都已禁用`,
        reason: '禁用后不会轮询微信消息，需要启用至少一个入口。',
        actions: [{ label: '打开用户入口', action: 'open-page', target: 'users' }],
      });
    }
    const broken = enabled.filter(({ account }) => !account?.token || !account?.base_url || !account?.user_id);
    if (broken.length > 0) {
      return makeDiagnosticCheck({
        id: 'weixin-account', title: '微信账号是否有效', status: 'fail', detail: `${broken.length} 个入口缺少 token、baseUrl 或 userId`,
        reason: '这类入口通常是扫码保存不完整，需要删除后重新扫码。',
        actions: [{ label: '打开用户入口', action: 'open-page', target: 'users' }, { label: '重新生成二维码', action: 'start-pairing' }],
      });
    }
    const bridge = this.getBridgeStatus();
    if (bridge?.lastErrorStage === 'poll' && bridge.lastError) {
      return makeDiagnosticCheck({
        id: 'weixin-account', title: '微信账号是否有效', status: 'warn', detail: `已添加 ${enabled.length} 个可用入口，但最近轮询失败`,
        reason: bridge.lastError,
        actions: [{ label: '重启桥接', action: 'restart-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      });
    }
    if (primaryAccountId && !accountIds.includes(primaryAccountId)) {
      return makeDiagnosticCheck({
        id: 'weixin-account', title: '微信账号是否有效', status: 'warn', detail: `主账号 ${primaryAccountId} 不在本地入口列表中`,
        reason: '可能是配置里还保留了旧账号 ID，可以在用户入口页面重新切换主账号。',
        actions: [{ label: '打开用户入口', action: 'open-page', target: 'users' }],
      });
    }
    return makeDiagnosticCheck({
      id: 'weixin-account', title: '微信账号是否有效', status: 'ok', detail: `已添加 ${records.length} 个入口，${enabled.length} 个启用中`,
      reason: primaryAccountId ? `当前主账号：${primaryAccountId}` : '未显式设置主账号，会自动选择最早添加的入口。',
      actions: [{ label: '管理入口', action: 'open-page', target: 'users' }],
    });
  }

  private diagnoseApiKey(): DiagnosticCheck {
    const provider = this.resolveModelProviderSettings();
    const missing = [provider.apiKeyConfigured ? '' : 'API key', provider.baseUrl ? '' : 'Base URL', provider.model ? '' : '模型名称'].filter(Boolean);
    if (missing.length > 0) {
      return makeDiagnosticCheck({
        id: 'api-key', title: 'API key 是否配置', status: 'fail', detail: `缺少：${missing.join('、')}`,
        reason: '模型配置不完整时，微信消息无法正常得到 Codex 回复。',
        actions: [{ label: '打开模型供应商', action: 'open-page', target: 'provider' }, ...(provider.source === 'ccswitch' ? [{ label: '同步 CCSwitch', action: 'sync-ccswitch' }] : [])],
      });
    }
    return makeDiagnosticCheck({
      id: 'api-key', title: 'API key 是否配置', status: 'ok', detail: `${provider.providerName} / ${provider.model} / ${provider.apiKeyMasked || '已保存 key'}`,
      reason: `配置文件：${provider.serviceEnvFile}`,
      actions: [{ label: '修改模型配置', action: 'open-page', target: 'provider' }],
    });
  }

  private async diagnoseModelAvailability(): Promise<DiagnosticCheck> {
    const provider = this.resolveModelProviderSettings();
    const apiKey = normalizeEnvString(this.env.CODEX_COMPAT_API_KEY) ?? '';
    if (!provider.baseUrl || !provider.model || !apiKey) {
      return makeDiagnosticCheck({
        id: 'model', title: '模型是否可用', status: 'fail', detail: '模型、Base URL 或 API key 尚未配置完整',
        reason: '需要先完成模型供应商配置。', actions: [{ label: '打开模型供应商', action: 'open-page', target: 'provider' }],
      });
    }
    let lastResult: DiagnosticJsonRequestResult | null = null;
    for (const url of buildModelEndpointCandidates(provider.baseUrl)) {
      const result = await this.requestJson(url, { timeoutMs: 6000, headers: { authorization: `Bearer ${apiKey}` } });
      lastResult = result;
      if (result.ok) {
        const models = extractModelIds(result.body);
        if (models.length === 0) return makeDiagnosticCheck({
          id: 'model', title: '模型是否可用', status: 'warn', detail: '模型接口可访问，但没有返回模型列表',
          reason: '部分中转站不会开放 /models 列表；如果微信能正常回复，可以忽略这个警告。', actions: [{ label: '查看模型配置', action: 'open-page', target: 'provider' }],
        });
        const found = models.includes(provider.model);
        return makeDiagnosticCheck({
          id: 'model', title: '模型是否可用', status: found ? 'ok' : 'warn',
          detail: found ? `模型列表中找到了 ${provider.model}` : `模型接口可访问，但列表里没有看到 ${provider.model}`,
          reason: found ? `接口：${url}` : '可能是模型名写错，也可能是供应商没有在 /models 里返回全部模型别名。',
          actions: [{ label: '打开模型供应商', action: 'open-page', target: 'provider' }],
        });
      }
      if (result.statusCode && ![404, 405].includes(result.statusCode)) break;
    }
    const statusCode = lastResult?.statusCode ?? 0;
    return makeDiagnosticCheck({
      id: 'model', title: '模型是否可用', status: statusCode === 429 || statusCode === 502 || statusCode === 503 ? 'warn' : 'fail',
      detail: statusCode ? `模型接口返回 HTTP ${statusCode}` : '无法连接模型接口', reason: explainProviderHttpFailure(lastResult),
      actions: [{ label: '打开模型供应商', action: 'open-page', target: 'provider' }, ...(provider.source === 'ccswitch' ? [{ label: '同步 CCSwitch', action: 'sync-ccswitch' }] : [])],
    });
  }

  private async diagnosePorts(): Promise<DiagnosticCheck> {
    const native = resolveNativeApiSettings(this.env);
    const preferredAdminPort = parseOptionalPort(this.env.WEIXIN_ADMIN_PORT) ?? this.adminPort;
    const details: string[] = [];
    const reasons: string[] = [];
    let status: DiagnosticStatus = 'ok';
    const binding = this.getAdminBinding();
    if (!binding) {
      status = 'fail'; details.push('管理面板端口未绑定'); reasons.push('当前 HTTP 服务没有监听成功。');
    } else {
      details.push(`管理面板：${binding.url}`);
      if (preferredAdminPort && preferredAdminPort !== binding.port) {
        status = 'warn'; reasons.push(`配置端口 ${preferredAdminPort} 可能被占用，管理面板已自动切换到 ${binding.port}。`);
      }
    }
    if (!native.enabled) {
      status = status === 'fail' ? status : 'warn'; details.push('Codex Native API：已关闭'); reasons.push('CODEX_NATIVE_API_ENABLE 被关闭时，部分本地诊断和兼容接口不可用。');
    } else {
      const open = await this.probeTcpPort(native.host, native.port, 1200);
      details.push(`Codex Native API：${native.host}:${native.port} ${open ? '已监听' : '未监听'}`);
      if (!open) { status = 'fail'; reasons.push(`端口 ${native.port} 没有监听，可能是 Native API 没启动，或启动时被其他程序影响。`); }
    }
    return makeDiagnosticCheck({
      id: 'ports', title: '端口是否占用', status, detail: details.join('；'), reason: reasons.join(' ') || '关键本地端口状态正常。',
      actions: [{ label: '重启桥接', action: 'restart-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
    });
  }

  private async diagnoseCodexNative(): Promise<DiagnosticCheck> {
    const native = resolveNativeApiSettings(this.env);
    if (!native.enabled) return makeDiagnosticCheck({
      id: 'codex-native', title: 'Codex 是否能正常响应', status: 'warn', detail: 'Codex Native API 已关闭',
      reason: '当前微信桥接仍可能可用，但无法通过本地 Native API 做健康检查。', actions: [{ label: '查看运行配置', action: 'open-page', target: 'settings' }],
    });
    const result = await this.requestJson(`${native.baseUrl}/v1/health`, { timeoutMs: 25000, headers: native.authToken ? { authorization: `Bearer ${native.authToken}` } : {} });
    const body = isRecord(result.body) ? result.body : {};
    const runtime = isRecord(body.native_runtime) ? body.native_runtime : {};
    const statusText = normalizeEnvString(body.status) ?? '';
    const runtimeReachable = Boolean(runtime.runtime_reachable);
    const runtimeProviderProfileId = normalizeEnvString(runtime.provider_profile_id) ?? '';
    const provider = this.resolveModelProviderSettings();
    const activeProviderId = normalizeEnvString(provider.profileId) ?? 'openai-default';
    const activeCapabilities = normalizeEnvString(provider.capabilities) ?? 'default';
    const activeProviderIsCompatible = activeProviderId !== 'openai-default' || activeCapabilities !== 'default';
    if (result.ok) return makeDiagnosticCheck({
      id: 'codex-native', title: 'Codex 是否能正常响应', status: statusText === 'ok' ? 'ok' : 'warn', detail: `Native API 响应：${statusText}`,
      reason: runtimeProviderProfileId ? `Provider：${runtimeProviderProfileId}` : `接口：${native.baseUrl}/v1/health`, actions: [{ label: '查看运行状态', action: 'open-page', target: 'runtime' }],
    });
    if (result.statusCode === 503 && (statusText === 'degraded' || runtimeReachable)) {
      if (activeProviderIsCompatible) return makeDiagnosticCheck({
        id: 'codex-native', title: 'Codex 是否能正常响应', status: 'ok', detail: `当前使用 ${provider.providerName} / ${provider.model}`,
        reason: runtimeProviderProfileId && runtimeProviderProfileId !== activeProviderId
          ? `Native API 健康检查返回 ${runtimeProviderProfileId} 降级，但当前微信回复走 ${activeProviderId} 兼容模型通道，不影响正常对话。`
          : 'Native API 健康检查处于降级状态，但当前微信回复走兼容模型通道，不影响正常对话。',
        actions: [{ label: '查看运行状态', action: 'open-page', target: 'runtime' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      });
      return makeDiagnosticCheck({
        id: 'codex-native', title: 'Codex 是否能正常响应', status: 'warn', detail: `Native API 返回 HTTP 503（${statusText || 'degraded'}）`,
        reason: runtimeProviderProfileId ? `当前桥接仍可用，但健康检查显示 Provider：${runtimeProviderProfileId} 处于降级状态` : '当前桥接仍可用，但健康检查显示为降级状态',
        actions: [{ label: '查看运行状态', action: 'open-page', target: 'runtime' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
      });
    }
    return makeDiagnosticCheck({
      id: 'codex-native', title: 'Codex 是否能正常响应', status: 'fail', detail: result.statusCode ? `Native API 返回 HTTP ${result.statusCode}` : 'Native API 没有响应',
      reason: explainNativeApiFailure(result), actions: [{ label: '重启桥接', action: 'restart-bridge' }, { label: '查看日志', action: 'open-page', target: 'logs' }],
    });
  }
}

export function summarizeDiagnosticChecks(checks: DiagnosticCheck[]) {
  const failed = checks.filter((check) => check.status === 'fail').length;
  const warned = checks.filter((check) => check.status === 'warn').length;
  const ok = checks.filter((check) => check.status === 'ok').length;
  return { status: failed > 0 ? 'fail' : (warned > 0 ? 'warn' : 'ok'), ok, warned, failed, text: failed > 0 ? `发现 ${failed} 个需要处理的问题，另有 ${warned} 个提醒。` : (warned > 0 ? `基础功能可用，但有 ${warned} 个提醒需要留意。` : '全部检查通过。') };
}

export function buildSetupTestMessage(target: string, check: DiagnosticCheck): string {
  const label = target === 'api-key' ? 'API key / 模型' : target === 'weixin' ? '微信连通' : 'Codex 命令能力';
  return check.status === 'ok' ? `${label} 测试通过：${check.detail}` : check.status === 'warn' ? `${label} 测试有提醒：${check.detail}` : `${label} 测试未通过：${check.detail}`;
}

export function buildSetupRepairHint(target: string, check: DiagnosticCheck): string {
  if (check.status === 'ok') return '当前项目正常，可以继续下一步。';
  const action = check.actions[0]?.label ? `建议先点击「${check.actions[0].label}」。` : '';
  const defaultHint = target === 'api-key' ? '请检查 API key、接口地址 Base URL、模型名称是否填写正确；如果使用 CCSwitch，可以先同步一次再保存。' : target === 'weixin' ? '请重新生成微信二维码并扫码确认，确认入口没有被禁用。' : '请确认本地 Codex / Native API 已启动；如果刚打开软件，可以等待十几秒后重试。';
  return [check.reason, action || defaultHint].filter(Boolean).join(' ');
}

function makeDiagnosticCheck(check: DiagnosticCheck): DiagnosticCheck {
  return { id: check.id, title: check.title, status: check.status, detail: check.detail, reason: check.reason, actions: check.actions };
}

function resolveNativeApiSettings(env: NodeJS.ProcessEnv | Record<string, unknown>) {
  const host = normalizeEnvString(env.CODEX_NATIVE_API_HOST) ?? DEFAULT_NATIVE_API_HOST;
  const port = parseOptionalPort(env.CODEX_NATIVE_API_PORT) ?? DEFAULT_NATIVE_API_PORT;
  return { enabled: parseBooleanEnv(env.CODEX_NATIVE_API_ENABLE, true), host, port, baseUrl: `http://${host}:${port}`, authToken: normalizeEnvString(env.CODEX_NATIVE_API_AUTH_TOKEN) ?? '' };
}

function resolvePrimaryAccountId(accountStore: WeixinAccountStore, env: NodeJS.ProcessEnv | Record<string, unknown>) {
  const explicitPrimary = normalizeCsv(env.WEIXIN_PRIMARY_ACCOUNT_ID)[0] ?? normalizeCsv(env.WEIXIN_ACCOUNT_ID)[0];
  if (explicitPrimary) return explicitPrimary;
  return accountStore.listAccounts().map((accountId) => ({ accountId, savedAt: Date.parse(String(accountStore.loadAccount(accountId)?.saved_at ?? '')) })).sort((left, right) => {
    const leftTime = Number.isFinite(left.savedAt) ? left.savedAt : Number.MAX_SAFE_INTEGER;
    const rightTime = Number.isFinite(right.savedAt) ? right.savedAt : Number.MAX_SAFE_INTEGER;
    return leftTime !== rightTime ? leftTime - rightTime : left.accountId.localeCompare(right.accountId);
  })[0]?.accountId ?? null;
}

function buildModelEndpointCandidates(baseUrl: string) {
  const candidates: string[] = [];
  try {
    const parsed = new URL(baseUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/u, '');
    if (normalizedPath.endsWith('/models')) candidates.push(parsed.toString());
    else {
      const first = new URL(parsed.toString());
      first.pathname = (normalizedPath.endsWith('/v1') ? `${normalizedPath}/models` : `${normalizedPath || ''}/v1/models`).replace(/\/+/gu, '/');
      candidates.push(first.toString());
      const second = new URL(parsed.toString());
      second.pathname = `${normalizedPath || ''}/models`.replace(/\/+/gu, '/');
      candidates.push(second.toString());
    }
  } catch { return []; }
  return [...new Set(candidates)];
}

function requestJsonUrl(url: string, { timeoutMs = 5000, headers = {} }: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<DiagnosticJsonRequestResult> {
  return new Promise((resolve) => {
    let parsed: URL;
    try { parsed = new URL(url); } catch {
      resolve({ ok: false, statusCode: null, body: null, error: 'URL 无效', url }); return;
    }
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request({ protocol: parsed.protocol, hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80), method: 'GET', path: `${parsed.pathname}${parsed.search}`, headers: { accept: 'application/json', ...headers }, timeout: timeoutMs }, (response) => {
      const chunks: Buffer[] = []; let total = 0;
      response.on('data', (chunk) => { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)); total += buffer.length; if (total <= 1024 * 1024) chunks.push(buffer); });
      response.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); const body = safeJsonParse(text); const statusCode = response.statusCode ?? null; resolve({ ok: Boolean(statusCode && statusCode >= 200 && statusCode < 300), statusCode, body, error: statusCode && statusCode >= 200 && statusCode < 300 ? '' : extractResponseError(body, text), url }); });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', () => resolve({ ok: false, statusCode: null, body: null, error: 'network request failed', url }));
    req.end();
  });
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (open: boolean) => { socket.removeAllListeners(); socket.destroy(); resolve(open); };
    socket.setTimeout(timeoutMs, () => finish(false)); socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
  });
}

function extractModelIds(body: unknown) {
  const root = isRecord(body) ? body : {};
  const rawModels = Array.isArray(root.data) ? root.data : (Array.isArray(root.models) ? root.models : []);
  return rawModels.map((entry) => typeof entry === 'string' ? entry.trim() : isRecord(entry) ? normalizeEnvString(entry.id) ?? normalizeEnvString(entry.name) ?? normalizeEnvString(entry.model) : null).filter((entry): entry is string => Boolean(entry));
}

function explainProviderHttpFailure(result: DiagnosticJsonRequestResult | null) {
  if (!result) return '没有拿到模型接口返回。';
  if (result.statusCode === 401 || result.statusCode === 403) return 'API key 无效、权限不足，或 Base URL 指向了错误的供应商。';
  if (result.statusCode === 429) return '供应商返回限流或额度不足；更换 key、充值或稍后重试。';
  if (result.statusCode === 502 || result.statusCode === 503) return '供应商上游服务临时不可用，这通常不是本地代码问题。';
  return result.statusCode ? result.error || '模型接口不可访问，请检查网络、Base URL 和 API key。' : '模型接口不可访问，请检查网络、Base URL 和 API key。';
}

function explainNativeApiFailure(result: DiagnosticJsonRequestResult) {
  if (result.statusCode === 401 || result.statusCode === 403) return 'Native API 设置了鉴权，但诊断请求没有通过，请检查 CODEX_NATIVE_API_AUTH_TOKEN。';
  if (result.statusCode === 503) return result.error || 'Codex Native API 已启动，但底层 Codex/模型运行时不可用。';
  return result.statusCode ? result.error || '请重启桥接后再检查。' : '请重启桥接后再检查。';
}

function extractResponseError(body: unknown, fallbackText: string) {
  if (isRecord(body)) { if (isRecord(body.error)) return normalizeEnvString(body.error.message) ?? normalizeEnvString(body.error.code) ?? JSON.stringify(body.error); return normalizeEnvString(body.message) ?? normalizeEnvString(body.status) ?? fallbackText.slice(0, 500); }
  return fallbackText.slice(0, 500);
}

function safeJsonParse(text: string) { try { return JSON.parse(text) as unknown; } catch { return null; } }
function normalizeEnvString(value: unknown) { const normalized = typeof value === 'string' ? value.trim() : ''; return normalized || null; }
function normalizeCsv(value: unknown) { return String(value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean); }
function parseOptionalPort(value: unknown) { const parsed = Number.parseInt(String(value ?? ''), 10); return Number.isFinite(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : null; }
function parseBooleanEnv(value: unknown, defaultValue = false): boolean { const normalized = String(value ?? '').trim().toLowerCase(); if (!normalized) return defaultValue; if (['0', 'false', 'no', 'off'].includes(normalized)) return false; return ['1', 'true', 'yes', 'on'].includes(normalized); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
