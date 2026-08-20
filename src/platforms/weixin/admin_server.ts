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
import { NotFoundError } from '../../core/errors.js';
import type { BridgeSession, SessionSettings, ThreadMetadata } from '../../types/core.js';
import type { ProviderModelCatalog } from '../../core/provider_model_catalog_service.js';
import type { ProviderUsageCatalog, ProviderUsageSnapshot } from '../../core/provider_usage_service.js';
import type { ProviderProfile } from '../../types/provider.js';
import type { PlatformBinding } from '../../types/repository.js';
import {
  WeixinAccountStore,
  isValidWeixinAccountId,
  type SavedWeixinAccount,
} from './account_store.js';
import {
  readJsonFileSafely,
  writeJsonFileAtomically,
  writeTextFileAtomically,
} from '../../store/file_json/json_file_io.js';
import { postAlert } from '../../runtime/alert_webhook.js';
import { DEFAULT_ILINK_BOT_TYPE, officialQrLogin, type OfficialQrLoginCredentials } from './official/login.js';
import {
  reloadContextTokensForAccount,
  replaceContextTokensForAccount,
} from './official/context_tokens.js';
import { renderAdminHtml } from './admin_page.js';

type QrLoginImpl = typeof officialQrLogin;

interface WeixinAdminServerOptions {
  accountStore: WeixinAccountStore;
  stateDir: string;
  adminAssetDir?: string;
  env?: NodeJS.ProcessEnv | Record<string, unknown>;
  host?: string;
  port?: number;
  locale?: string | null;
  qrLogin?: QrLoginImpl;
  bridgeControl?: WeixinBridgeControl | null;
  serviceControl?: WeixinAdminServiceControl | null;
  repositories?: WeixinAdminRepositories | null;
  providerModelCatalog?: ProviderModelCatalog | null;
  providerUsage?: ProviderUsageCatalog | null;
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

interface DeliveryOutboxSummary {
  pending: number;
  oldestCreatedAt: number | null;
  nextAttemptAt: number | null;
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
  retryPendingDeliveries?(): Promise<{
    before: DeliveryOutboxSummary;
    after: DeliveryOutboxSummary;
  }>;
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
    deliveryOutbox?: DeliveryOutboxSummary;
    maxConcurrentTurns?: number;
    activeTurns?: number;
    queuedTurns?: number;
    eventDispatchConcurrency?: number;
    turnRecovery?: {
      total?: number;
      running?: number;
      reconciling?: number;
      uncertain?: number;
      completedPendingDelivery?: number;
      interrupted?: number;
      approvalExpired?: number;
      oldestAgeMs?: number | null;
      lastReconciledAt?: number | null;
      lastErrorCategory?: string | null;
    } | null;
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
const FULL_BACKUP_SERVICE_ENV_KEYS = [
  'WEIXIN_PRIMARY_ACCOUNT_ID',
  'WEIXIN_ACCOUNT_ID',
  'WEIXIN_MAX_CONCURRENT_TURNS',
  'WEIXIN_EVENT_DISPATCH_CONCURRENCY',
  'WEIXIN_ATTACHMENT_CONCURRENCY',
  'WEIXIN_ACCOUNT_POLL_CONCURRENCY',
  'WEIXIN_LOG_CLEANUP_ENABLE',
  'WEIXIN_LOG_RETENTION_DAYS',
  'WEIXIN_LOG_MAX_BYTES',
  'WEIXIN_LOG_CLEANUP_INTERVAL_MINUTES',
  'WEIXIN_ALERT_WEBHOOK_URL',
  'CODEX_DEFAULT_PROVIDER_PROFILE_ID',
  'CODEX_COMPAT_PROVIDER_ID',
  'CODEX_COMPAT_PROVIDER_NAME',
  'CODEX_COMPAT_BASE_URL',
  'CODEX_COMPAT_DEFAULT_MODEL',
  'CODEX_COMPAT_MODEL',
  'CODEX_COMPAT_MODEL_IDS',
  'CODEX_COMPAT_CAPABILITIES',
  'CODEX_COMPAT_API_KEY',
] as const;
const ADMIN_FAVICON_PATH = path.resolve(process.cwd(), 'assets', 'windows', 'codexbridge-weixin.ico');
const ADMIN_FAVICON_PNG_PATH = path.resolve(process.cwd(), 'assets', 'windows', 'codexbridge-weixin.png');
const ADMIN_DONATE_QR_PATH = path.resolve(process.cwd(), 'assets', 'donate', 'wechat-reward.png');

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'ENOENT'
  );
}

export class WeixinAdminServer {
  constructor({
    accountStore,
    stateDir,
    adminAssetDir = path.resolve(process.cwd(), 'assets', 'weixin-admin'),
    env = process.env,
    host = DEFAULT_ADMIN_HOST,
    port = DEFAULT_ADMIN_PORT,
    locale = null,
    qrLogin = officialQrLogin,
    bridgeControl = null,
    serviceControl = null,
    repositories = null,
    providerModelCatalog = null,
    providerUsage = null,
    codexHome = resolveCodexHome(env as NodeJS.ProcessEnv),
    pageCloseShutdownGraceMs = DEFAULT_PAGE_CLOSE_SHUTDOWN_GRACE_MS,
  }: WeixinAdminServerOptions) {
    this.accountStore = accountStore;
    this.stateDir = stateDir;
    this.adminAssetDir = adminAssetDir;
    this.env = env;
    this.host = host;
    this.port = port;
    this.locale = locale;
    this.qrLogin = qrLogin;
    this.bridgeControl = bridgeControl;
    this.serviceControl = serviceControl;
    this.repositories = repositories;
    this.providerModelCatalog = providerModelCatalog;
    this.providerUsage = providerUsage;
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
    this.adminToken = crypto.randomBytes(32).toString('hex');
    this.cspNonce = crypto.randomBytes(18).toString('base64');
  }

