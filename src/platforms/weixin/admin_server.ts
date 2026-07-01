import crypto from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { readCodexSessionIndex, resolveCodexHome, findCodexSessionIndexEntry, type CodexSessionIndexEntry } from '../../providers/codex/session_index.js';
import { buildOpenAICompatibleProfileFromInput } from '../../providers/codex/config.js';
import { resolveCodexSwitchProviderState, type CodexSwitchProviderState } from '../../providers/codex/ccswitch_sync.js';
import type { BridgeSession, SessionSettings, ThreadMetadata } from '../../types/core.js';
import type { ProviderProfile } from '../../types/provider.js';
import type { PlatformBinding } from '../../types/repository.js';
import { WeixinAccountStore } from './account_store.js';
import { postAlert } from '../../runtime/alert_webhook.js';
import { DEFAULT_ILINK_BOT_TYPE, officialQrLogin, type OfficialQrLoginCredentials } from './official/login.js';

type QrLoginImpl = typeof officialQrLogin;

interface WeixinAdminServerOptions {
  accountStore: WeixinAccountStore;
  stateDir: string;
  env?: NodeJS.ProcessEnv | Record<string, unknown>;
  host?: string;
  port?: number;
  locale?: string | null;
  qrLogin?: QrLoginImpl;
  bridgeControl?: WeixinBridgeControl | null;
  serviceControl?: WeixinAdminServiceControl | null;
  repositories?: WeixinAdminRepositories | null;
  codexHome?: string | null;
  pageCloseShutdownGraceMs?: number;
}

interface WeixinAdminRepositories {
  providerProfiles?: {
    list(): ProviderProfile[];
    save?(profile: ProviderProfile): ProviderProfile;
  } | null;
  bridgeSessions?: {
    list(): BridgeSession[];
    save?(session: BridgeSession): BridgeSession;
    delete?(bridgeSessionId: string): void;
  } | null;
  platformBindings?: {
    list(): PlatformBinding[];
    save?(binding: PlatformBinding): PlatformBinding;
    deleteBySession?(bridgeSessionId: string): void;
  } | null;
  sessionSettings?: {
    getByBridgeSessionId?(bridgeSessionId: string): SessionSettings | null;
    get?(bridgeSessionId: string): SessionSettings | null;
    listAll?(): SessionSettings[];
    save?(settings: SessionSettings): SessionSettings;
    delete?(bridgeSessionId: string): void;
  } | null;
  threadMetadata?: {
    getByThread?(providerProfileId: string, threadId: string): ThreadMetadata | null;
    get?(providerProfileId: string, threadId: string): ThreadMetadata | null;
    listByProviderProfileId?(providerProfileId: string): ThreadMetadata[];
    listAll?(): ThreadMetadata[];
    save?(metadata: ThreadMetadata): ThreadMetadata;
    delete?(providerProfileId: string, threadId: string): void;
  } | null;
}

interface WeixinBridgeControl {
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  configureConcurrency?(settings: {
    maxConcurrentTurns?: number | null;
    eventDispatchConcurrency?: number | null;
    attachmentProcessingConcurrency?: number | null;
    accountPollConcurrency?: number | null;
  }): Promise<void> | void;
  getMetrics?(): Record<string, unknown>;
  resetMetrics?(): Record<string, unknown>;
  status(): {
    running: boolean;
    starting?: boolean;
    stopping?: boolean;
    restarting?: boolean;
    lastPollAt?: number | null;
    lastCommitAt?: number | null;
    lastErrorAt?: number | null;
    lastError?: string | null;
    lastErrorStage?: string | null;
    lastPollEventCount?: number;
    lastPollSyncCursor?: string | null;
    restartCount?: number;
    autoRestartScheduled?: boolean;
    healthCheckActive?: boolean;
    stalePollThresholdMs?: number;
    pendingDeliveryRetries?: number;
    maxConcurrentTurns?: number;
    activeTurns?: number;
    queuedTurns?: number;
    eventDispatchConcurrency?: number;
    weixin?: {
      running?: boolean;
      accountCount?: number;
      activeAccountIds?: string[];
      attachmentProcessingConcurrency?: number;
      accountPollConcurrency?: number;
    } | null;
  };
}

interface WeixinAdminServiceControl {
  shutdown(reason?: string): Promise<void> | void;
}

interface WeixinAdminServerBinding {
  host: string;
  port: number;
  url: string;
}

interface AdminPageClient {
  id: string;
  shutdownOnClose: boolean;
  closed: boolean;
  lastSeenAt: number;
}

interface PairingSession {
  id: string;
  status: 'starting' | 'wait' | 'scaned_but_redirect' | 'confirmed' | 'expired' | 'timeout' | 'cancelled' | 'error' | string;
  qrcode: string;
  qrUrl: string;
  qrImageDataUrl: string;
  displayName: string;
  accountId: string;
  userId: string;
  error: string;
  createdAt: string;
  updatedAt: string;
  cancelled: boolean;
  firstQrReady: Promise<void>;
  resolveFirstQrReady: () => void;
}

type DiagnosticStatus = 'ok' | 'warn' | 'fail';

interface DiagnosticAction {
  label: string;
  action: string;
  target?: string;
}

interface DiagnosticCheck {
  id: string;
  title: string;
  status: DiagnosticStatus;
  detail: string;
  reason: string;
  actions: DiagnosticAction[];
}

interface JsonRequestResult {
  ok: boolean;
  statusCode: number | null;
  body: unknown;
  error: string;
  url: string;
}

const DEFAULT_ADMIN_HOST = '127.0.0.1';
const DEFAULT_ADMIN_PORT = 43183;
const DEFAULT_NATIVE_API_HOST = '127.0.0.1';
const DEFAULT_NATIVE_API_PORT = 43182;
const PAIRING_TIMEOUT_SECONDS = 480;
const JSON_BODY_LIMIT_BYTES = 64 * 1024;
const IMPORT_BODY_LIMIT_BYTES = 32 * 1024 * 1024;
const DEFAULT_SESSION_LIST_LIMIT = 200;
const MAX_SESSION_LIST_LIMIT = 1000;
const LOG_TAIL_BYTES = 256 * 1024;
const DEFAULT_LOG_LINE_LIMIT = 300;
const MAX_LOG_LINE_LIMIT = 2000;
const DEFAULT_MAX_CONCURRENT_TURNS = 3;
const DEFAULT_EVENT_DISPATCH_CONCURRENCY = 12;
const DEFAULT_ATTACHMENT_PROCESSING_CONCURRENCY = 3;
const DEFAULT_ACCOUNT_POLL_CONCURRENCY = 4;
const DEFAULT_LOG_CLEANUP_ENABLED = true;
const DEFAULT_LOG_RETENTION_DAYS = 7;
const DEFAULT_LOG_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_LOG_CLEANUP_INTERVAL_MINUTES = 60;
const MAX_RUNTIME_CONCURRENCY = 64;
const MAX_LOG_RETENTION_DAYS = 365;
const MAX_LOG_CLEANUP_INTERVAL_MINUTES = 24 * 60;
const DEFAULT_PAGE_CLOSE_SHUTDOWN_GRACE_MS = 3000;
const ADMIN_PAGE_CLIENT_TTL_MS = 15_000;
const ADMIN_PREFERENCES_FILE = 'weixin-admin-preferences.json';
const MIN_NODE_MAJOR_VERSION = 24;
const DEFAULT_CCSWITCH_SYNC_INTERVAL_MS = 10_000;
const MIN_CCSWITCH_SYNC_INTERVAL_MS = 2_000;
const ADMIN_FAVICON_PATH = path.resolve(process.cwd(), 'assets', 'windows', 'codexbridge-weixin.ico');
const ADMIN_FAVICON_PNG_PATH = path.resolve(process.cwd(), 'assets', 'windows', 'codexbridge-weixin.png');
const ADMIN_DONATE_QR_PATH = path.resolve(process.cwd(), 'assets', 'donate', 'wechat-reward.png');

export class WeixinAdminServer {
  constructor({
    accountStore,
    stateDir,
    env = process.env,
    host = DEFAULT_ADMIN_HOST,
    port = DEFAULT_ADMIN_PORT,
    locale = null,
    qrLogin = officialQrLogin,
    bridgeControl = null,
    serviceControl = null,
    repositories = null,
    codexHome = resolveCodexHome(env as NodeJS.ProcessEnv),
    pageCloseShutdownGraceMs = DEFAULT_PAGE_CLOSE_SHUTDOWN_GRACE_MS,
  }: WeixinAdminServerOptions) {
    this.accountStore = accountStore;
    this.stateDir = stateDir;
    this.env = env;
    this.host = host;
    this.port = port;
    this.locale = locale;
    this.qrLogin = qrLogin;
    this.bridgeControl = bridgeControl;
    this.serviceControl = serviceControl;
    this.repositories = repositories;
    this.codexHome = codexHome;
    this.pageCloseShutdownGraceMs = Math.max(0, pageCloseShutdownGraceMs);
    this.server = null;
    this.binding = null;
    this.currentPairing = null;
    this.adminPageClients = new Map();
    this.pageCloseShutdownTimer = null;
    this.logCleanupTimer = null;
    this.ccswitchSyncTimer = null;
    this.lastCcswitchFingerprint = '';
    this.lastCcswitchSync = null;
    this.shutdownRequested = false;
  }

  accountStore: WeixinAccountStore;
  stateDir: string;
  env: NodeJS.ProcessEnv | Record<string, unknown>;
  host: string;
  port: number;
  locale: string | null;
  qrLogin: QrLoginImpl;
  bridgeControl: WeixinBridgeControl | null;
  serviceControl: WeixinAdminServiceControl | null;
  repositories: WeixinAdminRepositories | null;
  codexHome: string | null;
  pageCloseShutdownGraceMs: number;
  server: Server | null;
  binding: WeixinAdminServerBinding | null;
  currentPairing: PairingSession | null;
  adminPageClients: Map<string, AdminPageClient>;
  pageCloseShutdownTimer: ReturnType<typeof setTimeout> | null;
  logCleanupTimer: ReturnType<typeof setInterval> | null;
  ccswitchSyncTimer: ReturnType<typeof setInterval> | null;
  lastCcswitchFingerprint: string;
  lastCcswitchSync: Record<string, unknown> | null;
  shutdownRequested: boolean;

  async start(): Promise<WeixinAdminServerBinding> {
    if (this.binding) {
      return this.binding;
    }
    const parsedPort = Number(this.port);
    const preferredPort = Number.isFinite(parsedPort)
      ? Math.max(0, parsedPort)
      : DEFAULT_ADMIN_PORT;
    const maxAttempts = preferredPort === 0 ? 1 : 20;
    let lastError: unknown = null;

    for (let offset = 0; offset < maxAttempts; offset += 1) {
      const port = preferredPort === 0 ? 0 : preferredPort + offset;
      const server = http.createServer((req, res) => {
        void this.handleRequest(req, res).catch((error) => {
          this.writeJson(res, 500, { error: formatError(error) });
        });
      });
      try {
        const binding = await listen(server, this.host, port);
        this.server = server;
        this.binding = binding;
        this.startLogCleanupScheduler();
        this.startCcswitchSyncScheduler();
        return binding;
      } catch (error) {
        lastError = error;
        await closeServer(server);
        if (!isAddressInUseError(error)) {
          break;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'failed to start admin server'));
  }

  async stop() {
    this.cancelPairing('cancelled');
    this.clearPageCloseShutdownTimer();
    this.stopLogCleanupScheduler();
    this.stopCcswitchSyncScheduler();
    this.adminPageClients.clear();
    const server = this.server;
    this.server = null;
    this.binding = null;
    if (server) {
      await closeServer(server);
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    if (!isLoopback(req.socket.remoteAddress)) {
      this.writeJson(res, 403, { error: 'local access only' });
      return;
    }
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === 'GET' && pathname === '/') {
      this.writeHtml(res, renderAdminHtml());
      return;
    }
    if (req.method === 'GET' && pathname === '/favicon.ico') {
      this.writeIcon(res);
      return;
    }
    if (req.method === 'GET' && pathname === '/favicon.png') {
      this.writePngIcon(res);
      return;
    }
    if (req.method === 'GET' && pathname === '/donate/wechat-reward.png') {
      this.writeDonateQr(res);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/state') {
      this.writeJson(res, 200, this.buildState());
      return;
    }
    if (req.method === 'GET' && pathname === '/api/metrics') {
      this.writeJson(res, 200, this.bridgeControl?.getMetrics?.() ?? {});
      return;
    }
    if (req.method === 'POST' && pathname === '/api/metrics/reset') {
      if (typeof this.bridgeControl?.resetMetrics !== 'function') {
        this.writeJson(res, 409, { error: 'metrics reset is unavailable' });
        return;
      }
      this.writeJson(res, 200, {
        ok: true,
        metrics: this.bridgeControl.resetMetrics(),
      });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/diagnostics/run') {
      await this.handleRunDiagnostics(res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/alert/test') {
      await this.handleAlertTest(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/page/heartbeat') {
      await this.handlePageHeartbeat(req, res, url.searchParams);
      return;
    }
    if ((req.method === 'POST' || req.method === 'GET') && pathname === '/api/page/close') {
      await this.handlePageClose(req, res, url.searchParams);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/service/shutdown') {
      await this.handleServiceShutdown(req, res);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/accounts') {
      this.writeJson(res, 200, { accounts: this.listAccounts() });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/sessions') {
      this.writeJson(res, 200, this.buildSessionsResponse(url.searchParams));
      return;
    }
    if (req.method === 'GET' && pathname.startsWith('/api/sessions/') && pathname.endsWith('/history')) {
      const rawSessionId = pathname.slice('/api/sessions/'.length, -'/history'.length);
      this.writeJson(res, 200, this.buildSessionHistoryResponse(rawSessionId, url.searchParams));
      return;
    }
    if (req.method === 'PATCH' && pathname.startsWith('/api/sessions/')) {
      await this.handlePatchSession(req, res, pathname.slice('/api/sessions/'.length));
      return;
    }
    if (req.method === 'DELETE' && pathname.startsWith('/api/sessions/')) {
      this.handleDeleteSession(res, pathname.slice('/api/sessions/'.length));
      return;
    }
    if (req.method === 'GET' && pathname === '/api/logs') {
      this.writeJson(res, 200, this.readLogs({
        lineLimit: parsePositiveInt(url.searchParams.get('limit'), DEFAULT_LOG_LINE_LIMIT, MAX_LOG_LINE_LIMIT),
      }));
      return;
    }
    if (req.method === 'POST' && pathname === '/api/logs/cleanup') {
      await this.handleCleanupLogs(res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/settings') {
      await this.handleUpdateSettings(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/model-provider/sync-ccswitch') {
      await this.handleSyncCcswitchProvider(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/setup/complete') {
      await this.handleCompleteSetup(req, res);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/export') {
      this.writeJsonDownload(res, this.buildExportPayload());
      return;
    }
    if (req.method === 'POST' && pathname === '/api/import') {
      await this.handleImport(req, res);
      return;
    }
    if (req.method === 'PATCH' && pathname.startsWith('/api/accounts/')) {
      await this.handlePatchAccount(req, res, pathname.slice('/api/accounts/'.length));
      return;
    }
    if (req.method === 'DELETE' && pathname.startsWith('/api/accounts/')) {
      this.handleDeleteAccount(res, pathname.slice('/api/accounts/'.length));
      return;
    }
    if (req.method === 'POST' && pathname === '/api/primary') {
      await this.handleSetPrimary(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/bridge/start') {
      await this.handleBridgeStart(res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/bridge/stop') {
      await this.handleBridgeStop(res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/bridge/restart') {
      await this.handleBridgeRestart(res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/pairing/start') {
      await this.handleStartPairing(req, res);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/pairing/current') {
      this.writeJson(res, 200, { pairing: this.serializePairing(this.currentPairing) });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/pairing/cancel') {
      this.cancelPairing('cancelled');
      this.writeJson(res, 200, { pairing: this.serializePairing(this.currentPairing) });
      return;
    }

    this.writeJson(res, 404, { error: 'not found' });
  }

  private buildState() {
    return {
      stateDir: this.stateDir,
      adminUrl: this.binding?.url ?? null,
      primaryAccountId: this.primaryAccountId(),
      service: {
        shutdownAvailable: Boolean(this.serviceControl),
      },
      bridge: this.bridgeControl?.status?.() ?? { running: true },
      settings: this.buildSettings(),
      logs: this.buildLogSummary(),
      accounts: this.listAccounts(),
      pairing: this.serializePairing(this.currentPairing),
      setup: this.buildSetupState(),
    };
  }

  private buildSettings() {
    const bridge = this.bridgeControl?.status?.() ?? { running: true };
    const weixin = isRecord(bridge.weixin) ? bridge.weixin : {};
    return {
      concurrency: {
        maxConcurrentTurns: parsePositiveInt(
          this.env.WEIXIN_MAX_CONCURRENT_TURNS ?? bridge.maxConcurrentTurns,
          DEFAULT_MAX_CONCURRENT_TURNS,
          MAX_RUNTIME_CONCURRENCY,
        ),
        eventDispatchConcurrency: parsePositiveInt(
          this.env.WEIXIN_EVENT_DISPATCH_CONCURRENCY ?? bridge.eventDispatchConcurrency,
          DEFAULT_EVENT_DISPATCH_CONCURRENCY,
          MAX_RUNTIME_CONCURRENCY,
        ),
        attachmentProcessingConcurrency: parsePositiveInt(
          this.env.WEIXIN_ATTACHMENT_CONCURRENCY ?? weixin.attachmentProcessingConcurrency,
          DEFAULT_ATTACHMENT_PROCESSING_CONCURRENCY,
          MAX_RUNTIME_CONCURRENCY,
        ),
        accountPollConcurrency: parsePositiveInt(
          this.env.WEIXIN_ACCOUNT_POLL_CONCURRENCY ?? weixin.accountPollConcurrency,
          DEFAULT_ACCOUNT_POLL_CONCURRENCY,
          MAX_RUNTIME_CONCURRENCY,
        ),
      },
      logCleanup: this.resolveLogCleanupSettings(),
      modelProvider: this.resolveModelProviderSettings(),
      alertWebhookUrl: normalizeEnvString(this.env.WEIXIN_ALERT_WEBHOOK_URL) ?? '',
    };
  }

  private resolveModelProviderSettings() {
    const preferences = this.readAdminPreferences();
    const model = normalizeEnvString(this.env.CODEX_COMPAT_DEFAULT_MODEL)
      ?? normalizeEnvString(this.env.CODEX_COMPAT_MODEL)
      ?? '';
    const apiKey = normalizeEnvString(this.env.CODEX_COMPAT_API_KEY) ?? '';
    const source = normalizeModelProviderSource(preferences.modelProviderSource);
    return {
      source,
      profileId: normalizeEnvString(this.env.CODEX_DEFAULT_PROVIDER_PROFILE_ID) ?? 'openai-default',
      providerId: normalizeEnvString(this.env.CODEX_COMPAT_PROVIDER_ID) ?? 'openai-compatible',
      providerName: normalizeProviderDisplayName(this.env.CODEX_COMPAT_PROVIDER_NAME) ?? 'Z Token',
      baseUrl: normalizeEnvString(this.env.CODEX_COMPAT_BASE_URL) ?? '',
      model,
      modelIds: normalizeEnvString(this.env.CODEX_COMPAT_MODEL_IDS) ?? model,
      capabilities: normalizeEnvString(this.env.CODEX_COMPAT_CAPABILITIES) ?? 'default',
      apiKeyConfigured: Boolean(apiKey),
      apiKeyMasked: maskSecret(apiKey),
      serviceEnvFile: resolveServiceEnvFile(this.env),
      serviceEnvPreferenceFile: this.resolveAdminPreferencesFile(),
      ccswitch: this.buildCcswitchSettings(source, preferences),
      restartRequired: false,
    };
  }

  private buildCcswitchSettings(source: 'manual' | 'ccswitch', preferences: Record<string, unknown>) {
    const codexHome = normalizeEnvString(preferences.ccswitchCodexHome)
      ?? this.codexHome
      ?? normalizeEnvString(this.env.CODEX_HOME)
      ?? path.join(os.homedir(), '.codex');
    const intervalMs = parsePositiveInt(
      preferences.ccswitchSyncIntervalMs,
      DEFAULT_CCSWITCH_SYNC_INTERVAL_MS,
      60_000,
    );
    return {
      enabled: source === 'ccswitch',
      codexHome,
      configPath: path.join(codexHome, 'config.toml'),
      authPath: path.join(codexHome, 'auth.json'),
      intervalMs: Math.max(MIN_CCSWITCH_SYNC_INTERVAL_MS, intervalMs),
      lastSync: this.lastCcswitchSync,
    };
  }

  private buildLogSummary() {
    const files = this.resolveLogFiles().map((entry) => {
      const stat = safeStat(entry.path);
      return {
        ...entry,
        exists: Boolean(stat),
        sizeBytes: stat?.size ?? 0,
        updatedAt: stat?.mtimeMs ?? null,
      };
    });
    return {
      generatedAt: new Date().toISOString(),
      settings: this.resolveLogCleanupSettings(),
      totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      files,
    };
  }

  private buildSetupState() {
    const preferences = this.readAdminPreferences();
    const settings = this.buildSettings();
    const modelProvider = settings.modelProvider;
    const accounts = this.listAccounts();
    const completedAt = normalizeEnvString(preferences.firstRunCompletedAt);
    const skippedAt = normalizeEnvString(preferences.firstRunSkippedAt);
    const serviceEnvFile = modelProvider.serviceEnvFile || resolveServiceEnvFile(this.env);
    const serviceEnvStat = safeStat(serviceEnvFile);
    const dataDirStat = safeStat(this.stateDir);
    const codexHome = this.codexHome || normalizeEnvString(this.env.CODEX_HOME) || '';
    const codexHomeStat = codexHome ? safeStat(codexHome) : null;
    const codexBin = normalizeEnvString(this.env.CODEX_REAL_BIN) ?? normalizeEnvString(this.env.CODEX_BIN) ?? '';
    const codexStat = codexBin ? safeStat(codexBin) : null;
    const nodeMajor = Number.parseInt(String(process.versions.node ?? '').split('.')[0] ?? '', 10);
    const nodeOk = Number.isFinite(nodeMajor) && nodeMajor >= MIN_NODE_MAJOR_VERSION;
    const hasModelConfig = Boolean(
      modelProvider.apiKeyConfigured
      && modelProvider.baseUrl
      && modelProvider.model,
    );
    const hasAccount = accounts.length > 0;

    return {
      needsSetup: !completedAt && !skippedAt && (!hasModelConfig || !hasAccount),
      completedAt: completedAt ?? null,
      skippedAt: skippedAt ?? null,
      updatedAt: normalizeEnvString(preferences.firstRunUpdatedAt) ?? null,
      checks: {
        dataDir: {
          ok: Boolean(dataDirStat?.isDirectory()),
          label: this.stateDir,
          detail: dataDirStat?.isDirectory() ? '数据目录可用' : '数据目录不存在或不可访问',
          path: this.stateDir,
        },
        serviceEnvFile: {
          ok: Boolean(path.basename(serviceEnvFile)),
          label: serviceEnvFile,
          detail: serviceEnvStat?.isFile() ? '配置文件已存在' : '保存配置时会自动创建',
          path: serviceEnvFile,
          exists: Boolean(serviceEnvStat?.isFile()),
        },
        node: {
          ok: nodeOk,
          label: `Node ${process.version}`,
          detail: nodeOk
            ? `满足 Node ${MIN_NODE_MAJOR_VERSION}+ 要求`
            : `建议使用 Node ${MIN_NODE_MAJOR_VERSION}+`,
          path: process.execPath,
        },
        codexHome: {
          ok: Boolean(codexHome && (codexHomeStat?.isDirectory() || !codexHomeStat)),
          label: codexHome || '未配置 CODEX_HOME',
          detail: codexHomeStat?.isDirectory() ? 'Codex Home 可用' : '不存在时会由 Codex/应用按需创建',
          path: codexHome,
        },
        codex: {
          ok: Boolean(codexBin && codexStat?.isFile()),
          label: codexBin || '未配置 CODEX_REAL_BIN',
          detail: codexBin
            ? (codexStat?.isFile() ? 'Codex 可执行文件可用' : '路径不存在或不是文件')
            : '打包版通常会自动配置；源码运行时请检查 Codex CLI',
          path: codexBin,
        },
        modelProvider: {
          ok: hasModelConfig,
          label: hasModelConfig ? `${modelProvider.providerName} / ${modelProvider.model}` : '未完成模型配置',
          detail: hasModelConfig
            ? `Base URL：${modelProvider.baseUrl}`
            : '需要填写 API key、接口地址和模型',
        },
        weixinAccount: {
          ok: hasAccount,
          label: hasAccount ? `${accounts.length} 个微信入口` : '未添加微信入口',
          detail: hasAccount ? '可接收微信消息' : '需要生成二维码并用微信扫码确认',
          count: accounts.length,
        },
      },
    };
  }

  private listAccounts() {
    const primaryAccountId = this.primaryAccountId();
    return this.accountStore.listAccounts().map((accountId) => {
      const account = this.accountStore.loadAccount(accountId);
      return {
        accountId,
        displayName: String(account?.display_name ?? ''),
        userId: String(account?.user_id ?? ''),
        baseUrl: String(account?.base_url ?? ''),
        savedAt: String(account?.saved_at ?? ''),
        disabled: Boolean(account?.disabled),
        primary: accountId === primaryAccountId,
        syncUpdatedAt: statMtimeIso(this.accountStore.syncFile(accountId)),
      };
    });
  }

  private buildSessionsResponse(searchParams: URLSearchParams) {
    const query = normalizeSearchText(searchParams.get('query'));
    const accountId = normalizeAccountId(String(searchParams.get('accountId') ?? ''));
    const providerProfileId = normalizeAccountId(String(searchParams.get('providerProfileId') ?? ''));
    const sort = normalizeSessionSort(searchParams.get('sort'));
    const limit = parsePositiveInt(searchParams.get('limit'), DEFAULT_SESSION_LIST_LIMIT, MAX_SESSION_LIST_LIMIT);
    const allSessions = this.buildSessionSummaries();
    let filtered = allSessions;
    if (query) {
      filtered = filtered.filter((session) => sessionMatchesSearch(session, query));
    }
    if (accountId) {
      filtered = filtered.filter((session) => session.accountIds.includes(accountId));
    }
    if (providerProfileId) {
      filtered = filtered.filter((session) => session.providerProfileId === providerProfileId);
    }
    filtered = sortSessions(filtered, sort);
    return {
      sessions: filtered.slice(0, limit),
      total: filtered.length,
      returned: Math.min(filtered.length, limit),
      filters: {
        accounts: this.listAccounts(),
        providers: this.listProviderProfiles(),
      },
    };
  }

  private buildSessionSummaries() {
    const bridgeSessions = safeList(() => this.repositories?.bridgeSessions?.list?.() ?? []);
    const platformBindings = safeList(() => this.repositories?.platformBindings?.list?.() ?? []);
    const providerProfiles = new Map(this.listProviderProfiles().map((profile) => [profile.providerProfileId, profile]));
    const bindingsBySession = groupBy(platformBindings, (binding) => binding.bridgeSessionId);
    const codexIndex = readCodexSessionIndex({ codexHome: this.codexHome });
    const indexByThreadId = new Map(codexIndex.map((entry) => [entry.threadId, entry]));
    const primaryAccountId = this.primaryAccountId();

    return bridgeSessions.map((session) => {
      const metadata = this.getThreadMetadata(session.providerProfileId, session.codexThreadId);
      const indexEntry = indexByThreadId.get(session.codexThreadId) ?? null;
      const provider = providerProfiles.get(session.providerProfileId);
      const settings = this.getSessionSettings(session.id);
      const bindings = bindingsBySession.get(session.id) ?? [];
      const scopes = bindings.map((binding) => {
        const resolved = resolveWeixinScopeAccount({
          externalScopeId: binding.externalScopeId,
          primaryAccountId,
          accountStore: this.accountStore,
        });
        const account = resolved.accountId ? this.accountStore.loadAccount(resolved.accountId) : null;
        return {
          platform: binding.platform,
          externalScopeId: binding.externalScopeId,
          scopeId: resolved.scopeId,
          accountId: resolved.accountId,
          accountDisplayName: String(account?.display_name ?? ''),
          updatedAt: binding.updatedAt,
        };
      });
      const accountIds = uniqueStrings(scopes.map((scope) => scope.accountId).filter(Boolean));
      const title = metadata?.alias
        || session.title
        || indexEntry?.title
        || session.codexThreadId;
      const updatedAt = maxTimestamp([
        session.updatedAt,
        metadata?.updatedAt,
        indexEntry?.updatedAt,
        ...scopes.map((scope) => scope.updatedAt),
        settings?.updatedAt,
      ]);
      const preview = readLatestUserPrompt(indexEntry) || '';
      return {
        id: session.id,
        title,
        codexTitle: indexEntry?.title ?? null,
        providerProfileId: session.providerProfileId,
        providerDisplayName: provider?.displayName ?? session.providerProfileId,
        codexThreadId: session.codexThreadId,
        cwd: session.cwd ?? indexEntry?.cwd ?? '',
        createdAt: session.createdAt,
        updatedAt,
        preview,
        scopes,
        accountIds,
        scopeCount: scopes.length,
        model: settings?.model ?? null,
        reasoningEffort: settings?.reasoningEffort ?? null,
        archived: Boolean(metadata?.archivedAt),
        pinned: Boolean(metadata?.pinnedAt),
      };
    });
  }

  private buildSessionHistoryResponse(rawSessionId: string, searchParams: URLSearchParams) {
    const session = this.resolveAdminSession(rawSessionId);
    const threadId = session?.codexThreadId ?? normalizeAccountId(rawSessionId);
    const entry = threadId ? findCodexSessionIndexEntry(threadId, { codexHome: this.codexHome }) : null;
    const sessionPath = normalizeEnvString(entry?.sessionPath);
    const query = normalizeSearchText(searchParams.get('q'));
    const limit = parsePositiveInt(searchParams.get('limit'), 200, 1000);
    if (!sessionPath) {
      return { threadId, sessionPath: null, total: 0, returned: 0, messages: [], truncated: false };
    }
    const lines = readTailText(sessionPath, 1024 * 1024).split(/\r?\n/u).filter(Boolean);
    const all: Array<{ role: 'user' | 'assistant'; text: string; timestamp: number | null }> = [];
    for (const line of lines) {
      const record = parseHistoryRecord(line);
      if (!record || isEnvironmentContextText(record.text)) {
        continue;
      }
      if (query && !record.text.toLowerCase().includes(query)) {
        continue;
      }
      all.push(record);
    }
    const truncated = all.length > limit;
    const messages = truncated ? all.slice(all.length - limit) : all;
    return {
      threadId,
      sessionPath,
      total: all.length,
      returned: messages.length,
      messages,
      truncated,
    };
  }

  private async handlePatchSession(req: IncomingMessage, res: ServerResponse, rawSessionId: string) {
    const session = this.resolveAdminSession(rawSessionId);
    if (!session) {
      this.writeJson(res, 404, { error: 'session not found' });
      return;
    }
    const body = await readJsonBody(req);
    if (!Object.prototype.hasOwnProperty.call(body, 'archived')) {
      this.writeJson(res, 400, { error: 'missing archived flag' });
      return;
    }
    if (typeof this.repositories?.threadMetadata?.save !== 'function') {
      this.writeJson(res, 409, { error: 'thread metadata repository cannot save' });
      return;
    }
    const archived = normalizeBooleanFlag(body.archived);
    const current = this.getThreadMetadata(session.providerProfileId, session.codexThreadId);
    const now = Date.now();
    const metadata: ThreadMetadata = {
      providerProfileId: session.providerProfileId,
      threadId: session.codexThreadId,
      alias: current?.alias ?? null,
      archivedAt: archived ? now : null,
      pinnedAt: typeof current?.pinnedAt === 'number' ? current.pinnedAt : null,
      updatedAt: now,
    };
    this.repositories.threadMetadata.save(metadata);
    this.writeJson(res, 200, {
      ok: true,
      session: this.buildSessionSummaries().find((item) => item.id === session.id) ?? null,
      sessions: this.buildSessionsResponse(new URLSearchParams()),
    });
  }

  private handleDeleteSession(res: ServerResponse, rawSessionId: string) {
    const session = this.resolveAdminSession(rawSessionId);
    if (!session) {
      this.writeJson(res, 404, { error: 'session not found' });
      return;
    }
    if (typeof this.repositories?.bridgeSessions?.delete !== 'function') {
      this.writeJson(res, 409, { error: 'bridge session repository cannot delete' });
      return;
    }
    this.repositories.platformBindings?.deleteBySession?.(session.id);
    this.repositories.sessionSettings?.delete?.(session.id);
    this.repositories.threadMetadata?.delete?.(session.providerProfileId, session.codexThreadId);
    this.repositories.bridgeSessions.delete(session.id);
    this.writeJson(res, 200, {
      ok: true,
      deletedSession: {
        id: session.id,
        providerProfileId: session.providerProfileId,
        codexThreadId: session.codexThreadId,
        title: session.title ?? null,
      },
      sessions: this.buildSessionsResponse(new URLSearchParams()),
    });
  }

  private async handleSyncCcswitchProvider(req: IncomingMessage, res: ServerResponse) {
    const body = await readJsonBody(req);
    const codexHome = normalizeEnvString(body.codexHome)
      ?? normalizeEnvString(this.readAdminPreferences().ccswitchCodexHome)
      ?? this.codexHome
      ?? normalizeEnvString(this.env.CODEX_HOME);
    const result = this.syncCcswitchProvider({
      codexHome,
      persistSource: normalizeBooleanFlag(body.persistSource),
      force: true,
      reason: 'manual',
    });
    this.writeJson(res, result.ok ? 200 : 409, {
      ...result,
      settings: this.buildSettings(),
      state: this.buildState(),
    });
  }

  private syncCcswitchProvider({
    codexHome = null,
    persistSource = false,
    force = false,
    reason = 'auto',
  }: {
    codexHome?: string | null;
    persistSource?: boolean;
    force?: boolean;
    reason?: string;
  } = {}) {
    const sourceState = resolveCodexSwitchProviderState({
      codexHome,
      env: this.env,
    });
    if (!sourceState.apiKey) {
      const result = this.recordCcswitchSync({
        ok: false,
        changed: false,
        reason,
        message: '没有在 Codex/CCSwitch 当前配置里找到 API key',
        sourceState,
      });
      return result;
    }
    if (!sourceState.model) {
      const result = this.recordCcswitchSync({
        ok: false,
        changed: false,
        reason,
        message: '没有在 Codex/CCSwitch 当前配置里找到模型名称',
        sourceState,
      });
      return result;
    }
    const changed = force || sourceState.fingerprint !== this.lastCcswitchFingerprint;
    this.lastCcswitchFingerprint = sourceState.fingerprint;
    const profileId = normalizeEnvString(this.env.CODEX_DEFAULT_PROVIDER_PROFILE_ID) ?? 'openai-default';
    const envValues: Record<string, string> = {
      CODEX_DEFAULT_PROVIDER_PROFILE_ID: profileId,
      CODEX_COMPAT_PROVIDER_ID: profileId,
      CODEX_COMPAT_PROVIDER_NAME: normalizeProviderDisplayName(sourceState.providerName) ?? 'Z Token',
      CODEX_COMPAT_BASE_URL: sourceState.baseUrl,
      CODEX_COMPAT_DEFAULT_MODEL: sourceState.model,
      CODEX_COMPAT_MODEL_IDS: sourceState.model,
      CODEX_COMPAT_CAPABILITIES: normalizeProviderCapabilities(sourceState.capabilities) ?? 'default',
      CODEX_COMPAT_API_KEY: sourceState.apiKey,
    };
    for (const [key, value] of Object.entries(envValues)) {
      setEnvValue(this.env, key, value);
    }
    persistEnvValues(resolveServiceEnvFile(this.env), envValues);
    this.saveCompatibleProviderProfile({
      profileId,
      providerId: profileId,
      providerName: envValues.CODEX_COMPAT_PROVIDER_NAME,
      baseUrl: sourceState.baseUrl,
      model: sourceState.model,
      capabilities: envValues.CODEX_COMPAT_CAPABILITIES,
    });
    if (persistSource) {
      this.writeAdminPreferences({
        modelProviderSource: 'ccswitch',
        ccswitchCodexHome: sourceState.codexHome,
      });
    }
    return this.recordCcswitchSync({
      ok: true,
      changed,
      reason,
      message: changed ? '已同步 CCSwitch/Codex 当前配置' : '配置没有变化',
      sourceState,
    });
  }

  private saveCompatibleProviderProfile({
    profileId,
    providerId,
    providerName,
    baseUrl,
    model,
    capabilities,
  }: {
    profileId: string;
    providerId: string;
    providerName: string;
    baseUrl: string;
    model: string;
    capabilities: string;
  }) {
    if (typeof this.repositories?.providerProfiles?.save !== 'function') {
      return;
    }
    const profile = buildOpenAICompatibleProfileFromInput({
      id: profileId || providerId || 'openai-compatible',
      displayName: providerName || profileId || 'Z Token',
      apiKeyEnv: 'CODEX_COMPAT_API_KEY',
      baseUrl,
      defaultModel: model,
      capabilities,
      providerLabel: providerId || profileId,
    }, this.env as NodeJS.ProcessEnv);
    this.repositories.providerProfiles.save(profile);
  }

  private recordCcswitchSync({
    ok,
    changed,
    reason,
    message,
    sourceState,
  }: {
    ok: boolean;
    changed: boolean;
    reason: string;
    message: string;
    sourceState: CodexSwitchProviderState;
  }) {
    const result = {
      ok,
      changed,
      reason,
      message,
      syncedAt: new Date().toISOString(),
      providerId: sourceState.providerId,
      providerName: normalizeProviderDisplayName(sourceState.providerName) ?? sourceState.providerName,
      baseUrl: sourceState.baseUrl,
      model: sourceState.model,
      capabilities: sourceState.capabilities,
      apiKeyConfigured: Boolean(sourceState.apiKey),
      apiKeyMasked: maskSecret(sourceState.apiKey),
      codexHome: sourceState.codexHome,
      configPath: sourceState.configPath,
      authPath: sourceState.authPath,
      source: sourceState.source,
      errors: sourceState.errors,
    };
    this.lastCcswitchSync = result;
    return result;
  }

  private resolveAdminSession(rawSessionId: string): BridgeSession | null {
    const sessionId = normalizeAccountId(rawSessionId);
    if (!sessionId) {
      return null;
    }
    return safeList(() => this.repositories?.bridgeSessions?.list?.() ?? [])
      .find((session) => session.id === sessionId || session.codexThreadId === sessionId) ?? null;
  }

  private listProviderProfiles() {
    return safeList(() => this.repositories?.providerProfiles?.list?.() ?? [])
      .map((profile) => ({
        providerProfileId: profile.id,
        displayName: String(profile.displayName ?? profile.id),
        providerKind: String(profile.providerKind ?? ''),
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  private getSessionSettings(bridgeSessionId: string) {
    return this.repositories?.sessionSettings?.getByBridgeSessionId?.(bridgeSessionId)
      ?? this.repositories?.sessionSettings?.get?.(bridgeSessionId)
      ?? null;
  }

  private getThreadMetadata(providerProfileId: string, threadId: string) {
    return this.repositories?.threadMetadata?.getByThread?.(providerProfileId, threadId)
      ?? this.repositories?.threadMetadata?.get?.(providerProfileId, threadId)
      ?? null;
  }

  private readLogs({ lineLimit = DEFAULT_LOG_LINE_LIMIT }: { lineLimit?: number } = {}) {
    const files = this.resolveLogFiles().map((entry) => {
      const stat = safeStat(entry.path);
      const tail = stat ? tailLines(readTailText(entry.path, LOG_TAIL_BYTES), lineLimit) : '';
      return {
        ...entry,
        exists: Boolean(stat),
        sizeBytes: stat?.size ?? 0,
        updatedAt: stat?.mtimeMs ?? null,
        text: tail,
      };
    });
    return {
      generatedAt: new Date().toISOString(),
      settings: this.resolveLogCleanupSettings(),
      totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      files,
      text: files
        .map((file) => [
          `== ${file.kind}: ${file.path} ==`,
          file.exists ? (file.text || '(empty)') : '(missing)',
        ].join('\n'))
        .join('\n\n'),
    };
  }

  private resolveLogFiles() {
    return [
      { kind: 'stdout', path: path.join(this.stateDir, 'logs', 'weixin-bridge.out.log') },
      { kind: 'stderr', path: path.join(this.stateDir, 'logs', 'weixin-bridge.err.log') },
    ];
  }

  private resolveLogCleanupSettings() {
    return {
      enabled: parseBooleanEnv(this.env.WEIXIN_LOG_CLEANUP_ENABLE, DEFAULT_LOG_CLEANUP_ENABLED),
      retentionDays: parsePositiveInt(
        this.env.WEIXIN_LOG_RETENTION_DAYS,
        DEFAULT_LOG_RETENTION_DAYS,
        MAX_LOG_RETENTION_DAYS,
      ),
      maxBytes: parsePositiveInt(
        this.env.WEIXIN_LOG_MAX_BYTES,
        DEFAULT_LOG_MAX_BYTES,
        Number.MAX_SAFE_INTEGER,
      ),
      intervalMinutes: parsePositiveInt(
        this.env.WEIXIN_LOG_CLEANUP_INTERVAL_MINUTES,
        DEFAULT_LOG_CLEANUP_INTERVAL_MINUTES,
        MAX_LOG_CLEANUP_INTERVAL_MINUTES,
      ),
    };
  }

  private buildExportPayload() {
    const runtime = this.repositories;
    return {
      exportedAt: new Date().toISOString(),
      stateDir: this.stateDir,
      adminUrl: this.binding?.url ?? null,
      state: this.buildState(),
      accounts: this.accountStore.listAccounts().map((accountId) => ({
        accountId,
        ...this.accountStore.loadAccount(accountId),
      })),
      runtime: {
        providerProfiles: safeList(() => runtime?.providerProfiles?.list?.() ?? []),
        bridgeSessions: safeList(() => runtime?.bridgeSessions?.list?.() ?? []),
        platformBindings: safeList(() => runtime?.platformBindings?.list?.() ?? []),
        sessionSettings: safeList(() => runtime?.sessionSettings?.listAll?.() ?? []),
        threadMetadata: safeList(() => runtime?.threadMetadata?.listAll?.() ?? []),
      },
      sessionSummaries: sortSessions(this.buildSessionSummaries(), 'updatedDesc'),
      logs: this.readLogs({ lineLimit: 500 }),
    };
  }

  private async handleImport(req: IncomingMessage, res: ServerResponse) {
    const body = await readJsonBody(req, IMPORT_BODY_LIMIT_BYTES);
    const errors: string[] = [];
    const imported = {
      accounts: 0,
      providerProfiles: 0,
      bridgeSessions: 0,
      platformBindings: 0,
      sessionSettings: 0,
      threadMetadata: 0,
    };
    const accounts = Array.isArray(body.accounts) ? body.accounts : [];
    for (const raw of accounts) {
      try {
        if (!isRecord(raw)) {
          continue;
        }
        const accountId = normalizeAccountId(String(raw.accountId ?? ''));
        const token = String(raw.token ?? '').trim();
        if (!accountId || !token) {
          continue;
        }
        this.accountStore.saveAccount({
          accountId,
          token,
          baseUrl: String(raw.base_url ?? raw.baseUrl ?? ''),
          userId: String(raw.user_id ?? raw.userId ?? ''),
        });
        const patch: Parameters<WeixinAccountStore['updateAccount']>[1] = {};
        if (typeof raw.display_name === 'string') {
          patch.display_name = raw.display_name;
        }
        if (typeof raw.disabled === 'boolean') {
          patch.disabled = raw.disabled;
        }
        if (Object.keys(patch).length > 0) {
          this.accountStore.updateAccount(accountId, patch);
        }
        imported.accounts += 1;
      } catch (error) {
        errors.push('account: ' + formatError(error));
      }
    }
    const runtime = isRecord(body.runtime) ? body.runtime : {};
    const repos = this.repositories;
    imported.providerProfiles = this.importRecords(runtime.providerProfiles, repos?.providerProfiles?.save?.bind(repos?.providerProfiles), errors, 'providerProfile');
    imported.bridgeSessions = this.importRecords(runtime.bridgeSessions, repos?.bridgeSessions?.save?.bind(repos?.bridgeSessions), errors, 'bridgeSession');
    imported.platformBindings = this.importRecords(runtime.platformBindings, repos?.platformBindings?.save?.bind(repos?.platformBindings), errors, 'platformBinding');
    imported.sessionSettings = this.importRecords(runtime.sessionSettings, repos?.sessionSettings?.save?.bind(repos?.sessionSettings), errors, 'sessionSettings');
    imported.threadMetadata = this.importRecords(runtime.threadMetadata, repos?.threadMetadata?.save?.bind(repos?.threadMetadata), errors, 'threadMetadata');
    this.writeJson(res, 200, {
      ok: true,
      imported,
      errors,
      state: this.buildState(),
    });
  }

  private importRecords(
    value: unknown,
    save: ((record: any) => unknown) | undefined,
    errors: string[],
    label: string,
  ): number {
    if (!Array.isArray(value) || typeof save !== 'function') {
      return 0;
    }
    let count = 0;
    for (const record of value) {
      if (!isRecord(record)) {
        continue;
      }
      try {
        save(record);
        count += 1;
      } catch (error) {
        errors.push(label + ': ' + formatError(error));
      }
    }
    return count;
  }

  private async handlePageHeartbeat(req: IncomingMessage, res: ServerResponse, searchParams: URLSearchParams) {
    const body = mergePageLifecyclePayload(await readJsonBody(req), searchParams);
    const page = this.recordAdminPageHeartbeat(body);
    this.writeJson(res, 200, {
      ok: true,
      pageId: page?.id ?? null,
      shutdownOnClose: Boolean(page?.shutdownOnClose),
      service: {
        shutdownAvailable: Boolean(this.serviceControl),
      },
    });
  }

  private async handlePageClose(req: IncomingMessage, res: ServerResponse, searchParams: URLSearchParams) {
    const body = mergePageLifecyclePayload(
      req.method === 'GET' ? {} : await readJsonBody(req),
      searchParams,
    );
    this.recordAdminPageClose(body);
    this.writeJson(res, 200, { ok: true });
    if (this.shouldShutdownForClosedPage(body)) {
      this.requestServiceShutdown('admin-page-closed');
    }
  }

  private async handleServiceShutdown(req: IncomingMessage, res: ServerResponse) {
    if (!this.serviceControl) {
      this.writeJson(res, 409, { error: 'service shutdown is unavailable' });
      return;
    }
    const body = await readJsonBody(req);
    const reason = normalizeEnvString(body.reason) ?? 'admin-request';
    this.writeJson(res, 200, { ok: true, shuttingDown: true });
    this.requestServiceShutdown(reason);
  }

  private async handleUpdateSettings(req: IncomingMessage, res: ServerResponse) {
    const body = await readJsonBody(req);
    const next = this.normalizeSettingsPatch(body);
    setEnvValue(this.env, 'WEIXIN_MAX_CONCURRENT_TURNS', String(next.concurrency.maxConcurrentTurns));
    setEnvValue(this.env, 'WEIXIN_EVENT_DISPATCH_CONCURRENCY', String(next.concurrency.eventDispatchConcurrency));
    setEnvValue(this.env, 'WEIXIN_ATTACHMENT_CONCURRENCY', String(next.concurrency.attachmentProcessingConcurrency));
    setEnvValue(this.env, 'WEIXIN_ACCOUNT_POLL_CONCURRENCY', String(next.concurrency.accountPollConcurrency));
    setEnvValue(this.env, 'WEIXIN_LOG_CLEANUP_ENABLE', next.logCleanup.enabled ? '1' : '0');
    setEnvValue(this.env, 'WEIXIN_LOG_RETENTION_DAYS', String(next.logCleanup.retentionDays));
    setEnvValue(this.env, 'WEIXIN_LOG_MAX_BYTES', String(next.logCleanup.maxBytes));
    setEnvValue(this.env, 'WEIXIN_LOG_CLEANUP_INTERVAL_MINUTES', String(next.logCleanup.intervalMinutes));
    const envValues: Record<string, string> = {
      WEIXIN_MAX_CONCURRENT_TURNS: String(next.concurrency.maxConcurrentTurns),
      WEIXIN_EVENT_DISPATCH_CONCURRENCY: String(next.concurrency.eventDispatchConcurrency),
      WEIXIN_ATTACHMENT_CONCURRENCY: String(next.concurrency.attachmentProcessingConcurrency),
      WEIXIN_ACCOUNT_POLL_CONCURRENCY: String(next.concurrency.accountPollConcurrency),
      WEIXIN_LOG_CLEANUP_ENABLE: next.logCleanup.enabled ? '1' : '0',
      WEIXIN_LOG_RETENTION_DAYS: String(next.logCleanup.retentionDays),
      WEIXIN_LOG_MAX_BYTES: String(next.logCleanup.maxBytes),
      WEIXIN_LOG_CLEANUP_INTERVAL_MINUTES: String(next.logCleanup.intervalMinutes),
    };
    if (next.modelProvider) {
      const provider = next.modelProvider;
      const currentServiceEnvFile = resolveServiceEnvFile(this.env);
      const serviceEnvFileChanged = provider.serviceEnvFile !== currentServiceEnvFile;
      const currentApiKey = normalizeEnvString(this.env.CODEX_COMPAT_API_KEY);
      this.writeAdminPreferences({
        modelProviderSource: provider.source,
        ccswitchCodexHome: provider.ccswitchCodexHome,
        ccswitchSyncIntervalMs: provider.ccswitchSyncIntervalMs,
      });
      if (serviceEnvFileChanged) {
        this.saveServiceEnvFilePreference(provider.serviceEnvFile);
        setEnvValue(this.env, 'CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE', provider.serviceEnvFile);
      }
      setEnvValue(this.env, 'CODEX_DEFAULT_PROVIDER_PROFILE_ID', provider.profileId);
      setEnvValue(this.env, 'CODEX_COMPAT_PROVIDER_ID', provider.providerId);
      setEnvValue(this.env, 'CODEX_COMPAT_PROVIDER_NAME', provider.providerName);
      setEnvValue(this.env, 'CODEX_COMPAT_BASE_URL', provider.baseUrl);
      setEnvValue(this.env, 'CODEX_COMPAT_DEFAULT_MODEL', provider.model);
      setEnvValue(this.env, 'CODEX_COMPAT_MODEL_IDS', provider.modelIds);
      setEnvValue(this.env, 'CODEX_COMPAT_CAPABILITIES', provider.capabilities);
      envValues.CODEX_DEFAULT_PROVIDER_PROFILE_ID = provider.profileId;
      envValues.CODEX_COMPAT_PROVIDER_ID = provider.providerId;
      envValues.CODEX_COMPAT_PROVIDER_NAME = provider.providerName;
      envValues.CODEX_COMPAT_BASE_URL = provider.baseUrl;
      envValues.CODEX_COMPAT_DEFAULT_MODEL = provider.model;
      envValues.CODEX_COMPAT_MODEL_IDS = provider.modelIds;
      envValues.CODEX_COMPAT_CAPABILITIES = provider.capabilities;
      if (provider.apiKey !== null) {
        setEnvValue(this.env, 'CODEX_COMPAT_API_KEY', provider.apiKey);
        envValues.CODEX_COMPAT_API_KEY = provider.apiKey;
      } else if (serviceEnvFileChanged) {
        if (currentApiKey) {
          envValues.CODEX_COMPAT_API_KEY = currentApiKey;
        }
      }
      this.saveCompatibleProviderProfile({
        profileId: provider.profileId,
        providerId: provider.providerId,
        providerName: provider.providerName,
        baseUrl: provider.baseUrl,
        model: provider.model,
        capabilities: provider.capabilities,
      });
    }
    persistEnvValues(resolveServiceEnvFile(this.env), envValues);
    setEnvValue(this.env, 'WEIXIN_ALERT_WEBHOOK_URL', next.alertWebhookUrl);
    persistEnvValues(resolveServiceEnvFile(this.env), {
      WEIXIN_ALERT_WEBHOOK_URL: next.alertWebhookUrl,
    });
    await this.bridgeControl?.configureConcurrency?.({
      maxConcurrentTurns: next.concurrency.maxConcurrentTurns,
      eventDispatchConcurrency: next.concurrency.eventDispatchConcurrency,
      attachmentProcessingConcurrency: next.concurrency.attachmentProcessingConcurrency,
      accountPollConcurrency: next.concurrency.accountPollConcurrency,
    });
    this.restartLogCleanupScheduler();
    this.restartCcswitchSyncScheduler();
    const cleanup = await this.cleanupLogs('settings-updated');
    this.writeJson(res, 200, {
      ok: true,
      settings: this.buildSettings(),
      cleanup,
      state: this.buildState(),
      restartRequired: Boolean(next.modelProvider),
    });
  }

  private async handleCleanupLogs(res: ServerResponse) {
    const cleanup = await this.clearActiveLogs('manual');
    this.writeJson(res, 200, {
      ok: true,
      cleanup,
      logs: this.readLogs({ lineLimit: 500 }),
    });
  }

  private async handleRunDiagnostics(res: ServerResponse) {
    const checks = await this.runDiagnostics();
    this.writeJson(res, 200, {
      generatedAt: new Date().toISOString(),
      summary: summarizeDiagnosticChecks(checks),
      checks,
    });
  }

  private async runDiagnostics(): Promise<DiagnosticCheck[]> {
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

  private diagnoseService(): DiagnosticCheck {
    if (!this.bridgeControl) {
      return makeDiagnosticCheck({
        id: 'service',
        title: '服务是否运行',
        status: 'warn',
        detail: '管理面板没有接入桥接控制器',
        reason: '当前页面能打开，但无法直接判断微信桥接进程状态。',
        actions: [
          { label: '查看运行日志', action: 'open-page', target: 'logs' },
        ],
      });
    }
    const bridge = this.bridgeControl.status();
    if (bridge.running) {
      return makeDiagnosticCheck({
        id: 'service',
        title: '服务是否运行',
        status: 'ok',
        detail: `微信桥接正在运行，当前 ${bridge.activeTurns ?? 0} 个回复中，${bridge.queuedTurns ?? 0} 个排队中。`,
        reason: bridge.lastError ? `最近错误：${bridge.lastError}` : '服务主循环可用。',
        actions: [
          { label: '重启桥接', action: 'restart-bridge' },
          { label: '查看日志', action: 'open-page', target: 'logs' },
        ],
      });
    }
    if (bridge.starting || bridge.restarting || bridge.stopping) {
      return makeDiagnosticCheck({
        id: 'service',
        title: '服务是否运行',
        status: 'warn',
        detail: bridge.restarting ? '微信桥接正在重启' : (bridge.starting ? '微信桥接正在启动' : '微信桥接正在停止'),
        reason: '如果长时间停在这个状态，可以手动重启桥接。',
        actions: [
          { label: '重启桥接', action: 'restart-bridge' },
          { label: '查看日志', action: 'open-page', target: 'logs' },
        ],
      });
    }
    return makeDiagnosticCheck({
      id: 'service',
      title: '服务是否运行',
      status: 'fail',
      detail: '微信桥接当前没有运行',
      reason: '服务停止后，微信消息不会继续转发给 Codex。',
      actions: [
        { label: '启动桥接', action: 'start-bridge' },
        { label: '查看日志', action: 'open-page', target: 'logs' },
      ],
    });
  }

  private diagnoseWeixinAccounts(): DiagnosticCheck {
    const accountIds = this.accountStore.listAccounts();
    const primaryAccountId = this.primaryAccountId();
    const records = accountIds.map((accountId) => ({
      accountId,
      account: this.accountStore.loadAccount(accountId),
    }));
    if (records.length === 0) {
      return makeDiagnosticCheck({
        id: 'weixin-account',
        title: '微信账号是否有效',
        status: 'fail',
        detail: '还没有添加任何微信入口',
        reason: '需要先生成二维码并用微信扫码确认，朋友或你自己才能发消息。',
        actions: [
          { label: '添加微信入口', action: 'open-page', target: 'users' },
          { label: '生成二维码', action: 'start-pairing' },
        ],
      });
    }
    const enabled = records.filter(({ account }) => account && !account.disabled);
    if (enabled.length === 0) {
      return makeDiagnosticCheck({
        id: 'weixin-account',
        title: '微信账号是否有效',
        status: 'fail',
        detail: `${records.length} 个入口都已禁用`,
        reason: '禁用后不会轮询微信消息，需要启用至少一个入口。',
        actions: [
          { label: '打开用户入口', action: 'open-page', target: 'users' },
        ],
      });
    }
    const broken = enabled.filter(({ account }) => !account?.token || !account?.base_url || !account?.user_id);
    if (broken.length > 0) {
      return makeDiagnosticCheck({
        id: 'weixin-account',
        title: '微信账号是否有效',
        status: 'fail',
        detail: `${broken.length} 个入口缺少 token、baseUrl 或 userId`,
        reason: '这类入口通常是扫码保存不完整，需要删除后重新扫码。',
        actions: [
          { label: '打开用户入口', action: 'open-page', target: 'users' },
          { label: '重新生成二维码', action: 'start-pairing' },
        ],
      });
    }
    const bridge = this.bridgeControl?.status?.();
    if (bridge?.lastErrorStage === 'poll' && bridge.lastError) {
      return makeDiagnosticCheck({
        id: 'weixin-account',
        title: '微信账号是否有效',
        status: 'warn',
        detail: `已添加 ${enabled.length} 个可用入口，但最近轮询失败`,
        reason: bridge.lastError,
        actions: [
          { label: '重启桥接', action: 'restart-bridge' },
          { label: '查看日志', action: 'open-page', target: 'logs' },
        ],
      });
    }
    if (primaryAccountId && !accountIds.includes(primaryAccountId)) {
      return makeDiagnosticCheck({
        id: 'weixin-account',
        title: '微信账号是否有效',
        status: 'warn',
        detail: `主账号 ${primaryAccountId} 不在本地入口列表中`,
        reason: '可能是配置里还保留了旧账号 ID，可以在用户入口页面重新切换主账号。',
        actions: [
          { label: '打开用户入口', action: 'open-page', target: 'users' },
        ],
      });
    }
    return makeDiagnosticCheck({
      id: 'weixin-account',
      title: '微信账号是否有效',
      status: 'ok',
      detail: `已添加 ${records.length} 个入口，${enabled.length} 个启用中`,
      reason: primaryAccountId ? `当前主账号：${primaryAccountId}` : '未显式设置主账号，会自动选择最早添加的入口。',
      actions: [
        { label: '管理入口', action: 'open-page', target: 'users' },
      ],
    });
  }

  private diagnoseApiKey(): DiagnosticCheck {
    const provider = this.resolveModelProviderSettings();
    const missing = [
      provider.apiKeyConfigured ? '' : 'API key',
      provider.baseUrl ? '' : 'Base URL',
      provider.model ? '' : '模型名称',
    ].filter(Boolean);
    if (missing.length > 0) {
      return makeDiagnosticCheck({
        id: 'api-key',
        title: 'API key 是否配置',
        status: 'fail',
        detail: `缺少：${missing.join('、')}`,
        reason: '模型配置不完整时，微信消息无法正常得到 Codex 回复。',
        actions: [
          { label: '打开模型供应商', action: 'open-page', target: 'provider' },
          ...(provider.source === 'ccswitch'
            ? [{ label: '同步 CCSwitch', action: 'sync-ccswitch' }]
            : []),
        ],
      });
    }
    return makeDiagnosticCheck({
      id: 'api-key',
      title: 'API key 是否配置',
      status: 'ok',
      detail: `${provider.providerName} / ${provider.model} / ${provider.apiKeyMasked || '已保存 key'}`,
      reason: `配置文件：${provider.serviceEnvFile}`,
      actions: [
        { label: '修改模型配置', action: 'open-page', target: 'provider' },
      ],
    });
  }

  private async diagnoseModelAvailability(): Promise<DiagnosticCheck> {
    const provider = this.resolveModelProviderSettings();
    const apiKey = normalizeEnvString(this.env.CODEX_COMPAT_API_KEY) ?? '';
    if (!provider.baseUrl || !provider.model || !apiKey) {
      return makeDiagnosticCheck({
        id: 'model',
        title: '模型是否可用',
        status: 'fail',
        detail: '模型、Base URL 或 API key 尚未配置完整',
        reason: '需要先完成模型供应商配置。',
        actions: [
          { label: '打开模型供应商', action: 'open-page', target: 'provider' },
        ],
      });
    }
    const candidates = buildModelEndpointCandidates(provider.baseUrl);
    let lastResult: JsonRequestResult | null = null;
    for (const url of candidates) {
      const result = await requestJsonUrl(url, {
        timeoutMs: 6000,
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
      });
      lastResult = result;
      if (result.ok) {
        const models = extractModelIds(result.body);
        if (models.length === 0) {
          return makeDiagnosticCheck({
            id: 'model',
            title: '模型是否可用',
            status: 'warn',
            detail: '模型接口可访问，但没有返回模型列表',
            reason: '部分中转站不会开放 /models 列表；如果微信能正常回复，可以忽略这个警告。',
            actions: [
              { label: '查看模型配置', action: 'open-page', target: 'provider' },
            ],
          });
        }
        const found = models.includes(provider.model);
        return makeDiagnosticCheck({
          id: 'model',
          title: '模型是否可用',
          status: found ? 'ok' : 'warn',
          detail: found
            ? `模型列表中找到了 ${provider.model}`
            : `模型接口可访问，但列表里没有看到 ${provider.model}`,
          reason: found
            ? `接口：${url}`
            : '可能是模型名写错，也可能是供应商没有在 /models 里返回全部模型别名。',
          actions: [
            { label: '打开模型供应商', action: 'open-page', target: 'provider' },
          ],
        });
      }
      if (result.statusCode && ![404, 405].includes(result.statusCode)) {
        break;
      }
    }
    const statusCode = lastResult?.statusCode ?? 0;
    const reason = explainProviderHttpFailure(lastResult);
    return makeDiagnosticCheck({
      id: 'model',
      title: '模型是否可用',
      status: statusCode === 429 || statusCode === 502 || statusCode === 503 ? 'warn' : 'fail',
      detail: statusCode ? `模型接口返回 HTTP ${statusCode}` : '无法连接模型接口',
      reason,
      actions: [
        { label: '打开模型供应商', action: 'open-page', target: 'provider' },
        ...(provider.source === 'ccswitch'
          ? [{ label: '同步 CCSwitch', action: 'sync-ccswitch' }]
          : []),
      ],
    });
  }

  private async diagnosePorts(): Promise<DiagnosticCheck> {
    const native = resolveNativeApiSettings(this.env);
    const preferredAdminPort = parseOptionalPort(this.env.WEIXIN_ADMIN_PORT) ?? this.port;
    const details: string[] = [];
    const reasons: string[] = [];
    let status: DiagnosticStatus = 'ok';

    if (!this.binding) {
      status = 'fail';
      details.push('管理面板端口未绑定');
      reasons.push('当前 HTTP 服务没有监听成功。');
    } else {
      details.push(`管理面板：${this.binding.url}`);
      if (preferredAdminPort && preferredAdminPort !== this.binding.port) {
        status = 'warn';
        reasons.push(`配置端口 ${preferredAdminPort} 可能被占用，管理面板已自动切换到 ${this.binding.port}。`);
      }
    }

    if (!native.enabled) {
      status = status === 'fail' ? status : 'warn';
      details.push('Codex Native API：已关闭');
      reasons.push('CODEX_NATIVE_API_ENABLE 被关闭时，部分本地诊断和兼容接口不可用。');
    } else {
      const open = await probeTcpPort(native.host, native.port, 1200);
      details.push(`Codex Native API：${native.host}:${native.port} ${open ? '已监听' : '未监听'}`);
      if (!open) {
        status = 'fail';
        reasons.push(`端口 ${native.port} 没有监听，可能是 Native API 没启动，或启动时被其他程序影响。`);
      }
    }

    return makeDiagnosticCheck({
      id: 'ports',
      title: '端口是否占用',
      status,
      detail: details.join('；'),
      reason: reasons.join(' ') || '关键本地端口状态正常。',
      actions: [
        { label: '重启桥接', action: 'restart-bridge' },
        { label: '查看日志', action: 'open-page', target: 'logs' },
      ],
    });
  }

  private async diagnoseCodexNative(): Promise<DiagnosticCheck> {
    const native = resolveNativeApiSettings(this.env);
    if (!native.enabled) {
      return makeDiagnosticCheck({
        id: 'codex-native',
        title: 'Codex 是否能正常响应',
        status: 'warn',
        detail: 'Codex Native API 已关闭',
        reason: '当前微信桥接仍可能可用，但无法通过本地 Native API 做健康检查。',
        actions: [
          { label: '查看运行配置', action: 'open-page', target: 'settings' },
        ],
      });
    }
    const result = await requestJsonUrl(`${native.baseUrl}/v1/health`, {
      timeoutMs: 25000,
      headers: native.authToken ? { authorization: `Bearer ${native.authToken}` } : {},
    });
    if (result.ok) {
      const body = isRecord(result.body) ? result.body : {};
      const runtime = isRecord(body.native_runtime) ? body.native_runtime : {};
      const statusText = normalizeEnvString(body.status) ?? 'ok';
      return makeDiagnosticCheck({
        id: 'codex-native',
        title: 'Codex 是否能正常响应',
        status: statusText === 'ok' ? 'ok' : 'warn',
        detail: `Native API 响应：${statusText}`,
        reason: normalizeEnvString(runtime.provider_profile_id)
          ? `Provider：${runtime.provider_profile_id}`
          : `接口：${native.baseUrl}/v1/health`,
        actions: [
          { label: '查看运行状态', action: 'open-page', target: 'runtime' },
        ],
      });
    }
    return makeDiagnosticCheck({
      id: 'codex-native',
      title: 'Codex 是否能正常响应',
      status: 'fail',
      detail: result.statusCode ? `Native API 返回 HTTP ${result.statusCode}` : 'Native API 没有响应',
      reason: explainNativeApiFailure(result),
      actions: [
        { label: '重启桥接', action: 'restart-bridge' },
        { label: '查看日志', action: 'open-page', target: 'logs' },
      ],
    });
  }

  private resolveAdminPreferencesFile() {
    return path.join(this.stateDir, 'runtime', ADMIN_PREFERENCES_FILE);
  }

  private readAdminPreferences() {
    const filePath = this.resolveAdminPreferencesFile();
    const existing = readJsonFile(filePath);
    return isRecord(existing) ? existing : {};
  }

  private writeAdminPreferences(patch: Record<string, unknown>) {
    const filePath = this.resolveAdminPreferencesFile();
    const next = {
      ...this.readAdminPreferences(),
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }

  private saveServiceEnvFilePreference(serviceEnvFile: string) {
    this.writeAdminPreferences({ serviceEnvFile });
  }

  private async handleCompleteSetup(req: IncomingMessage, res: ServerResponse) {
    const body = await readJsonBody(req);
    const now = new Date().toISOString();
    this.writeAdminPreferences({
      firstRunUpdatedAt: now,
      ...(normalizeBooleanFlag(body.skipped)
        ? { firstRunSkippedAt: now }
        : { firstRunCompletedAt: now }),
    });
    this.writeJson(res, 200, {
      ok: true,
      setup: this.buildSetupState(),
      state: this.buildState(),
    });
  }

  private async handleAlertTest(req: IncomingMessage, res: ServerResponse) {
    const body = await readJsonBody(req);
    const url = normalizeEnvString(body.url) ?? normalizeEnvString(this.env.WEIXIN_ALERT_WEBHOOK_URL);
    if (!url) {
      this.writeJson(res, 200, { ok: false, configured: false });
      return;
    }
    const ok = await postAlert(url, {
      type: 'test',
      stage: 'admin-panel',
      message: 'CodexBridge 测试告警',
      at: Date.now(),
    }, { minIntervalMs: 0, timeoutMs: 3000 });
    this.writeJson(res, 200, { ok, configured: true });
  }

  private normalizeSettingsPatch(body: Record<string, unknown>) {
    const current = this.buildSettings();
    const concurrency = isRecord(body.concurrency) ? body.concurrency : body;
    const logCleanup = isRecord(body.logCleanup) ? body.logCleanup : {};
    const modelProvider = isRecord(body.modelProvider)
      ? normalizeModelProviderPatch(body.modelProvider, current.modelProvider)
      : null;
    return {
      concurrency: {
        maxConcurrentTurns: parsePositiveInt(
          concurrency.maxConcurrentTurns ?? current.concurrency.maxConcurrentTurns,
          current.concurrency.maxConcurrentTurns,
          MAX_RUNTIME_CONCURRENCY,
        ),
        eventDispatchConcurrency: parsePositiveInt(
          concurrency.eventDispatchConcurrency ?? current.concurrency.eventDispatchConcurrency,
          current.concurrency.eventDispatchConcurrency,
          MAX_RUNTIME_CONCURRENCY,
        ),
        attachmentProcessingConcurrency: parsePositiveInt(
          concurrency.attachmentProcessingConcurrency ?? current.concurrency.attachmentProcessingConcurrency,
          current.concurrency.attachmentProcessingConcurrency,
          MAX_RUNTIME_CONCURRENCY,
        ),
        accountPollConcurrency: parsePositiveInt(
          concurrency.accountPollConcurrency ?? current.concurrency.accountPollConcurrency,
          current.concurrency.accountPollConcurrency,
          MAX_RUNTIME_CONCURRENCY,
        ),
      },
      logCleanup: {
        enabled: logCleanup.enabled === undefined
          ? current.logCleanup.enabled
          : normalizeBooleanFlag(logCleanup.enabled),
        retentionDays: parsePositiveInt(
          logCleanup.retentionDays ?? current.logCleanup.retentionDays,
          current.logCleanup.retentionDays,
          MAX_LOG_RETENTION_DAYS,
        ),
        maxBytes: parsePositiveInt(
          logCleanup.maxBytes ?? current.logCleanup.maxBytes,
          current.logCleanup.maxBytes,
          Number.MAX_SAFE_INTEGER,
        ),
        intervalMinutes: parsePositiveInt(
          logCleanup.intervalMinutes ?? current.logCleanup.intervalMinutes,
          current.logCleanup.intervalMinutes,
          MAX_LOG_CLEANUP_INTERVAL_MINUTES,
        ),
      },
      modelProvider,
      alertWebhookUrl: typeof body.alertWebhookUrl === 'string'
        ? body.alertWebhookUrl.trim()
        : current.alertWebhookUrl,
    };
  }

  private recordAdminPageHeartbeat(body: Record<string, unknown>): AdminPageClient | null {
    const pageId = normalizePageId(body.pageId);
    if (!pageId) {
      return null;
    }
    const shutdownOnClose = normalizeBooleanFlag(body.shutdownOnClose);
    const page: AdminPageClient = {
      id: pageId,
      shutdownOnClose,
      closed: false,
      lastSeenAt: Date.now(),
    };
    this.adminPageClients.set(pageId, page);
    if (shutdownOnClose) {
      this.schedulePageCloseShutdownCheck();
    }
    return page;
  }

  private recordAdminPageClose(body: Record<string, unknown>): void {
    const pageId = normalizePageId(body.pageId);
    const requestedShutdown = normalizeBooleanFlag(body.shutdownOnClose);
    if (pageId) {
      const current = this.adminPageClients.get(pageId);
      this.adminPageClients.set(pageId, {
        id: pageId,
        shutdownOnClose: requestedShutdown || Boolean(current?.shutdownOnClose),
        closed: true,
        lastSeenAt: Date.now(),
      });
    }
    if (requestedShutdown || (pageId && this.adminPageClients.get(pageId)?.shutdownOnClose)) {
      this.schedulePageCloseShutdownCheck();
    }
  }

  private shouldShutdownForClosedPage(body: Record<string, unknown>): boolean {
    if (!this.serviceControl) {
      return false;
    }
    const pageId = normalizePageId(body.pageId);
    if (normalizeBooleanFlag(body.shutdownOnClose)) {
      return true;
    }
    return Boolean(pageId && this.adminPageClients.get(pageId)?.shutdownOnClose);
  }

  private schedulePageCloseShutdownCheck(): void {
    if (!this.serviceControl) {
      return;
    }
    this.clearPageCloseShutdownTimer();
    const delay = this.hasActiveShutdownOnClosePage()
      ? ADMIN_PAGE_CLIENT_TTL_MS + this.pageCloseShutdownGraceMs
      : this.pageCloseShutdownGraceMs;
    this.pageCloseShutdownTimer = setTimeout(() => {
      this.pageCloseShutdownTimer = null;
      this.maybeShutdownAfterPageClose();
    }, delay);
  }

  private maybeShutdownAfterPageClose(): void {
    if (!this.serviceControl) {
      return;
    }
    const hadShutdownOnClosePage = Array.from(this.adminPageClients.values())
      .some((page) => page.shutdownOnClose);
    if (this.hasActiveShutdownOnClosePage()) {
      this.schedulePageCloseShutdownCheck();
      return;
    }
    if (!hadShutdownOnClosePage) {
      return;
    }
    this.requestServiceShutdown('admin-page-closed');
  }

  private hasActiveShutdownOnClosePage(): boolean {
    const now = Date.now();
    for (const [pageId, page] of this.adminPageClients.entries()) {
      if (page.closed) {
        continue;
      }
      if (now - page.lastSeenAt > ADMIN_PAGE_CLIENT_TTL_MS) {
        this.adminPageClients.delete(pageId);
        continue;
      }
      if (page.shutdownOnClose) {
        return true;
      }
    }
    return false;
  }

  private clearPageCloseShutdownTimer(): void {
    if (!this.pageCloseShutdownTimer) {
      return;
    }
    clearTimeout(this.pageCloseShutdownTimer);
    this.pageCloseShutdownTimer = null;
  }

  private requestServiceShutdown(reason: string): void {
    const serviceControl = this.serviceControl;
    if (!serviceControl || this.shutdownRequested) {
      return;
    }
    this.shutdownRequested = true;
    setTimeout(() => {
      Promise.resolve(serviceControl.shutdown(reason)).catch(() => {});
    }, 0);
  }

  private startLogCleanupScheduler({ runImmediately = true }: { runImmediately?: boolean } = {}) {
    this.stopLogCleanupScheduler();
    const settings = this.resolveLogCleanupSettings();
    if (!settings.enabled) {
      return;
    }
    if (runImmediately) {
      void this.cleanupLogs('startup').catch(() => {});
    }
    this.logCleanupTimer = setInterval(() => {
      void this.cleanupLogs('interval').catch(() => {});
    }, Math.max(1, settings.intervalMinutes) * 60 * 1000);
  }

  private restartLogCleanupScheduler() {
    this.startLogCleanupScheduler({ runImmediately: false });
  }

  private stopLogCleanupScheduler() {
    if (!this.logCleanupTimer) {
      return;
    }
    clearInterval(this.logCleanupTimer);
    this.logCleanupTimer = null;
  }

  private startCcswitchSyncScheduler({ runImmediately = true }: { runImmediately?: boolean } = {}) {
    this.stopCcswitchSyncScheduler();
    const preferences = this.readAdminPreferences();
    if (normalizeModelProviderSource(preferences.modelProviderSource) !== 'ccswitch') {
      return;
    }
    const settings = this.buildCcswitchSettings('ccswitch', preferences);
    if (runImmediately) {
      this.syncCcswitchProvider({
        codexHome: settings.codexHome,
        reason: 'startup',
      });
    }
    this.ccswitchSyncTimer = setInterval(() => {
      this.syncCcswitchProvider({
        codexHome: settings.codexHome,
        reason: 'interval',
      });
    }, settings.intervalMs);
  }

  private restartCcswitchSyncScheduler() {
    this.startCcswitchSyncScheduler({ runImmediately: true });
  }

  private stopCcswitchSyncScheduler() {
    if (!this.ccswitchSyncTimer) {
      return;
    }
    clearInterval(this.ccswitchSyncTimer);
    this.ccswitchSyncTimer = null;
  }

  private async cleanupLogs(reason: string) {
    const settings = this.resolveLogCleanupSettings();
    const logsDir = path.join(this.stateDir, 'logs');
    const startedAt = new Date().toISOString();
    const actions: Array<{
      path: string;
      action: string;
      beforeBytes: number;
      afterBytes: number;
      error?: string;
    }> = [];
    if (!settings.enabled) {
      return {
        enabled: false,
        reason,
        startedAt,
        actions,
      };
    }
    const now = Date.now();
    const retentionMs = settings.retentionDays > 0 ? settings.retentionDays * 24 * 60 * 60 * 1000 : 0;
    const activeLogPaths = new Set(this.resolveLogFiles().map((entry) => path.resolve(entry.path)));
    for (const filePath of this.listLogCleanupTargets(logsDir)) {
      const stat = safeStat(filePath);
      if (!stat || !stat.isFile()) {
        continue;
      }
      const beforeBytes = stat.size;
      const isActiveLog = activeLogPaths.has(path.resolve(filePath));
      try {
        if (retentionMs > 0 && now - stat.mtimeMs > retentionMs) {
          if (isActiveLog) {
            const message = `[CodexBridge] log cleared at ${startedAt}; reason=${reason}; older than ${settings.retentionDays} day(s).\n`;
            fs.writeFileSync(filePath, message, 'utf8');
            actions.push({
              path: filePath,
              action: 'cleared_old_active_log',
              beforeBytes,
              afterBytes: safeStat(filePath)?.size ?? 0,
            });
          } else {
            fs.unlinkSync(filePath);
            actions.push({
              path: filePath,
              action: 'deleted_old_log',
              beforeBytes,
              afterBytes: 0,
            });
          }
          continue;
        }
        if (settings.maxBytes > 0 && stat.size > settings.maxBytes) {
          compactLogFile(filePath, settings.maxBytes, {
            reason,
            timestamp: startedAt,
          });
          actions.push({
            path: filePath,
            action: 'compacted_large_log',
            beforeBytes,
            afterBytes: safeStat(filePath)?.size ?? 0,
          });
        }
      } catch (error) {
        actions.push({
          path: filePath,
          action: 'failed',
          beforeBytes,
          afterBytes: safeStat(filePath)?.size ?? beforeBytes,
          error: formatError(error),
        });
      }
    }
    return {
      enabled: true,
      reason,
      startedAt,
      settings,
      actions,
    };
  }

  private async clearActiveLogs(reason: string) {
    const startedAt = new Date().toISOString();
    const summary = this.buildLogResetSummary({ reason, startedAt });
    const actions: Array<{
      path: string;
      action: string;
      beforeBytes: number;
      afterBytes: number;
      error?: string;
    }> = [];
    for (const entry of this.resolveLogFiles()) {
      const beforeBytes = safeStat(entry.path)?.size ?? 0;
      try {
        fs.mkdirSync(path.dirname(entry.path), { recursive: true });
        const content = entry.kind === 'stdout' ? summary : '';
        fs.writeFileSync(entry.path, content, 'utf8');
        actions.push({
          path: entry.path,
          action: entry.kind === 'stdout' ? 'reset_active_log_with_summary' : 'cleared_active_log',
          beforeBytes,
          afterBytes: safeStat(entry.path)?.size ?? 0,
        });
      } catch (error) {
        actions.push({
          path: entry.path,
          action: 'failed',
          beforeBytes,
          afterBytes: safeStat(entry.path)?.size ?? beforeBytes,
          error: formatError(error),
        });
      }
    }
    return {
      enabled: true,
      reason,
      startedAt,
      actions,
    };
  }

  private buildLogResetSummary({ reason, startedAt }: { reason: string; startedAt: string }) {
    const settings = this.buildSettings();
    const bridge = this.bridgeControl?.status?.() ?? { running: true };
    const concurrency = settings.concurrency;
    return [
      '[CodexBridge] running log reset',
      `cleared_at: ${startedAt}`,
      `reason: ${reason}`,
      `state_dir: ${this.stateDir}`,
      `service_env_file: ${resolveServiceEnvFile(this.env)}`,
      `admin_url: ${this.binding?.url ?? '-'}`,
      `primary_account_id: ${this.primaryAccountId() || '-'}`,
      `bridge_running: ${Boolean(bridge.running)}`,
      `max_concurrent_turns: ${concurrency.maxConcurrentTurns}`,
      `event_dispatch_concurrency: ${concurrency.eventDispatchConcurrency}`,
      `attachment_processing_concurrency: ${concurrency.attachmentProcessingConcurrency}`,
      `account_poll_concurrency: ${concurrency.accountPollConcurrency}`,
      '',
    ].join('\n');
  }

  private listLogCleanupTargets(logsDir: string) {
    const paths = new Set(this.resolveLogFiles().map((entry) => entry.path));
    try {
      for (const name of fs.readdirSync(logsDir)) {
        if (/^weixin-bridge\..*\.log(?:\.\d+)?$/u.test(name)) {
          paths.add(path.join(logsDir, name));
        }
      }
    } catch {
      // Missing logs directory is normal before the service has written logs.
    }
    return [...paths];
  }

  private async handlePatchAccount(req: IncomingMessage, res: ServerResponse, rawAccountId: string) {
    const accountId = normalizeAccountId(rawAccountId);
    const account = accountId ? this.accountStore.loadAccount(accountId) : null;
    if (!accountId || !account) {
      this.writeJson(res, 404, { error: 'account not found' });
      return;
    }
    const body = await readJsonBody(req);
    const nextDisabled = typeof body.disabled === 'boolean' ? body.disabled : undefined;
    if (accountId === this.primaryAccountId() && nextDisabled) {
      this.writeJson(res, 400, { error: 'primary account cannot be disabled' });
      return;
    }
    const patch: Parameters<WeixinAccountStore['updateAccount']>[1] = {};
    if (typeof body.displayName === 'string') {
      patch.display_name = body.displayName;
    }
    if (typeof nextDisabled === 'boolean') {
      patch.disabled = nextDisabled;
    }
    const updated = this.accountStore.updateAccount(accountId, patch);
    this.writeJson(res, 200, { account: updated, accounts: this.listAccounts() });
  }

  private handleDeleteAccount(res: ServerResponse, rawAccountId: string) {
    const accountId = normalizeAccountId(rawAccountId);
    const account = accountId ? this.accountStore.loadAccount(accountId) : null;
    if (!accountId || !account) {
      this.writeJson(res, 404, { error: 'account not found' });
      return;
    }
    if (accountId === this.primaryAccountId()) {
      this.writeJson(res, 400, { error: 'primary account cannot be deleted' });
      return;
    }
    this.accountStore.deleteAccount(accountId);
    this.writeJson(res, 200, { ok: true, accounts: this.listAccounts() });
  }

  private async handleSetPrimary(req: IncomingMessage, res: ServerResponse) {
    const body = await readJsonBody(req);
    const accountId = normalizeAccountId(String(body.accountId ?? ''));
    const account = accountId ? this.accountStore.loadAccount(accountId) : null;
    if (!accountId || !account) {
      this.writeJson(res, 404, { error: 'account not found' });
      return;
    }
    this.accountStore.updateAccount(accountId, { disabled: false });
    setEnvValue(this.env, 'WEIXIN_PRIMARY_ACCOUNT_ID', accountId);
    setEnvValue(this.env, 'WEIXIN_ACCOUNT_ID', '');
    persistEnvValues(resolveServiceEnvFile(this.env), {
      WEIXIN_ACCOUNT_ID: '',
      WEIXIN_PRIMARY_ACCOUNT_ID: accountId,
    });
    this.writeJson(res, 200, this.buildState());
  }

  private async handleBridgeStart(res: ServerResponse) {
    if (!this.bridgeControl) {
      this.writeJson(res, 409, { error: 'bridge control is unavailable' });
      return;
    }
    await this.bridgeControl.start();
    this.writeJson(res, 200, this.buildState());
  }

  private async handleBridgeStop(res: ServerResponse) {
    if (!this.bridgeControl) {
      this.writeJson(res, 409, { error: 'bridge control is unavailable' });
      return;
    }
    await this.bridgeControl.stop();
    this.writeJson(res, 200, this.buildState());
  }

  private async handleBridgeRestart(res: ServerResponse) {
    if (!this.bridgeControl) {
      this.writeJson(res, 409, { error: 'bridge control is unavailable' });
      return;
    }
    await this.bridgeControl.restart();
    this.writeJson(res, 200, this.buildState());
  }

  private async handleStartPairing(req: IncomingMessage, res: ServerResponse) {
    const body = await readJsonBody(req);
    const displayName = String(body.displayName ?? '').trim();
    const session = this.startPairing(displayName);
    await Promise.race([
      session.firstQrReady,
      sleep(8000),
    ]);
    this.writeJson(res, 200, { pairing: this.serializePairing(session) });
  }

  private startPairing(displayName: string) {
    this.cancelPairing('cancelled');
    let resolveFirstQrReady = () => {};
    const firstQrReady = new Promise<void>((resolve) => {
      resolveFirstQrReady = resolve;
    });
    const session: PairingSession = {
      id: crypto.randomUUID(),
      status: 'starting',
      qrcode: '',
      qrUrl: '',
      qrImageDataUrl: '',
      displayName,
      accountId: '',
      userId: '',
      error: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cancelled: false,
      firstQrReady,
      resolveFirstQrReady,
    };
    this.currentPairing = session;
    void this.runPairing(session);
    return session;
  }

  private async runPairing(session: PairingSession) {
    try {
      const credentials = await this.qrLogin({
        accountStore: this.accountStore,
        accountsDir: this.accountStore.rootDir,
        botType: DEFAULT_ILINK_BOT_TYPE,
        timeoutSeconds: PAIRING_TIMEOUT_SECONDS,
        locale: this.locale,
        sleep: async (ms) => cancellableSleep(ms, session),
        onQrCode: async ({ qrcode, qrcodeImageContent }) => {
          const rendered = await renderQrImage(qrcode, qrcodeImageContent);
          session.qrcode = qrcode;
          session.qrUrl = rendered.qrUrl;
          session.qrImageDataUrl = rendered.qrImageDataUrl;
          session.status = 'wait';
          session.updatedAt = new Date().toISOString();
          session.resolveFirstQrReady();
        },
        onStatus: async ({ status }) => {
          session.status = status;
          session.updatedAt = new Date().toISOString();
        },
      });
      if (session.cancelled) {
        session.status = 'cancelled';
        return;
      }
      if (!credentials) {
        session.status = 'timeout';
        session.updatedAt = new Date().toISOString();
        session.resolveFirstQrReady();
        return;
      }
      session.status = 'confirmed';
      session.accountId = credentials.account_id;
      session.userId = credentials.user_id;
      session.updatedAt = new Date().toISOString();
      applyPairingDisplayName(this.accountStore, credentials, session.displayName);
    } catch (error) {
      if (session.cancelled) {
        session.status = 'cancelled';
        session.updatedAt = new Date().toISOString();
        return;
      }
      session.status = 'error';
      session.error = formatError(error);
      session.updatedAt = new Date().toISOString();
      session.resolveFirstQrReady();
    }
  }

  private cancelPairing(status: PairingSession['status']) {
    const session = this.currentPairing;
    if (!session || ['confirmed', 'timeout', 'cancelled', 'error'].includes(session.status)) {
      return;
    }
    session.cancelled = true;
    session.status = status;
    session.updatedAt = new Date().toISOString();
    session.resolveFirstQrReady();
  }

  private serializePairing(session: PairingSession | null) {
    if (!session) {
      return null;
    }
    return {
      id: session.id,
      status: session.status,
      qrcode: session.qrcode,
      qrUrl: session.qrUrl,
      qrImageDataUrl: session.qrImageDataUrl,
      displayName: session.displayName,
      accountId: session.accountId,
      userId: session.userId,
      error: session.error,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  private primaryAccountId() {
    return resolvePrimaryAccountId(this.accountStore, this.env);
  }

  private writeJson(res: ServerResponse, statusCode: number, body: unknown) {
    const payload = `${JSON.stringify(body)}\n`;
    res.writeHead(statusCode, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  private writeJsonDownload(res: ServerResponse, body: unknown) {
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
    const payload = `${JSON.stringify(body, null, 2)}\n`;
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename="codexbridge-weixin-backup-${stamp}.json"`,
      'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  private writeHtml(res: ServerResponse, html: string) {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(html),
    });
    res.end(html);
  }

  private writeIcon(res: ServerResponse) {
    if (!fs.existsSync(ADMIN_FAVICON_PATH)) {
      this.writeJson(res, 404, { error: 'favicon not found' });
      return;
    }
    const icon = fs.readFileSync(ADMIN_FAVICON_PATH);
    res.writeHead(200, {
      'content-type': 'image/x-icon',
      'cache-control': 'no-store, max-age=0',
      'content-length': icon.length,
    });
    res.end(icon);
  }

  private writePngIcon(res: ServerResponse) {
    if (!fs.existsSync(ADMIN_FAVICON_PNG_PATH)) {
      this.writeJson(res, 404, { error: 'favicon png not found' });
      return;
    }
    const icon = fs.readFileSync(ADMIN_FAVICON_PNG_PATH);
    res.writeHead(200, {
      'content-type': 'image/png',
      'cache-control': 'no-store, max-age=0',
      'content-length': icon.length,
    });
    res.end(icon);
  }

  private writeDonateQr(res: ServerResponse) {
    if (!fs.existsSync(ADMIN_DONATE_QR_PATH)) {
      this.writeJson(res, 404, { error: 'donate qr not found' });
      return;
    }
    const image = fs.readFileSync(ADMIN_DONATE_QR_PATH);
    res.writeHead(200, {
      'content-type': 'image/png',
      'cache-control': 'no-store, max-age=0',
      'content-length': image.length,
    });
    res.end(image);
  }
}

export function resolveWeixinAdminServerOptions({
  env = process.env,
}: {
  env?: NodeJS.ProcessEnv | Record<string, unknown>;
} = {}) {
  return {
    enabled: parseBooleanEnv(env.WEIXIN_ADMIN_ENABLE, true),
    host: normalizeEnvString(env.WEIXIN_ADMIN_HOST) ?? DEFAULT_ADMIN_HOST,
    port: parseOptionalPort(env.WEIXIN_ADMIN_PORT) ?? DEFAULT_ADMIN_PORT,
  };
}

export function resolvePrimaryAccountId(
  accountStore: WeixinAccountStore,
  env: NodeJS.ProcessEnv | Record<string, unknown> = process.env,
) {
  const explicitPrimary = normalizeCsv(env.WEIXIN_PRIMARY_ACCOUNT_ID)[0]
    ?? normalizeCsv(env.WEIXIN_ACCOUNT_ID)[0];
  if (explicitPrimary) {
    return explicitPrimary;
  }
  return accountStore
    .listAccounts()
    .map((accountId) => ({
      accountId,
      savedAt: Date.parse(String(accountStore.loadAccount(accountId)?.saved_at ?? '')),
    }))
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.savedAt) ? left.savedAt : Number.MAX_SAFE_INTEGER;
      const rightTime = Number.isFinite(right.savedAt) ? right.savedAt : Number.MAX_SAFE_INTEGER;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.accountId.localeCompare(right.accountId);
    })[0]?.accountId ?? null;
}

async function renderQrImage(qrcode: string, qrcodeImageContent: string | null | undefined) {
  const content = String(qrcodeImageContent ?? '').trim();
  if (content.startsWith('data:image/')) {
    return {
      qrUrl: '',
      qrImageDataUrl: content,
    };
  }
  const qrUrl = /^https?:\/\//u.test(content) ? content : '';
  const payload = qrUrl || qrcode;
  const qrImageDataUrl = payload
    ? await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
    })
    : '';
  return {
    qrUrl,
    qrImageDataUrl,
  };
}

function applyPairingDisplayName(
  accountStore: WeixinAccountStore,
  credentials: OfficialQrLoginCredentials,
  displayName: string,
) {
  const normalized = displayName.trim();
  if (!normalized) {
    return;
  }
  accountStore.updateAccount(credentials.account_id, {
    display_name: normalized,
  });
}

function setEnvValue(env: NodeJS.ProcessEnv | Record<string, unknown>, key: string, value: string) {
  env[key] = value;
}

function resolveServiceEnvFile(env: NodeJS.ProcessEnv | Record<string, unknown>) {
  const explicit = normalizeEnvString(env.CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE)
    ?? normalizeEnvString(env.CODEXBRIDGE_SERVICE_ENV_FILE);
  if (explicit) {
    return explicit;
  }
  if (process.platform === 'win32') {
    const appData = normalizeEnvString(env.APPDATA) ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'codexbridge', 'weixin.service.env');
  }
  const configHome = normalizeEnvString(env.XDG_CONFIG_HOME) ?? path.join(os.homedir(), '.config');
  return path.join(configHome, 'codexbridge', 'weixin.service.env');
}

function persistEnvValues(filePath: string, values: Record<string, string>) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const keys = new Set(Object.keys(values));
  const seen = new Set<string>();
  const lines = existing ? existing.split(/\r?\n/u) : [];
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/u);
    const key = match?.[1] ?? '';
    if (!key || !keys.has(key)) {
      return line;
    }
    seen.add(key);
    return `${key}=${values[key] ?? ''}`;
  });
  for (const key of keys) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${values[key] ?? ''}`);
    }
  }
  const content = `${nextLines.join('\n').replace(/\n+$/u, '')}\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function readJsonFile(filePath: string) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

async function readJsonBody(req: IncomingMessage, maxBytes = JSON_BODY_LIMIT_BYTES): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error('request body too large');
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    return {};
  }
  const parsed = JSON.parse(text);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function makeDiagnosticCheck(check: DiagnosticCheck): DiagnosticCheck {
  return {
    id: check.id,
    title: check.title,
    status: check.status,
    detail: check.detail,
    reason: check.reason,
    actions: check.actions,
  };
}

function summarizeDiagnosticChecks(checks: DiagnosticCheck[]) {
  const failed = checks.filter((check) => check.status === 'fail').length;
  const warned = checks.filter((check) => check.status === 'warn').length;
  const ok = checks.filter((check) => check.status === 'ok').length;
  return {
    status: failed > 0 ? 'fail' : (warned > 0 ? 'warn' : 'ok'),
    ok,
    warned,
    failed,
    text: failed > 0
      ? `发现 ${failed} 个需要处理的问题，另有 ${warned} 个提醒。`
      : (warned > 0 ? `基础功能可用，但有 ${warned} 个提醒需要留意。` : '全部检查通过。'),
  };
}

function resolveNativeApiSettings(env: NodeJS.ProcessEnv | Record<string, unknown>) {
  const host = normalizeEnvString(env.CODEX_NATIVE_API_HOST) ?? DEFAULT_NATIVE_API_HOST;
  const port = parseOptionalPort(env.CODEX_NATIVE_API_PORT) ?? DEFAULT_NATIVE_API_PORT;
  return {
    enabled: parseBooleanEnv(env.CODEX_NATIVE_API_ENABLE, true),
    host,
    port,
    baseUrl: `http://${host}:${port}`,
    authToken: normalizeEnvString(env.CODEX_NATIVE_API_AUTH_TOKEN) ?? '',
  };
}

async function probeTcpPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function buildModelEndpointCandidates(baseUrl: string) {
  const candidates: string[] = [];
  try {
    const parsed = new URL(baseUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/u, '');
    if (normalizedPath.endsWith('/models')) {
      candidates.push(parsed.toString());
    } else {
      const first = new URL(parsed.toString());
      first.pathname = (normalizedPath.endsWith('/v1')
        ? `${normalizedPath}/models`
        : `${normalizedPath || ''}/v1/models`).replace(/\/+/gu, '/');
      candidates.push(first.toString());
      const second = new URL(parsed.toString());
      second.pathname = `${normalizedPath || ''}/models`.replace(/\/+/gu, '/');
      candidates.push(second.toString());
    }
  } catch {
    return [];
  }
  return [...new Set(candidates)];
}

function requestJsonUrl(
  url: string,
  {
    timeoutMs = 5000,
    headers = {},
  }: {
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<JsonRequestResult> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (error) {
      resolve({
        ok: false,
        statusCode: null,
        body: null,
        error: `URL 无效：${formatError(error)}`,
        url,
      });
      return;
    }
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      method: 'GET',
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        accept: 'application/json',
        ...headers,
      },
      timeout: timeoutMs,
    }, (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on('data', (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        total += buffer.length;
        if (total <= 1024 * 1024) {
          chunks.push(buffer);
        }
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const body = safeJsonParse(text);
        const statusCode = response.statusCode ?? null;
        resolve({
          ok: Boolean(statusCode && statusCode >= 200 && statusCode < 300),
          statusCode,
          body,
          error: statusCode && statusCode >= 200 && statusCode < 300 ? '' : extractResponseError(body, text),
          url,
        });
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('请求超时'));
    });
    req.on('error', (error) => {
      resolve({
        ok: false,
        statusCode: null,
        body: null,
        error: formatError(error),
        url,
      });
    });
    req.end();
  });
}

function extractModelIds(body: unknown) {
  const root = isRecord(body) ? body : {};
  const rawModels = Array.isArray(root.data)
    ? root.data
    : (Array.isArray(root.models) ? root.models : []);
  return rawModels
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry.trim();
      }
      return isRecord(entry)
        ? normalizeEnvString(entry.id) ?? normalizeEnvString(entry.name) ?? normalizeEnvString(entry.model)
        : null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

function explainProviderHttpFailure(result: JsonRequestResult | null) {
  if (!result) {
    return '没有拿到模型接口返回。';
  }
  if (result.statusCode === 401 || result.statusCode === 403) {
    return 'API key 无效、权限不足，或 Base URL 指向了错误的供应商。';
  }
  if (result.statusCode === 429) {
    return '供应商返回限流或额度不足；更换 key、充值或稍后重试。';
  }
  if (result.statusCode === 502 || result.statusCode === 503) {
    return '供应商上游服务临时不可用，这通常不是本地代码问题。';
  }
  return result.error || '模型接口不可访问，请检查网络、Base URL 和 API key。';
}

function explainNativeApiFailure(result: JsonRequestResult) {
  if (result.statusCode === 401 || result.statusCode === 403) {
    return 'Native API 设置了鉴权，但诊断请求没有通过，请检查 CODEX_NATIVE_API_AUTH_TOKEN。';
  }
  if (result.statusCode === 503) {
    return result.error || 'Codex Native API 已启动，但底层 Codex/模型运行时不可用。';
  }
  if (result.error) {
    return result.error;
  }
  return '请重启桥接后再检查。';
}

function extractResponseError(body: unknown, fallbackText: string) {
  if (isRecord(body)) {
    if (isRecord(body.error)) {
      return normalizeEnvString(body.error.message) ?? normalizeEnvString(body.error.code) ?? JSON.stringify(body.error);
    }
    return normalizeEnvString(body.message) ?? normalizeEnvString(body.status) ?? fallbackText.slice(0, 500);
  }
  return fallbackText.slice(0, 500);
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function mergePageLifecyclePayload(
  body: Record<string, unknown>,
  searchParams: URLSearchParams,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...body };
  const pageId = searchParams.get('pageId');
  const shutdownOnClose = searchParams.get('shutdownOnClose');
  if (pageId !== null && merged.pageId === undefined) {
    merged.pageId = pageId;
  }
  if (shutdownOnClose !== null && merged.shutdownOnClose === undefined) {
    merged.shutdownOnClose = shutdownOnClose;
  }
  return merged;
}

function listen(server: Server, host: string, port: number): Promise<WeixinAdminServerBinding> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        host,
        port: boundPort,
        url: `http://${host}:${boundPort}`,
      });
    };
    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host, port });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function cancellableSleep(ms: number, session: PairingSession) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (session.cancelled) {
        reject(new Error('pairing cancelled'));
        return;
      }
      resolve();
    }, ms);
    if (session.cancelled) {
      clearTimeout(timer);
      reject(new Error('pairing cancelled'));
    }
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function statMtimeIso(filePath: string) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return '';
  }
}

function normalizeAccountId(raw: string) {
  return String(raw ?? '').trim();
}

function normalizePageId(value: unknown) {
  return String(value ?? '').trim().slice(0, 128);
}

function normalizeBooleanFlag(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeCsv(value: unknown) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeEnvString(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function normalizeModelProviderPatch(
  raw: Record<string, unknown>,
  current: {
    profileId: string;
    providerId: string;
    providerName: string;
    baseUrl: string;
    model: string;
    modelIds: string;
    capabilities: string;
    serviceEnvFile?: string;
    source?: string;
    ccswitchCodexHome?: string;
    ccswitchSyncIntervalMs?: number;
    ccswitch?: {
      codexHome?: string;
      intervalMs?: number;
    };
  },
) {
  const model = normalizeEnvString(raw.model) ?? current.model;
  const baseUrl = normalizeEnvString(raw.baseUrl) ?? current.baseUrl;
  if (!model) {
    throw new Error('model is required');
  }
  if (!baseUrl || !/^https?:\/\//iu.test(baseUrl)) {
    throw new Error('baseUrl must start with http:// or https://');
  }
  const apiKey = normalizeEnvString(raw.apiKey);
  const providerName = normalizeProviderDisplayName(raw.providerName) ?? normalizeProviderDisplayName(current.providerName) ?? 'Z Token';
  const providerId = normalizeProviderId(raw.providerId) ?? current.providerId;
  const profileId = normalizeProviderId(raw.profileId) ?? current.profileId;
  const capabilities = normalizeProviderCapabilities(raw.capabilities) ?? current.capabilities;
  const serviceEnvFile = normalizeServiceEnvFile(raw.serviceEnvFile, current.serviceEnvFile);
  return {
    source: normalizeModelProviderSource(raw.source ?? current.source),
    profileId,
    providerId,
    providerName,
    apiKey: apiKey ?? null,
    baseUrl: baseUrl.replace(/\/+$/u, ''),
    model,
    modelIds: normalizeEnvString(raw.modelIds) ?? model,
    capabilities,
    serviceEnvFile,
    ccswitchCodexHome: normalizeOptionalPath(raw.ccswitchCodexHome, current.ccswitch?.codexHome),
    ccswitchSyncIntervalMs: parsePositiveInt(
      raw.ccswitchSyncIntervalMs ?? current.ccswitch?.intervalMs,
      DEFAULT_CCSWITCH_SYNC_INTERVAL_MS,
      60_000,
    ),
  };
}

function normalizeModelProviderSource(value: unknown): 'manual' | 'ccswitch' {
  return String(value ?? '').trim().toLowerCase() === 'ccswitch' ? 'ccswitch' : 'manual';
}

function normalizeOptionalPath(value: unknown, fallback: unknown) {
  const raw = normalizeEnvString(value) ?? normalizeEnvString(fallback);
  return raw ? path.resolve(raw) : '';
}

function normalizeServiceEnvFile(value: unknown, fallback: string | undefined) {
  const raw = normalizeEnvString(value) ?? normalizeEnvString(fallback);
  if (!raw) {
    throw new Error('serviceEnvFile is required');
  }
  const resolved = path.resolve(raw);
  if (!path.basename(resolved)) {
    throw new Error('serviceEnvFile must be a file path');
  }
  return resolved;
}

function normalizeProviderId(value: unknown) {
  const normalized = normalizeEnvString(value);
  if (!normalized) {
    return null;
  }
  return normalized.replace(/[^A-Za-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '') || null;
}

function normalizeProviderDisplayName(value: unknown) {
  const normalized = normalizeEnvString(value);
  if (!normalized) {
    return null;
  }
  const withoutSourcePrefix = normalized.replace(/^CCSwitch\s*[·路]\s*/iu, '').trim();
  if (withoutSourcePrefix.replace(/[\s_-]+/gu, '').toLowerCase() === 'ztoken') {
    return 'Z Token';
  }
  return withoutSourcePrefix;
}

function normalizeProviderCapabilities(value: unknown) {
  const normalized = normalizeEnvString(value)?.toLowerCase();
  const allowed = new Set(['default', 'claude-code', 'deepseek', 'minimax', 'qwen', 'openrouter', 'kimi', 'gemini', 'iflow']);
  return normalized && allowed.has(normalized) ? normalized : null;
}

function maskSecret(value: string) {
  if (!value) {
    return '';
  }
  if (value.length <= 8) {
    return '********';
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function parseOptionalPort(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
    return null;
  }
  return parsed;
}

function parsePositiveInt(value: unknown, defaultValue: number, maxValue: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return Math.min(parsed, maxValue);
}

function parseBooleanEnv(value: unknown, defaultValue = false): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function isAddressInUseError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE');
}

function isLoopback(address: string | undefined) {
  const normalized = String(address ?? '').trim();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1'
    || normalized === '';
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message || error.stack || String(error);
  }
  return String(error);
}

function safeList<T>(producer: () => T[]): T[] {
  try {
    const value = producer();
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function groupBy<T>(records: T[], selector: (record: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const record of records) {
    const key = selector(record);
    const current = grouped.get(key) ?? [];
    current.push(record);
    grouped.set(key, current);
  }
  return grouped;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

function maxTimestamp(values: Array<number | null | undefined>) {
  const normalized = values
    .map((value) => Number(value ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  return normalized.length ? Math.max(...normalized) : null;
}

function normalizeSearchText(value: unknown) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function normalizeSessionSort(value: unknown) {
  const normalized = String(value ?? '').trim();
  return ['updatedAsc', 'titleAsc', 'titleDesc', 'createdDesc'].includes(normalized)
    ? normalized
    : 'updatedDesc';
}

function sessionMatchesSearch(session: any, query: string) {
  const haystack = normalizeSearchText([
    session.id,
    session.title,
    session.codexTitle,
    session.preview,
    session.providerProfileId,
    session.providerDisplayName,
    session.codexThreadId,
    session.cwd,
    session.model,
    session.reasoningEffort,
    ...(session.scopes ?? []).flatMap((scope: any) => [
      scope.externalScopeId,
      scope.scopeId,
      scope.accountId,
      scope.accountDisplayName,
    ]),
  ].filter(Boolean).join(' '));
  return haystack.includes(query);
}

function sortSessions<T extends { title?: string | null; updatedAt?: number | null; createdAt?: number | null }>(
  sessions: T[],
  sort: string,
) {
  return [...sessions].sort((left, right) => {
    if (sort === 'updatedAsc') {
      return Number(left.updatedAt ?? 0) - Number(right.updatedAt ?? 0);
    }
    if (sort === 'titleAsc' || sort === 'titleDesc') {
      const compared = String(left.title ?? '').localeCompare(String(right.title ?? ''), 'zh-CN');
      return sort === 'titleDesc' ? -compared : compared;
    }
    if (sort === 'createdDesc') {
      return Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0);
    }
    return Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0);
  });
}

function resolveWeixinScopeAccount({
  externalScopeId,
  primaryAccountId,
  accountStore,
}: {
  externalScopeId: string;
  primaryAccountId: string | null;
  accountStore: WeixinAccountStore;
}) {
  const normalized = String(externalScopeId ?? '');
  const separator = normalized.indexOf(':');
  if (separator > 0) {
    const accountId = normalized.slice(0, separator);
    if (accountStore.loadAccount(accountId)) {
      return {
        accountId,
        scopeId: normalized.slice(separator + 1),
      };
    }
  }
  return {
    accountId: primaryAccountId,
    scopeId: normalized,
  };
}

function safeStat(filePath: string) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readTailText(filePath: string, maxBytes: number) {
  let fd: number | null = null;
  try {
    const stat = fs.statSync(filePath);
    const length = Math.min(stat.size, maxBytes);
    const start = Math.max(0, stat.size - length);
    const buffer = Buffer.alloc(length);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, length, start);
    return buffer.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

function compactLogFile(
  filePath: string,
  maxBytes: number,
  {
    reason,
    timestamp,
  }: {
    reason: string;
    timestamp: string;
  },
) {
  const marker = `[CodexBridge] log compacted at ${timestamp}; reason=${reason}; kept the latest log tail.\n`;
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  const keepBytes = Math.max(0, maxBytes - markerBytes);
  const tail = readTailBuffer(filePath, keepBytes);
  fs.writeFileSync(filePath, Buffer.concat([Buffer.from(marker, 'utf8'), tail]));
}

function readTailBuffer(filePath: string, maxBytes: number) {
  if (maxBytes <= 0) {
    return Buffer.alloc(0);
  }
  let fd: number | null = null;
  try {
    const stat = fs.statSync(filePath);
    const length = Math.min(stat.size, maxBytes);
    const start = Math.max(0, stat.size - length);
    const buffer = Buffer.alloc(length);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, length, start);
    return buffer;
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

function tailLines(text: string, lineLimit: number) {
  const normalized = text.replace(/^\uFEFF/u, '').trimEnd();
  if (!normalized) {
    return '';
  }
  const lines = normalized.split(/\r?\n/u);
  return lines.slice(Math.max(0, lines.length - lineLimit)).join('\n');
}

function readLatestUserPrompt(entry: CodexSessionIndexEntry | null | undefined) {
  const sessionPath = normalizeEnvString(entry?.sessionPath);
  if (!sessionPath) {
    return '';
  }
  const lines = readTailText(sessionPath, 512 * 1024).split(/\r?\n/u).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index] ?? '');
      const text = extractMessageText(parsed, 'user');
      if (text) {
        return truncateText(text, 220);
      }
    } catch {
      // Ignore partial or unknown JSONL records near the tail.
    }
  }
  return '';
}

function extractMessageText(value: unknown, role: string): string {
  if (!value || typeof value !== 'object') {
    return '';
  }
  const record = value as Record<string, unknown>;
  if (String(record.role ?? '').toLowerCase() === role) {
    return compactWhitespace(collectTextFragments(record.content ?? record.text ?? record.message ?? record.input).join(' '));
  }
  for (const key of ['item', 'message', 'payload', 'event', 'data']) {
    const nested = extractMessageText(record[key], role);
    if (nested) {
      return nested;
    }
  }
  return '';
}

function parseHistoryRecord(line: string): { role: 'user' | 'assistant'; text: string; timestamp: number | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const timestamp = normalizeHistoryTimestamp((parsed as Record<string, unknown>).timestamp);
  for (const role of ['user', 'assistant'] as const) {
    const text = extractMessageText(parsed, role);
    if (text) {
      return { role, text, timestamp };
    }
  }
  return null;
}

function isEnvironmentContextText(text: string): boolean {
  const trimmed = text.trim();
  return /^<environment_context>/iu.test(trimmed) || /^<user_instructions>/iu.test(trimmed);
}

function normalizeHistoryTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function collectTextFragments(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectTextFragments(entry));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  const record = value as Record<string, unknown>;
  const fragments: string[] = [];
  for (const key of ['text', 'content', 'message', 'input']) {
    if (key in record) {
      fragments.push(...collectTextFragments(record[key]));
    }
  }
  return fragments;
}

function compactWhitespace(value: unknown) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}

function renderAdminHtml() {
  const faviconVersion = String(Date.now());
  const faviconIcoHref = `/favicon.ico?v=${faviconVersion}`;
  const faviconPngHref = `/favicon.png?v=${faviconVersion}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CodexBridge Weixin</title>
  <link rel="icon" type="image/png" href="${faviconPngHref}" />
  <link rel="icon" type="image/x-icon" href="${faviconIcoHref}" />
  <link rel="shortcut icon" href="${faviconIcoHref}" />
  <link rel="apple-touch-icon" href="${faviconPngHref}" />
  <style>
    :root {
      color-scheme: light;
      --bg: #f3f7ff;
      --panel: rgba(255, 255, 255, 0.86);
      --panel-solid: #ffffff;
      --text: #1f2533;
      --muted: #64708a;
      --line: rgba(15, 23, 42, 0.09);
      --line-strong: rgba(15, 23, 42, 0.16);
      --accent: #2563eb;
      --accent-2: #f43f5e;
      --accent-dark: #1d4ed8;
      --cyan: #06b6d4;
      --amber: #f59e0b;
      --support: #ff4d6d;
      --danger: #e11d48;
      --ok: #059669;
      --grad: linear-gradient(135deg, #2563eb 0%, #06b6d4 48%, #f43f5e 100%);
      --support-grad: linear-gradient(135deg, #ffb703 0%, #ff4d6d 48%, #8b5cf6 100%);
      --shadow: 0 22px 48px -26px rgba(37, 99, 235, 0.34), 0 8px 20px -16px rgba(15, 23, 42, 0.16);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(1100px 620px at 12% -8%, rgba(37, 99, 235, 0.16), transparent 60%),
        radial-gradient(1000px 600px at 108% 4%, rgba(244, 63, 94, 0.13), transparent 55%),
        radial-gradient(900px 720px at 50% 120%, rgba(245, 158, 11, 0.12), transparent 60%),
        var(--bg);
      background-attachment: fixed;
    }
    ::selection { background: rgba(139, 92, 246, 0.22); }
    a { color: #6d28d9; }
    header {
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.72);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      position: sticky;
      top: 0;
      z-index: 20;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.6), 0 12px 30px -22px rgba(15, 23, 42, 0.28);
    }
    .wrap {
      width: min(1680px, calc(100% - 28px));
      margin: 0 auto;
    }
    .topbar {
      min-height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 800;
      letter-spacing: 0.2px;
      background: linear-gradient(120deg, #2563eb 0%, #0891b2 42%, #f43f5e 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    main {
      padding: 24px 0 48px;
    }
    .shell {
      display: grid;
      grid-template-columns: clamp(210px, 15vw, 260px) minmax(0, 1fr);
      gap: clamp(14px, 1.4vw, 24px);
      align-items: start;
    }
    .sidebar {
      position: sticky;
      top: 86px;
      display: grid;
      gap: 12px;
      align-self: start;
    }
    .side-card {
      border: 1px solid rgba(37, 99, 235, 0.18);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.82);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .side-title {
      padding: 14px 15px 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .side-nav {
      display: grid;
      padding: 6px;
      gap: 4px;
    }
    .side-nav a {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 38px;
      border-radius: 10px;
      padding: 0 10px;
      color: var(--text);
      text-decoration: none;
      font-weight: 650;
      transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
    }
    .side-nav a.active {
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.14), rgba(6, 182, 212, 0.12));
      color: var(--accent-dark);
      box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.18);
    }
    .side-nav a:hover {
      background: rgba(37, 99, 235, 0.10);
      color: var(--accent-dark);
      transform: translateX(2px);
    }
    .side-nav a::after {
      content: "›";
      color: var(--muted);
      font-size: 18px;
      line-height: 1;
    }
    .side-support {
      padding: 14px;
      display: grid;
      gap: 10px;
      background:
        radial-gradient(120px 120px at 100% 0%, rgba(255, 183, 3, 0.24), transparent 70%),
        radial-gradient(160px 130px at 0% 100%, rgba(244, 63, 94, 0.18), transparent 70%),
        #ffffff;
    }
    .side-support strong {
      font-size: 15px;
      color: #9f1239;
    }
    .side-support span {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.6;
    }
    .content {
      display: grid;
      gap: clamp(14px, 1.4vw, 22px);
      min-width: 0;
    }
    .page-group {
      display: none;
      gap: clamp(14px, 1.4vw, 22px);
      min-width: 0;
    }
    .page-group.active {
      display: grid;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
      gap: 20px;
      align-items: start;
    }
    section {
      position: relative;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: var(--shadow);
      overflow: hidden;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
      min-width: 0;
    }
    section::before {
      content: "";
      position: absolute;
      inset: 0 0 auto 0;
      height: 3px;
      background: linear-gradient(90deg, #6366f1, #a855f7, #d946ef);
      opacity: 0.85;
    }
    section:hover { border-color: var(--line-strong); }
    section[id] {
      scroll-margin-top: 90px;
    }
    .section-head {
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
    }
    h2 {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }
    .body {
      padding: 18px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    button, input, select {
      height: 36px;
      border-radius: 9px;
      border: 1px solid var(--line-strong);
      background: #ffffff;
      color: var(--text);
      font: inherit;
      transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
    }
    input, select {
      min-width: 0;
      padding: 0 11px;
    }
    select option {
      background: #ffffff;
      color: var(--text);
    }
    button {
      padding: 0 13px;
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover {
      background: #f1f3f9;
      border-color: rgba(15, 23, 42, 0.22);
    }
    button:active { transform: translateY(1px); }
    button.primary {
      border: 0;
      background: var(--grad);
      background-size: 160% 160%;
      color: #fff;
      font-weight: 650;
      box-shadow: 0 10px 22px -8px rgba(124, 58, 237, 0.55);
    }
    button.primary:hover {
      background-position: 100% 0;
      box-shadow: 0 14px 28px -8px rgba(124, 58, 237, 0.7);
      transform: translateY(-1px);
    }
    button.support {
      border: 0;
      background: var(--support-grad);
      background-size: 160% 160%;
      color: #ffffff;
      font-weight: 800;
      box-shadow: 0 13px 26px -12px rgba(244, 63, 94, 0.75);
    }
    button.support:hover {
      background-position: 100% 0;
      box-shadow: 0 16px 32px -12px rgba(245, 158, 11, 0.6);
      transform: translateY(-1px);
    }
    button.danger {
      border-color: rgba(225, 29, 72, 0.32);
      color: #be123c;
      background: rgba(225, 29, 72, 0.07);
    }
    button.danger:hover {
      background: rgba(225, 29, 72, 0.13);
      border-color: rgba(225, 29, 72, 0.5);
    }
    button:disabled {
      opacity: 0.5;
      cursor: default;
      transform: none;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: auto;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 10px 12px;
      text-align: left;
      vertical-align: middle;
    }
    th {
      font-size: 12px;
      color: var(--muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      background: rgba(99, 102, 241, 0.05);
    }
    td {
      overflow-wrap: anywhere;
      min-width: 0;
    }
    tbody tr { transition: background 0.15s ease; }
    tbody tr:hover { background: rgba(99, 102, 241, 0.06); }
    tr:last-child td {
      border-bottom: 0;
    }
    .name-cell {
      display: grid;
      gap: 6px;
    }
    .rename-row {
      display: grid;
      grid-template-columns: minmax(150px, 1fr) auto;
      gap: 6px;
      align-items: center;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 26px;
      border-radius: 999px;
      border: 1px solid var(--line-strong);
      padding: 0 11px;
      font-size: 12px;
      color: var(--muted);
      background: #ffffff;
      width: fit-content;
      white-space: nowrap;
    }
    .pill.ok {
      border-color: rgba(5, 150, 105, 0.3);
      color: #047857;
      background: rgba(16, 185, 129, 0.10);
    }
    .pill.warn {
      border-color: rgba(217, 119, 6, 0.3);
      color: #b45309;
      background: rgba(245, 158, 11, 0.13);
    }
    .pill.ok::before, .pill.warn::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      flex: 0 0 auto;
    }
    .pill.ok::before {
      animation: pillPulse 1.8s ease-in-out infinite;
    }
    @keyframes pillPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45); }
      50% { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.06); }
    }
    .muted {
      color: var(--muted);
      font-size: 12px;
    }
    .actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .account-actions {
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      min-width: 118px;
    }
    .account-actions button {
      height: 32px;
      padding: 0 12px;
      font-size: 12.5px;
    }
    .tag-primary {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 30px;
      padding: 0 13px;
      border-radius: 999px;
      font-size: 12.5px;
      font-weight: 650;
      color: #6d28d9;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.14), rgba(217, 70, 239, 0.12));
      border: 1px solid rgba(139, 92, 246, 0.3);
      white-space: nowrap;
    }
    .account-id {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .account-id-main {
      font-weight: 650;
      overflow-wrap: anywhere;
      line-height: 1.35;
    }
    .account-id-sub {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
      line-height: 1.35;
    }
    .accounts-table th:nth-child(1), .accounts-table td:nth-child(1) { width: 26%; min-width: 230px; }
    .accounts-table th:nth-child(2), .accounts-table td:nth-child(2) { width: 20%; min-width: 180px; }
    .accounts-table th:nth-child(3), .accounts-table td:nth-child(3) { width: 26%; min-width: 220px; }
    .accounts-table th:nth-child(4), .accounts-table td:nth-child(4) { width: 12%; min-width: 110px; }
    .accounts-table th:nth-child(5), .accounts-table td:nth-child(5) { width: 16%; min-width: 132px; }
    .status-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .overview-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr);
      gap: 14px;
    }
    .chart-card {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
      background: linear-gradient(160deg, #ffffff, #f7fbff);
      min-width: 0;
    }
    .chart-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 12px;
      font-weight: 750;
    }
    .chart-title span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
    }
    .donut-wrap {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr);
      align-items: center;
      gap: 16px;
    }
    .donut {
      width: 150px;
      aspect-ratio: 1 / 1;
      border-radius: 50%;
      background: conic-gradient(var(--ok) 0deg, var(--ok) 0deg, #e5e7eb 0deg 360deg);
      display: grid;
      place-items: center;
      box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.06);
    }
    .donut::after {
      content: attr(data-label);
      width: 96px;
      aspect-ratio: 1 / 1;
      border-radius: 50%;
      background: #ffffff;
      display: grid;
      place-items: center;
      text-align: center;
      font-weight: 800;
      color: var(--text);
      box-shadow: 0 8px 18px -14px rgba(15, 23, 42, 0.45);
    }
    .legend {
      display: grid;
      gap: 8px;
    }
    .legend-row {
      display: grid;
      grid-template-columns: 10px minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      color: var(--muted);
      font-size: 12px;
    }
    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--accent);
    }
    .bar-chart {
      display: grid;
      gap: 12px;
    }
    .bar-row {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr) 54px;
      gap: 10px;
      align-items: center;
      font-size: 12px;
      color: var(--muted);
    }
    .bar-track {
      height: 12px;
      border-radius: 999px;
      overflow: hidden;
      background: #e8eef8;
    }
    .bar-fill {
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: var(--grad);
      transition: width 0.25s ease;
    }
    .mini-grid {
      display: grid;
      gap: 10px;
    }
    .progress-row {
      display: grid;
      gap: 6px;
    }
    .progress-meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      color: var(--muted);
      font-size: 12px;
    }
    .progress-track {
      height: 10px;
      border-radius: 999px;
      background: #e8eef8;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: linear-gradient(90deg, #2563eb, #06b6d4);
      transition: width 0.25s ease;
    }
    .account-bars {
      display: grid;
      gap: 10px;
    }
    .account-bar-row {
      display: grid;
      gap: 5px;
    }
    .account-bar-meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 12px;
      color: var(--muted);
    }
    .account-bar-track {
      height: 9px;
      border-radius: 999px;
      background: #edf2fb;
      overflow: hidden;
    }
    .account-bar-fill {
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: linear-gradient(90deg, #f59e0b, #f43f5e);
    }
    .metric {
      position: relative;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px 14px;
      background: linear-gradient(160deg, #ffffff, #f5f6fd);
      min-height: 78px;
      overflow: hidden;
    }
    .metric::after {
      content: "";
      position: absolute;
      right: -22px;
      top: -22px;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(6, 182, 212, 0.20), transparent 70%);
    }
    .metric-label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
    }
    .metric-value {
      position: relative;
      font-size: 19px;
      font-weight: 750;
      overflow-wrap: anywhere;
    }
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      align-items: end;
    }
    .provider-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .provider-span {
      grid-column: span 2;
    }
    .readonly-line {
      min-height: 36px;
      display: flex;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 9px;
      padding: 0 11px;
      background: #f6f7fb;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .update-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
      margin-top: 16px;
    }
    .diagnostics-list {
      display: grid;
      gap: 12px;
      margin-top: 14px;
    }
    .diagnostic-card {
      display: grid;
      gap: 10px;
      padding: 14px;
      border: 1px solid var(--line);
      border-left: 5px solid #64748b;
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 12px 24px -22px rgba(15, 23, 42, 0.35);
    }
    .diagnostic-card.ok { border-left-color: #059669; }
    .diagnostic-card.warn { border-left-color: #f59e0b; }
    .diagnostic-card.fail { border-left-color: #e11d48; }
    .diagnostic-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }
    .diagnostic-title {
      font-size: 15px;
      font-weight: 750;
    }
    .diagnostic-detail {
      color: #334155;
      line-height: 1.6;
      overflow-wrap: anywhere;
    }
    .diagnostic-reason {
      color: var(--muted);
      line-height: 1.6;
      overflow-wrap: anywhere;
    }
    .diagnostic-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .release-notes {
      min-height: 140px;
      max-height: 260px;
      overflow: auto;
      margin: 12px 0 0;
      padding: 13px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #f8fafc;
      color: #334155;
      font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .field {
      display: grid;
      gap: 5px;
    }
    .field label {
      color: var(--muted);
      font-size: 12px;
    }
    .log-summary {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .qr-box {
      min-height: 260px;
      display: grid;
      place-items: center;
      border: 1px dashed var(--line-strong);
      border-radius: 12px;
      background: #f6f7fb;
      margin-bottom: 12px;
      padding: 16px;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .qr-box.clickable {
      cursor: pointer;
    }
    .qr-box.clickable:hover {
      border-color: var(--accent);
      background: rgba(99, 102, 241, 0.06);
    }
    .qr-box img {
      width: min(260px, 100%);
      aspect-ratio: 1 / 1;
      object-fit: contain;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 8px;
      box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.12), 0 14px 30px -12px rgba(124, 58, 237, 0.35);
    }
    .qr-form {
      display: grid;
      gap: 10px;
    }
    .qr-buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .status-line {
      min-height: 20px;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .filter-row {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) minmax(150px, 190px) minmax(140px, 170px) auto;
      gap: 8px;
      margin-bottom: 12px;
    }
    .session-title {
      font-weight: 650;
    }
    .session-preview {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
    }
    .log-box {
      min-height: 220px;
      max-height: 420px;
      overflow: auto;
      margin: 0;
      padding: 14px;
      border: 1px solid rgba(15, 23, 42, 0.18);
      border-radius: 12px;
      background: #0d1426;
      color: #d7def0;
      font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 14px 30px -20px rgba(15, 23, 42, 0.55);
    }
    .export-row {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    .import-row {
      display: grid;
      grid-template-columns: minmax(280px, 1fr) auto minmax(260px, 1fr);
      gap: 10px;
      align-items: center;
      margin-top: 12px;
    }
    .file-picker {
      position: relative;
      min-height: 56px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fff;
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
      overflow: hidden;
    }
    .file-picker:hover {
      border-color: var(--accent);
      box-shadow: 0 10px 22px -16px rgba(99, 102, 241, 0.8);
      transform: translateY(-1px);
    }
    .file-picker:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
    }
    .file-picker input[type="file"] {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      cursor: pointer;
    }
    .file-picker-icon {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 46px;
      height: 32px;
      border-radius: 8px;
      background: rgba(99, 102, 241, 0.1);
      color: var(--accent-dark);
      font-size: 12px;
      font-weight: 800;
    }
    .file-picker-copy {
      min-width: 0;
      display: grid;
      gap: 2px;
    }
    .file-picker-title {
      font-weight: 750;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .file-picker-meta {
      color: var(--muted);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    input:focus, select:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
      background: #ffffff;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 11px;
    }
    .brand img {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      flex: 0 0 auto;
      box-shadow: 0 6px 16px -4px rgba(124, 58, 237, 0.45);
    }
    .promo {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      padding: 16px 18px;
      border: 1px solid rgba(139, 92, 246, 0.28);
      border-radius: 14px;
      background:
        radial-gradient(120% 140% at 0% 0%, rgba(99, 102, 241, 0.14), transparent 55%),
        radial-gradient(120% 160% at 100% 0%, rgba(217, 70, 239, 0.12), transparent 55%),
        #ffffff;
      box-shadow: 0 16px 34px -20px rgba(124, 58, 237, 0.5);
      overflow: hidden;
    }
    .promo-text {
      display: grid;
      gap: 4px;
      min-width: 220px;
    }
    .promo-title {
      font-weight: 800;
      font-size: 15px;
      color: #4c1d95;
      letter-spacing: 0.2px;
    }
    .promo-sub {
      color: #6f63a6;
      font-size: 12px;
    }
    .promo-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .promo .promo-link {
      display: inline-flex;
      align-items: center;
      height: 36px;
      padding: 0 16px;
      border-radius: 9px;
      background: var(--grad);
      background-size: 160% 160%;
      color: #fff;
      text-decoration: none;
      font-weight: 700;
      white-space: nowrap;
      animation: promoGlow 2.4s ease-in-out infinite;
    }
    .promo .promo-link:hover {
      background-position: 100% 0;
      transform: translateY(-1px);
    }
    @keyframes promoGlow {
      0%, 100% { box-shadow: 0 6px 16px -6px rgba(139, 92, 246, 0.45); }
      50% { box-shadow: 0 10px 24px -4px rgba(139, 92, 246, 0.6); }
    }
    .help-line {
      margin-top: 14px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.6;
    }
    .help-line a {
      color: #6d28d9;
      text-decoration: none;
    }
    .help-line a:hover {
      text-decoration: underline;
    }
    .subsection-title {
      margin: 20px 0 10px;
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
    }
    .subsection-title:first-child { margin-top: 0; }
    .webhook-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .webhook-row input { flex: 1; }
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(3px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      z-index: 50;
    }
    .modal-overlay[hidden] { display: none; }
    .modal-card {
      width: min(820px, 100%);
      max-height: calc(100vh - 64px);
      display: flex;
      flex-direction: column;
      background: var(--panel-solid);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
    }
    .modal-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 18px;
      border-bottom: 1px solid var(--line);
    }
    .modal-toolbar input { flex: 1; }
    .history-body {
      padding: 16px 18px;
      overflow: auto;
      display: grid;
      gap: 10px;
    }
    .history-msg {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 12px;
    }
    .history-msg.user {
      background: rgba(99, 102, 241, 0.06);
      border-color: rgba(99, 102, 241, 0.22);
    }
    .history-msg.assistant {
      background: #f6f7fb;
    }
    .history-meta {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    .history-role {
      font-weight: 650;
      color: var(--text);
    }
    .history-text {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.55;
    }
    .donate-body {
      padding: 18px;
      display: grid;
      gap: 12px;
      justify-items: center;
      text-align: center;
      background:
        radial-gradient(220px 160px at 0% 0%, rgba(255, 183, 3, 0.20), transparent 70%),
        radial-gradient(240px 180px at 100% 20%, rgba(244, 63, 94, 0.16), transparent 70%),
        #ffffff;
    }
    .donate-body img {
      width: min(320px, 78vw);
      aspect-ratio: 1 / 1;
      object-fit: contain;
      border-radius: 20px;
      border: 1px solid rgba(244, 63, 94, 0.24);
      background: #ffffff;
      padding: 10px;
      box-shadow: 0 24px 50px -30px rgba(244, 63, 94, 0.9), 0 0 0 5px rgba(255, 183, 3, 0.13);
    }
    .donate-note {
      color: #9f1239;
      font-size: 13px;
      line-height: 1.6;
      font-weight: 650;
    }
    .setup-card {
      width: min(920px, 100%);
    }
    .setup-progress {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      background: #f8fbff;
    }
    .setup-step-tab {
      height: 42px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: #ffffff;
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
      cursor: pointer;
    }
    .setup-step-tab.active {
      border-color: rgba(37, 99, 235, 0.35);
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.14), rgba(6, 182, 212, 0.12));
      color: var(--accent-dark);
      box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.12);
    }
    .setup-body {
      padding: 18px;
      overflow: auto;
      display: grid;
      gap: 16px;
    }
    .setup-step {
      display: none;
      gap: 14px;
    }
    .setup-step.active {
      display: grid;
    }
    .setup-intro {
      display: grid;
      gap: 6px;
      padding: 14px 16px;
      border: 1px solid rgba(37, 99, 235, 0.18);
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(6, 182, 212, 0.08));
    }
    .setup-intro strong {
      font-size: 16px;
    }
    .setup-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .setup-info {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px;
      background: #ffffff;
      display: grid;
      gap: 5px;
    }
    .setup-info span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .setup-info code {
      display: block;
      color: var(--text);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .setup-checks {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .setup-check {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 13px;
      background: #ffffff;
      display: grid;
      gap: 6px;
    }
    .setup-check.ok {
      border-color: rgba(5, 150, 105, 0.25);
      background: rgba(5, 150, 105, 0.05);
    }
    .setup-check.warn {
      border-color: rgba(245, 158, 11, 0.30);
      background: rgba(245, 158, 11, 0.06);
    }
    .setup-check-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-weight: 800;
    }
    .setup-check-detail {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.6;
      overflow-wrap: anywhere;
    }
    .setup-actions {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 14px 18px;
      border-top: 1px solid var(--line);
      background: #ffffff;
    }
    .setup-actions .toolbar {
      justify-content: flex-end;
    }
    .setup-qr-box {
      min-height: 280px;
    }
    .setup-test-card {
      border: 1px solid rgba(5, 150, 105, 0.24);
      border-radius: 12px;
      padding: 16px;
      background: rgba(5, 150, 105, 0.06);
      display: grid;
      gap: 10px;
    }
    .setup-test-card strong {
      color: #065f46;
    }
    .doc-hero {
      display: grid;
      gap: 12px;
      padding: 20px;
      border: 1px solid rgba(37, 99, 235, 0.16);
      border-radius: 14px;
      background:
        linear-gradient(135deg, rgba(37, 99, 235, 0.10), rgba(6, 182, 212, 0.08) 48%, rgba(244, 63, 94, 0.08)),
        #ffffff;
    }
    .doc-hero h3 {
      margin: 0;
      font-size: 20px;
      line-height: 1.25;
    }
    .doc-hero p {
      margin: 0;
      color: var(--muted);
      max-width: 920px;
    }
    .doc-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-top: 16px;
    }
    .doc-card {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 16px;
      background: #ffffff;
      display: grid;
      gap: 10px;
    }
    .doc-card.wide {
      grid-column: 1 / -1;
    }
    .doc-card h3 {
      margin: 0;
      font-size: 15px;
    }
    .doc-card p,
    .doc-card li {
      color: #465269;
    }
    .doc-card p {
      margin: 0;
    }
    .doc-card ol,
    .doc-card ul {
      margin: 0;
      padding-left: 20px;
    }
    .doc-card li + li {
      margin-top: 6px;
    }
    .command-table {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 12px;
    }
    .command-row {
      display: grid;
      grid-template-columns: minmax(190px, 0.34fr) minmax(0, 1fr);
      gap: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      align-items: start;
    }
    .command-row:last-child {
      border-bottom: 0;
    }
    .command-row code,
    .doc-code code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: #0f172a;
      overflow-wrap: anywhere;
    }
    .command-row span {
      color: #4b5568;
    }
    .doc-code {
      display: grid;
      gap: 6px;
      padding: 12px;
      border-radius: 12px;
      background: #f5f7fb;
      border: 1px solid var(--line);
    }
    .download-links {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .download-links a {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid rgba(37, 99, 235, 0.18);
      border-radius: 10px;
      background: rgba(37, 99, 235, 0.07);
      color: var(--accent-dark);
      text-decoration: none;
      font-weight: 750;
    }
    @media (max-width: 1240px) {
      .accounts-table,
      .accounts-table thead,
      .accounts-table tbody,
      .accounts-table tr,
      .accounts-table th,
      .accounts-table td {
        display: block;
      }
      .accounts-table thead {
        display: none;
      }
      .accounts-table tr {
        display: grid;
        grid-template-columns: minmax(260px, 1.2fr) minmax(210px, 1fr) minmax(220px, 1fr);
        gap: 12px;
        padding: 16px 18px;
        border-bottom: 1px solid var(--line);
      }
      .accounts-table td {
        width: auto !important;
        min-width: 0 !important;
        padding: 0;
        border-bottom: 0;
      }
      .accounts-table td::before {
        content: attr(data-label);
        display: block;
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 5px;
      }
      .accounts-table td:nth-child(1) {
        grid-row: span 2;
      }
      .accounts-table td:nth-child(5) {
        grid-column: 3;
        grid-row: 1 / span 2;
      }
      .accounts-table .account-actions {
        min-width: 0;
      }
    }
    @media (max-width: 1080px) {
      .shell {
        grid-template-columns: 1fr;
      }
      .sidebar {
        position: static;
      }
      .side-nav {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      .side-nav a::after {
        content: "";
      }
      .overview-grid {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 860px) {
      .grid {
        grid-template-columns: 1fr;
      }
      .topbar {
        align-items: flex-start;
        flex-direction: column;
        padding: 14px 0;
      }
      .filter-row {
        grid-template-columns: 1fr;
      }
      .import-row {
        grid-template-columns: 1fr;
      }
      .status-grid,
      .settings-grid {
        grid-template-columns: 1fr;
      }
      .side-nav {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .accounts-table tr {
        grid-template-columns: 1fr;
      }
      .accounts-table td:nth-child(1),
      .accounts-table td:nth-child(5) {
        grid-column: auto;
        grid-row: auto;
      }
      .rename-row {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .donut-wrap {
        grid-template-columns: 1fr;
        justify-items: center;
      }
      .bar-row {
        grid-template-columns: 76px minmax(0, 1fr) 44px;
      }
      .provider-span {
        grid-column: auto;
      }
      .setup-progress,
      .setup-grid,
      .setup-checks,
      .doc-grid {
        grid-template-columns: 1fr;
      }
      .command-row {
        grid-template-columns: 1fr;
      }
      table, thead, tbody, tr, th, td {
        display: block;
      }
      thead {
        display: none;
      }
      tr {
        border-bottom: 1px solid var(--line);
      }
      td {
        border-bottom: 0;
      }
      td::before {
        content: attr(data-label);
        display: block;
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 4px;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap topbar">
      <div class="brand">
        <img src="/favicon.png" alt="" />
        <h1>CodexBridge Weixin 管理面板</h1>
      </div>
      <div class="toolbar">
        <span class="pill" id="service-state">加载中</span>
        <button id="bridge-start">启动微信桥接</button>
        <button id="bridge-restart">重启微信桥接</button>
        <button class="danger" id="bridge-stop">停止微信桥接</button>
        <button id="setup-open">配置向导</button>
        <button class="support" id="donate-open">支持项目</button>
        <button id="refresh-btn">刷新列表</button>
      </div>
    </div>
  </header>
  <main class="wrap">
    <div class="shell">
      <aside class="sidebar">
        <div class="side-card">
          <div class="side-title">导航</div>
          <nav class="side-nav" aria-label="管理面板分区">
            <a class="active" href="#overview" data-page="overview">数据概览</a>
            <a href="#users" data-page="users">用户入口</a>
            <a href="#runtime" data-page="runtime">运行状态</a>
            <a href="#diagnostics" data-page="diagnostics">诊断修复</a>
            <a href="#metrics" data-page="metrics">用量统计</a>
            <a href="#settings" data-page="settings">运行配置</a>
            <a href="#updates" data-page="updates">软件更新</a>
            <a href="#provider" data-page="provider">模型供应商</a>
            <a href="#phone-guide" data-page="phone-guide">手机使用 Codex</a>
            <a href="#sessions" data-page="sessions">会话管理</a>
            <a href="#logs" data-page="logs">运行日志</a>
            <a href="#backup" data-page="backup">备份恢复</a>
          </nav>
        </div>
        <div class="side-card side-support">
          <strong>支持项目</strong>
          <span>觉得这个工具顺手的话，可以点开收款码支持一下，后续维护也更有动力。</span>
          <button class="support" id="donate-open-side">打开收款码</button>
        </div>
      </aside>
      <div class="content">
    <div class="page-group active" data-page-panel="overview">
    <section id="overview">
      <div class="section-head">
        <h2>数据概览</h2>
        <span class="muted" id="overview-updated">等待数据</span>
      </div>
      <div class="body">
        <div class="overview-grid">
          <div class="chart-card">
            <div class="chart-title">回复健康度 <span id="delivery-rate-label">-</span></div>
            <div class="donut-wrap">
              <div class="donut" id="delivery-donut" data-label="-"></div>
              <div class="legend">
                <div class="legend-row"><span class="legend-dot" style="background:#059669"></span><span>投递成功</span><strong id="chart-delivery-success">0</strong></div>
                <div class="legend-row"><span class="legend-dot" style="background:#e11d48"></span><span>投递失败</span><strong id="chart-delivery-failed">0</strong></div>
                <div class="legend-row"><span class="legend-dot" style="background:#f59e0b"></span><span>待补发</span><strong id="chart-delivery-pending">0</strong></div>
              </div>
            </div>
          </div>
          <div class="chart-card mini-grid">
            <div class="chart-title">并发占用 <span id="chart-concurrency-label">-</span></div>
            <div class="progress-row">
              <div class="progress-meta"><span>回复回合</span><strong id="chart-turns-active-label">0 / 0</strong></div>
              <div class="progress-track"><div class="progress-fill" id="chart-turns-active-fill"></div></div>
            </div>
            <div class="progress-row">
              <div class="progress-meta"><span>事件分发</span><strong id="chart-events-label">0</strong></div>
              <div class="progress-track"><div class="progress-fill" id="chart-events-fill"></div></div>
            </div>
            <div class="progress-row">
              <div class="progress-meta"><span>账号轮询</span><strong id="chart-poll-label">0</strong></div>
              <div class="progress-track"><div class="progress-fill" id="chart-poll-fill"></div></div>
            </div>
          </div>
          <div class="chart-card">
            <div class="chart-title">核心数据 <span>累计</span></div>
            <div class="bar-chart" id="metrics-bars"></div>
          </div>
          <div class="chart-card">
            <div class="chart-title">账号活跃度 <span id="account-bars-summary">暂无数据</span></div>
            <div class="account-bars" id="account-bars"></div>
          </div>
        </div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="users">
    <div class="grid">
      <section id="users">
        <div class="section-head">
          <h2>已添加用户</h2>
          <span class="muted" id="account-count"></span>
        </div>
        <div class="table-wrap">
          <table class="accounts-table">
            <thead>
              <tr>
                <th style="width: 26%">名称</th>
                <th style="width: 21%">账号</th>
                <th style="width: 20%">用户</th>
                <th style="width: 13%">状态</th>
                <th style="width: 20%">操作</th>
              </tr>
            </thead>
            <tbody id="accounts-body"></tbody>
          </table>
        </div>
      </section>

      <section id="pairing">
        <div class="section-head">
          <h2>添加朋友</h2>
          <span class="pill" id="pairing-status">未生成</span>
        </div>
        <div class="body">
          <div class="qr-box clickable" id="qr-box" title="点击生成二维码" role="button" tabindex="0">
            <span class="muted">点击生成二维码</span>
          </div>
          <div class="qr-form">
            <input id="display-name" placeholder="备注名，可不填" />
            <div class="qr-buttons">
              <button class="primary" id="start-pairing">生成二维码</button>
              <button id="refresh-pairing">刷新二维码</button>
              <button id="cancel-pairing">取消</button>
            </div>
            <div class="status-line" id="qr-link"></div>
            <div class="status-line" id="message"></div>
          </div>
        </div>
      </section>
    </div>
    </div>

    <div class="page-group" data-page-panel="runtime">
    <section id="runtime">
      <div class="section-head">
        <h2>运行状态</h2>
        <span class="muted" id="status-updated"></span>
      </div>
      <div class="body">
        <div class="status-grid">
          <div class="metric">
            <div class="metric-label">当前回合</div>
            <div class="metric-value" id="metric-turns">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">事件分发</div>
            <div class="metric-value" id="metric-events">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">微信账号</div>
            <div class="metric-value" id="metric-accounts">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">最近错误</div>
            <div class="metric-value" id="metric-error">-</div>
          </div>
        </div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="diagnostics">
    <section id="diagnostics">
      <div class="section-head">
        <h2>一键诊断 / 修复</h2>
        <div class="toolbar">
          <span class="muted" id="diagnostics-updated">等待检查</span>
          <button class="primary" id="diagnostics-run">开始诊断</button>
        </div>
      </div>
      <div class="body">
        <div class="status-grid">
          <div class="metric">
            <div class="metric-label">总体状态</div>
            <div class="metric-value" id="diagnostics-summary-status">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">通过</div>
            <div class="metric-value" id="diagnostics-summary-ok">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">提醒</div>
            <div class="metric-value" id="diagnostics-summary-warn">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">需处理</div>
            <div class="metric-value" id="diagnostics-summary-fail">-</div>
          </div>
        </div>
        <div class="help-line" id="diagnostics-summary-text">点击“开始诊断”后，会检查服务运行、微信入口、API key、模型接口、端口和 Codex Native API。</div>
        <div class="diagnostics-list" id="diagnostics-list"></div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="metrics">
    <section id="metrics">
      <div class="section-head">
        <h2>用量统计</h2>
        <div class="toolbar">
          <span class="muted" id="metrics-uptime"></span>
          <button id="metrics-reset">清零统计</button>
        </div>
      </div>
      <div class="body">
        <div class="status-grid">
          <div class="metric">
            <div class="metric-label">收到消息</div>
            <div class="metric-value" id="metric-messages">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">完成回合 / 失败</div>
            <div class="metric-value" id="metric-turns-done">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">投递成功 / 失败</div>
            <div class="metric-value" id="metric-deliveries">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">当前错误状态</div>
            <div class="metric-value" id="metric-current-error">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">最近 1 小时错误</div>
            <div class="metric-value" id="metric-errors-hour">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">后台错误累计</div>
            <div class="metric-value" id="metric-errors-total">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">轮询错误 / 运行错误</div>
            <div class="metric-value" id="metric-error-breakdown">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">真正回复失败</div>
            <div class="metric-value" id="metric-reply-failures">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">平均回合耗时</div>
            <div class="metric-value" id="metric-avg-turn">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">最近回合耗时</div>
            <div class="metric-value" id="metric-last-turn">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">进行中 / 排队回合</div>
            <div class="metric-value" id="metric-active-turns">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">待补发消息</div>
            <div class="metric-value" id="metric-pending">-</div>
          </div>
        </div>
        <div class="help-line" id="metrics-error-detail">统计随服务重启保留；清零统计只清数字，不会删除会话、账号或日志。</div>
        <h3 class="subsection-title">按账号</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width: 40%">账号</th>
                <th style="width: 20%">收到消息</th>
                <th style="width: 20%">完成 / 失败回合</th>
                <th style="width: 20%">平均回合耗时</th>
              </tr>
            </thead>
            <tbody id="metrics-by-account-body"></tbody>
          </table>
        </div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="settings">
    <section id="settings">
      <div class="section-head">
        <h2>运行配置</h2>
        <span class="muted" id="settings-message"></span>
      </div>
      <div class="body">
        <div class="settings-grid">
          <div class="field">
            <label for="max-concurrent-turns">最大同时回复数</label>
            <input id="max-concurrent-turns" type="number" min="1" max="64" step="1" />
          </div>
          <div class="field">
            <label for="event-dispatch-concurrency">事件分发并发</label>
            <input id="event-dispatch-concurrency" type="number" min="1" max="64" step="1" />
          </div>
          <div class="field">
            <label for="attachment-concurrency">附件处理并发</label>
            <input id="attachment-concurrency" type="number" min="1" max="64" step="1" />
          </div>
          <div class="field">
            <label for="account-poll-concurrency">账号轮询并发</label>
            <input id="account-poll-concurrency" type="number" min="1" max="64" step="1" />
          </div>
          <div class="field">
            <label for="log-retention-days">日志保留天数</label>
            <input id="log-retention-days" type="number" min="1" max="365" step="1" />
          </div>
          <div class="field">
            <label for="log-max-mb">单个日志最大 MB</label>
            <input id="log-max-mb" type="number" min="1" max="1024" step="1" />
          </div>
          <div class="field">
            <label for="log-cleanup-interval">清理间隔分钟</label>
            <input id="log-cleanup-interval" type="number" min="1" max="1440" step="1" />
          </div>
          <div class="field provider-span">
            <label for="alert-webhook-url">错误告警 Webhook（留空关闭，出错时 POST 通知）</label>
            <div class="webhook-row">
              <input id="alert-webhook-url" autocomplete="off" placeholder="https://..." />
              <button id="alert-test">测试</button>
            </div>
          </div>
          <div class="actions">
            <button class="primary" id="settings-save">保存配置</button>
          </div>
        </div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="updates">
    <section id="updates">
      <div class="section-head">
        <h2>软件更新</h2>
        <span class="muted" id="update-message"></span>
      </div>
      <div class="body">
        <div class="status-grid">
          <div class="metric">
            <div class="metric-label">当前版本</div>
            <div class="metric-value" id="update-current-version">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">最新版本</div>
            <div class="metric-value" id="update-latest-version">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">更新状态</div>
            <div class="metric-value" id="update-status-label">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">上次检查</div>
            <div class="metric-value" id="update-last-checked">-</div>
          </div>
        </div>
        <div class="progress-row">
          <div class="progress-meta">
            <span>下载进度</span>
            <strong id="update-progress-label">-</strong>
          </div>
          <div class="progress-track"><div class="progress-fill" id="update-progress-fill"></div></div>
        </div>
        <div class="update-actions">
          <button class="primary" id="update-check">检查更新</button>
          <button id="update-download">下载更新</button>
          <button class="danger" id="update-install">重启安装</button>
        </div>
        <div class="help-line">启动安装版时会自动检查更新。发现新版本后不会强制安装，需要你确认下载和重启安装；配置、API key、微信会话数据会保留在本机数据目录。</div>
        <h3 class="subsection-title">更新日志</h3>
        <pre class="release-notes" id="update-release-notes">暂无更新日志。</pre>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="provider">
    <section id="provider">
      <div class="section-head">
        <h2>模型供应商</h2>
        <span class="muted" id="provider-message"></span>
      </div>
      <div class="body">
        <div class="promo">
          <div class="promo-text">
            <span class="promo-title">推荐中转站 · Z Token</span>
            <span class="promo-sub">一个 key 直连 GPT-5.5 / GPT-5.4 等模型 · 支持 Claude Code · 免代理 · 按量计费 · 接口地址已自动填好</span>
          </div>
          <div class="promo-actions">
            <a class="promo-link" href="https://ztoken.app/register?aff=8M7CSMLY5J77" target="_blank" rel="noopener">前往 ztoken.app</a>
            <button id="promo-copy">复制链接</button>
          </div>
        </div>
        <div class="settings-grid provider-grid">
          <div class="field">
            <label for="provider-preset">供应商预设</label>
            <select id="provider-preset">
              <option value="default">OpenAI</option>
              <option value="claude-code">Claude Code</option>
              <option value="deepseek">DeepSeek</option>
              <option value="qwen">Qwen</option>
              <option value="openrouter">OpenRouter</option>
              <option value="kimi">Kimi</option>
              <option value="gemini">Gemini</option>
              <option value="minimax">MiniMax</option>
              <option value="iflow">iFlow</option>
            </select>
          </div>
          <div class="field">
            <label for="provider-source">配置来源</label>
            <select id="provider-source">
              <option value="manual">手动填写</option>
              <option value="ccswitch">跟随 CCSwitch / Codex 当前配置</option>
            </select>
          </div>
          <div class="field">
            <label for="provider-name">供应商名称</label>
            <input id="provider-name" autocomplete="off" />
          </div>
          <div class="field">
            <label for="provider-model">模型</label>
            <select id="provider-model"></select>
            <input id="provider-model-custom" autocomplete="off" placeholder="自定义模型名称" style="display:none;" />
          </div>
          <div class="field">
            <label for="provider-api-key">API key</label>
            <input id="provider-api-key" type="password" autocomplete="off" placeholder="不填写则保留当前 key" />
          </div>
          <div class="field provider-span">
            <label for="provider-base-url">接口地址 Base URL</label>
            <input id="provider-base-url" autocomplete="off" />
          </div>
          <div class="field provider-span">
            <label>当前 key</label>
            <div class="readonly-line" id="provider-key-status">-</div>
          </div>
          <div class="field provider-span">
            <label for="provider-env-file">配置文件</label>
            <input id="provider-env-file" autocomplete="off" placeholder="例如 D:\\IT_learn\\codex_weixin\\CodexBridge\\weixin.service.env" />
          </div>
          <div class="field provider-span">
            <label for="provider-ccswitch-home">CCSwitch / Codex Home</label>
            <input id="provider-ccswitch-home" autocomplete="off" placeholder="默认使用当前用户的 .codex 目录" />
          </div>
          <div class="field">
            <label for="provider-ccswitch-interval">自动同步间隔（秒）</label>
            <input id="provider-ccswitch-interval" type="number" min="2" max="60" step="1" />
          </div>
          <div class="field">
            <label>CCSwitch 同步状态</label>
            <div class="readonly-line" id="provider-ccswitch-status">-</div>
          </div>
          <div class="actions">
            <button class="primary" id="provider-save">保存模型配置</button>
            <button id="provider-ccswitch-sync">立即同步 CCSwitch</button>
          </div>
        </div>
        <div class="help-line">
          没有 API key？可在 <a href="https://ztoken.app/register?aff=8M7CSMLY5J77" target="_blank" rel="noopener">ztoken.app</a> 注册中转站获取（OpenAI 兼容接口，支持 GPT-5.5 / GPT-5.4，也可选择 Claude Code 预设）。API key 留空表示保留当前已保存的 key。
        </div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="phone-guide">
    <section id="phone-guide">
      <div class="section-head">
        <h2>手机使用 Codex 详细文档</h2>
        <span class="muted">微信聊天、项目控制、上传图片、会话管理和常用命令</span>
      </div>
      <div class="body">
        <div class="doc-card wide">
          <h3>完整使用流程</h3>
          <p>手机使用 Codex 的核心逻辑是：微信消息先进入本机 CodexBridge 服务，再交给电脑上的 Codex 和模型处理，最后把最终结果发回微信。因此电脑必须保持开机、联网，并且本软件正在运行。</p>
          <ol>
            <li>双击打开 <strong>CodexBridge Weixin Admin</strong>，等待顶部状态显示服务正常。</li>
            <li>进入“模型供应商”，选择配置来源：手动填写 API key，或跟随 CCSwitch / Codex 当前配置。</li>
            <li>进入“用户入口”，生成微信登录二维码或朋友入口二维码，用微信扫码确认。</li>
            <li>在微信里发送 <code>你好</code> 测试普通聊天；发送 <code>/status</code> 查看当前会话、模型、权限和连接状态。</li>
            <li>如果要让手机控制电脑项目，先发送 <code>/project D:\\你的项目路径</code>，再发送具体任务。</li>
          </ol>
          <p>第一次使用建议先只测试普通聊天；确认能正常回复后，再开启项目控制和文件修改权限。</p>
        </div>

        <div class="doc-grid">
          <div class="doc-card">
            <h3>手机能做什么</h3>
            <ul>
              <li>像普通聊天一样向 Codex 提问，并把最终答案发回微信。</li>
              <li>让 Codex 在电脑项目目录里读代码、改文件、运行测试和总结结果。</li>
              <li>连续发送多张截图或多个文件，最后用一句提示词统一分析。</li>
              <li>在手机上新建会话、查找历史会话、按名字切换会话、重命名会话。</li>
              <li>在需要执行命令或修改文件时，通过 <code>/allow</code> 和 <code>/deny</code> 审批。</li>
            </ul>
          </div>

          <div class="doc-card">
            <h3>手机不能脱离电脑</h3>
            <ul>
              <li>电脑关机、睡眠、断网或软件退出后，微信端不能继续调用本地 Codex。</li>
              <li>朋友扫码后也使用的是你这台电脑上的服务、API key 和数据目录。</li>
              <li>如果 API key 没额度、provider 不可用或模型接口报错，微信端也会失败。</li>
              <li>如果二维码过期，需要重新生成；看到 <code>expired</code> 就代表旧二维码不能用了。</li>
            </ul>
          </div>

          <div class="doc-card wide">
            <h3>手机控制项目：推荐写法</h3>
            <p>先指定项目目录，再发送任务。任务最好包含：目标、范围、验证方式、输出要求。</p>
            <div class="doc-code">
              <code>/project D:\\IT_learn\\codex_weixin\\CodexBridge</code>
              <code>请检查为什么管理面板打不开。先定位原因，再修复；只改必要文件；修复后运行相关测试；最后只告诉我根因、修改文件和测试结果。</code>
            </div>
            <ul>
              <li><code>/project</code> 查看当前项目目录、默认目录和权限状态。</li>
              <li><code>/project on</code> 使用当前会话或默认目录开启项目控制。</li>
              <li><code>/project D:\\path</code> 指定电脑项目目录。</li>
              <li><code>/project cancel</code> 取消还没开始的项目控制会话。</li>
            </ul>
          </div>

          <div class="doc-card">
            <h3>审批和权限</h3>
            <p>当 Codex 需要改文件、运行命令或做高风险操作时，微信里可能会出现审批请求。</p>
            <div class="doc-code">
              <code>/allow</code>
              <code>/allow 1</code>
              <code>/allow 2</code>
              <code>/deny</code>
            </div>
            <ul>
              <li><code>/allow</code> 查看当前等待审批的请求。</li>
              <li><code>/allow 1</code> 单次批准第 1 个请求。</li>
              <li><code>/allow 2</code> 批准并在当前会话记住类似请求。</li>
              <li><code>/deny</code> 拒绝当前审批请求。</li>
            </ul>
          </div>

          <div class="doc-card">
            <h3>权限模式怎么选</h3>
            <div class="doc-code">
              <code>/permissions</code>
              <code>/permissions default-permissions</code>
              <code>/permissions auto-review</code>
              <code>/permissions full-access</code>
            </div>
            <ul>
              <li>新手优先用 <code>default-permissions</code>，工作区内可写，高风险操作会询问。</li>
              <li><code>auto-review</code> 会让审查代理辅助处理部分审批。</li>
              <li><code>full-access</code> 风险更高，只在你明确知道任务需要时使用。</li>
            </ul>
          </div>

          <div class="doc-card wide">
            <h3>图片和文件：多张一起发</h3>
            <p>需要连续发多张图片、截图或文件时，先开启上传模式。图片会先暂存，直到你发送文字提示词后才统一交给 Codex。</p>
            <div class="doc-code">
              <code>/up</code>
              <code>连续发送图片或文件</code>
              <code>请结合刚才所有截图，判断为什么服务启动失败，并给我按步骤排查。</code>
            </div>
            <ul>
              <li><code>/up</code> 开启上传暂存模式。</li>
              <li><code>/up status</code> 查看已经暂存的图片和文件。</li>
              <li><code>/up cancel</code> 取消本次上传模式并清空暂存。</li>
              <li>只发送图片通常不会立刻回答；发送文字说明后才开始处理。</li>
            </ul>
          </div>

          <div class="doc-card wide">
            <h3>会话管理：让历史对话好找</h3>
            <div class="command-table">
              <div class="command-row"><code>/new</code><span>准备新会话；发送下一条普通内容后才真正创建，避免空会话。</span></div>
              <div class="command-row"><code>/threads</code><span>查看历史会话列表，当前会话前面会有醒目标识。</span></div>
              <div class="command-row"><code>/next /prev</code><span>查看历史会话下一页或上一页，需要先用 <code>/threads</code> 或 <code>/search</code>。</span></div>
              <div class="command-row"><code>/search 项目学习</code><span>搜索标题或内容里包含关键词的会话。</span></div>
              <div class="command-row"><code>/open 2</code><span>打开当前列表第 2 个会话。</span></div>
              <div class="command-row"><code>/open 项目学习</code><span>按名字打开会话；如果重名，建议先搜索再按序号打开。</span></div>
              <div class="command-row"><code>/peek 2</code><span>预览第 2 个会话最近内容，但不切换。</span></div>
              <div class="command-row"><code>/rename this 项目学习</code><span>给当前会话改名。</span></div>
              <div class="command-row"><code>/rename 2 项目学习</code><span>给当前列表第 2 个会话改名。</span></div>
              <div class="command-row"><code>/threads del 2</code><span>归档列表第 2 个会话；通常不是彻底删除底层 Codex 历史。</span></div>
              <div class="command-row"><code>/threads pin 2</code><span>置顶列表第 2 个会话。</span></div>
              <div class="command-row"><code>/threads all</code><span>查看全部会话，包括归档项。</span></div>
            </div>
          </div>

          <div class="doc-card wide">
            <h3>模型和供应商</h3>
            <div class="command-table">
              <div class="command-row"><code>/provider</code><span>查看或切换 provider 配置。</span></div>
              <div class="command-row"><code>/models</code><span>查看当前 provider 下可用模型。</span></div>
              <div class="command-row"><code>/model</code><span>查看当前模型、模型来源和推理强度。</span></div>
              <div class="command-row"><code>/model gpt-5.5</code><span>切换到指定模型。</span></div>
              <div class="command-row"><code>/model high</code><span>只切换推理强度。</span></div>
              <div class="command-row"><code>/model gpt-5.5 xhigh</code><span>同时切换模型和推理强度。</span></div>
              <div class="command-row"><code>/model default</code><span>恢复 provider 默认模型和推理配置。</span></div>
            </div>
            <p>不同 provider 和模型支持的推理强度不同。如果某个强度不支持，系统会按模型能力兼容或提示。</p>
          </div>

          <div class="doc-card wide">
            <h3>所有常用命令速查</h3>
            <div class="command-table">
              <div class="command-row"><code>/helps</code><span>查看全部命令帮助；也可以用 <code>/helps project</code> 查看某个命令。</span></div>
              <div class="command-row"><code>/status</code><span>查看当前会话、项目目录、模型、权限和运行状态。</span></div>
              <div class="command-row"><code>/usage</code><span>查看当前账号用量和额度摘要。</span></div>
              <div class="command-row"><code>/stop</code><span>停止当前正在回复或执行的任务。</span></div>
              <div class="command-row"><code>/retry</code><span>重试上一条任务。</span></div>
              <div class="command-row"><code>/reconnect</code><span>刷新当前 provider / Codex 连接。</span></div>
              <div class="command-row"><code>/restart</code><span>请求重启桥接服务。</span></div>
              <div class="command-row"><code>/compact</code><span>手动压缩当前 Codex 上下文。</span></div>
              <div class="command-row"><code>/review</code><span>对当前项目改动做代码审查。</span></div>
              <div class="command-row"><code>/skills</code><span>查看当前项目可用 skills。</span></div>
              <div class="command-row"><code>/plugins</code><span>查看插件。</span></div>
              <div class="command-row"><code>/apps</code><span>查看 Apps / Connectors。</span></div>
              <div class="command-row"><code>/mcp</code><span>查看 MCP servers。</span></div>
              <div class="command-row"><code>/use @插件名 任务</code><span>指定本轮优先使用某个插件。</span></div>
              <div class="command-row"><code>/instructions</code><span>查看或修改全局自定义指令。</span></div>
              <div class="command-row"><code>/personality</code><span>查看或切换会话风格。</span></div>
              <div class="command-row"><code>/plan on / /plan off</code><span>开启或关闭规划模式。</span></div>
              <div class="command-row"><code>/fast / /fast off</code><span>开启或关闭 Fast 模式。</span></div>
              <div class="command-row"><code>/lang zh-CN / /lang en</code><span>切换桥接回复语言。</span></div>
              <div class="command-row"><code>/as</code><span>助理记录统一入口，自动识别日志、待办、提醒和笔记。</span></div>
              <div class="command-row"><code>/log / /todo / /remind / /note</code><span>分别保存日志、待办、提醒和笔记。</span></div>
            </div>
            <p>实际可用命令以微信里 <code>/helps</code> 返回为准。不同版本可能会新增、隐藏或调整部分命令。</p>
          </div>

          <div class="doc-card wide">
            <h3>常见问题排查</h3>
            <div class="command-table">
              <div class="command-row"><code>一直显示正在输入</code><span>先发 <code>/status</code> 看状态，再用 <code>/stop</code> 中断；必要时 <code>/reconnect</code> 或在管理面板重启服务。</span></div>
              <div class="command-row"><code>提示有一轮回复在进行中</code><span>同一会话通常会排队，等当前任务完成，或先 <code>/stop</code> 再发新任务。</span></div>
              <div class="command-row"><code>502 / 503</code><span>多半是上游模型服务临时不可用；稍后 <code>/retry</code>，并检查 API key、额度和 Base URL。</span></div>
              <div class="command-row"><code>429</code><span>通常是额度不足、请求太频繁或 provider 限速；换 key、降并发或等待额度恢复。</span></div>
              <div class="command-row"><code>朋友扫码无法连接</code><span>检查电脑是否开机联网、服务是否运行、微信账号是否在线、二维码是否过期。</span></div>
              <div class="command-row"><code>换 key 后仍报错</code><span>手动模式保存新 key；CCSwitch 模式先在 CCSwitch 切换，再点同步或发送 <code>/reconnect</code>。</span></div>
            </div>
          </div>

          <div class="doc-card wide">
            <h3>推荐任务模板</h3>
            <div class="doc-code">
              <code>请在当前项目里定位并修复这个问题：管理页面打开后一直检查失败。要求：先读相关代码，不要乱改无关文件；找到根因后再修改；修改后运行相关测试；最后只告诉我根因、修改文件和测试结果。</code>
              <code>请给当前项目新增功能：在管理面板增加会话导出按钮。要求：保持现有 UI 风格；功能完整可用；加必要测试；最后告诉我怎么使用。</code>
              <code>请结合我刚才发的截图分析问题。先判断最可能原因，再给我按步骤排查；如果需要更多信息，请明确告诉我要截图哪里或复制哪段日志。</code>
            </div>
          </div>
        </div>

        <div class="doc-hero">
          <h3>用手机微信控制电脑上的 Codex</h3>
          <p>这个软件会把微信消息转发给本机 Codex。你可以在手机上让 Codex 读项目代码、修改文件、运行测试、总结日志，也可以给朋友生成入口二维码。电脑必须保持开机并运行本软件，手机端才可以继续对话。</p>
          <div class="download-links">
            <a href="https://gh-proxy.org/https://github.com/farion1231/cc-switch/releases/download/v3.14.1/CC-Switch-v3.14.1-Windows.msi" target="_blank" rel="noopener">下载 CCSwitch Windows</a>
            <a href="https://gh-proxy.org/https://github.com/farion1231/cc-switch/releases/download/v3.14.1/CC-Switch-v3.14.1-macOS.dmg" target="_blank" rel="noopener">下载 CCSwitch macOS</a>
            <a href="https://ztoken.app/register?aff=8M7CSMLY5J77" target="_blank" rel="noopener">注册 ztoken.app</a>
          </div>
        </div>

        <div class="doc-grid">
          <div class="doc-card">
            <h3>1. 第一次使用</h3>
            <ol>
              <li>双击打开 CodexBridge Weixin Admin，等待顶部显示桥接运行中。</li>
              <li>进入“模型供应商”，选择 Z Token 或 Claude Code（Z Token），填写 API key、模型和 Base URL 后保存。</li>
              <li>如果你使用 CCSwitch，把“配置来源”改为“跟随 CCSwitch / Codex 当前配置”，点击“立即同步 CCSwitch”。</li>
              <li>进入“用户入口”，生成二维码，用你的微信或朋友微信扫码确认。</li>
              <li>在微信里发送一句普通消息，例如“你好”，确认能收到最终回复。</li>
            </ol>
          </div>

          <div class="doc-card">
            <h3>2. CCSwitch 和 API key</h3>
            <p>没有 CCSwitch 可以先下载安装。当前版本提供 Windows 安装包和 macOS dmg；如果你只想手动填 API key，可以不装 CCSwitch。</p>
            <ul>
              <li>手动模式：直接在“模型供应商”里填 API key、模型、Base URL，保存后生效。</li>
              <li>CCSwitch 模式：在 CCSwitch 切换 key 或模型后，本软件会按间隔自动同步，也可以手动点“立即同步 CCSwitch”。</li>
              <li>API key 留空保存时，会保留当前已经保存过的 key，不会清空。</li>
            </ul>
          </div>

          <div class="doc-card">
            <h3>3. 手机控制项目代码</h3>
            <p>先在微信里指定项目目录，再发送任务。这样 Codex 会在电脑对应目录里读代码、修改文件和运行命令。</p>
            <div class="doc-code">
              <code>/project D:\\IT_learn\\codex_weixin\\CodexBridge</code>
              <code>读取这个项目，帮我修复启动报错，跑测试后只告诉我结果</code>
            </div>
            <ul>
              <li><code>/project</code> 查看当前项目目录和权限状态。</li>
              <li><code>/project on</code> 使用当前会话或默认目录开启项目控制。</li>
              <li><code>/project cancel</code> 取消还没开始的新项目控制会话。</li>
              <li>默认是请求批准权限；需要执行高风险操作时，微信会提示你用 <code>/allow</code> 审批。</li>
            </ul>
          </div>

          <div class="doc-card">
            <h3>4. 上传图片和文件</h3>
            <p>需要一次发多张图片或多个文件时，先开启上传模式。图片会暂存，直到你发送文字提示词才一起提交给 Codex。</p>
            <div class="doc-code">
              <code>/up</code>
              <code>连续发送图片或文件</code>
              <code>请结合这些截图分析问题，并给我最终结论</code>
            </div>
            <ul>
              <li><code>/up status</code> 查看已经暂存的文件。</li>
              <li><code>/up cancel</code> 取消本次上传模式并清空暂存。</li>
              <li>只发图片不会立刻回答，发送文字说明后才会开始处理。</li>
            </ul>
          </div>

          <div class="doc-card wide">
            <h3>5. 常用命令大全</h3>
            <div class="command-table">
              <div class="command-row"><code>/helps</code><span>查看全部命令帮助；也可以用 <code>/helps project</code> 查看某个命令。</span></div>
              <div class="command-row"><code>/status</code><span>查看当前会话、项目目录、模型、权限和运行状态。</span></div>
              <div class="command-row"><code>/usage</code><span>查看当前账号用量和剩余额度摘要。</span></div>
              <div class="command-row"><code>/new</code><span>准备新会话；下一条普通消息才真正创建，避免空会话。</span></div>
              <div class="command-row"><code>/new D:\\path</code><span>在指定目录准备一个新会话。</span></div>
              <div class="command-row"><code>/project</code><span>查看手机项目控制状态。</span></div>
              <div class="command-row"><code>/project D:\\path</code><span>指定电脑项目目录，让手机消息控制 Codex 操作项目代码。</span></div>
              <div class="command-row"><code>/stop</code><span>停止当前正在回复或执行的任务。</span></div>
              <div class="command-row"><code>/retry</code><span>重试上一条任务。</span></div>
              <div class="command-row"><code>/reconnect</code><span>刷新当前 provider / Codex 连接。</span></div>
              <div class="command-row"><code>/restart</code><span>重启桥接服务。</span></div>
              <div class="command-row"><code>/model</code><span>查看当前模型；<code>/model gpt-5.5 high</code> 可切换模型和推理深度。</span></div>
              <div class="command-row"><code>/models</code><span>列出当前 provider 可用模型。</span></div>
              <div class="command-row"><code>/provider</code><span>查看或切换 provider 配置。</span></div>
              <div class="command-row"><code>/permissions</code><span>查看当前权限模式。</span></div>
              <div class="command-row"><code>/permissions default-permissions</code><span>工作区可写，越界或高风险操作请求批准，推荐日常使用。</span></div>
              <div class="command-row"><code>/permissions auto-review</code><span>工作区可写，由审查代理处理合格审批。</span></div>
              <div class="command-row"><code>/permissions full-access</code><span>完全访问且不审批，只在你明确信任任务时使用。</span></div>
              <div class="command-row"><code>/allow</code><span>查看当前待审批请求。</span></div>
              <div class="command-row"><code>/allow 1</code><span>单次批准第 1 个请求。</span></div>
              <div class="command-row"><code>/allow 2</code><span>批准并在当前会话内记住。</span></div>
              <div class="command-row"><code>/deny</code><span>拒绝当前审批请求；<code>/deny 2</code> 拒绝第 2 个请求。</span></div>
              <div class="command-row"><code>/up</code><span>开启上传模式，连续上传图片/文件后统一提交。</span></div>
              <div class="command-row"><code>/up status</code><span>查看已暂存上传文件。</span></div>
              <div class="command-row"><code>/up cancel</code><span>取消上传模式。</span></div>
              <div class="command-row"><code>/threads</code><span>查看历史会话列表。</span></div>
              <div class="command-row"><code>/next /prev</code><span>历史会话列表下一页 / 上一页。</span></div>
              <div class="command-row"><code>/search 名字</code><span>搜索历史会话标题或内容。</span></div>
              <div class="command-row"><code>/open 名字</code><span>切换到指定名字的历史会话。</span></div>
              <div class="command-row"><code>/peek 2</code><span>预览当前列表第 2 个会话最近内容。</span></div>
              <div class="command-row"><code>/rename this 项目学习</code><span>给当前会话改名。</span></div>
              <div class="command-row"><code>/rename 2 项目学习</code><span>给当前列表第 2 个会话改名。</span></div>
              <div class="command-row"><code>/threads del 2</code><span>归档当前列表第 2 个会话，原始 Codex 历史不会被直接删除。</span></div>
              <div class="command-row"><code>/threads pin 2</code><span>置顶当前列表第 2 个会话。</span></div>
              <div class="command-row"><code>/threads all</code><span>查看全部历史会话，包括归档项。</span></div>
              <div class="command-row"><code>/compact</code><span>手动压缩当前 Codex 上下文。</span></div>
              <div class="command-row"><code>/lang zh-CN / /lang en</code><span>切换桥接回复语言。</span></div>
              <div class="command-row"><code>/plan on / /plan off</code><span>切换规划模式。</span></div>
              <div class="command-row"><code>/fast / /fast off</code><span>切换服务速度档位。</span></div>
              <div class="command-row"><code>/personality</code><span>查看或切换会话风格。</span></div>
              <div class="command-row"><code>/instructions</code><span>查看、起草或确认全局自定义指令。</span></div>
              <div class="command-row"><code>/review</code><span>对当前项目改动运行代码审查。</span></div>
              <div class="command-row"><code>/as</code><span>助理记录统一入口，自动识别日志、待办、提醒和笔记。</span></div>
              <div class="command-row"><code>/log</code><span>记录或查询日志。</span></div>
              <div class="command-row"><code>/todo</code><span>记录、查询或完成待办事项。</span></div>
              <div class="command-row"><code>/remind</code><span>创建或管理提醒。</span></div>
              <div class="command-row"><code>/note</code><span>记录或查询笔记。</span></div>
              <div class="command-row"><code>/skills</code><span>查看当前项目可用技能。</span></div>
              <div class="command-row"><code>/apps / /plugins / /mcp</code><span>查看和管理 Codex 可见的连接器、插件和 MCP 服务。</span></div>
              <div class="command-row"><code>/use @插件名 任务</code><span>显式指定本轮优先使用某个插件。</span></div>
              <div class="command-row"><code>/login</code><span>管理 Codex 登录账号或刷新登录状态。</span></div>
            </div>
          </div>

          <div class="doc-card">
            <h3>6. 示例场景</h3>
            <div class="doc-code">
              <code>/project D:\\IT_learn\\codex_weixin\\CodexBridge</code>
              <code>帮我检查为什么管理页面打不开，修复后跑相关测试</code>
              <code>/allow 1</code>
            </div>
            <p>如果 Codex 需要运行命令或改文件，微信会显示审批提示。你确认没问题后再发 <code>/allow 1</code> 或 <code>/allow 2</code>。</p>
          </div>

          <div class="doc-card">
            <h3>7. 常见问题</h3>
            <ul>
              <li>电脑关机、断网或软件关闭后，微信端不能继续让本机 Codex 执行任务。</li>
              <li>一直显示正在输入时，先发 <code>/status</code> 查看状态，再用 <code>/stop</code> 中断。</li>
              <li>API key 换了后，手动模式在“模型供应商”里保存新 key；CCSwitch 模式在 CCSwitch 切换后点击同步。</li>
              <li>朋友扫码后产生的会话和数据会保存在你这台电脑的数据目录里。</li>
              <li>需要只看最终结果时，当前桥接默认会过滤思考过程，只把最终回答发到微信。</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="sessions">
    <section id="sessions">
      <div class="section-head">
        <h2>会话管理</h2>
        <span class="muted" id="session-count"></span>
      </div>
      <div class="body">
        <div class="filter-row">
          <input id="session-query" placeholder="搜索标题、账号、线程、最新问题" />
          <select id="session-account">
            <option value="">全部账号</option>
          </select>
          <select id="session-sort">
            <option value="updatedDesc">最近更新优先</option>
            <option value="updatedAsc">最早更新优先</option>
            <option value="titleAsc">标题 A-Z</option>
            <option value="titleDesc">标题 Z-A</option>
            <option value="createdDesc">新建时间优先</option>
          </select>
          <button id="sessions-refresh">刷新会话</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width: 30%">标题 / 最新问题</th>
                <th style="width: 16%">微信账号</th>
                <th style="width: 16%">模型</th>
                <th style="width: 16%">更新时间</th>
                <th style="width: 10%">状态</th>
                <th style="width: 12%">操作</th>
              </tr>
            </thead>
            <tbody id="sessions-body"></tbody>
          </table>
        </div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="logs">
    <section id="logs">
      <div class="section-head">
        <h2>运行日志</h2>
        <div class="toolbar">
          <button id="logs-cleanup">立即清理</button>
          <button id="logs-copy">复制日志</button>
          <button id="logs-refresh">刷新日志</button>
        </div>
      </div>
      <div class="body">
        <div class="log-summary">
          <span class="pill" id="logs-size">日志大小：-</span>
          <span class="muted" id="logs-policy"></span>
        </div>
        <pre class="log-box" id="logs-box">正在加载日志...</pre>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="backup">
    <section id="backup">
      <div class="section-head">
        <h2>导出备份 / 导入恢复</h2>
        <span class="muted" id="import-message"></span>
      </div>
      <div class="body">
        <div class="export-row">
          <button class="primary" id="export-backup">导出 JSON 备份</button>
          <span class="muted">包含本机账号配置、会话索引和最近日志，请妥善保存。</span>
        </div>
        <div class="import-row">
          <label class="file-picker" for="import-file">
            <span class="file-picker-icon">JSON</span>
            <span class="file-picker-copy">
              <span class="file-picker-title" id="import-file-name">选择备份 JSON 文件</span>
              <span class="file-picker-meta" id="import-file-meta">支持 .json 文件，导入会覆盖同 id 的账号和会话</span>
            </span>
            <input type="file" id="import-file" accept="application/json,.json" />
          </label>
          <button id="import-backup">导入备份</button>
          <span class="muted">从导出的 JSON 恢复账号与会话（同 id 会被覆盖）。</span>
        </div>
      </div>
    </section>
    </div>
      </div>
    </div>
  </main>

  <div class="modal-overlay" id="history-modal" hidden>
    <div class="modal-card">
      <div class="modal-head">
        <h2 id="history-title">会话历史</h2>
        <button id="history-close">关闭</button>
      </div>
      <div class="modal-toolbar">
        <input id="history-search" placeholder="搜索这条会话的历史消息，回车搜索" />
        <span class="muted" id="history-count"></span>
      </div>
      <div class="history-body" id="history-body"></div>
    </div>
  </div>

  <div class="modal-overlay" id="setup-modal" hidden>
    <div class="modal-card setup-card">
      <div class="modal-head">
        <h2>首次配置向导</h2>
        <div class="toolbar">
          <span class="pill" id="setup-status">等待检查</span>
          <button id="setup-close">关闭</button>
        </div>
      </div>
      <div class="setup-progress" id="setup-progress">
        <button class="setup-step-tab active" data-setup-step="0">1 数据目录</button>
        <button class="setup-step-tab" data-setup-step="1">2 模型配置</button>
        <button class="setup-step-tab" data-setup-step="2">3 环境检查</button>
        <button class="setup-step-tab" data-setup-step="3">4 微信扫码</button>
        <button class="setup-step-tab" data-setup-step="4">5 测试完成</button>
      </div>
      <div class="setup-body">
        <div class="setup-step active" data-setup-panel="0">
          <div class="setup-intro">
            <strong>先确认数据保存位置</strong>
            <span class="muted">当前服务启动后会使用下面的数据目录和配置文件。需要迁移目录时，建议关闭应用后通过启动器或安装路径调整。</span>
          </div>
          <div class="setup-grid">
            <div class="setup-info">
              <span>数据目录</span>
              <code id="setup-data-dir">-</code>
            </div>
            <div class="setup-info">
              <span>配置文件</span>
              <code id="setup-env-file">-</code>
            </div>
            <div class="setup-info">
              <span>Codex Home</span>
              <code id="setup-codex-home">-</code>
            </div>
            <div class="setup-info">
              <span>管理页面</span>
              <code id="setup-admin-url">-</code>
            </div>
          </div>
        </div>
        <div class="setup-step" data-setup-panel="1">
          <div class="setup-intro">
            <strong>填写模型供应商</strong>
            <span class="muted">这里会保存到服务配置文件。API key 留空表示保留已有 key。</span>
          </div>
          <div class="settings-grid provider-grid">
            <div class="field">
              <label for="setup-provider-preset">供应商预设</label>
              <select id="setup-provider-preset">
                <option value="default">OpenAI</option>
                <option value="claude-code">Claude Code</option>
                <option value="deepseek">DeepSeek</option>
                <option value="qwen">Qwen</option>
                <option value="openrouter">OpenRouter</option>
                <option value="kimi">Kimi</option>
                <option value="gemini">Gemini</option>
                <option value="minimax">MiniMax</option>
                <option value="iflow">iFlow</option>
              </select>
            </div>
            <div class="field">
              <label for="setup-provider-source">配置来源</label>
              <select id="setup-provider-source">
                <option value="manual">手动填写</option>
                <option value="ccswitch">跟随 CCSwitch / Codex 当前配置</option>
              </select>
            </div>
            <div class="field">
              <label for="setup-provider-name">供应商名称</label>
              <input id="setup-provider-name" autocomplete="off" />
            </div>
            <div class="field">
              <label for="setup-provider-model">模型</label>
              <select id="setup-provider-model"></select>
              <input id="setup-provider-model-custom" autocomplete="off" placeholder="自定义模型名称" style="display:none;" />
            </div>
            <div class="field">
              <label for="setup-provider-api-key">API key</label>
              <input id="setup-provider-api-key" type="password" autocomplete="off" placeholder="填写新 key，留空保留当前 key" />
            </div>
            <div class="field provider-span">
              <label for="setup-provider-base-url">接口地址 Base URL</label>
              <input id="setup-provider-base-url" autocomplete="off" />
              <div class="help-line">如果使用中转站，可以点击 <a href="https://ztoken.app/register?aff=8M7CSMLY5J77" target="_blank" rel="noopener">ztoken.app</a> 跳转到中转站获取接口地址。</div>
            </div>
            <div class="field provider-span">
              <label for="setup-provider-env-file">配置文件</label>
              <input id="setup-provider-env-file" autocomplete="off" />
            </div>
            <div class="field provider-span">
              <label for="setup-provider-ccswitch-home">CCSwitch / Codex Home</label>
              <input id="setup-provider-ccswitch-home" autocomplete="off" placeholder="默认使用当前用户的 .codex 目录" />
            </div>
            <div class="field">
              <label for="setup-provider-ccswitch-interval">自动同步间隔（秒）</label>
              <input id="setup-provider-ccswitch-interval" type="number" min="2" max="60" step="1" />
            </div>
            <div class="field">
              <label>CCSwitch 同步状态</label>
              <div class="readonly-line" id="setup-provider-ccswitch-status">-</div>
            </div>
          </div>
          <div class="help-line" id="setup-provider-message">保存后关闭并重新打开应用，可让模型配置在整个服务中生效。</div>
        </div>
        <div class="setup-step" data-setup-panel="2">
          <div class="setup-intro">
            <strong>检查运行环境</strong>
            <span class="muted">如果有黄色项目，按提示补齐后点击刷新检查。</span>
          </div>
          <div class="setup-checks" id="setup-checks"></div>
        </div>
        <div class="setup-step" data-setup-panel="3">
          <div class="setup-intro">
            <strong>生成微信扫码入口</strong>
            <span class="muted">点击生成二维码，用微信扫描并确认后，这个账号就可以通过桥接服务聊天。</span>
          </div>
          <div class="grid">
            <div class="qr-box setup-qr-box" id="setup-qr-box">
              <span class="muted">点击下方按钮生成二维码</span>
            </div>
            <div class="qr-form">
              <input id="setup-display-name" placeholder="入口备注名，可不填" />
              <div class="qr-buttons">
                <button class="primary" id="setup-start-pairing">生成二维码</button>
                <button id="setup-refresh-pairing">刷新二维码</button>
              </div>
              <div class="status-line" id="setup-qr-link"></div>
              <div class="status-line" id="setup-message"></div>
            </div>
          </div>
        </div>
        <div class="setup-step" data-setup-panel="4">
          <div class="setup-test-card">
            <strong>最后做一次测试</strong>
            <span>在微信里发送：你好，测试一下</span>
            <span>收到正常回复后，点击“完成引导”。如果暂时不测试，也可以先跳过，后面再从右上角打开配置向导。</span>
          </div>
          <div class="setup-checks" id="setup-final-checks"></div>
        </div>
      </div>
      <div class="setup-actions">
        <button id="setup-skip">跳过</button>
        <div class="toolbar">
          <button id="setup-prev">上一步</button>
          <button id="setup-refresh">刷新检查</button>
          <button class="primary" id="setup-save-provider">保存模型配置</button>
          <button id="setup-ccswitch-sync">同步 CCSwitch</button>
          <button class="primary" id="setup-next">下一步</button>
          <button class="primary" id="setup-complete">完成引导</button>
        </div>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="donate-modal" hidden>
    <div class="modal-card" style="width:min(420px, 100%);">
      <div class="modal-head">
        <h2>支持项目</h2>
        <button id="donate-close">关闭</button>
      </div>
      <div class="donate-body">
        <img src="/donate/wechat-reward.png" alt="微信收款码" />
        <div class="donate-note">如果这个工具帮到了你，可以用微信扫码支持一下。感谢你的鼓励。</div>
      </div>
    </div>
  </div>

  <script>
    const queryParams = new URLSearchParams(window.location.search);
    const state = {
      pairingTimer: null,
      shutdownOnClose: queryParams.get('shutdownOnClose') !== '0',
      pageId: (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(16).slice(2),
      lifecycleTimer: null,
      lifecycleClosed: false,
      closeBeacon: null,
      statusTimer: null,
      settingsLoaded: false,
      currentModelProvider: null,
      updaterStatus: null,
      updaterUnsubscribe: null,
      diagnostics: null,
      setup: null,
      setupStep: 0,
      setupAutoOpened: false
    };
    const $ = (id) => document.getElementById(id);
    const providerPresets = {
      default: {
        profileId: 'openai-default',
        providerId: 'openai-compatible',
        providerName: 'OpenAI',
        baseUrl: 'https://ztoken.app/',
        model: 'gpt-5.5',
        models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.1-codex', 'gpt-5.1-codex-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o3-mini', 'o4-mini'],
        capabilities: 'default'
      },
      'claude-code': {
        profileId: 'claude-code',
        providerId: 'claude-code',
        providerName: 'Claude Code',
        baseUrl: 'https://ztoken.app/',
        model: 'claude-sonnet-4-20250514',
        models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
        capabilities: 'claude-code'
      },
      deepseek: {
        profileId: 'deepseek',
        providerId: 'deepseek',
        providerName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder', 'deepseek-v3', 'deepseek-r1'],
        capabilities: 'deepseek'
      },
      qwen: {
        profileId: 'qwen',
        providerId: 'qwen',
        providerName: 'Qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3-coder-plus',
        models: ['qwen3-coder-plus', 'qwen3-coder-flash', 'qwen3-max', 'qwen3-plus', 'qwen3-turbo', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
        capabilities: 'qwen'
      },
      openrouter: {
        profileId: 'openrouter',
        providerId: 'openrouter',
        providerName: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openai/gpt-5',
        models: ['openai/gpt-5', 'openai/gpt-4.1', 'anthropic/claude-sonnet-4', 'anthropic/claude-opus-4', 'deepseek/deepseek-chat-v3-0324', 'deepseek/deepseek-r1', 'google/gemini-2.5-pro', 'qwen/qwen3-coder'],
        capabilities: 'openrouter'
      },
      kimi: {
        profileId: 'kimi',
        providerId: 'kimi',
        providerName: 'Kimi',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2-0711-preview',
        models: ['kimi-k2-0711-preview', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
        capabilities: 'kimi'
      },
      gemini: {
        profileId: 'gemini',
        providerId: 'gemini',
        providerName: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-2.5-pro',
        models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
        capabilities: 'gemini'
      },
      minimax: {
        profileId: 'minimax',
        providerId: 'minimax',
        providerName: 'MiniMax',
        baseUrl: 'https://api.minimax.chat/v1',
        model: 'MiniMax-M1',
        models: ['MiniMax-M1', 'MiniMax-Text-01', 'abab6.5s-chat', 'abab6.5g-chat'],
        capabilities: 'minimax'
      },
      iflow: {
        profileId: 'iflow',
        providerId: 'iflow',
        providerName: 'iFlow',
        baseUrl: 'https://apis.iflow.cn/v1',
        model: 'iflow-default',
        models: ['iflow-default', 'Qwen3-Coder', 'DeepSeek-V3', 'DeepSeek-R1', 'GLM-4.5'],
        capabilities: 'iflow'
      }
    };

    function pageLifecycleUrl(path, extra) {
      const params = new URLSearchParams({
        pageId: state.pageId,
        shutdownOnClose: state.shutdownOnClose ? '1' : '0'
      });
      for (const [key, value] of Object.entries(extra || {})) {
        if (value !== undefined && value !== null) {
          params.set(key, String(value));
        }
      }
      return path + '?' + params.toString();
    }

    function sendPageLifecycle(path, extra) {
      if (!state.shutdownOnClose) return;
      const url = pageLifecycleUrl(path, extra);
      const payload = JSON.stringify({
        pageId: state.pageId,
        shutdownOnClose: state.shutdownOnClose,
        ...(extra || {})
      });
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        if (navigator.sendBeacon(url, blob)) {
          return;
        }
      }
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
        keepalive: true
      }).catch(() => {});
    }

    function sendPageCloseLifecycle() {
      const extra = { closedAt: Date.now() };
      sendPageLifecycle('/api/page/close', extra);
      sendShutdownRequest('admin-page-closed');
      const image = new Image();
      image.src = pageLifecycleUrl('/api/page/close', extra);
      state.closeBeacon = image;
    }

    function sendShutdownRequest(reason) {
      if (!state.shutdownOnClose) return;
      const payload = JSON.stringify({ reason: reason || 'admin-page-closed' });
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        if (navigator.sendBeacon('/api/service/shutdown', blob)) {
          return;
        }
      }
      fetch('/api/service/shutdown', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
        keepalive: true
      }).catch(() => {});
    }

    function showPage(page) {
      const target = String(page || 'overview').replace(/^#/, '') || 'overview';
      const links = Array.from(document.querySelectorAll('.side-nav a[data-page]'));
      const panels = Array.from(document.querySelectorAll('[data-page-panel]'));
      const known = panels.some((panel) => panel.dataset.pagePanel === target);
      const next = known ? target : 'overview';
      for (const link of links) {
        link.classList.toggle('active', link.dataset.page === next);
      }
      for (const panel of panels) {
        panel.classList.toggle('active', panel.dataset.pagePanel === next);
      }
      if (window.location.hash !== '#' + next) {
        history.replaceState(null, '', '#' + next);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function startPageLifecycle() {
      if (!state.shutdownOnClose) return;
      sendPageLifecycle('/api/page/heartbeat');
      state.lifecycleTimer = window.setInterval(() => {
        sendPageLifecycle('/api/page/heartbeat');
      }, 5000);
      const closePage = () => {
        if (state.lifecycleClosed) return;
        state.lifecycleClosed = true;
        if (state.lifecycleTimer) {
          window.clearInterval(state.lifecycleTimer);
          state.lifecycleTimer = null;
        }
        sendPageCloseLifecycle();
      };
      window.addEventListener('pagehide', closePage);
      window.addEventListener('beforeunload', closePage);
      window.addEventListener('unload', closePage);
    }

    function fmtTime(value) {
      if (!value) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN');
    }

    function fmtRelativeMs(value) {
      const timestamp = Number(value || 0);
      if (!timestamp) return '-';
      const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
      if (seconds < 60) return seconds + ' 秒前';
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return minutes + ' 分钟前';
      const hours = Math.round(minutes / 60);
      if (hours < 24) return hours + ' 小时前';
      return Math.round(hours / 24) + ' 天前';
    }

    function fmtBytes(value) {
      const bytes = Number(value || 0);
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
      return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
    }

    function readPositiveIntInput(id, fallback) {
      const parsed = Number.parseInt(String($(id).value || ''), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    function setMessage(text, danger) {
      const el = $('message');
      el.textContent = text || '';
      el.style.color = danger ? '#e11d48' : '#64708a';
    }

    function renderImportFileState() {
      const input = $('import-file');
      const file = input.files && input.files[0];
      if (!file) {
        $('import-file-name').textContent = '选择备份 JSON 文件';
        $('import-file-meta').textContent = '支持 .json 文件，导入会覆盖同 id 的账号和会话';
        return;
      }
      $('import-file-name').textContent = file.name || '已选择备份文件';
      $('import-file-meta').textContent = [
        fmtBytes(file.size || 0),
        file.type || 'JSON',
        file.lastModified ? ('修改时间 ' + fmtTime(file.lastModified)) : ''
      ].filter(Boolean).join(' · ');
      $('import-message').textContent = '';
    }

    async function requestJson(url, options) {
      const res = await fetch(url, {
        headers: { 'content-type': 'application/json' },
        ...options
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || ('HTTP ' + res.status));
      }
      return data;
    }

    function updaterApi() {
      return window.codexbridgeUpdater || null;
    }

    function renderUpdaterStatus(status) {
      const api = updaterApi();
      const current = status || {
        supported: false,
        packaged: false,
        reason: api ? '正在读取更新状态...' : '请在桌面安装版窗口中使用自动更新。'
      };
      state.updaterStatus = current;
      $('update-current-version').textContent = current.currentVersion || '-';
      $('update-latest-version').textContent = current.latestVersion || (current.available ? '发现新版本' : '-');
      $('update-last-checked').textContent = current.lastCheckedAt ? fmtTime(current.lastCheckedAt) : '-';
      let label = '等待检查';
      if (!api) {
        label = '浏览器页面不可用';
      } else if (!current.packaged) {
        label = '开发模式';
      } else if (current.errorCode === 'missing-latest-yml') {
        label = '更新清单未配置';
      } else if (current.error) {
        label = '检查失败';
      } else if (current.checking) {
        label = '正在检查';
      } else if (current.downloading) {
        label = '正在下载';
      } else if (current.downloaded) {
        label = '已下载';
      } else if (current.available) {
        label = '发现新版本';
      } else if (current.lastCheckedAt) {
        label = '已是最新';
      }
      $('update-status-label').textContent = label;
      const progress = current.progress || {};
      const percent = Number.isFinite(Number(progress.percent)) ? Math.max(0, Math.min(100, Math.round(Number(progress.percent)))) : (current.downloaded ? 100 : 0);
      setWidth('update-progress-fill', percent);
      if (current.downloading || current.downloaded) {
        const transferred = progress.transferred ? fmtBytes(progress.transferred) : '';
        const total = progress.total ? fmtBytes(progress.total) : '';
        $('update-progress-label').textContent = [percent + '%', transferred && total ? (transferred + ' / ' + total) : ''].filter(Boolean).join(' · ');
      } else {
        $('update-progress-label').textContent = '-';
      }
      const message = current.error || current.reason || (current.available
        ? '发现新版本，可以下载更新。'
        : (current.lastCheckedAt ? '当前已经是最新版本。' : '启动安装版后会自动检查更新。'));
      $('update-message').textContent = message;
      $('update-check').disabled = !api || current.checking || current.downloading || current.canCheck === false;
      $('update-download').disabled = !api || current.downloading || current.downloaded || current.canDownload === false;
      $('update-install').disabled = !api || current.canInstall === false;
      const notes = String(current.releaseNotes || '').trim();
      $('update-release-notes').textContent = notes || '暂无更新日志。';
    }

    async function refreshUpdaterStatus() {
      const api = updaterApi();
      if (!api || !api.getStatus) {
        renderUpdaterStatus(null);
        return;
      }
      renderUpdaterStatus(await api.getStatus());
    }

    async function checkForUpdate() {
      const api = updaterApi();
      if (!api || !api.check) {
        renderUpdaterStatus(null);
        return;
      }
      $('update-message').textContent = '正在检查更新...';
      renderUpdaterStatus(await api.check());
    }

    async function downloadUpdate() {
      const api = updaterApi();
      if (!api || !api.download) {
        renderUpdaterStatus(null);
        return;
      }
      $('update-message').textContent = '正在下载更新包...';
      renderUpdaterStatus(await api.download());
    }

    async function installUpdate() {
      const api = updaterApi();
      if (!api || !api.install) {
        renderUpdaterStatus(null);
        return;
      }
      if (!confirm('确认重启并安装新版本？安装前会先停止微信桥接服务。')) {
        return;
      }
      $('update-message').textContent = '正在停止服务并准备安装...';
      await api.install();
    }

    function startUpdaterBridge() {
      const api = updaterApi();
      if (api && api.onStatus) {
        state.updaterUnsubscribe = api.onStatus((status) => {
          renderUpdaterStatus(status);
        });
      }
      refreshUpdaterStatus().catch((error) => {
        renderUpdaterStatus({
          supported: false,
          reason: error.message || String(error),
          currentVersion: '-'
        });
      });
    }

    async function loadState() {
      const data = await requestJson('/api/state');
      state.accounts = data.accounts || [];
      state.setup = data.setup || null;
      renderAccounts(data.accounts || []);
      renderSessionFilters(data.accounts || []);
      renderPairing(data.pairing);
      renderSetup(data);
      renderBridge(data.bridge || { running: true });
      renderRuntimeStatus(data);
      if (!state.settingsLoaded) {
        renderSettings(data.settings || {});
        state.settingsLoaded = true;
      }
      renderLogSummary(data.logs || {});
      await Promise.all([
        loadSessions(),
        loadLogs(),
        loadMetrics()
      ]);
      $('account-count').textContent = String((data.accounts || []).length) + ' 个入口';
    }

    async function refreshRuntimeState() {
      const data = await requestJson('/api/state');
      state.setup = data.setup || null;
      renderBridge(data.bridge || { running: true });
      renderRuntimeStatus(data);
      renderPairing(data.pairing);
      renderSetup(data);
      renderLogSummary(data.logs || {});
      await loadMetrics().catch(() => {});
    }

    function fmtDuration(ms) {
      const value = Number(ms || 0);
      if (value <= 0) return '0 ms';
      if (value < 1000) return Math.round(value) + ' ms';
      if (value < 60000) return (value / 1000).toFixed(1) + ' 秒';
      const minutes = Math.floor(value / 60000);
      const seconds = Math.round((value % 60000) / 1000);
      return minutes + ' 分 ' + seconds + ' 秒';
    }

    function fmtNumber(value) {
      const number = Number(value || 0);
      if (!Number.isFinite(number)) return '0';
      return number.toLocaleString('zh-CN');
    }

    function pct(part, total) {
      const p = Number(part || 0);
      const t = Number(total || 0);
      if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return 0;
      return Math.max(0, Math.min(100, Math.round((p / t) * 100)));
    }

    function setWidth(id, percent) {
      const el = $(id);
      if (el) el.style.width = Math.max(0, Math.min(100, Number(percent || 0))) + '%';
    }

    async function loadMetrics() {
      const data = await requestJson('/api/metrics');
      renderMetrics(data || {});
    }

    function formatErrorStage(stage) {
      if (stage === 'poll') return '轮询';
      if (stage === 'commit') return '游标';
      if (stage === 'runtime') return '运行';
      return stage || '未知';
    }

    function renderMetrics(m) {
      const breakdown = m.errorBreakdown || {};
      const currentError = m.currentError || null;
      const replyFailures = Number(m.replyFailures || 0);
      $('metric-messages').textContent = fmtNumber(m.messagesReceived || 0);
      $('metric-turns-done').textContent = fmtNumber(m.turnsCompleted || 0) + ' / ' + fmtNumber(m.turnsFailed || 0);
      $('metric-deliveries').textContent = fmtNumber(m.deliveriesSucceeded || 0) + ' / ' + fmtNumber(m.deliveriesFailed || 0);
      $('metric-current-error').textContent = currentError ? ('异常 · ' + formatErrorStage(currentError.stage)) : '正常';
      $('metric-errors-hour').textContent = fmtNumber(m.errorsRecentHour || 0);
      $('metric-errors-total').textContent = fmtNumber(m.errors || 0);
      $('metric-error-breakdown').textContent = fmtNumber(breakdown.poll || 0) + ' / ' + fmtNumber(breakdown.runtime || 0);
      $('metric-reply-failures').textContent = fmtNumber(replyFailures);
      $('metric-avg-turn').textContent = fmtDuration(m.avgTurnDurationMs);
      $('metric-last-turn').textContent = fmtDuration(m.lastTurnDurationMs);
      $('metric-active-turns').textContent = fmtNumber(m.activeTurns || 0) + ' / ' + fmtNumber(m.queuedTurns || 0);
      $('metric-pending').textContent = fmtNumber(m.pendingDeliveryRetries || 0);
      $('metrics-uptime').textContent = m.uptimeMs ? ('运行 ' + fmtDuration(m.uptimeMs)) : '';
      $('metrics-error-detail').textContent = currentError
        ? ('当前错误：' + formatErrorStage(currentError.stage) + ' · ' + (currentError.message || '未知错误'))
        : ('当前无持续错误。最近 1 小时错误 ' + fmtNumber(m.errorsRecentHour || 0) + ' 次；后台错误累计 ' + fmtNumber(m.errors || 0) + ' 次。');
      renderMetricCharts(m);
      renderMetricsByAccount(m.byAccount || {});
    }

    async function resetMetrics() {
      if (!window.confirm('确认清零统计数字？这不会删除会话、账号或日志。')) {
        return;
      }
      const data = await requestJson('/api/metrics/reset', { method: 'POST' });
      renderMetrics(data.metrics || {});
      setMessage('统计已清零。');
    }

    async function runDiagnostics() {
      $('diagnostics-run').disabled = true;
      $('diagnostics-updated').textContent = '正在检查...';
      $('diagnostics-summary-text').textContent = '正在检查服务、微信入口、模型接口和本地端口...';
      try {
        const data = await requestJson('/api/diagnostics/run', { method: 'POST' });
        state.diagnostics = data;
        renderDiagnostics(data);
      } finally {
        $('diagnostics-run').disabled = false;
      }
    }

    function renderDiagnostics(data) {
      const summary = (data && data.summary) || {};
      const status = summary.status || 'ok';
      $('diagnostics-summary-status').textContent = status === 'fail' ? '需要处理' : (status === 'warn' ? '有提醒' : '正常');
      $('diagnostics-summary-ok').textContent = fmtNumber(summary.ok || 0);
      $('diagnostics-summary-warn').textContent = fmtNumber(summary.warned || 0);
      $('diagnostics-summary-fail').textContent = fmtNumber(summary.failed || 0);
      $('diagnostics-summary-text').textContent = summary.text || '诊断完成。';
      $('diagnostics-updated').textContent = data && data.generatedAt ? ('检查于 ' + fmtTime(data.generatedAt)) : '已检查';
      const box = $('diagnostics-list');
      box.textContent = '';
      const checks = Array.isArray(data && data.checks) ? data.checks : [];
      if (!checks.length) {
        const empty = document.createElement('div');
        empty.className = 'help-line';
        empty.textContent = '暂无诊断结果。';
        box.appendChild(empty);
        return;
      }
      for (const check of checks) {
        box.appendChild(renderDiagnosticCard(check));
      }
    }

    function renderDiagnosticCard(check) {
      const card = document.createElement('div');
      const status = check && check.status ? String(check.status) : 'warn';
      card.className = 'diagnostic-card ' + status;
      const head = document.createElement('div');
      head.className = 'diagnostic-head';
      const title = document.createElement('div');
      title.className = 'diagnostic-title';
      title.textContent = check.title || check.id || '诊断项';
      const pill = document.createElement('span');
      pill.className = status === 'ok' ? 'pill ok' : (status === 'fail' ? 'pill warn' : 'pill');
      pill.textContent = status === 'ok' ? '正常' : (status === 'fail' ? '需处理' : '提醒');
      head.appendChild(title);
      head.appendChild(pill);
      const detail = document.createElement('div');
      detail.className = 'diagnostic-detail';
      detail.textContent = check.detail || '-';
      const reason = document.createElement('div');
      reason.className = 'diagnostic-reason';
      reason.textContent = check.reason || '';
      const actions = document.createElement('div');
      actions.className = 'diagnostic-actions';
      for (const action of (Array.isArray(check.actions) ? check.actions : [])) {
        const button = document.createElement('button');
        button.textContent = action.label || '处理';
        button.onclick = () => runDiagnosticAction(action).catch((error) => setMessage(error.message, true));
        actions.appendChild(button);
      }
      card.appendChild(head);
      card.appendChild(detail);
      if (reason.textContent) card.appendChild(reason);
      if (actions.childElementCount) card.appendChild(actions);
      return card;
    }

    async function runDiagnosticAction(action) {
      const type = String((action && action.action) || '');
      if (type === 'open-page') {
        showPage(action.target || 'overview');
        return;
      }
      if (type === 'start-bridge') {
        setMessage('正在启动微信桥接...', false);
        const data = await requestJson('/api/bridge/start', { method: 'POST' });
        renderBridge(data.bridge || { running: true });
        await loadState();
        await runDiagnostics();
        setMessage('微信桥接已启动', false);
        return;
      }
      if (type === 'restart-bridge') {
        setMessage('正在重启微信桥接...', false);
        const data = await requestJson('/api/bridge/restart', { method: 'POST' });
        renderBridge(data.bridge || { running: true });
        await loadState();
        await runDiagnostics();
        setMessage('微信桥接已重启', false);
        return;
      }
      if (type === 'start-pairing') {
        showPage('users');
        await startPairing();
        return;
      }
      if (type === 'sync-ccswitch') {
        showPage('provider');
        await syncProviderFromCcswitch('provider');
        await runDiagnostics();
        return;
      }
      setMessage('暂不支持这个处理动作：' + type, true);
    }

    function renderMetricCharts(m) {
      const success = Number(m.deliveriesSucceeded || 0);
      const failed = Number(m.deliveriesFailed || 0);
      const pending = Number(m.pendingDeliveryRetries || 0);
      const totalDelivery = success + failed;
      const successRate = pct(success, totalDelivery);
      const donut = $('delivery-donut');
      donut.dataset.label = totalDelivery ? (successRate + '%') : '暂无';
      donut.style.background = totalDelivery
        ? 'conic-gradient(#059669 0deg ' + (successRate * 3.6) + 'deg, #e11d48 ' + (successRate * 3.6) + 'deg 360deg)'
        : 'conic-gradient(#dbe4f0 0deg 360deg)';
      $('delivery-rate-label').textContent = totalDelivery ? ('成功率 ' + successRate + '%') : '暂无投递数据';
      $('chart-delivery-success').textContent = fmtNumber(success);
      $('chart-delivery-failed').textContent = fmtNumber(failed);
      $('chart-delivery-pending').textContent = fmtNumber(pending);

      const bars = [
        { label: '收到消息', value: Number(m.messagesReceived || 0), color: 'linear-gradient(90deg, #2563eb, #06b6d4)' },
        { label: '完成回合', value: Number(m.turnsCompleted || 0), color: 'linear-gradient(90deg, #059669, #22c55e)' },
        { label: '真正回复失败', value: Number(m.replyFailures || 0), color: 'linear-gradient(90deg, #f59e0b, #f43f5e)' },
        { label: '最近1小时错误', value: Number(m.errorsRecentHour || 0), color: 'linear-gradient(90deg, #06b6d4, #8b5cf6)' },
        { label: '后台错误累计', value: Number(m.errors || 0), color: 'linear-gradient(90deg, #e11d48, #8b5cf6)' },
      ];
      const max = Math.max(1, ...bars.map((item) => item.value));
      const box = $('metrics-bars');
      box.textContent = '';
      for (const item of bars) {
        const row = document.createElement('div');
        row.className = 'bar-row';
        const label = document.createElement('span');
        label.textContent = item.label;
        const track = document.createElement('div');
        track.className = 'bar-track';
        const fill = document.createElement('div');
        fill.className = 'bar-fill';
        fill.style.width = Math.max(4, Math.round((item.value / max) * 100)) + '%';
        fill.style.background = item.color;
        track.appendChild(fill);
        const value = document.createElement('strong');
        value.textContent = fmtNumber(item.value);
        row.appendChild(label);
        row.appendChild(track);
        row.appendChild(value);
        box.appendChild(row);
      }
      renderAccountBars(m.byAccount || {});
    }

    function renderMetricsByAccount(byAccount) {
      const body = $('metrics-by-account-body');
      body.textContent = '';
      const names = {};
      for (const account of (state.accounts || [])) {
        names[account.accountId] = account.displayName || account.accountId;
      }
      const ids = Object.keys(byAccount);
      if (!ids.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 4;
        td.className = 'muted';
        td.textContent = '暂无数据';
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }
      for (const id of ids) {
        const a = byAccount[id] || {};
        const label = id === 'default' ? (names[id] || '默认 / 主账号') : (names[id] || id);
        const tr = document.createElement('tr');
        tr.appendChild(textCell('账号', label));
        tr.appendChild(textCell('收到消息', String(a.messagesReceived || 0)));
        tr.appendChild(textCell('完成 / 失败回合', String(a.turnsCompleted || 0) + ' / ' + String(a.turnsFailed || 0)));
        tr.appendChild(textCell('平均回合耗时', fmtDuration(a.avgTurnDurationMs)));
        body.appendChild(tr);
      }
    }

    function renderAccountBars(byAccount) {
      const box = $('account-bars');
      box.textContent = '';
      const names = {};
      for (const account of (state.accounts || [])) {
        names[account.accountId] = account.displayName || account.accountId;
      }
      const rows = Object.entries(byAccount || {})
        .map(([id, value]) => ({ id, data: value || {}, messages: Number((value || {}).messagesReceived || 0) }))
        .sort((a, b) => b.messages - a.messages)
        .slice(0, 6);
      if (!rows.length) {
        $('account-bars-summary').textContent = '暂无数据';
        const empty = document.createElement('div');
        empty.className = 'muted';
        empty.textContent = '收到微信消息后，这里会显示各账号活跃度。';
        box.appendChild(empty);
        return;
      }
      const max = Math.max(1, ...rows.map((row) => row.messages));
      $('account-bars-summary').textContent = rows.length + ' 个账号';
      for (const row of rows) {
        const labelText = row.id === 'default' ? (names[row.id] || '默认 / 主账号') : (names[row.id] || row.id);
        const wrap = document.createElement('div');
        wrap.className = 'account-bar-row';
        const meta = document.createElement('div');
        meta.className = 'account-bar-meta';
        const label = document.createElement('span');
        label.textContent = labelText;
        const value = document.createElement('strong');
        value.textContent = fmtNumber(row.messages);
        meta.appendChild(label);
        meta.appendChild(value);
        const track = document.createElement('div');
        track.className = 'account-bar-track';
        const fill = document.createElement('div');
        fill.className = 'account-bar-fill';
        fill.style.width = Math.max(5, Math.round((row.messages / max) * 100)) + '%';
        track.appendChild(fill);
        wrap.appendChild(meta);
        wrap.appendChild(track);
        box.appendChild(wrap);
      }
    }

    function renderSessionFilters(accounts) {
      const select = $('session-account');
      const selected = select.value;
      select.textContent = '';
      const all = document.createElement('option');
      all.value = '';
      all.textContent = '全部账号';
      select.appendChild(all);
      for (const account of accounts) {
        const option = document.createElement('option');
        option.value = account.accountId;
        option.textContent = (account.displayName || account.accountId) + (account.primary ? '（主账号）' : '');
        select.appendChild(option);
      }
      select.value = selected;
    }

    async function loadSessions() {
      const params = new URLSearchParams();
      const query = $('session-query').value.trim();
      const accountId = $('session-account').value.trim();
      const sort = $('session-sort').value;
      if (query) params.set('query', query);
      if (accountId) params.set('accountId', accountId);
      if (sort) params.set('sort', sort);
      const data = await requestJson('/api/sessions?' + params.toString());
      renderSessions(data.sessions || [], data.total || 0, data.returned || 0);
    }

    function renderSessions(sessions, total, returned) {
      const body = $('sessions-body');
      body.textContent = '';
      $('session-count').textContent = total ? ('显示 ' + returned + ' / ' + total + ' 个') : '暂无会话';
      if (!sessions.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 6;
        td.className = 'muted';
        td.textContent = '没有找到匹配的会话';
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }
      for (const session of sessions) {
        const tr = document.createElement('tr');
        tr.appendChild(sessionTitleCell(session));
        tr.appendChild(textCell('微信账号', formatSessionAccounts(session)));
        tr.appendChild(textCell('模型', formatSessionModel(session)));
        tr.appendChild(textCell('更新时间', fmtTime(session.updatedAt) || '-'));
        tr.appendChild(sessionStatusCell(session));
        tr.appendChild(sessionActionsCell(session));
        body.appendChild(tr);
      }
    }

    function sessionTitleCell(session) {
      const td = document.createElement('td');
      td.dataset.label = '标题 / 最新问题';
      const title = document.createElement('div');
      title.className = 'session-title';
      title.textContent = session.title || session.codexThreadId || '(无标题)';
      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.textContent = '线程：' + (session.codexThreadId || '-') + '  项目：' + (session.cwd || '-');
      td.appendChild(title);
      if (session.preview) {
        const preview = document.createElement('div');
        preview.className = 'session-preview';
        preview.textContent = '最新问题：' + session.preview;
        td.appendChild(preview);
      }
      td.appendChild(meta);
      return td;
    }

    function sessionStatusCell(session) {
      const td = document.createElement('td');
      td.dataset.label = '状态';
      const wrap = document.createElement('div');
      wrap.className = 'actions';
      if (session.pinned) {
        const pinned = document.createElement('span');
        pinned.className = 'pill ok';
        pinned.textContent = '置顶';
        wrap.appendChild(pinned);
      }
      if (session.archived) {
        const archived = document.createElement('span');
        archived.className = 'pill warn';
        archived.textContent = '归档';
        wrap.appendChild(archived);
      }
      if (!session.pinned && !session.archived) {
        const normal = document.createElement('span');
        normal.className = 'pill';
        normal.textContent = '正常';
        wrap.appendChild(normal);
      }
      td.appendChild(wrap);
      return td;
    }

    function sessionActionsCell(session) {
      const td = document.createElement('td');
      td.dataset.label = '操作';
      const wrap = document.createElement('div');
      wrap.className = 'actions';

      const history = document.createElement('button');
      history.textContent = '查看历史';
      history.onclick = () => openSessionHistory(session)
        .catch((error) => setMessage(error.message, true));

      const archive = document.createElement('button');
      archive.textContent = session.archived ? '恢复' : '归档';
      archive.onclick = () => setSessionArchived(session, !session.archived)
        .catch((error) => setMessage(error.message, true));

      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '删除';
      del.onclick = () => deleteSession(session)
        .catch((error) => setMessage(error.message, true));

      wrap.appendChild(history);
      wrap.appendChild(archive);
      wrap.appendChild(del);
      td.appendChild(wrap);
      return td;
    }

    async function setSessionArchived(session, archived) {
      const name = session.title || session.codexThreadId || session.id;
      await requestJson('/api/sessions/' + encodeURIComponent(session.id), {
        method: 'PATCH',
        body: JSON.stringify({ archived })
      });
      setMessage((archived ? '已归档：' : '已恢复：') + name, false);
      await loadSessions();
    }

    async function deleteSession(session) {
      const name = session.title || session.codexThreadId || session.id;
      const lineBreak = String.fromCharCode(10);
      const prompt = [
        '确定删除这个本地会话记录吗？',
        name,
        '',
        '不会删除 Codex 原始历史文件。'
      ].join(lineBreak);
      if (!confirm(prompt)) {
        return;
      }
      await requestJson('/api/sessions/' + encodeURIComponent(session.id), { method: 'DELETE' });
      setMessage('已删除本地会话记录：' + name, false);
      await loadSessions();
    }

    let historySessionId = null;

    async function openSessionHistory(session) {
      historySessionId = session.id;
      $('history-title').textContent = '会话历史 · ' + (session.title || session.codexThreadId || session.id);
      $('history-search').value = '';
      $('history-count').textContent = '';
      $('history-body').textContent = '正在加载历史...';
      $('history-modal').hidden = false;
      await loadSessionHistory('');
    }

    async function loadSessionHistory(query) {
      if (!historySessionId) return;
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      const url = '/api/sessions/' + encodeURIComponent(historySessionId) + '/history'
        + (params.toString() ? ('?' + params.toString()) : '');
      const data = await requestJson(url);
      renderHistory(data);
    }

    function renderHistory(data) {
      const body = $('history-body');
      body.textContent = '';
      const messages = (data && data.messages) || [];
      const total = data && data.total ? data.total : 0;
      $('history-count').textContent = total
        ? ('显示 ' + messages.length + ' / ' + total + ' 条' + (data.truncated ? '（仅最近）' : ''))
        : '';
      if (!data || !data.sessionPath) {
        body.textContent = '没有找到这条会话的 Codex 历史文件。';
        return;
      }
      if (!messages.length) {
        body.textContent = '没有匹配的历史消息。';
        return;
      }
      for (const message of messages) {
        const card = document.createElement('div');
        card.className = 'history-msg ' + (message.role === 'user' ? 'user' : 'assistant');
        const meta = document.createElement('div');
        meta.className = 'history-meta';
        const role = document.createElement('span');
        role.className = 'history-role';
        role.textContent = message.role === 'user' ? '用户' : '助手';
        meta.appendChild(role);
        const time = document.createElement('span');
        time.textContent = fmtTime(message.timestamp) || '';
        meta.appendChild(time);
        const text = document.createElement('div');
        text.className = 'history-text';
        text.textContent = message.text || '';
        card.appendChild(meta);
        card.appendChild(text);
        body.appendChild(card);
      }
    }

    function closeSessionHistory() {
      historySessionId = null;
      $('history-modal').hidden = true;
    }

    function openDonateModal() {
      $('donate-modal').hidden = false;
    }

    function closeDonateModal() {
      $('donate-modal').hidden = true;
    }

    function openSetupWizard(step) {
      $('setup-modal').hidden = false;
      setSetupStep(Number.isFinite(Number(step)) ? Number(step) : state.setupStep || 0);
    }

    function closeSetupWizard() {
      $('setup-modal').hidden = true;
    }

    function setSetupStep(step) {
      const next = Math.max(0, Math.min(4, Number(step || 0)));
      state.setupStep = next;
      for (const tab of document.querySelectorAll('[data-setup-step]')) {
        tab.classList.toggle('active', Number(tab.dataset.setupStep) === next);
      }
      for (const panel of document.querySelectorAll('[data-setup-panel]')) {
        panel.classList.toggle('active', Number(panel.dataset.setupPanel) === next);
      }
      $('setup-prev').disabled = next === 0;
      $('setup-next').style.display = next < 4 ? '' : 'none';
      $('setup-complete').style.display = next === 4 ? '' : 'none';
      $('setup-save-provider').style.display = next === 1 ? '' : 'none';
      $('setup-ccswitch-sync').style.display = next === 1 ? '' : 'none';
      $('setup-refresh').style.display = next === 2 ? '' : 'none';
    }

    function setupCheckCard(title, check) {
      const card = document.createElement('div');
      const ok = Boolean(check && check.ok);
      card.className = 'setup-check ' + (ok ? 'ok' : 'warn');
      const head = document.createElement('div');
      head.className = 'setup-check-title';
      const label = document.createElement('span');
      label.textContent = title;
      const pill = document.createElement('span');
      pill.className = ok ? 'pill ok' : 'pill warn';
      pill.textContent = ok ? '通过' : '待处理';
      head.appendChild(label);
      head.appendChild(pill);
      const main = document.createElement('div');
      main.textContent = (check && check.label) || '-';
      const detail = document.createElement('div');
      detail.className = 'setup-check-detail';
      detail.textContent = (check && check.detail) || '';
      card.appendChild(head);
      card.appendChild(main);
      card.appendChild(detail);
      return card;
    }

    function renderSetup(data) {
      const setup = (data && data.setup) || {};
      const settings = (data && data.settings) || {};
      const checks = setup.checks || {};
      const modelProvider = settings.modelProvider || state.currentModelProvider || {};
      $('setup-data-dir').textContent = data.stateDir || (checks.dataDir && checks.dataDir.path) || '-';
      $('setup-env-file').textContent = modelProvider.serviceEnvFile || (checks.serviceEnvFile && checks.serviceEnvFile.path) || '-';
      $('setup-codex-home').textContent = (checks.codexHome && checks.codexHome.path) || modelProvider.codexHome || '-';
      $('setup-admin-url').textContent = data.adminUrl || window.location.href;
      $('setup-status').textContent = setup.completedAt
        ? '已完成'
        : setup.skippedAt
          ? '已跳过'
          : setup.needsSetup
            ? '需要配置'
            : '检查通过';
      $('setup-status').className = setup.needsSetup ? 'pill warn' : 'pill ok';
      if ($('setup-modal').hidden || state.setupStep !== 1) {
        renderSetupProvider(modelProvider);
      }
      renderSetupChecks(checks);
      renderSetupPairing(data.pairing);
      if (setup.needsSetup && !state.setupAutoOpened) {
        state.setupAutoOpened = true;
        openSetupWizard(0);
      }
    }

    function renderSetupChecks(checks) {
      const entries = [
        ['数据目录', checks.dataDir],
        ['配置文件', checks.serviceEnvFile],
        ['Node 环境', checks.node],
        ['Codex CLI', checks.codex],
        ['模型配置', checks.modelProvider],
        ['微信入口', checks.weixinAccount]
      ];
      for (const id of ['setup-checks', 'setup-final-checks']) {
        const box = $(id);
        box.textContent = '';
        for (const [title, check] of entries) {
          box.appendChild(setupCheckCard(title, check || {}));
        }
      }
    }

    function formatSessionAccounts(session) {
      const scopes = Array.isArray(session.scopes) ? session.scopes : [];
      if (!scopes.length) return '未绑定';
      return scopes.map((scope) => scope.accountDisplayName || scope.accountId || scope.scopeId || scope.externalScopeId).filter(Boolean).join('，') || '未绑定';
    }

    function formatSessionModel(session) {
      return [session.model, session.reasoningEffort].filter(Boolean).join(' / ') || '-';
    }

    function renderRuntimeStatus(data) {
      const bridge = data.bridge || {};
      const weixin = bridge.weixin || {};
      const active = Number(bridge.activeTurns || 0);
      const queued = Number(bridge.queuedTurns || 0);
      const maxTurns = Number(bridge.maxConcurrentTurns || 0);
      const eventDispatch = Number(bridge.eventDispatchConcurrency || 0);
      const accountPoll = Number(weixin.accountPollConcurrency || 0);
      const accountCount = Number(weixin.accountCount || 0);
      $('metric-turns').textContent = active + ' 运行 / ' + queued + ' 排队 / 上限 ' + (maxTurns || '-');
      $('metric-events').textContent = '分发 ' + (eventDispatch || '-') + ' / 补发 ' + (bridge.pendingDeliveryRetries || 0);
      $('metric-accounts').textContent = accountCount + ' 个 / 轮询 ' + (accountPoll || '-');
      $('metric-error').textContent = bridge.lastError
        ? String(bridge.lastError).slice(0, 80)
        : '无';
      $('metric-error').title = bridge.lastError || '';
      $('status-updated').textContent = [
        '上次轮询 ' + fmtRelativeMs(bridge.lastPollAt),
        '上次提交 ' + fmtRelativeMs(bridge.lastCommitAt),
        '重启 ' + (bridge.restartCount || 0) + ' 次'
      ].join('  ');
      $('overview-updated').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
      $('chart-concurrency-label').textContent = maxTurns ? ('上限 ' + maxTurns) : '未配置';
      $('chart-turns-active-label').textContent = active + ' / ' + (maxTurns || 0);
      setWidth('chart-turns-active-fill', maxTurns ? pct(active, maxTurns) : 0);
      $('chart-events-label').textContent = eventDispatch ? ('分发 ' + eventDispatch) : '未配置';
      setWidth('chart-events-fill', eventDispatch ? Math.min(100, Math.max(8, eventDispatch * 6)) : 0);
      $('chart-poll-label').textContent = accountCount + ' 个账号 / 并发 ' + (accountPoll || 0);
      setWidth('chart-poll-fill', accountPoll ? pct(Math.min(accountCount, accountPoll), accountPoll) : 0);
    }

    function renderSettings(settings) {
      const concurrency = settings.concurrency || {};
      const logCleanup = settings.logCleanup || {};
      $('max-concurrent-turns').value = concurrency.maxConcurrentTurns || 3;
      $('event-dispatch-concurrency').value = concurrency.eventDispatchConcurrency || 12;
      $('attachment-concurrency').value = concurrency.attachmentProcessingConcurrency || 3;
      $('account-poll-concurrency').value = concurrency.accountPollConcurrency || 4;
      $('log-retention-days').value = logCleanup.retentionDays || 7;
      $('log-max-mb').value = Math.max(1, Math.round(Number(logCleanup.maxBytes || 10485760) / 1024 / 1024));
      $('log-cleanup-interval').value = logCleanup.intervalMinutes || 60;
      $('alert-webhook-url').value = settings.alertWebhookUrl || '';
      renderModelProvider(settings.modelProvider || {});
    }

    function renderLogSummary(logs) {
      const settings = logs.settings || {};
      $('logs-size').textContent = '日志大小：' + fmtBytes(logs.totalSizeBytes || 0);
      $('logs-policy').textContent = '自动清理：'
        + (settings.enabled === false ? '关闭' : '开启')
        + '，保留 ' + (settings.retentionDays || 7)
        + ' 天，单文件上限 ' + fmtBytes(settings.maxBytes || 10485760);
    }

    function renderLogs(data) {
      renderLogSummary(data);
      const files = Array.isArray(data && data.files) ? data.files : [];
      const hasContent = files.some((file) => String(file && file.text || '').trim());
      $('logs-box').textContent = hasContent ? (data.text || '(暂无日志)') : '(暂无日志)';
    }

    async function loadLogs() {
      const data = await requestJson('/api/logs?limit=300');
      renderLogs(data);
    }

    function renderBridge(bridge) {
      const running = Boolean(bridge && bridge.running);
      const starting = Boolean(bridge && bridge.starting);
      const stopping = Boolean(bridge && bridge.stopping);
      const restarting = Boolean(bridge && bridge.restarting);
      const retryCount = Number(bridge && bridge.pendingDeliveryRetries || 0);
      const label = restarting ? '重启中' : starting ? '启动中' : stopping ? '停止中' : running ? '桥接运行中' : '桥接已停止';
      $('service-state').textContent = label;
      $('service-state').title = retryCount > 0 ? ('待补发消息：' + retryCount) : '';
      $('service-state').className = running || starting || restarting ? 'pill ok' : 'pill warn';
      $('bridge-start').disabled = running || starting || restarting;
      $('bridge-restart').disabled = starting || stopping || restarting;
      $('bridge-stop').disabled = !running || stopping || restarting;
    }

    function renderAccounts(accounts) {
      const body = $('accounts-body');
      body.textContent = '';
      if (!accounts.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.className = 'muted';
        td.textContent = '暂无账号';
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }
      for (const account of accounts) {
        const tr = document.createElement('tr');
        tr.appendChild(nameCell(account));
        tr.appendChild(accountIdCell(account));
        tr.appendChild(textCell('用户', account.userId || '-'));
        tr.appendChild(statusCell(account));
        tr.appendChild(actionCell(account));
        body.appendChild(tr);
      }
    }

    function nameCell(account) {
      const td = document.createElement('td');
      td.dataset.label = '名称';
      const wrap = document.createElement('div');
      wrap.className = 'name-cell';
      const row = document.createElement('div');
      row.className = 'rename-row';
      const input = document.createElement('input');
      input.value = account.displayName || '';
      input.placeholder = account.primary ? '我的账号' : '朋友备注';
      const save = document.createElement('button');
      save.textContent = '保存';
      save.onclick = async () => {
        await patchAccount(account.accountId, { displayName: input.value });
      };
      row.appendChild(input);
      row.appendChild(save);
      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.textContent = '添加：' + (fmtTime(account.savedAt) || '-') + '  同步：' + (fmtTime(account.syncUpdatedAt) || '-');
      wrap.appendChild(row);
      wrap.appendChild(meta);
      td.appendChild(wrap);
      return td;
    }

    function accountIdCell(account) {
      const td = document.createElement('td');
      td.dataset.label = '账号';
      const wrap = document.createElement('div');
      wrap.className = 'account-id';
      const main = document.createElement('div');
      main.className = 'account-id-main';
      main.textContent = account.accountId || '-';
      wrap.appendChild(main);
      const sub = document.createElement('div');
      sub.className = 'account-id-sub';
      sub.textContent = account.primary ? '主账号' : '朋友入口';
      wrap.appendChild(sub);
      td.appendChild(wrap);
      return td;
    }

    function textCell(label, text) {
      const td = document.createElement('td');
      td.dataset.label = label;
      td.textContent = text || '-';
      return td;
    }

    function statusCell(account) {
      const td = document.createElement('td');
      td.dataset.label = '状态';
      const pill = document.createElement('span');
      pill.className = account.disabled ? 'pill warn' : 'pill ok';
      pill.textContent = account.disabled ? '已禁用' : '监听中';
      td.appendChild(pill);
      return td;
    }

    function actionCell(account) {
      const td = document.createElement('td');
      td.dataset.label = '操作';
      const wrap = document.createElement('div');
      wrap.className = 'actions account-actions';
      if (account.primary) {
        const badge = document.createElement('span');
        badge.className = 'tag-primary';
        badge.textContent = '★ 当前主账号';
        wrap.appendChild(badge);
        td.appendChild(wrap);
        return td;
      }
      const primary = document.createElement('button');
      primary.textContent = '设为主账号';
      primary.onclick = async () => {
        await setPrimaryAccount(account.accountId);
      };
      const toggle = document.createElement('button');
      toggle.textContent = account.disabled ? '启用' : '禁用';
      toggle.onclick = async () => {
        await patchAccount(account.accountId, { disabled: !account.disabled });
      };
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '删除';
      del.onclick = async () => {
        if (!confirm('确认删除这个入口？')) return;
        await requestJson('/api/accounts/' + encodeURIComponent(account.accountId), { method: 'DELETE' });
        await loadState();
      };
      wrap.appendChild(primary);
      wrap.appendChild(toggle);
      wrap.appendChild(del);
      td.appendChild(wrap);
      return td;
    }

    async function setPrimaryAccount(accountId) {
      await requestJson('/api/primary', {
        method: 'POST',
        body: JSON.stringify({ accountId })
      });
      await loadState();
    }

    async function patchAccount(accountId, patch) {
      await requestJson('/api/accounts/' + encodeURIComponent(accountId), {
        method: 'PATCH',
        body: JSON.stringify(patch)
      });
      await loadState();
    }

    const CUSTOM_MODEL_OPTION = '__custom__';

    function populateModelOptionsFor(selectId, customId, presetKey, selectedModel) {
      const preset = providerPresets[presetKey] || providerPresets.default;
      const select = $(selectId);
      const custom = $(customId);
      const models = Array.isArray(preset.models) && preset.models.length
        ? preset.models.slice()
        : [preset.model].filter(Boolean);
      const wanted = String(selectedModel || '').trim();
      if (wanted && !models.includes(wanted)) {
        models.push(wanted);
      }
      select.innerHTML = '';
      for (const model of models) {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        select.appendChild(option);
      }
      const customOption = document.createElement('option');
      customOption.value = CUSTOM_MODEL_OPTION;
      customOption.textContent = '自定义…';
      select.appendChild(customOption);
      select.value = wanted || preset.model || models[0] || '';
      custom.value = '';
      custom.style.display = 'none';
    }

    function populateModelOptions(presetKey, selectedModel) {
      populateModelOptionsFor('provider-model', 'provider-model-custom', presetKey, selectedModel);
    }

    function syncCustomModelVisibilityFor(selectId, customId) {
      const select = $(selectId);
      const custom = $(customId);
      const isCustom = select.value === CUSTOM_MODEL_OPTION;
      custom.style.display = isCustom ? '' : 'none';
      if (isCustom) {
        custom.focus();
      }
    }

    function syncCustomModelVisibility() {
      syncCustomModelVisibilityFor('provider-model', 'provider-model-custom');
    }

    function getSelectedModelFrom(selectId, customId) {
      const select = $(selectId);
      if (select.value === CUSTOM_MODEL_OPTION) {
        return $(customId).value.trim();
      }
      return String(select.value || '').trim();
    }

    function getSelectedModel() {
      return getSelectedModelFrom('provider-model', 'provider-model-custom');
    }

    function presetKeyForProvider(provider) {
      const capabilities = String(provider.capabilities || '').toLowerCase();
      if (providerPresets[capabilities]) {
        return capabilities;
      }
      const providerId = String(provider.providerId || '').toLowerCase();
      for (const [key, preset] of Object.entries(providerPresets)) {
        if (providerId === String(preset.providerId).toLowerCase()) {
          return key;
        }
      }
      const providerName = String(provider.providerName || '').replace(/\s+/g, '').toLowerCase();
      if (providerName.includes('claude')) {
        return 'claude-code';
      }
      if (providerName.includes('deepseek')) {
        return 'deepseek';
      }
      if (providerName.includes('qwen')) {
        return 'qwen';
      }
      if (providerName.includes('openrouter')) {
        return 'openrouter';
      }
      if (providerName.includes('kimi') || providerName.includes('moonshot')) {
        return 'kimi';
      }
      if (providerName.includes('gemini') || providerName.includes('google')) {
        return 'gemini';
      }
      if (providerName.includes('minimax')) {
        return 'minimax';
      }
      if (providerName.includes('iflow')) {
        return 'iflow';
      }
      return 'default';
    }

    function renderModelProvider(provider) {
      state.currentModelProvider = provider || {};
      const presetKey = presetKeyForProvider(state.currentModelProvider);
      const preset = providerPresets[presetKey] || providerPresets.default;
      $('provider-preset').value = presetKey;
      $('provider-name').value = state.currentModelProvider.providerName || preset.providerName || '';
      populateModelOptions(presetKey, state.currentModelProvider.model || '');
      $('provider-base-url').value = state.currentModelProvider.baseUrl || preset.baseUrl || '';
      $('provider-api-key').value = '';
      $('provider-key-status').textContent = state.currentModelProvider.apiKeyConfigured
        ? ('已配置：' + (state.currentModelProvider.apiKeyMasked || '********'))
        : '未配置';
      $('provider-env-file').value = state.currentModelProvider.serviceEnvFile || '';
      $('provider-source').value = state.currentModelProvider.source || 'manual';
      $('provider-ccswitch-home').value = (state.currentModelProvider.ccswitch && state.currentModelProvider.ccswitch.codexHome) || '';
      $('provider-ccswitch-interval').value = Math.max(2, Math.round(Number((state.currentModelProvider.ccswitch && state.currentModelProvider.ccswitch.intervalMs) || 10000) / 1000));
      renderCcswitchStatus('provider-ccswitch-status', state.currentModelProvider.ccswitch);
    }

    function applyProviderPreset(presetKey) {
      const preset = providerPresets[presetKey] || providerPresets.default;
      $('provider-name').value = preset.providerName;
      populateModelOptions(presetKey, preset.model);
      $('provider-base-url').value = preset.baseUrl;
      $('provider-message').textContent = '';
    }

    function renderSetupProvider(provider) {
      const current = provider || {};
      const presetKey = presetKeyForProvider(current);
      const preset = providerPresets[presetKey] || providerPresets.default;
      $('setup-provider-preset').value = presetKey;
      $('setup-provider-name').value = current.providerName || preset.providerName || '';
      populateModelOptionsFor('setup-provider-model', 'setup-provider-model-custom', presetKey, current.model || '');
      $('setup-provider-base-url').value = current.baseUrl || preset.baseUrl || '';
      $('setup-provider-api-key').value = '';
      $('setup-provider-env-file').value = current.serviceEnvFile || '';
      $('setup-provider-source').value = current.source || 'manual';
      $('setup-provider-ccswitch-home').value = (current.ccswitch && current.ccswitch.codexHome) || '';
      $('setup-provider-ccswitch-interval').value = Math.max(2, Math.round(Number((current.ccswitch && current.ccswitch.intervalMs) || 10000) / 1000));
      renderCcswitchStatus('setup-provider-ccswitch-status', current.ccswitch);
    }

    function applySetupProviderPreset(presetKey) {
      const preset = providerPresets[presetKey] || providerPresets.default;
      $('setup-provider-name').value = preset.providerName;
      populateModelOptionsFor('setup-provider-model', 'setup-provider-model-custom', presetKey, preset.model);
      $('setup-provider-base-url').value = preset.baseUrl;
      $('setup-provider-message').textContent = '';
    }

    function readProviderPayloadFrom(prefix) {
      const preset = providerPresets[$(prefix + '-preset').value] || providerPresets.default;
      const current = state.currentModelProvider || {};
      const providerName = $(prefix + '-name').value.trim() || preset.providerName || current.providerName || 'Z Token';
      const model = getSelectedModelFrom(prefix + '-model', prefix + '-model-custom');
      const baseUrl = $(prefix + '-base-url').value.trim();
      const apiKey = $(prefix + '-api-key').value.trim();
      const serviceEnvFile = $(prefix + '-env-file').value.trim();
      const source = $(prefix + '-source').value || 'manual';
      const ccswitchCodexHome = $(prefix + '-ccswitch-home').value.trim();
      const ccswitchSyncIntervalMs = Math.max(2, Number.parseInt($(prefix + '-ccswitch-interval').value || '10', 10) || 10) * 1000;
      if (!model) {
        throw new Error('请填写模型名称');
      }
      if (!serviceEnvFile) {
        throw new Error('请填写配置文件路径');
      }
      const lowerBaseUrl = baseUrl.toLowerCase();
      if (!lowerBaseUrl.startsWith('http://') && !lowerBaseUrl.startsWith('https://')) {
        throw new Error('接口地址必须以 http:// 或 https:// 开头');
      }
      const payload = {
        profileId: preset.profileId || current.profileId || 'openai-default',
        providerId: preset.providerId || current.providerId || 'openai-compatible',
        providerName,
        baseUrl,
        model,
        modelIds: model,
        capabilities: preset.capabilities || current.capabilities || 'default',
        serviceEnvFile,
        source,
        ccswitchCodexHome,
        ccswitchSyncIntervalMs
      };
      if (apiKey) {
        payload.apiKey = apiKey;
      }
      return payload;
    }

    function renderCcswitchStatus(id, ccswitch) {
      const el = $(id);
      if (!el) return;
      const last = ccswitch && ccswitch.lastSync;
      if (!ccswitch || !ccswitch.enabled) {
        el.textContent = '未启用跟随';
        return;
      }
      if (!last) {
        el.textContent = '等待自动同步';
        return;
      }
      const ok = last.ok ? '成功' : '失败';
      const model = last.model ? (' · ' + last.model) : '';
      const time = last.syncedAt ? (' · ' + fmtTime(last.syncedAt)) : '';
      el.textContent = ok + model + time + ' · ' + (last.message || '');
      el.title = [
        last.configPath ? ('config: ' + last.configPath) : '',
        last.authPath ? ('auth: ' + last.authPath) : '',
        Array.isArray(last.errors) && last.errors.length ? last.errors.join('\\n') : ''
      ].filter(Boolean).join('\\n');
    }

    function readModelProviderPayload() {
      return readProviderPayloadFrom('provider');
    }

    async function saveProviderSettings() {
      $('provider-message').textContent = '正在保存...';
      const data = await requestJson('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          modelProvider: readModelProviderPayload()
        })
      });
      renderSettings(data.settings || {});
      $('provider-api-key').value = '';
      $('provider-message').textContent = '已保存。新一轮微信对话会使用最新配置。';
    }

    async function syncProviderFromCcswitch(targetPrefix) {
      const isSetup = targetPrefix === 'setup-provider';
      const messageId = isSetup ? 'setup-provider-message' : 'provider-message';
      $(messageId).textContent = '正在读取 CCSwitch / Codex 当前配置...';
      const data = await requestJson('/api/model-provider/sync-ccswitch', {
        method: 'POST',
        body: JSON.stringify({
          codexHome: $(targetPrefix + '-ccswitch-home').value.trim(),
          persistSource: true
        })
      });
      renderSettings(data.settings || {});
      renderSetup(data.state || {});
      $(messageId).textContent = data.message || '已同步 CCSwitch / Codex 当前配置';
      if (data.state && data.state.settings) {
        renderSettings(data.state.settings);
      }
    }

    async function saveSetupProviderSettings() {
      $('setup-provider-message').textContent = '正在保存...';
      const data = await requestJson('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          modelProvider: readProviderPayloadFrom('setup-provider')
        })
      });
      state.setup = (data.state && data.state.setup) || null;
      renderSettings(data.settings || {});
      renderSetup(data.state || {});
      $('setup-provider-api-key').value = '';
      $('setup-provider-message').textContent = '已保存。新一轮微信对话会使用最新配置。';
    }

    async function saveSettings() {
      const payload = {
        concurrency: {
          maxConcurrentTurns: readPositiveIntInput('max-concurrent-turns', 3),
          eventDispatchConcurrency: readPositiveIntInput('event-dispatch-concurrency', 12),
          attachmentProcessingConcurrency: readPositiveIntInput('attachment-concurrency', 3),
          accountPollConcurrency: readPositiveIntInput('account-poll-concurrency', 4)
        },
        logCleanup: {
          enabled: true,
          retentionDays: readPositiveIntInput('log-retention-days', 7),
          maxBytes: readPositiveIntInput('log-max-mb', 10) * 1024 * 1024,
          intervalMinutes: readPositiveIntInput('log-cleanup-interval', 60)
        },
        alertWebhookUrl: $('alert-webhook-url').value
      };
      $('settings-message').textContent = '正在保存...';
      const data = await requestJson('/api/settings', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      renderSettings(data.settings || {});
      renderRuntimeStatus(data.state || {});
      renderLogSummary((data.state && data.state.logs) || {});
      await loadLogs();
      $('settings-message').textContent = '已保存并即时生效';
    }

    async function testAlertWebhook() {
      const url = $('alert-webhook-url').value.trim();
      $('settings-message').textContent = '正在发送测试告警...';
      const data = await requestJson('/api/alert/test', {
        method: 'POST',
        body: JSON.stringify({ url: url })
      });
      if (!data.configured) {
        $('settings-message').textContent = '请先填写 Webhook 地址';
      } else if (data.ok) {
        $('settings-message').textContent = '测试告警已发送，请检查接收端';
      } else {
        $('settings-message').textContent = '发送失败：请检查地址是否可达（需 http/https）';
      }
    }

    async function importBackup() {
      const fileInput = $('import-file');
      const file = fileInput.files && fileInput.files[0];
      if (!file) {
        $('import-message').textContent = '请先选择一个备份 JSON 文件';
        return;
      }
      if (!confirm('导入会覆盖同 id 的账号和会话记录，确定继续？')) {
        return;
      }
      $('import-message').textContent = '正在导入...';
      const text = await file.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (parseError) {
        $('import-message').textContent = '文件不是有效的 JSON';
        return;
      }
      const data = await requestJson('/api/import', { method: 'POST', body: JSON.stringify(payload) });
      const im = data.imported || {};
      const parts = [
        '账号 ' + (im.accounts || 0),
        '会话 ' + (im.bridgeSessions || 0),
        '绑定 ' + (im.platformBindings || 0),
        '设置 ' + (im.sessionSettings || 0),
        '供应商 ' + (im.providerProfiles || 0),
        '元数据 ' + (im.threadMetadata || 0)
      ];
      const errCount = Array.isArray(data.errors) ? data.errors.length : 0;
      $('import-message').textContent = '导入完成：' + parts.join('，') + (errCount ? ('（' + errCount + ' 条失败）') : '');
      fileInput.value = '';
      renderImportFileState();
      await loadState();
    }

    async function cleanupLogsNow() {
      $('settings-message').textContent = '正在清理日志...';
      const data = await requestJson('/api/logs/cleanup', { method: 'POST' });
      renderLogs(data.logs || {});
      const count = data.cleanup && Array.isArray(data.cleanup.actions) ? data.cleanup.actions.length : 0;
      $('settings-message').textContent = count ? ('已清理 ' + count + ' 个日志文件') : '无需清理';
    }

    async function copyLogsNow() {
      const text = String($('logs-box').textContent || '');
      if (!text.trim() || text.trim() === '(暂无日志)') {
        setMessage('暂无可复制的日志', true);
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setMessage('日志已复制');
    }

    function renderPairing(pairing) {
      const status = $('pairing-status');
      const box = $('qr-box');
      const link = $('qr-link');
      status.textContent = pairing ? pairing.status : '未生成';
      status.className = pairing && pairing.status === 'confirmed' ? 'pill ok' : 'pill';
      box.textContent = '';
      link.textContent = '';
      if (pairing && pairing.qrImageDataUrl) {
        const img = document.createElement('img');
        img.src = pairing.qrImageDataUrl;
        img.alt = '微信二维码';
        box.appendChild(img);
        box.classList.remove('clickable');
        box.title = '';
      } else {
        const empty = document.createElement('span');
        empty.className = 'muted';
        empty.textContent = pairing && pairing.status === 'starting' ? '正在生成二维码...' : '点击生成二维码';
        box.appendChild(empty);
        box.classList.add('clickable');
        box.title = '点击生成二维码';
      }
      if (pairing && pairing.qrUrl) {
        const a = document.createElement('a');
        a.href = pairing.qrUrl;
        a.textContent = pairing.qrUrl;
        a.target = '_blank';
        a.rel = 'noreferrer';
        link.appendChild(a);
      }
      if (pairing && pairing.status === 'confirmed') {
        setMessage('已添加：' + pairing.accountId, false);
        window.clearInterval(state.pairingTimer);
        state.pairingTimer = null;
        void loadState();
      } else if (pairing && pairing.error) {
        setMessage(pairing.error, true);
      }
    }

    function renderSetupPairing(pairing) {
      const box = $('setup-qr-box');
      const link = $('setup-qr-link');
      const message = $('setup-message');
      box.textContent = '';
      link.textContent = '';
      message.textContent = '';
      if (pairing && pairing.qrImageDataUrl) {
        const img = document.createElement('img');
        img.src = pairing.qrImageDataUrl;
        img.alt = '微信二维码';
        box.appendChild(img);
      } else {
        const empty = document.createElement('span');
        empty.className = 'muted';
        empty.textContent = pairing && pairing.status === 'starting' ? '正在生成二维码...' : '点击生成二维码';
        box.appendChild(empty);
      }
      if (pairing && pairing.qrUrl) {
        const a = document.createElement('a');
        a.href = pairing.qrUrl;
        a.textContent = pairing.qrUrl;
        a.target = '_blank';
        a.rel = 'noreferrer';
        link.appendChild(a);
      }
      if (pairing && pairing.status === 'confirmed') {
        message.textContent = '已添加：' + pairing.accountId;
        message.style.color = '#059669';
      } else if (pairing && pairing.error) {
        message.textContent = pairing.error;
        message.style.color = '#e11d48';
      } else if (pairing) {
        message.textContent = '状态：' + pairing.status;
        message.style.color = '#64708a';
      }
    }

    async function startPairing(displayName) {
      setMessage('正在生成二维码...', false);
      const data = await requestJson('/api/pairing/start', {
        method: 'POST',
        body: JSON.stringify({ displayName: displayName ?? $('display-name').value })
      });
      renderPairing(data.pairing);
      renderSetupPairing(data.pairing);
      if (!state.pairingTimer) {
        state.pairingTimer = window.setInterval(refreshPairingStatus, 2000);
      }
      setMessage('等待微信扫码确认', false);
    }

    async function refreshPairingStatus() {
      const data = await requestJson('/api/pairing/current');
      renderPairing(data.pairing);
      renderSetupPairing(data.pairing);
    }

    async function startSetupPairing() {
      $('setup-message').textContent = '正在生成二维码...';
      await startPairing($('setup-display-name').value);
      $('setup-message').textContent = '等待微信扫码确认';
    }

    async function completeSetup(skipped) {
      const data = await requestJson('/api/setup/complete', {
        method: 'POST',
        body: JSON.stringify({ skipped: Boolean(skipped) })
      });
      state.setup = data.setup || null;
      renderSetup(data.state || {});
      if (!skipped) {
        closeSetupWizard();
        setMessage('首次配置引导已完成', false);
      } else {
        closeSetupWizard();
        setMessage('已跳过首次配置引导，可随时重新打开配置向导', false);
      }
    }

    for (const link of document.querySelectorAll('.side-nav a[data-page]')) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        showPage(link.dataset.page);
      });
    }
    window.addEventListener('hashchange', () => showPage(window.location.hash.slice(1) || 'overview'));
    showPage(window.location.hash.slice(1) || 'overview');

    $('refresh-btn').onclick = () => loadState().catch((error) => setMessage(error.message, true));
    $('bridge-start').onclick = async () => {
      setMessage('正在启动微信桥接...', false);
      const data = await requestJson('/api/bridge/start', { method: 'POST' });
      renderBridge(data.bridge || { running: true });
      await loadState();
      setMessage('微信桥接已启动', false);
    };
    $('bridge-restart').onclick = async () => {
      setMessage('正在重启微信桥接...', false);
      const data = await requestJson('/api/bridge/restart', { method: 'POST' });
      renderBridge(data.bridge || { running: true });
      await loadState();
      setMessage('微信桥接已重启', false);
    };
    $('bridge-stop').onclick = async () => {
      if (!confirm('停止后，微信消息会暂停处理。管理面板仍可继续打开。')) return;
      setMessage('正在停止微信桥接...', false);
      const data = await requestJson('/api/bridge/stop', { method: 'POST' });
      renderBridge(data.bridge || { running: false });
      await loadState();
      setMessage('微信桥接已停止', false);
    };
    $('start-pairing').onclick = () => startPairing().catch((error) => setMessage(error.message, true));
    $('refresh-pairing').onclick = () => startPairing().catch((error) => setMessage(error.message, true));
    $('qr-box').onclick = () => {
      if ($('qr-box').querySelector('img')) return;
      startPairing().catch((error) => setMessage(error.message, true));
    };
    $('qr-box').addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !$('qr-box').querySelector('img')) {
        event.preventDefault();
        startPairing().catch((error) => setMessage(error.message, true));
      }
    });
    $('cancel-pairing').onclick = async () => {
      await requestJson('/api/pairing/cancel', { method: 'POST' });
      await loadState();
      setMessage('已取消', false);
    };
    $('setup-open').onclick = () => openSetupWizard(0);
    $('setup-close').onclick = () => closeSetupWizard();
    $('setup-prev').onclick = () => setSetupStep(state.setupStep - 1);
    $('setup-next').onclick = () => setSetupStep(state.setupStep + 1);
    $('setup-refresh').onclick = () => loadState().catch((error) => {
      $('setup-status').textContent = '检查失败';
      setMessage(error.message, true);
    });
    $('setup-save-provider').onclick = () => saveSetupProviderSettings().catch((error) => {
      $('setup-provider-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('setup-ccswitch-sync').onclick = () => syncProviderFromCcswitch('setup-provider').catch((error) => {
      $('setup-provider-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('setup-complete').onclick = () => completeSetup(false).catch((error) => setMessage(error.message, true));
    $('setup-skip').onclick = () => completeSetup(true).catch((error) => setMessage(error.message, true));
    $('setup-provider-preset').onchange = () => applySetupProviderPreset($('setup-provider-preset').value);
    $('setup-provider-model').onchange = () => syncCustomModelVisibilityFor('setup-provider-model', 'setup-provider-model-custom');
    $('setup-provider-source').onchange = () => {
      $('setup-provider-message').textContent = $('setup-provider-source').value === 'ccswitch'
        ? '保存后将自动跟随 CCSwitch / Codex 当前配置'
        : '已切换为手动填写模式';
    };
    $('setup-start-pairing').onclick = () => startSetupPairing().catch((error) => {
      $('setup-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('setup-refresh-pairing').onclick = () => startSetupPairing().catch((error) => {
      $('setup-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('setup-qr-box').onclick = () => {
      if ($('setup-qr-box').querySelector('img')) return;
      startSetupPairing().catch((error) => {
        $('setup-message').textContent = error.message;
        setMessage(error.message, true);
      });
    };
    for (const tab of document.querySelectorAll('[data-setup-step]')) {
      tab.addEventListener('click', () => setSetupStep(Number(tab.dataset.setupStep || 0)));
    }
    $('sessions-refresh').onclick = () => loadSessions().catch((error) => setMessage(error.message, true));
    $('donate-open').onclick = () => openDonateModal();
    $('donate-open-side').onclick = () => openDonateModal();
    $('donate-close').onclick = () => closeDonateModal();
    $('donate-modal').addEventListener('click', (event) => {
      if (event.target === $('donate-modal')) {
        closeDonateModal();
      }
    });
    $('history-close').onclick = () => closeSessionHistory();
    $('setup-modal').addEventListener('click', (event) => {
      if (event.target === $('setup-modal')) {
        closeSetupWizard();
      }
    });
    $('history-modal').addEventListener('click', (event) => {
      if (event.target === $('history-modal')) {
        closeSessionHistory();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!$('donate-modal').hidden) closeDonateModal();
        if (!$('history-modal').hidden) closeSessionHistory();
        if (!$('setup-modal').hidden) closeSetupWizard();
      }
    });
    $('history-search').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        void loadSessionHistory($('history-search').value.trim()).catch((error) => setMessage(error.message, true));
      }
    });
    $('session-query').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        void loadSessions().catch((error) => setMessage(error.message, true));
      }
    });
    $('session-account').onchange = () => loadSessions().catch((error) => setMessage(error.message, true));
    $('session-sort').onchange = () => loadSessions().catch((error) => setMessage(error.message, true));
    $('diagnostics-run').onclick = () => runDiagnostics().catch((error) => {
      $('diagnostics-updated').textContent = '检查失败';
      $('diagnostics-summary-text').textContent = error.message;
      setMessage(error.message, true);
    });
    $('metrics-reset').onclick = () => resetMetrics().catch((error) => setMessage(error.message, true));
    $('settings-save').onclick = () => saveSettings().catch((error) => {
      $('settings-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('update-check').onclick = () => checkForUpdate().catch((error) => {
      $('update-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('update-download').onclick = () => downloadUpdate().catch((error) => {
      $('update-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('update-install').onclick = () => installUpdate().catch((error) => {
      $('update-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('alert-test').onclick = () => testAlertWebhook().catch((error) => {
      $('settings-message').textContent = error.message;
    });
    $('provider-preset').onchange = () => applyProviderPreset($('provider-preset').value);
    $('provider-model').onchange = () => syncCustomModelVisibility();
    $('provider-source').onchange = () => {
      $('provider-message').textContent = $('provider-source').value === 'ccswitch'
        ? '保存后将自动跟随 CCSwitch / Codex 当前配置'
        : '已切换为手动填写模式';
    };
    $('provider-save').onclick = () => saveProviderSettings().catch((error) => {
      $('provider-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('provider-ccswitch-sync').onclick = () => syncProviderFromCcswitch('provider').catch((error) => {
      $('provider-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('promo-copy').onclick = () => {
      const url = 'https://ztoken.app/register?aff=8M7CSMLY5J77';
      const notify = () => {
        $('provider-message').textContent = '已复制中转站地址：' + url;
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(notify).catch(() => {
          $('provider-message').textContent = url;
        });
      } else {
        $('provider-message').textContent = url;
      }
    };
    $('logs-cleanup').onclick = () => cleanupLogsNow().catch((error) => {
      $('settings-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('logs-copy').onclick = () => copyLogsNow().catch((error) => setMessage(error.message, true));
    $('logs-refresh').onclick = () => loadLogs().catch((error) => setMessage(error.message, true));
    $('export-backup').onclick = () => {
      window.location.href = '/api/export';
    };
    $('import-backup').onclick = () => importBackup().catch((error) => {
      $('import-message').textContent = error.message;
    });
    $('import-file').onchange = () => renderImportFileState();

    startUpdaterBridge();
    startPageLifecycle();
    state.statusTimer = window.setInterval(() => {
      refreshRuntimeState().catch(() => {});
    }, 5000);
    loadState().catch((error) => {
      $('service-state').textContent = '异常';
      $('service-state').className = 'pill warn';
      setMessage(error.message, true);
    });
  </script>
</body>
</html>`;
}