  accountStore: WeixinAccountStore;
  stateDir: string;
  adminAssetDir: string;
  env: NodeJS.ProcessEnv | Record<string, unknown>;
  host: string;
  port: number;
  locale: string | null;
  qrLogin: QrLoginImpl;
  bridgeControl: WeixinBridgeControl | null;
  serviceControl: WeixinAdminServiceControl | null;
  repositories: WeixinAdminRepositories | null;
  providerModelCatalog: ProviderModelCatalog | null;
  providerUsage: ProviderUsageCatalog | null;
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
  adminToken: string;
  cspNonce: string;

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
        void this.handleRequest(req, res).catch(() => {
          this.writeJson(res, 500, { error: 'internal server error' });
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
    const browserAuthorizationError = this.browserAuthorizationError(req, url);
    if (browserAuthorizationError) {
      this.writeJson(res, 403, { error: browserAuthorizationError });
      return;
    }
    if (this.requiresExplicitAdminToken(req, pathname) && !this.hasValidAdminToken(req, url)) {
      this.writeJson(res, 403, { error: 'missing or invalid admin token' });
      return;
    }

    const modelRoute = pathname.match(/^\/api\/provider-profiles\/([^/]+)\/models(\/refresh)?$/u);
    if (modelRoute && req.method === 'GET' && !modelRoute[2]) {
      await this.handleProviderModels(res, modelRoute[1] ?? '', false);
      return;
    }

    const usageRoute = pathname.match(/^\/api\/provider-profiles\/([^/]+)\/usage(\/refresh)?$/u);
    if (usageRoute && req.method === 'GET' && !usageRoute[2]) {
      await this.handleProviderUsage(res, usageRoute[1] ?? '', false);
      return;
    }
    if (usageRoute && req.method === 'POST' && usageRoute[2] === '/refresh') {
      await this.handleProviderUsage(res, usageRoute[1] ?? '', true);
      return;
    }
    if (modelRoute && req.method === 'POST' && modelRoute[2] === '/refresh') {
      await this.handleProviderModels(res, modelRoute[1] ?? '', true);
      return;
    }

    if (req.method === 'GET' && pathname === '/') {
      this.writeHtml(res, renderAdminHtml(this.adminToken, this.cspNonce));
      return;
    }
    if (req.method === 'GET' && pathname === '/admin/admin.css') {
      this.writeAdminAsset(res, 'admin.css', 'text/css; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && pathname === '/admin/admin.js') {
      this.writeAdminAsset(res, 'admin.js', 'text/javascript; charset=utf-8');
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
    if (req.method === 'POST' && pathname === '/api/setup/test') {
      await this.handleSetupTest(req, res);
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
    if (req.method === 'GET' && pathname === '/api/export/diagnostic') {
      this.writeJsonDownload(res, this.buildDiagnosticExportPayload(), 'codexbridge-weixin-diagnostic');
      return;
    }
    if (req.method === 'GET' && pathname === '/api/export') {
      this.writeJsonDownload(res, this.buildExportPayload(), 'codexbridge-weixin-backup');
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
    if (req.method === 'POST' && pathname === '/api/delivery-outbox/retry') {
      await this.handleRetryDeliveryOutbox(res);
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

  private async handleProviderModels(
    res: ServerResponse,
    providerProfileId: string,
    forceRefresh: boolean,
  ) {
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

  private async handleProviderUsage(
    res: ServerResponse,
    providerProfileId: string,
    forceRefresh: boolean,
  ) {
    if (!this.providerUsage) {
      this.writeJson(res, 503, { error: 'provider usage unavailable' });
      return;
    }
    try {
      const snapshot = await this.providerUsage.getUsage(providerProfileId, { forceRefresh });
      this.writeJson(res, 200, serializeProviderUsageSnapshot(snapshot));
    } catch (error) {
      if (error instanceof NotFoundError) {
        this.writeJson(res, 404, { error: 'provider profile not found' });
        return;
      }
      this.writeJson(res, 500, { error: 'provider usage unavailable' });
    }
  }

  private browserAuthorizationError(req: IncomingMessage, url: URL): string | null {
    const origin = normalizeEnvString(req.headers.origin);
    const fetchSite = normalizeEnvString(req.headers['sec-fetch-site']);
    if (!origin && !fetchSite) {
      return null;
    }
    if ((origin && !isAllowedAdminOrigin(origin, this.binding?.port ?? this.port)) || fetchSite === 'cross-site') {
      return 'invalid admin origin';
    }
    const pathname = decodeURIComponent(url.pathname);
    const mutatesState = !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method ?? '').toUpperCase())
      || pathname === '/api/page/close';
    if (!mutatesState) {
      return null;
    }
    return this.hasValidAdminToken(req, url)
      ? null
      : 'missing or invalid admin token';
  }

  private requiresExplicitAdminToken(req: IncomingMessage, pathname: string): boolean {
    if (String(req.method ?? '').toUpperCase() !== 'POST') {
      return false;
    }
    return pathname === '/api/delivery-outbox/retry'
      || /^\/api\/provider-profiles\/[^/]+\/(?:models|usage)\/refresh$/u.test(pathname);
  }

  private hasValidAdminToken(req: IncomingMessage, url: URL): boolean {
    const suppliedToken = normalizeEnvString(req.headers['x-codexbridge-admin-token'])
      ?? normalizeEnvString(url.searchParams.get('adminToken'));
    return Boolean(suppliedToken && secureTokenEquals(suppliedToken, this.adminToken));
  }

  private buildState() {
    return {
      stateDir: this.stateDir,
      adminUrl: this.binding?.url ?? null,
      primaryAccountId: this.primaryAccountId(),
      service: {
        shutdownAvailable: Boolean(this.serviceControl),
      },
      bridge: this.bridgeControl?.status
        ? serializeAdminBridgeStatus(this.bridgeControl.status())
        : { running: true },
      settings: this.buildSettings(),
      logs: this.buildLogSummary(),
      accounts: this.listAccounts(),
      providerProfiles: this.listProviderProfiles(),
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
        group: String(account?.group ?? ''),
        role: normalizeAccountRole(account?.role, accountId === primaryAccountId ? 'owner' : 'member'),
        permissions: serializeAccountPermissions(account, accountId === primaryAccountId),
        modelProvider: serializeAccountModelProvider(account),
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
    const currentModelProvider = this.resolveModelProviderSettings();

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
      const rawRememberedAccountId = settings?.metadata?.weixinAccountId;
      const rememberedAccountId = typeof rawRememberedAccountId === 'string'
        ? normalizeAccountId(rawRememberedAccountId)
        : '';
      if (
        rememberedAccountId
        && this.accountStore.loadAccount(rememberedAccountId)
        && !scopes.some((scope) => scope.accountId === rememberedAccountId)
      ) {
        const account = this.accountStore.loadAccount(rememberedAccountId);
        scopes.push({
          platform: 'weixin',
          externalScopeId: '',
          scopeId: '',
          accountId: rememberedAccountId,
          accountDisplayName: String(account?.display_name ?? ''),
          updatedAt: settings?.updatedAt ?? session.updatedAt,
        });
      }
      if (scopes.length === 0 && primaryAccountId && this.accountStore.loadAccount(primaryAccountId)) {
        const account = this.accountStore.loadAccount(primaryAccountId);
        scopes.push({
          platform: 'weixin',
          externalScopeId: '',
          scopeId: '',
          accountId: primaryAccountId,
          accountDisplayName: String(account?.display_name ?? ''),
          updatedAt: settings?.updatedAt ?? session.updatedAt,
        });
      }
      const accountIds = uniqueStrings(scopes.map((scope) => scope.accountId).filter(Boolean));
      const accountModelProvider = resolveScopeModelProvider({
        scopes,
        accountStore: this.accountStore,
        providerProfileId: session.providerProfileId,
      });
      const effectiveModel = resolveEffectiveSessionModel({
        sessionModel: settings?.model ?? null,
        sessionReasoningEffort: settings?.reasoningEffort ?? null,
        accountModelProvider,
        providerDefaultModel: provider?.defaultModel ?? '',
        currentModelProvider,
        providerProfileId: session.providerProfileId,
      });
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
        model: effectiveModel.model,
        modelSource: effectiveModel.modelSource,
        reasoningEffort: effectiveModel.reasoningEffort,
        reasoningEffortSource: effectiveModel.reasoningEffortSource,
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
    if (result.ok && result.changed) {
      this.clearSessionModelOverrides();
      await this.bridgeControl?.restart?.();
    }
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
    if (!changed) {
      return this.recordCcswitchSync({
        ok: true,
        changed: false,
        reason,
        message: '配置没有变化',
        sourceState,
      });
    }
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
      this.providerModelCatalog?.invalidate(profileId);
      this.providerUsage?.invalidate(profileId);
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
      relayProfileMode: 'pure-api',
    }, this.env as NodeJS.ProcessEnv);
    this.repositories.providerProfiles.save(profile);
    this.providerModelCatalog?.invalidate(profile.id);
    this.providerUsage?.invalidate(profile.id);
  }

  private clearSessionModelOverrides() {
    const sessionSettings = this.repositories?.sessionSettings;
    if (!sessionSettings || typeof sessionSettings.save !== 'function') {
      return 0;
    }
    const allSettings = typeof sessionSettings.listAll === 'function'
      ? sessionSettings.listAll()
      : this.repositories?.bridgeSessions?.list?.()
        .map((session) => sessionSettings.getByBridgeSessionId?.(session.id) ?? sessionSettings.get?.(session.id) ?? null)
        .filter((settings): settings is SessionSettings => Boolean(settings)) ?? [];
    let cleared = 0;
    for (const settings of allSettings) {
      if (!settings.model && !settings.reasoningEffort) {
        continue;
      }
      const now = Date.now();
      sessionSettings.save({
        ...settings,
        model: null,
        reasoningEffort: null,
        metadata: {
          ...settings.metadata,
          modelOverrideClearedAt: now,
          modelOverrideClearedReason: 'model-provider-updated',
        },
        updatedAt: now,
      });
      cleared += 1;
    }
    return cleared;
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
        defaultModel: normalizeEnvString(profile.config?.defaultModel) ?? '',
        models: extractProviderProfileModelIds(profile),
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  private listRawProviderProfiles() {
    return safeList(() => this.repositories?.providerProfiles?.list?.() ?? []);
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
    const state = this.buildState();
    const {
      deliveryOutbox: _deliveryOutbox,
      pendingDeliveryRetries: _pendingDeliveryRetries,
      ...backupBridgeState
    } = state.bridge;
    return {
      schemaVersion: 1,
      kind: 'full-backup',
      containsSecrets: true,
      exportedAt: new Date().toISOString(),
      stateDir: this.stateDir,
      adminUrl: this.binding?.url ?? null,
      state: {
        ...state,
        bridge: backupBridgeState,
      },
      accounts: this.accountStore.listAccounts().map((accountId) => ({
        accountId,
        ...this.accountStore.loadAccount(accountId),
        context_tokens: this.accountStore.readJson<Record<string, string>>(
          this.accountStore.contextTokensFile(accountId),
        ) ?? {},
        sync_cursor: this.accountStore.loadSyncCursor(accountId),
      })),
      configuration: {
        serviceEnv: exportFullBackupServiceEnv(this.env),
      },
      runtime: {
        providerProfiles: runtime?.providerProfiles?.list?.() ?? [],
        bridgeSessions: runtime?.bridgeSessions?.list?.() ?? [],
        platformBindings: runtime?.platformBindings?.list?.() ?? [],
        sessionSettings: runtime?.sessionSettings?.listAll?.() ?? [],
        threadMetadata: runtime?.threadMetadata?.listAll?.() ?? [],
      },
      sessionSummaries: sortSessions(this.buildSessionSummaries(), 'updatedDesc'),
      logs: this.readLogs({ lineLimit: 500 }),
    };
  }

  private async handleImport(req: IncomingMessage, res: ServerResponse) {
    const body = await readJsonBody(req, IMPORT_BODY_LIMIT_BYTES);
    const validation = validateImportPayload(body);
    if (validation.errors.length > 0) {
      this.writeJson(res, 400, {
        error: 'invalid backup',
        errors: validation.errors,
      });
      return;
    }
    const restorePoint = this.createPreImportRestorePoint();
    const snapshots = this.captureImportSnapshots(validation.payload);
    const envSnapshot = this.captureImportEnvSnapshot(validation.payload.serviceEnv);
    const errors: string[] = [];
    const imported = {
      accounts: 0,
      providerProfiles: 0,
      bridgeSessions: 0,
      platformBindings: 0,
      sessionSettings: 0,
      threadMetadata: 0,
      configuration: 0,
    };
    try {
      for (const raw of validation.payload.accounts) {
        const accountId = normalizeAccountId(String(raw.accountId ?? ''));
        const token = String(raw.token ?? '').trim();
        this.accountStore.saveAccount({
          accountId,
          token,
          baseUrl: String(raw.base_url ?? raw.baseUrl ?? '').trim(),
          userId: String(raw.user_id ?? raw.userId ?? ''),
        });
        const patch: Parameters<WeixinAccountStore['updateAccount']>[1] = {};
        if (typeof raw.display_name === 'string') {
          patch.display_name = raw.display_name;
        }
        if (typeof raw.disabled === 'boolean') {
          patch.disabled = raw.disabled;
        }
        if (typeof raw.group === 'string') {
          patch.group = raw.group;
        }
        if (typeof raw.role === 'string') {
          patch.role = raw.role;
        }
        if (isRecord(raw.permissions)) {
          patch.permissions = raw.permissions;
        }
        if (isRecord(raw.model_provider) || isRecord(raw.modelProvider)) {
          patch.model_provider = isRecord(raw.model_provider) ? raw.model_provider : raw.modelProvider as Record<string, unknown>;
        }
        if (Object.keys(patch).length > 0) {
          this.accountStore.updateAccount(accountId, patch);
        }
        if (isRecord(raw.context_tokens)) {
          replaceContextTokensForAccount(this.accountStore.rootDir, accountId, raw.context_tokens);
        }
        if (typeof raw.sync_cursor === 'string') {
          this.accountStore.saveSyncCursor(accountId, raw.sync_cursor);
        }
        imported.accounts += 1;
      }
      const runtime = validation.payload.runtime;
      const repos = this.repositories;
      imported.providerProfiles = this.importRecords(runtime.providerProfiles, repos?.providerProfiles?.save?.bind(repos?.providerProfiles), errors, 'providerProfile');
      imported.bridgeSessions = this.importRecords(runtime.bridgeSessions, repos?.bridgeSessions?.save?.bind(repos?.bridgeSessions), errors, 'bridgeSession');
      imported.platformBindings = this.importRecords(runtime.platformBindings, repos?.platformBindings?.save?.bind(repos?.platformBindings), errors, 'platformBinding');
      imported.sessionSettings = this.importRecords(runtime.sessionSettings, repos?.sessionSettings?.save?.bind(repos?.sessionSettings), errors, 'sessionSettings');
      imported.threadMetadata = this.importRecords(runtime.threadMetadata, repos?.threadMetadata?.save?.bind(repos?.threadMetadata), errors, 'threadMetadata');
      if (errors.length > 0) {
        throw new Error(errors.join('; '));
      }
      if (Object.keys(validation.payload.serviceEnv).length > 0) {
        for (const [key, value] of Object.entries(validation.payload.serviceEnv)) {
          setEnvValue(this.env, key, value);
        }
        persistEnvValues(resolveServiceEnvFile(this.env), validation.payload.serviceEnv);
        imported.configuration = 1;
      }
      this.writeJson(res, 200, {
        ok: true,
        imported,
        errors: [],
        restorePoint,
        state: this.buildState(),
      });
    } catch (error) {
      const rollbackErrors: string[] = [];
      rollbackErrors.push(...this.restoreImportSnapshots(snapshots));
      for (const raw of validation.payload.accounts) {
        const accountId = normalizeAccountId(String(raw.accountId ?? ''));
        try {
          reloadContextTokensForAccount(this.accountStore.rootDir, accountId);
        } catch (rollbackError) {
          rollbackErrors.push(`context tokens ${accountId}: ${formatError(rollbackError)}`);
        }
      }
      try {
        this.restoreImportEnvSnapshot(envSnapshot);
      } catch (rollbackError) {
        rollbackErrors.push(`environment: ${formatError(rollbackError)}`);
      }
      this.writeJson(res, 409, {
        error: rollbackErrors.length > 0
          ? 'backup import failed and rollback was incomplete'
          : 'backup import failed and was rolled back',
        detail: formatError(error),
        rollbackErrors,
        restorePoint,
      });
    }
  }

  private createPreImportRestorePoint() {
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
    const filePath = path.join(this.stateDir, 'backups', `pre-import-${stamp}.json`);
    writeJsonFileAtomically(filePath, this.buildExportPayload());
    return filePath;
  }

  private captureImportSnapshots(payload: ValidatedImportPayload): ImportFileSnapshot[] {
    const runtimeDir = path.join(this.stateDir, 'runtime');
    const paths = uniqueStrings([
      ...payload.accounts.flatMap((account) => {
        const accountId = String(account.accountId);
        return [
          this.accountStore.accountFile(accountId),
          this.accountStore.contextTokensFile(accountId),
          this.accountStore.syncFile(accountId),
        ];
      }),
      path.join(runtimeDir, 'provider_profiles.json'),
      path.join(runtimeDir, 'bridge_sessions.json'),
      path.join(runtimeDir, 'platform_bindings.json'),
      path.join(runtimeDir, 'session_settings.json'),
      path.join(runtimeDir, 'thread_metadata.json'),
      ...(Object.keys(payload.serviceEnv).length > 0 ? [resolveServiceEnvFile(this.env)] : []),
    ]);
    return paths.map((filePath) => ({
      filePath,
      existed: fs.existsSync(filePath),
      content: fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '',
    }));
  }

  private restoreImportSnapshots(snapshots: ImportFileSnapshot[]) {
    const errors: string[] = [];
    for (const snapshot of snapshots) {
      try {
        if (snapshot.existed) {
          writeTextFileAtomically(snapshot.filePath, snapshot.content);
        } else {
          fs.rmSync(snapshot.filePath, { force: true });
        }
      } catch (error) {
        errors.push(`file ${snapshot.filePath}: ${formatError(error)}`);
      }
    }
    return errors;
  }

  private captureImportEnvSnapshot(serviceEnv: Record<string, string>) {
    return Object.keys(serviceEnv).map((key) => ({
      key,
      existed: Object.prototype.hasOwnProperty.call(this.env, key),
      value: this.env[key],
    }));
  }

  private restoreImportEnvSnapshot(snapshots: ImportEnvSnapshot[]) {
    for (const snapshot of snapshots) {
      if (snapshot.existed) {
        this.env[snapshot.key] = snapshot.value;
      } else {
        delete this.env[snapshot.key];
      }
    }
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
      this.clearSessionModelOverrides();
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
    await this.bridgeControl?.restart?.();
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

  private async handleSetupTest(req: IncomingMessage, res: ServerResponse) {
    const body = await readJsonBody(req);
    const target = normalizeEnvString(body.target) ?? '';
    let check: DiagnosticCheck;
    if (target === 'api-key') {
      const apiKey = this.diagnoseApiKey();
      check = apiKey.status === 'fail' ? apiKey : await this.diagnoseModelAvailability();
    } else if (target === 'weixin') {
      check = this.diagnoseWeixinAccounts();
    } else if (target === 'codex-command') {
      check = await this.diagnoseCodexNative();
    } else {
      this.writeJson(res, 400, {
        error: 'unknown setup test target',
        targets: ['api-key', 'weixin', 'codex-command'],
      });
      return;
    }
    this.writeJson(res, 200, {
      target,
      generatedAt: new Date().toISOString(),
      check,
      message: buildSetupTestMessage(target, check),
      repairHint: buildSetupRepairHint(target, check),
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
    const body = isRecord(result.body) ? result.body : {};
    const runtime = isRecord(body.native_runtime) ? body.native_runtime : {};
    const statusText = normalizeEnvString(body.status) ?? '';
    const runtimeReachable = Boolean(runtime.runtime_reachable);
    const runtimeProviderProfileId = normalizeEnvString(runtime.provider_profile_id) ?? '';
    const provider = this.resolveModelProviderSettings();
    const activeProviderId = normalizeEnvString(provider.profileId) ?? 'openai-default';
    const activeCapabilities = normalizeEnvString(provider.capabilities) ?? 'default';
    const activeProviderIsCompatible = activeProviderId !== 'openai-default' || activeCapabilities !== 'default';
    if (result.ok) {
      return makeDiagnosticCheck({
        id: 'codex-native',
        title: 'Codex 是否能正常响应',
        status: statusText === 'ok' ? 'ok' : 'warn',
        detail: `Native API 响应：${statusText}`,
        reason: runtimeProviderProfileId
          ? `Provider：${runtimeProviderProfileId}`
          : `接口：${native.baseUrl}/v1/health`,
        actions: [
          { label: '查看运行状态', action: 'open-page', target: 'runtime' },
        ],
      });
    }
    if (result.statusCode === 503 && (statusText === 'degraded' || runtimeReachable)) {
      if (activeProviderIsCompatible) {
        return makeDiagnosticCheck({
          id: 'codex-native',
          title: 'Codex 是否能正常响应',
          status: 'ok',
          detail: `当前使用 ${provider.providerName} / ${provider.model}`,
          reason: runtimeProviderProfileId && runtimeProviderProfileId !== activeProviderId
            ? `Native API 健康检查返回 ${runtimeProviderProfileId} 降级，但当前微信回复走 ${activeProviderId} 兼容模型通道，不影响正常对话。`
            : 'Native API 健康检查处于降级状态，但当前微信回复走兼容模型通道，不影响正常对话。',
          actions: [
            { label: '查看运行状态', action: 'open-page', target: 'runtime' },
            { label: '查看日志', action: 'open-page', target: 'logs' },
          ],
        });
      }
      return makeDiagnosticCheck({
        id: 'codex-native',
        title: 'Codex 是否能正常响应',
        status: 'warn',
        detail: `Native API 返回 HTTP 503（${statusText || 'degraded'}）`,
        reason: runtimeProviderProfileId
          ? `当前桥接仍可用，但健康检查显示 Provider：${runtimeProviderProfileId} 处于降级状态`
          : '当前桥接仍可用，但健康检查显示为降级状态',
        actions: [
          { label: '查看运行状态', action: 'open-page', target: 'runtime' },
          { label: '查看日志', action: 'open-page', target: 'logs' },
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
    const existing = readJsonFileSafely<unknown>(filePath, {
      fallback: {},
      reinitializeOnCorrupt: true,
    });
    return isRecord(existing) ? existing : {};
  }

  private writeAdminPreferences(patch: Record<string, unknown>) {
    const filePath = this.resolveAdminPreferencesFile();
    const next = {
      ...this.readAdminPreferences(),
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    writeJsonFileAtomically(filePath, next);
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
    if (typeof body.group === 'string') {
      patch.group = body.group;
    }
    if (typeof body.role === 'string') {
      patch.role = body.role;
    }
    if (isRecord(body.permissions)) {
      patch.permissions = {
        can_chat: body.permissions.canChat === undefined ? undefined : normalizeBooleanFlag(body.permissions.canChat),
        can_upload: body.permissions.canUpload === undefined ? undefined : normalizeBooleanFlag(body.permissions.canUpload),
        can_execute_commands: body.permissions.canExecuteCommands === undefined ? undefined : normalizeBooleanFlag(body.permissions.canExecuteCommands),
      };
    }
    if (isRecord(body.modelProvider)) {
      const modelProvider = await this.normalizeAccountModelProviderPatch(
        body.modelProvider,
        account.model_provider ?? null,
      );
      if ('error' in modelProvider) {
        this.writeJson(res, 400, modelProvider.error);
        return;
      }
      patch.model_provider = modelProvider.value;
    }
    if (typeof nextDisabled === 'boolean') {
      patch.disabled = nextDisabled;
    }
    const updated = this.accountStore.updateAccount(accountId, patch);
    this.writeJson(res, 200, { account: updated, accounts: this.listAccounts() });
  }

  private async normalizeAccountModelProviderPatch(
    modelProvider: Record<string, unknown>,
    currentModelProvider: SavedWeixinAccount['model_provider'] | null,
  ): Promise<
    | { value: NonNullable<SavedWeixinAccount['model_provider']> }
    | { error: Record<string, unknown> }
  > {
    const providerProfileId = normalizeEnvString(modelProvider.providerProfileId) ?? '';
    const model = normalizeEnvString(modelProvider.model) ?? '';
    const reasoningEffort = normalizeEnvString(modelProvider.reasoningEffort) ?? '';
    const value = {
      provider_profile_id: providerProfileId,
      model,
      reasoning_effort: reasoningEffort,
    };
    const profiles = this.listRawProviderProfiles();
    const selectedProfile = providerProfileId
      ? profiles.find((profile) => profile.id === providerProfileId) ?? null
      : null;

    if (!this.providerModelCatalog) {
      if (profiles.length > 0 && providerProfileId && !selectedProfile) {
        return {
          error: {
            error: 'unknown provider profile',
            providerProfileId,
          },
        };
      }
      if (profiles.length > 0 && model && !providerProfileId) {
        return {
          error: {
            error: 'provider profile is required when account model is set',
          },
        };
      }
      if (selectedProfile && model) {
        const models = extractProviderProfileModelIds(selectedProfile);
        if (models.length > 0 && !models.includes(model)) {
          return {
            error: {
              error: 'model is not available for provider profile',
              providerProfileId,
              model,
              availableModels: models,
            },
          };
        }
      }
      return { value };
    }

    const currentValue = {
      provider_profile_id: normalizeEnvString(currentModelProvider?.provider_profile_id) ?? '',
      model: normalizeEnvString(currentModelProvider?.model) ?? '',
      reasoning_effort: normalizeEnvString(currentModelProvider?.reasoning_effort) ?? '',
    };
    const isUnchanged = value.provider_profile_id === currentValue.provider_profile_id
      && value.model === currentValue.model
      && value.reasoning_effort === currentValue.reasoning_effort;

    if (providerProfileId && !selectedProfile) {
      if (isUnchanged) {
        return { value };
      }
      return {
        error: {
          error: 'unknown provider profile',
          providerProfileId,
        },
      };
    }
    if (!providerProfileId) {
      if (!model) {
        return { value };
      }
      return {
        error: {
          error: 'provider profile is required when account model is set',
        },
      };
    }
    if (!model) {
      return { value };
    }

    let catalog;
    try {
      catalog = await this.providerModelCatalog.listModels(providerProfileId, { forceRefresh: false });
    } catch {
      return {
        error: {
          error: 'provider model catalog unavailable',
          providerProfileId,
        },
      };
    }
    const selectedModel = catalog.models.find((item) => item.id === model);
    if (!selectedModel) {
      if (isUnchanged) {
        return { value };
      }
      return {
        error: {
          error: 'model is not available for provider profile',
          providerProfileId,
          model,
          availableModels: catalog.models.map((item) => item.id),
        },
      };
    }

    const availableReasoningEfforts = selectedModel.supportedReasoningEfforts.length > 0
      ? selectedModel.supportedReasoningEfforts
      : ['low', 'medium', 'high', 'xhigh'];
    if (reasoningEffort && !availableReasoningEfforts.includes(reasoningEffort) && !isUnchanged) {
      return {
        error: {
          error: 'reasoning effort is not available for model',
          providerProfileId,
          model,
          reasoningEffort,
          availableReasoningEfforts,
        },
      };
    }
    return { value };
  }

  private buildDiagnosticExportPayload() {
    const runtime = this.repositories;
    const accountIds = this.accountStore.listAccounts();
    const logSummary = this.buildLogSummary();
    const bridgeStatus = this.bridgeControl?.status?.() ?? { running: true };
    return {
      schemaVersion: 1,
      kind: 'diagnostic',
      containsSecrets: false,
      exportedAt: new Date().toISOString(),
      environment: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
      },
      service: {
        bridge: serializeDiagnosticBridgeStatus(bridgeStatus),
        setupRequired: Boolean(this.buildSetupState().needsSetup),
      },
      accounts: {
        count: accountIds.length,
        enabled: accountIds.filter((accountId) => !this.accountStore.isAccountDisabled(accountId)).length,
        disabled: accountIds.filter((accountId) => this.accountStore.isAccountDisabled(accountId)).length,
        primaryConfigured: Boolean(this.primaryAccountId()),
      },
      runtime: {
        providerProfiles: safeList(() => runtime?.providerProfiles?.list?.() ?? []).length,
        bridgeSessions: safeList(() => runtime?.bridgeSessions?.list?.() ?? []).length,
        platformBindings: safeList(() => runtime?.platformBindings?.list?.() ?? []).length,
        sessionSettings: safeList(() => runtime?.sessionSettings?.listAll?.() ?? []).length,
        threadMetadata: safeList(() => runtime?.threadMetadata?.listAll?.() ?? []).length,
      },
      logs: {
        totalSizeBytes: logSummary.totalSizeBytes,
        files: logSummary.files.map((file) => ({
          name: path.basename(file.path),
          exists: file.exists,
          sizeBytes: file.sizeBytes,
          updatedAt: file.updatedAt,
        })),
      },
    };
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
      ...this.securityHeaders(),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  private writeJsonDownload(res: ServerResponse, body: unknown, filenamePrefix: string) {
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
    const payload = `${JSON.stringify(body, null, 2)}\n`;
    res.writeHead(200, {
      ...this.securityHeaders(),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename="${filenamePrefix}-${stamp}.json"`,
      'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  private writeHtml(res: ServerResponse, html: string) {
    res.writeHead(200, {
      ...this.securityHeaders(),
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(html),
    });
    res.end(html);
  }

  private writeAdminAsset(
    res: ServerResponse,
    filename: 'admin.css' | 'admin.js',
    contentType: 'text/css; charset=utf-8' | 'text/javascript; charset=utf-8',
  ) {
    try {
      const body = fs.readFileSync(path.join(this.adminAssetDir, filename));
      res.writeHead(200, {
        ...this.securityHeaders(),
        'content-type': contentType,
        'cache-control': 'no-store',
        'content-length': body.length,
      });
      res.end(body);
    } catch (error) {
      this.writeJson(res, isMissingFileError(error) ? 404 : 500, {
        error: isMissingFileError(error) ? 'admin asset not found' : 'admin asset unavailable',
      });
    }
  }

  private async handleRetryDeliveryOutbox(res: ServerResponse) {
    if (typeof this.bridgeControl?.retryPendingDeliveries !== 'function') {
      this.writeJson(res, 409, { error: 'delivery retry is unavailable' });
      return;
    }
    if (!this.bridgeControl.status().running) {
      this.writeJson(res, 409, { error: 'bridge is not running' });
      return;
    }
    try {
      const result = await this.bridgeControl.retryPendingDeliveries();
      this.writeJson(res, 200, {
        ok: true,
        before: serializeDeliveryOutboxSummary(result.before) ?? emptyDeliveryOutboxSummary(),
        after: serializeDeliveryOutboxSummary(result.after) ?? emptyDeliveryOutboxSummary(),
      });
    } catch {
      let deliveryOutbox = emptyDeliveryOutboxSummary();
      try {
        deliveryOutbox = serializeDeliveryOutboxSummary(
          this.bridgeControl.status().deliveryOutbox,
        ) ?? deliveryOutbox;
      } catch {}
      this.writeJson(res, 500, {
        error: 'delivery retry failed',
        deliveryOutbox,
      });
    }
  }

  private writeIcon(res: ServerResponse) {
    if (!fs.existsSync(ADMIN_FAVICON_PATH)) {
      this.writeJson(res, 404, { error: 'favicon not found' });
      return;
    }
    const icon = fs.readFileSync(ADMIN_FAVICON_PATH);
    res.writeHead(200, {
      ...this.securityHeaders(),
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
      ...this.securityHeaders(),
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
      ...this.securityHeaders(),
      'content-type': 'image/png',
      'cache-control': 'no-store, max-age=0',
      'content-length': image.length,
    });
    res.end(image);
  }

  private securityHeaders() {
    return {
      'content-security-policy': [
        "default-src 'self'",
        `script-src 'nonce-${this.cspNonce}'`,
        "style-src 'self' 'unsafe-inline'",
        `style-src-elem 'self' 'nonce-${this.cspNonce}'`,
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join('; '),
      'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    };
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

interface ValidatedImportPayload {
  accounts: Record<string, unknown>[];
  serviceEnv: Record<string, string>;
  runtime: {
    providerProfiles: Record<string, unknown>[];
    bridgeSessions: Record<string, unknown>[];
    platformBindings: Record<string, unknown>[];
    sessionSettings: Record<string, unknown>[];
    threadMetadata: Record<string, unknown>[];
  };
}

interface ImportFileSnapshot {
  filePath: string;
  existed: boolean;
  content: string;
}

interface ImportEnvSnapshot {
  key: string;
  existed: boolean;
  value: unknown;
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

function normalizeAccountRole(value: unknown, fallback = 'member'): string {
  const role = String(value ?? '').trim().toLowerCase();
  return ['owner', 'admin', 'member', 'viewer'].includes(role) ? role : fallback;
}

function serializeAccountPermissions(account: SavedWeixinAccount | null | undefined, isPrimary: boolean) {
  const permissions = account?.permissions ?? {};
  return {
    canChat: permissions.can_chat ?? true,
    canUpload: permissions.can_upload ?? true,
    canExecuteCommands: isPrimary ? true : permissions.can_execute_commands ?? false,
  };
}

function serializeAccountModelProvider(account: SavedWeixinAccount | null | undefined) {
  const modelProvider = account?.model_provider ?? {};
  return {
    providerProfileId: String(modelProvider.provider_profile_id ?? ''),
    model: String(modelProvider.model ?? ''),
    reasoningEffort: String(modelProvider.reasoning_effort ?? ''),
  };
}

function resolveScopeModelProvider({
  scopes,
  accountStore,
  providerProfileId,
}: {
  scopes: Array<{ accountId: string }>;
  accountStore: WeixinAccountStore;
  providerProfileId: string;
}) {
  const providers = scopes
    .map((scope) => serializeAccountModelProvider(accountStore.loadAccount(scope.accountId)))
    .filter((modelProvider) => modelProvider.model || modelProvider.reasoningEffort);
  return providers.find((modelProvider) => (
    modelProvider.providerProfileId
    && modelProvider.providerProfileId === providerProfileId
  )) ?? providers.find((modelProvider) => !modelProvider.providerProfileId) ?? providers[0] ?? null;
}

function resolveEffectiveSessionModel({
  sessionModel,
  sessionReasoningEffort,
  accountModelProvider,
  providerDefaultModel,
  currentModelProvider,
  providerProfileId,
}: {
  sessionModel: string | null;
  sessionReasoningEffort: string | null;
  accountModelProvider: ReturnType<typeof serializeAccountModelProvider> | null;
  providerDefaultModel: string;
  currentModelProvider: {
    profileId?: string;
    model?: string;
  };
  providerProfileId: string;
}) {
  const normalizedSessionModel = normalizeEnvString(sessionModel);
  const normalizedAccountModel = normalizeEnvString(accountModelProvider?.model);
  const normalizedProviderDefaultModel = normalizeEnvString(providerDefaultModel);
  const normalizedCurrentModel = normalizeEnvString(currentModelProvider.model);
  const currentModelApplies = !currentModelProvider.profileId || currentModelProvider.profileId === providerProfileId;
  const model = normalizedSessionModel
    ?? normalizedAccountModel
    ?? normalizedProviderDefaultModel
    ?? (currentModelApplies ? normalizedCurrentModel : null)
    ?? null;
  const modelSource = normalizedSessionModel
    ? 'session'
    : (normalizedAccountModel
      ? 'account'
      : (normalizedProviderDefaultModel
        ? 'provider'
        : (currentModelApplies && normalizedCurrentModel ? 'default' : 'none')));
  const normalizedSessionReasoningEffort = normalizeEnvString(sessionReasoningEffort);
  const normalizedAccountReasoningEffort = normalizeEnvString(accountModelProvider?.reasoningEffort);
  const reasoningEffort = normalizedSessionReasoningEffort ?? normalizedAccountReasoningEffort ?? null;
  const reasoningEffortSource = normalizedSessionReasoningEffort
    ? 'session'
    : (normalizedAccountReasoningEffort ? 'account' : 'none');
  return {
    model,
    modelSource,
    reasoningEffort,
    reasoningEffortSource,
  };
}

function extractProviderProfileModelIds(profile: ProviderProfile): string[] {
  const config = isRecord(profile.config) ? profile.config : {};
  return uniqueStrings([
    ...extractStringList(config.modelIds),
    ...extractModelCatalogIds(config.modelCatalog),
    normalizeEnvString(config.defaultModel),
  ]);
}

function extractStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeEnvString(entry)).filter(Boolean) as string[];
  }
  const text = normalizeEnvString(value);
  if (!text) {
    return [];
  }
  return text.split(',')
    .map((entry) => normalizeEnvString(entry))
    .filter(Boolean) as string[];
}

function extractModelCatalogIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (isRecord(entry)) {
        return normalizeEnvString(entry.id)
          ?? normalizeEnvString(entry.model)
          ?? normalizeEnvString(entry.slug)
          ?? normalizeEnvString(entry.name);
      }
      return normalizeEnvString(entry);
    })
    .filter(Boolean) as string[];
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
  writeTextFileAtomically(filePath, content);
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

function buildSetupTestMessage(target: string, check: DiagnosticCheck): string {
  const label = target === 'api-key'
    ? 'API key / 模型'
    : target === 'weixin'
      ? '微信连通'
      : 'Codex 命令能力';
  if (check.status === 'ok') {
    return `${label} 测试通过：${check.detail}`;
  }
  if (check.status === 'warn') {
    return `${label} 测试有提醒：${check.detail}`;
  }
  return `${label} 测试未通过：${check.detail}`;
}

function buildSetupRepairHint(target: string, check: DiagnosticCheck): string {
  if (check.status === 'ok') {
    return '当前项目正常，可以继续下一步。';
  }
  const action = check.actions[0]?.label ? `建议先点击「${check.actions[0].label}」。` : '';
  const defaultHint = target === 'api-key'
    ? '请检查 API key、接口地址 Base URL、模型名称是否填写正确；如果使用 CCSwitch，可以先同步一次再保存。'
    : target === 'weixin'
      ? '请重新生成微信二维码并扫码确认，确认入口没有被禁用。'
      : '请确认本地 Codex / Native API 已启动；如果刚打开软件，可以等待十几秒后重试。';
  return [check.reason, action || defaultHint].filter(Boolean).join(' ');
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

function secureTokenEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function validateImportPayload(body: Record<string, unknown>): {
  payload: ValidatedImportPayload;
  errors: string[];
} {
  const errors: string[] = [];
  const schemaVersion = Number(body.schemaVersion ?? 1);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 1) {
    errors.push(`unsupported schemaVersion: ${String(body.schemaVersion ?? '')}`);
  }
  if (body.kind === 'diagnostic' || body.containsSecrets === false) {
    errors.push('diagnostic exports cannot be imported as backups');
  }

  const accounts = validateImportRecordArray(body.accounts, 'accounts', errors);
  validateUniqueImportRecords(
    accounts,
    'accounts',
    errors,
    (record) => normalizeAccountId(String(record.accountId ?? '')).toLowerCase(),
  );
  for (const [index, account] of accounts.entries()) {
    const accountId = normalizeAccountId(String(account.accountId ?? ''));
    if (!isValidWeixinAccountId(accountId)) {
      errors.push(`accounts[${index}].accountId is invalid`);
    }
    if (!normalizeEnvString(account.token)) {
      errors.push(`accounts[${index}].token is required`);
    }
    const baseUrl = normalizeEnvString(account.base_url) ?? normalizeEnvString(account.baseUrl);
    if (!baseUrl) {
      errors.push(`accounts[${index}].base_url is required`);
    } else if (!isValidHttpUrl(baseUrl)) {
      errors.push(`accounts[${index}].base_url must be an http(s) URL`);
    }
    if (account.context_tokens !== undefined) {
      if (!isRecord(account.context_tokens)) {
        errors.push(`accounts[${index}].context_tokens must be an object`);
      } else {
        for (const [peerId, token] of Object.entries(account.context_tokens)) {
          if (!peerId.trim() || typeof token !== 'string' || !token) {
            errors.push(`accounts[${index}].context_tokens contains an invalid token`);
            break;
          }
        }
      }
    }
    if (account.sync_cursor !== undefined && typeof account.sync_cursor !== 'string') {
      errors.push(`accounts[${index}].sync_cursor must be a string`);
    }
  }

  const rawConfiguration = body.configuration === undefined ? {} : body.configuration;
  if (!isRecord(rawConfiguration)) {
    errors.push('configuration must be an object');
  }
  const rawServiceEnv = isRecord(rawConfiguration) && rawConfiguration.serviceEnv !== undefined
    ? rawConfiguration.serviceEnv
    : {};
  if (!isRecord(rawServiceEnv)) {
    errors.push('configuration.serviceEnv must be an object');
  }
  const serviceEnv: Record<string, string> = {};
  if (isRecord(rawServiceEnv)) {
    const allowedKeys = new Set<string>(FULL_BACKUP_SERVICE_ENV_KEYS);
    for (const [key, value] of Object.entries(rawServiceEnv)) {
      if (!allowedKeys.has(key)) {
        errors.push(`configuration.serviceEnv.${key} is not supported`);
      } else if (typeof value !== 'string') {
        errors.push(`configuration.serviceEnv.${key} must be a string`);
      } else if (/[\r\n]/u.test(value)) {
        errors.push(`configuration.serviceEnv.${key} must not contain line breaks`);
      } else {
        serviceEnv[key] = value;
      }
    }
  }
  if (serviceEnv.CODEX_COMPAT_BASE_URL && !isValidHttpUrl(serviceEnv.CODEX_COMPAT_BASE_URL)) {
    errors.push('configuration.serviceEnv.CODEX_COMPAT_BASE_URL must be an http(s) URL');
  }

  const rawRuntime = body.runtime === undefined ? {} : body.runtime;
  if (!isRecord(rawRuntime)) {
    errors.push('runtime must be an object');
  }
  const runtime = isRecord(rawRuntime) ? rawRuntime : {};
  const providerProfiles = validateImportRecordArray(runtime.providerProfiles, 'runtime.providerProfiles', errors);
  const bridgeSessions = validateImportRecordArray(runtime.bridgeSessions, 'runtime.bridgeSessions', errors);
  const platformBindings = validateImportRecordArray(runtime.platformBindings, 'runtime.platformBindings', errors);
  const sessionSettings = validateImportRecordArray(runtime.sessionSettings, 'runtime.sessionSettings', errors);
  const threadMetadata = validateImportRecordArray(runtime.threadMetadata, 'runtime.threadMetadata', errors);

  validateImportRequiredStrings(providerProfiles, 'runtime.providerProfiles', ['id', 'providerKind'], errors);
  validateImportRequiredStrings(bridgeSessions, 'runtime.bridgeSessions', ['id', 'providerProfileId', 'codexThreadId'], errors);
  validateImportRequiredStrings(platformBindings, 'runtime.platformBindings', ['platform', 'externalScopeId', 'bridgeSessionId'], errors);
  validateImportRequiredStrings(sessionSettings, 'runtime.sessionSettings', ['bridgeSessionId'], errors);
  validateImportRequiredStrings(threadMetadata, 'runtime.threadMetadata', ['providerProfileId', 'threadId'], errors);
  validateUniqueImportRecords(providerProfiles, 'runtime.providerProfiles', errors, (record) => String(record.id ?? ''));
  validateUniqueImportRecords(bridgeSessions, 'runtime.bridgeSessions', errors, (record) => String(record.id ?? ''));
  validateUniqueImportRecords(platformBindings, 'runtime.platformBindings', errors, (record) => `${record.platform}:${record.externalScopeId}`);
  validateUniqueImportRecords(sessionSettings, 'runtime.sessionSettings', errors, (record) => String(record.bridgeSessionId ?? ''));
  validateUniqueImportRecords(threadMetadata, 'runtime.threadMetadata', errors, (record) => `${record.providerProfileId}:${record.threadId}`);

  return {
    payload: {
      accounts,
      serviceEnv,
      runtime: {
        providerProfiles,
        bridgeSessions,
        platformBindings,
        sessionSettings,
        threadMetadata,
      },
    },
    errors,
  };
}

function validateImportRecordArray(value: unknown, label: string, errors: string[]): Record<string, unknown>[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  const records: Record<string, unknown>[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      errors.push(`${label}[${index}] must be an object`);
      continue;
    }
    records.push(entry);
  }
  return records;
}

function validateImportRequiredStrings(
  records: Record<string, unknown>[],
  label: string,
  keys: string[],
  errors: string[],
) {
  for (const [index, record] of records.entries()) {
    for (const key of keys) {
      if (!normalizeEnvString(record[key])) {
        errors.push(`${label}[${index}].${key} is required`);
      }
    }
  }
}

function validateUniqueImportRecords(
  records: Record<string, unknown>[],
  label: string,
  errors: string[],
  identity: (record: Record<string, unknown>) => string,
) {
  const seen = new Set<string>();
  for (const [index, record] of records.entries()) {
    const key = identity(record).trim();
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      errors.push(`${label}[${index}] duplicates ${key}`);
    }
    seen.add(key);
  }
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
  const capabilities = normalizeProviderCapabilities(raw.capabilities) ?? current.capabilities;
  const model = normalizeModelForCapabilities(
    capabilities,
    normalizeEnvString(raw.model) ?? current.model,
    current.model,
  );
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

function normalizeModelForCapabilities(capabilities: string | null | undefined, model: unknown, fallbackModel: unknown) {
  const value = normalizeEnvString(model) ?? '';
  const fallback = normalizeEnvString(fallbackModel) ?? '';
  const lower = value.toLowerCase();
  const fallbackLower = fallback.toLowerCase();
  const kind = String(capabilities ?? '').toLowerCase();
  if (kind === 'deepseek') {
    if (lower.startsWith('deepseek-')) return value;
    if (fallbackLower.startsWith('deepseek-')) return fallback;
    return 'deepseek-v4-flash';
  }
  if (kind === 'claude-code' || kind === 'claude') {
    if (lower.startsWith('claude-')) return value;
    if (fallbackLower.startsWith('claude-')) return fallback;
    return 'claude-sonnet-4-6';
  }
  if (kind === 'qwen') {
    if (lower.startsWith('qwen')) return value;
    if (fallbackLower.startsWith('qwen')) return fallback;
    return 'qwen3-coder-flash';
  }
  if (kind === 'gemini') {
    if (lower.startsWith('gemini-')) return value;
    if (fallbackLower.startsWith('gemini-')) return fallback;
    return 'gemini-2.5-flash';
  }
  if (kind === 'kimi') {
    if (lower.startsWith('kimi-') || lower.startsWith('moonshot-')) return value;
    if (fallbackLower.startsWith('kimi-') || fallbackLower.startsWith('moonshot-')) return fallback;
    return 'kimi-k2-0905-preview';
  }
  if (kind === 'minimax') {
    if (lower.startsWith('minimax-') || lower.startsWith('abab')) return value;
    if (fallbackLower.startsWith('minimax-') || fallbackLower.startsWith('abab')) return fallback;
    return 'MiniMax-M2.0';
  }
  if (kind === 'iflow') {
    if (value) return value;
    if (fallback) return fallback;
    return 'qwen3-coder-plus';
  }
  if (kind === 'openrouter') {
    if (value) return value;
    if (fallback) return fallback;
    return 'openai/gpt-4o-mini';
  }
  return value || fallback || '';
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
  const allowed = new Set(['default', 'claude-code', 'claude', 'deepseek', 'minimax', 'qwen', 'openrouter', 'kimi', 'gemini', 'iflow']);
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
  return normalized === '' || isLoopbackHostname(normalized);
}

function isLoopbackHostname(value: string) {
  const normalized = value.replace(/^\[|\]$/gu, '').trim().toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') {
    return true;
  }
  const ipv4 = normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized;
  const parts = ipv4.split('.');
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255);
}

function isAllowedAdminOrigin(origin: string, port: number) {
  try {
    const url = new URL(origin);
    const originPort = Number(url.port || (url.protocol === 'http:' ? 80 : 443));
    return url.protocol === 'http:'
      && originPort === port
      && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function exportFullBackupServiceEnv(env: NodeJS.ProcessEnv | Record<string, unknown>) {
  const values: Record<string, string> = {};
  for (const key of FULL_BACKUP_SERVICE_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined && value !== null) {
      values[key] = String(value);
    }
  }
  return values;
}

function serializeDiagnosticBridgeStatus(status: ReturnType<WeixinBridgeControl['status']>) {
  const weixin = status.weixin;
  return {
    running: Boolean(status.running),
    starting: status.starting,
    stopping: status.stopping,
    restarting: status.restarting,
    lastPollAt: status.lastPollAt,
    lastCommitAt: status.lastCommitAt,
    lastErrorAt: status.lastErrorAt,
    lastPollEventCount: status.lastPollEventCount,
    restartCount: status.restartCount,
    autoRestartScheduled: status.autoRestartScheduled,
    healthCheckActive: status.healthCheckActive,
    stalePollThresholdMs: status.stalePollThresholdMs,
    pendingDeliveryRetries: status.pendingDeliveryRetries,
    deliveryOutbox: serializeDeliveryOutboxSummary(status.deliveryOutbox),
    maxConcurrentTurns: status.maxConcurrentTurns,
    activeTurns: status.activeTurns,
    queuedTurns: status.queuedTurns,
    eventDispatchConcurrency: status.eventDispatchConcurrency,
    turnRecovery: serializeTurnRecoveryStatus(status.turnRecovery),
    weixin: weixin
      ? {
          running: weixin.running,
          accountCount: weixin.accountCount,
          attachmentProcessingConcurrency: weixin.attachmentProcessingConcurrency,
          accountPollConcurrency: weixin.accountPollConcurrency,
        }
      : null,
  };
}

function serializeAdminBridgeStatus(status: ReturnType<WeixinBridgeControl['status']>) {
  const deliveryOutbox = serializeDeliveryOutboxSummary(status.deliveryOutbox);
  const turnRecovery = serializeTurnRecoveryStatus(status.turnRecovery);
  const {
    deliveryOutbox: _deliveryOutbox,
    turnRecovery: _turnRecovery,
    ...safeStatus
  } = status;
  return {
    ...safeStatus,
    ...(deliveryOutbox ? { deliveryOutbox } : {}),
    ...(turnRecovery ? { turnRecovery } : {}),
  };
}

function serializeTurnRecoveryStatus(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  return {
    total: toNonNegativeInteger(value.total),
    running: toNonNegativeInteger(value.running),
    reconciling: toNonNegativeInteger(value.reconciling),
    uncertain: toNonNegativeInteger(value.uncertain),
    completedPendingDelivery: toNonNegativeInteger(value.completedPendingDelivery),
    interrupted: toNonNegativeInteger(value.interrupted),
    approvalExpired: toNonNegativeInteger(value.approvalExpired),
    oldestAgeMs: toNullableNonNegativeInteger(value.oldestAgeMs),
    lastReconciledAt: toNullableNonNegativeInteger(value.lastReconciledAt),
    lastErrorCategory: normalizeEnvString(value.lastErrorCategory)?.slice(0, 80) ?? null,
  };
}

function toNonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function toNullableNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toNonNegativeInteger(value);
}

function serializeDeliveryOutboxSummary(value: unknown): DeliveryOutboxSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    pending: toNonNegativeOutboxCount(value.pending),
    oldestCreatedAt: toNullableTimestamp(value.oldestCreatedAt),
    nextAttemptAt: toNullableTimestamp(value.nextAttemptAt),
  };
}

function emptyDeliveryOutboxSummary(): DeliveryOutboxSummary {
  return { pending: 0, oldestCreatedAt: null, nextAttemptAt: null };
}

function serializeProviderUsageSnapshot(snapshot: ProviderUsageSnapshot) {
  const report = isRecord(snapshot.report) ? snapshot.report : null;
  return {
    providerProfileId: normalizeEnvString(snapshot.providerProfileId) ?? '',
    providerKind: normalizeEnvString(snapshot.providerKind) ?? '',
    status: report ? 'available' : 'unavailable',
    report: report ? {
      provider: normalizeEnvString(report.provider) ?? '',
      plan: normalizeEnvString(report.plan),
      buckets: Array.isArray(report.buckets)
        ? report.buckets.slice(0, 20).filter(isRecord).map((bucket) => ({
          name: normalizeEnvString(bucket.name) ?? '',
          allowed: bucket.allowed === true,
          limitReached: bucket.limitReached === true,
          windows: Array.isArray(bucket.windows)
            ? bucket.windows.slice(0, 10).filter(isRecord).map((window) => ({
              name: normalizeEnvString(window.name) ?? '',
              usedPercent: toBoundedPercent(window.usedPercent),
              windowSeconds: toNonNegativeOutboxCount(window.windowSeconds),
              resetAfterSeconds: toNonNegativeOutboxCount(window.resetAfterSeconds),
              resetAtUnix: toNonNegativeOutboxCount(window.resetAtUnix),
            }))
            : [],
        }))
        : [],
      credits: isRecord(report.credits) ? {
        hasCredits: report.credits.hasCredits === true,
        unlimited: report.credits.unlimited === true,
        balance: normalizeEnvString(report.credits.balance),
      } : null,
    } : null,
    source: snapshot.source === 'cache' ? 'cache' : 'provider',
    fetchedAt: toNullableTimestamp(snapshot.fetchedAt),
    expiresAt: toNullableTimestamp(snapshot.expiresAt),
    refreshFailed: snapshot.refreshFailed === true,
  };
}

function toBoundedPercent(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

function toNonNegativeOutboxCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function toNullableTimestamp(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
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
