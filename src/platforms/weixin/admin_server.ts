import crypto from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { readCodexSessionIndex, resolveCodexHome, findCodexSessionIndexEntry, type CodexSessionIndexEntry } from '../../providers/codex/session_index.js';
import type { BridgeSession, SessionSettings, ThreadMetadata } from '../../types/core.js';
import type { ProviderProfile } from '../../types/provider.js';
import type { PlatformBinding } from '../../types/repository.js';
import { WeixinAccountStore } from './account_store.js';
import type { WeixinAutomationStore } from './automation_store.js';
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
  weixinAutomationStore?: WeixinAutomationStore | null;
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

const DEFAULT_ADMIN_HOST = '127.0.0.1';
const DEFAULT_ADMIN_PORT = 43183;
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
const ADMIN_FAVICON_PATH = path.resolve(process.cwd(), 'assets', 'windows', 'codexbridge-weixin.ico');
const ADMIN_FAVICON_PNG_PATH = path.resolve(process.cwd(), 'assets', 'windows', 'codexbridge-weixin.png');

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
    weixinAutomationStore = null,
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
    this.weixinAutomationStore = weixinAutomationStore;
    this.pageCloseShutdownGraceMs = Math.max(0, pageCloseShutdownGraceMs);
    this.server = null;
    this.binding = null;
    this.currentPairing = null;
    this.adminPageClients = new Map();
    this.pageCloseShutdownTimer = null;
    this.logCleanupTimer = null;
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
  weixinAutomationStore: WeixinAutomationStore | null;
  pageCloseShutdownGraceMs: number;
  server: Server | null;
  binding: WeixinAdminServerBinding | null;
  currentPairing: PairingSession | null;
  adminPageClients: Map<string, AdminPageClient>;
  pageCloseShutdownTimer: ReturnType<typeof setTimeout> | null;
  logCleanupTimer: ReturnType<typeof setInterval> | null;
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
    if (req.method === 'GET' && pathname === '/api/state') {
      this.writeJson(res, 200, this.buildState());
      return;
    }
    if (req.method === 'GET' && pathname === '/api/metrics') {
      this.writeJson(res, 200, this.bridgeControl?.getMetrics?.() ?? {});
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
    if (req.method === 'GET' && pathname === '/api/automation') {
      this.writeJson(res, 200, this.buildAutomationResponse(url.searchParams));
      return;
    }
    if (req.method === 'POST' && pathname === '/api/automation/templates') {
      await this.handleCreateAutomationTemplate(req, res);
      return;
    }
    if (req.method === 'PATCH' && pathname.startsWith('/api/automation/templates/')) {
      await this.handleUpdateAutomationTemplate(req, res, pathname.slice('/api/automation/templates/'.length));
      return;
    }
    if (req.method === 'DELETE' && pathname.startsWith('/api/automation/templates/')) {
      this.handleDeleteAutomationTemplate(res, pathname.slice('/api/automation/templates/'.length));
      return;
    }
    if (req.method === 'POST' && pathname === '/api/automation/rules') {
      await this.handleCreateAutomationRule(req, res);
      return;
    }
    if (req.method === 'PATCH' && pathname.startsWith('/api/automation/rules/')) {
      await this.handleUpdateAutomationRule(req, res, pathname.slice('/api/automation/rules/'.length));
      return;
    }
    if (req.method === 'DELETE' && pathname.startsWith('/api/automation/rules/')) {
      this.handleDeleteAutomationRule(res, pathname.slice('/api/automation/rules/'.length));
      return;
    }
    if (req.method === 'POST' && pathname === '/api/automation/archive/clear') {
      this.handleClearAutomationArchive(res);
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
    const model = normalizeEnvString(this.env.CODEX_COMPAT_DEFAULT_MODEL)
      ?? normalizeEnvString(this.env.CODEX_COMPAT_MODEL)
      ?? '';
    const apiKey = normalizeEnvString(this.env.CODEX_COMPAT_API_KEY) ?? '';
    return {
      profileId: normalizeEnvString(this.env.CODEX_DEFAULT_PROVIDER_PROFILE_ID) ?? 'openai-default',
      providerId: normalizeEnvString(this.env.CODEX_COMPAT_PROVIDER_ID) ?? 'openai-compatible',
      providerName: normalizeEnvString(this.env.CODEX_COMPAT_PROVIDER_NAME) ?? 'OpenAI Compatible',
      baseUrl: normalizeEnvString(this.env.CODEX_COMPAT_BASE_URL) ?? '',
      model,
      modelIds: normalizeEnvString(this.env.CODEX_COMPAT_MODEL_IDS) ?? model,
      capabilities: normalizeEnvString(this.env.CODEX_COMPAT_CAPABILITIES) ?? 'default',
      apiKeyConfigured: Boolean(apiKey),
      apiKeyMasked: maskSecret(apiKey),
      serviceEnvFile: resolveServiceEnvFile(this.env),
      serviceEnvPreferenceFile: this.resolveAdminPreferencesFile(),
      restartRequired: false,
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

  private buildAutomationResponse(searchParams: URLSearchParams) {
    if (!this.weixinAutomationStore) {
      return {
        enabled: false,
        templates: [],
        rules: [],
        archive: [],
      };
    }
    const archiveLimit = parsePositiveInt(searchParams.get('archiveLimit'), 20, 200);
    const snapshot = this.weixinAutomationStore.snapshot();
    return {
      enabled: true,
      templates: snapshot.templates,
      rules: snapshot.rules,
      archive: snapshot.archive.slice(0, archiveLimit),
      archiveTotal: snapshot.archive.length,
      commands: [
        '/tpl add 名称 内容',
        '/kw add 关键词 -> 模板名',
        '/kw prompt 关键词 -> 模板名',
        '/kw archive 关键词 标签',
        '/archive',
      ],
    };
  }

  private async handleCreateAutomationTemplate(req: IncomingMessage, res: ServerResponse) {
    if (!this.weixinAutomationStore) {
      this.writeJson(res, 409, { error: 'automation store is unavailable' });
      return;
    }
    const body = await readJsonBody(req);
    const template = this.weixinAutomationStore.createTemplate({
      name: String(body.name ?? ''),
      content: String(body.content ?? ''),
    });
    this.writeJson(res, 200, { template, automation: this.buildAutomationResponse(new URLSearchParams()) });
  }

  private async handleUpdateAutomationTemplate(req: IncomingMessage, res: ServerResponse, rawId: string) {
    if (!this.weixinAutomationStore) {
      this.writeJson(res, 409, { error: 'automation store is unavailable' });
      return;
    }
    const body = await readJsonBody(req);
    const updates: Record<string, string> = {};
    if (typeof body.name === 'string') {
      updates.name = body.name;
    }
    if (typeof body.content === 'string') {
      updates.content = body.content;
    }
    const template = this.weixinAutomationStore.updateTemplate(rawId, updates);
    this.writeJson(res, 200, { template, automation: this.buildAutomationResponse(new URLSearchParams()) });
  }

  private handleDeleteAutomationTemplate(res: ServerResponse, rawId: string) {
    if (!this.weixinAutomationStore) {
      this.writeJson(res, 409, { error: 'automation store is unavailable' });
      return;
    }
    this.weixinAutomationStore.deleteTemplate(rawId);
    this.writeJson(res, 200, { ok: true, automation: this.buildAutomationResponse(new URLSearchParams()) });
  }

  private async handleCreateAutomationRule(req: IncomingMessage, res: ServerResponse) {
    if (!this.weixinAutomationStore) {
      this.writeJson(res, 409, { error: 'automation store is unavailable' });
      return;
    }
    const body = await readJsonBody(req);
    const rule = this.weixinAutomationStore.createRule({
      name: String(body.name ?? ''),
      enabled: body.enabled !== false,
      keywords: Array.isArray(body.keywords) ? body.keywords.map((value) => String(value)) : [String(body.keyword ?? '')],
      matchMode: ['exact', 'prefix', 'regex'].includes(String(body.matchMode ?? '')) ? body.matchMode as any : 'contains',
      externalScopeId: normalizeEnvString(body.externalScopeId),
      replyTemplateId: normalizeEnvString(body.replyTemplateId),
      replyText: normalizeEnvString(body.replyText),
      promptTemplateId: normalizeEnvString(body.promptTemplateId),
      promptText: normalizeEnvString(body.promptText),
      archive: normalizeBooleanFlag(body.archive),
      archiveTag: normalizeEnvString(body.archiveTag),
      stopAfterMatch: normalizeBooleanFlag(body.stopAfterMatch),
    });
    this.writeJson(res, 200, { rule, automation: this.buildAutomationResponse(new URLSearchParams()) });
  }

  private async handleUpdateAutomationRule(req: IncomingMessage, res: ServerResponse, rawId: string) {
    if (!this.weixinAutomationStore) {
      this.writeJson(res, 409, { error: 'automation store is unavailable' });
      return;
    }
    const body = await readJsonBody(req);
    const updates: Record<string, unknown> = {};
    for (const key of [
      'name',
      'enabled',
      'keywords',
      'matchMode',
      'externalScopeId',
      'replyTemplateId',
      'replyText',
      'promptTemplateId',
      'promptText',
      'archive',
      'archiveTag',
      'stopAfterMatch',
    ]) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        updates[key] = body[key];
      }
    }
    const rule = this.weixinAutomationStore.updateRule(rawId, updates as any);
    this.writeJson(res, 200, { rule, automation: this.buildAutomationResponse(new URLSearchParams()) });
  }

  private handleDeleteAutomationRule(res: ServerResponse, rawId: string) {
    if (!this.weixinAutomationStore) {
      this.writeJson(res, 409, { error: 'automation store is unavailable' });
      return;
    }
    this.weixinAutomationStore.deleteRule(rawId);
    this.writeJson(res, 200, { ok: true, automation: this.buildAutomationResponse(new URLSearchParams()) });
  }

  private handleClearAutomationArchive(res: ServerResponse) {
    if (!this.weixinAutomationStore) {
      this.writeJson(res, 409, { error: 'automation store is unavailable' });
      return;
    }
    this.weixinAutomationStore.clearArchive();
    this.writeJson(res, 200, { ok: true, automation: this.buildAutomationResponse(new URLSearchParams()) });
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

  private resolveAdminPreferencesFile() {
    return path.join(this.stateDir, 'runtime', ADMIN_PREFERENCES_FILE);
  }

  private saveServiceEnvFilePreference(serviceEnvFile: string) {
    const filePath = this.resolveAdminPreferencesFile();
    const existing = readJsonFile(filePath);
    const next = {
      ...(isRecord(existing) ? existing : {}),
      serviceEnvFile,
      updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
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
  const providerName = normalizeEnvString(raw.providerName) ?? current.providerName;
  const providerId = normalizeProviderId(raw.providerId) ?? current.providerId;
  const profileId = normalizeProviderId(raw.profileId) ?? current.profileId;
  const capabilities = normalizeProviderCapabilities(raw.capabilities) ?? current.capabilities;
  const serviceEnvFile = normalizeServiceEnvFile(raw.serviceEnvFile, current.serviceEnvFile);
  return {
    profileId,
    providerId,
    providerName,
    apiKey: apiKey ?? null,
    baseUrl: baseUrl.replace(/\/+$/u, ''),
    model,
    modelIds: normalizeEnvString(raw.modelIds) ?? model,
    capabilities,
    serviceEnvFile,
  };
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

function normalizeProviderCapabilities(value: unknown) {
  const normalized = normalizeEnvString(value)?.toLowerCase();
  const allowed = new Set(['default', 'deepseek', 'minimax', 'qwen', 'openrouter', 'kimi', 'gemini', 'iflow']);
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
      --bg: #f5f6fc;
      --panel: rgba(255, 255, 255, 0.82);
      --panel-solid: #ffffff;
      --text: #1f2533;
      --muted: #64708a;
      --line: rgba(15, 23, 42, 0.09);
      --line-strong: rgba(15, 23, 42, 0.16);
      --accent: #6366f1;
      --accent-2: #a855f7;
      --accent-dark: #4f46e5;
      --danger: #e11d48;
      --ok: #059669;
      --grad: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%);
      --shadow: 0 20px 44px -24px rgba(79, 70, 229, 0.30), 0 6px 18px -14px rgba(15, 23, 42, 0.14);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(1100px 620px at 12% -8%, rgba(99, 102, 241, 0.13), transparent 60%),
        radial-gradient(1000px 600px at 108% 4%, rgba(168, 85, 247, 0.11), transparent 55%),
        radial-gradient(900px 720px at 50% 120%, rgba(56, 189, 248, 0.10), transparent 60%),
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
      width: min(1180px, calc(100% - 32px));
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
      background: linear-gradient(120deg, #4f46e5 0%, #7c3aed 45%, #db2777 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    main {
      padding: 24px 0 48px;
      display: grid;
      gap: 20px;
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
    .section-head {
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
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
      table-layout: fixed;
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
      grid-template-columns: minmax(130px, 1fr) auto;
      gap: 6px;
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
    .status-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
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
      background: radial-gradient(circle, rgba(139, 92, 246, 0.18), transparent 70%);
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
      grid-template-columns: minmax(180px, 1fr) 180px 160px auto;
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
    .auto-h3 {
      margin: 20px 0 10px;
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
    }
    .auto-h3:first-child { margin-top: 0; }
    .auto-new { margin: 10px 0 6px; }
    .auto-new > summary {
      cursor: pointer;
      color: var(--accent-dark);
      font-size: 13px;
      font-weight: 600;
      padding: 6px 0;
    }
    .auto-form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 8px;
    }
    .auto-span2 { grid-column: span 2; }
    .auto-checks {
      grid-column: span 2;
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .auto-check {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--text);
    }
    .auto-check input {
      height: auto;
      width: auto;
    }
    .auto-tpl-new {
      grid-template-columns: minmax(160px, 1fr) minmax(220px, 2fr) auto;
      margin-top: 10px;
    }
    .auto-archive-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
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
      .provider-span {
        grid-column: auto;
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
        <button id="refresh-btn">刷新列表</button>
      </div>
    </div>
  </header>
  <main class="wrap">
    <div class="grid">
      <section>
        <div class="section-head">
          <h2>已添加用户</h2>
          <span class="muted" id="account-count"></span>
        </div>
        <div class="table-wrap">
          <table>
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

      <section>
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

    <section>
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

    <section>
      <div class="section-head">
        <h2>用量统计</h2>
        <span class="muted" id="metrics-uptime"></span>
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
            <div class="metric-label">错误次数</div>
            <div class="metric-value" id="metric-errors">-</div>
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
        <div class="help-line">统计自服务启动累计，并随服务重启保留（写入 metrics.json）。</div>
        <h3 class="auto-h3">按账号</h3>
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

    <section>
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

    <section>
      <div class="section-head">
        <h2>模型供应商</h2>
        <span class="muted" id="provider-message"></span>
      </div>
      <div class="body">
        <div class="promo">
          <div class="promo-text">
            <span class="promo-title">🚀 推荐中转站 · ZToken</span>
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
              <option value="default">OpenAI 兼容</option>
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
          <div class="actions">
            <button class="primary" id="provider-save">保存模型配置</button>
          </div>
        </div>
        <div class="help-line">
          没有 API key？可在 <a href="https://ztoken.app/register?aff=8M7CSMLY5J77" target="_blank" rel="noopener">ztoken.app</a> 注册中转站获取（OpenAI 兼容接口，支持 GPT-5.5 / GPT-5.4）。API key 留空表示保留当前已保存的 key。
        </div>
      </div>
    </section>

    <section>
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

    <section>
      <div class="section-head">
        <h2>自动化</h2>
        <span class="muted" id="automation-message"></span>
      </div>
      <div class="body">
        <h3 class="auto-h3">关键词规则</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width: 18%">名称 / 状态</th>
                <th style="width: 22%">关键词</th>
                <th style="width: 10%">匹配</th>
                <th style="width: 26%">动作</th>
                <th style="width: 8%">命中</th>
                <th style="width: 16%">操作</th>
              </tr>
            </thead>
            <tbody id="automation-rules-body"></tbody>
          </table>
        </div>
        <details class="auto-new" id="rule-form-details">
          <summary id="rule-form-summary">新增关键词规则</summary>
          <div class="auto-form">
            <div class="field">
              <label for="rule-new-name">名称</label>
              <input id="rule-new-name" autocomplete="off" />
            </div>
            <div class="field">
              <label for="rule-new-keywords">关键词（逗号分隔）</label>
              <input id="rule-new-keywords" autocomplete="off" />
            </div>
            <div class="field">
              <label for="rule-new-matchmode">匹配模式</label>
              <select id="rule-new-matchmode">
                <option value="contains">包含</option>
                <option value="exact">完全匹配</option>
                <option value="prefix">前缀</option>
                <option value="regex">正则</option>
              </select>
            </div>
            <div class="field">
              <label for="rule-new-scope">限定聊天 scope（空=全局）</label>
              <input id="rule-new-scope" autocomplete="off" />
            </div>
            <div class="field auto-span2">
              <label for="rule-new-replytext">自动回复文本（留空则用模板）</label>
              <input id="rule-new-replytext" autocomplete="off" />
            </div>
            <div class="field">
              <label for="rule-new-replytpl">回复模板</label>
              <select id="rule-new-replytpl"><option value="">（不使用）</option></select>
            </div>
            <div class="field">
              <label for="rule-new-prompttpl">提示词模板</label>
              <select id="rule-new-prompttpl"><option value="">（不使用）</option></select>
            </div>
            <div class="field auto-span2">
              <label for="rule-new-prompttext">提示词文本（转发给 AI，留空则用模板）</label>
              <input id="rule-new-prompttext" autocomplete="off" />
            </div>
            <div class="field">
              <label for="rule-new-archivetag">归档标签（填则归档）</label>
              <input id="rule-new-archivetag" autocomplete="off" />
            </div>
            <div class="auto-checks">
              <label class="auto-check"><input type="checkbox" id="rule-new-archive" /> 归档命中消息</label>
              <label class="auto-check"><input type="checkbox" id="rule-new-stop" /> 命中后停止普通对话</label>
              <label class="auto-check"><input type="checkbox" id="rule-new-enabled" checked /> 启用</label>
            </div>
            <div class="actions">
              <button class="primary" id="rule-create">新增规则</button>
              <button id="rule-cancel-edit" hidden>取消编辑</button>
            </div>
          </div>
        </details>

        <h3 class="auto-h3">回复模板</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width: 24%">名称</th>
                <th style="width: 56%">内容</th>
                <th style="width: 20%">操作</th>
              </tr>
            </thead>
            <tbody id="automation-templates-body"></tbody>
          </table>
        </div>
        <div class="filter-row auto-tpl-new">
          <input id="tpl-new-name" placeholder="模板名称" autocomplete="off" />
          <input id="tpl-new-content" placeholder="模板内容，支持 {{text}} {{keyword}} {{rule}} {{scope}} {{date}} {{time}}" autocomplete="off" />
          <button class="primary" id="tpl-create">新增模板</button>
        </div>

        <div class="auto-archive-head">
          <h3 class="auto-h3">归档记录 <span class="muted" id="automation-archive-count"></span></h3>
          <button class="danger" id="automation-archive-clear">清空归档</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width: 22%">规则 / 标签</th>
                <th style="width: 16%">命中关键词</th>
                <th style="width: 42%">文本</th>
                <th style="width: 20%">时间</th>
              </tr>
            </thead>
            <tbody id="automation-archive-body"></tbody>
          </table>
        </div>
      </div>
    </section>

    <section>
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

    <section>
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
      currentModelProvider: null
    };
    const $ = (id) => document.getElementById(id);
    const providerPresets = {
      default: {
        profileId: 'openai-default',
        providerId: 'openai-compatible',
        providerName: 'OpenAI Compatible',
        baseUrl: 'https://ztoken.app/',
        model: 'gpt-5.5',
        models: ['gpt-5.5', 'gpt-5.4'],
        capabilities: 'default'
      },
      deepseek: {
        profileId: 'deepseek',
        providerId: 'deepseek',
        providerName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        models: ['deepseek-chat'],
        capabilities: 'deepseek'
      },
      qwen: {
        profileId: 'qwen',
        providerId: 'qwen',
        providerName: 'Qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen-plus',
        models: ['qwen-plus'],
        capabilities: 'qwen'
      },
      openrouter: {
        profileId: 'openrouter',
        providerId: 'openrouter',
        providerName: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openai/gpt-5',
        models: ['openai/gpt-5'],
        capabilities: 'openrouter'
      },
      kimi: {
        profileId: 'kimi',
        providerId: 'kimi',
        providerName: 'Kimi',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2-0711-preview',
        models: ['kimi-k2-0711-preview'],
        capabilities: 'kimi'
      },
      gemini: {
        profileId: 'gemini',
        providerId: 'gemini',
        providerName: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-2.5-pro',
        models: ['gemini-2.5-pro'],
        capabilities: 'gemini'
      },
      minimax: {
        profileId: 'minimax',
        providerId: 'minimax',
        providerName: 'MiniMax',
        baseUrl: 'https://api.minimax.chat/v1',
        model: 'MiniMax-M1',
        models: ['MiniMax-M1'],
        capabilities: 'minimax'
      },
      iflow: {
        profileId: 'iflow',
        providerId: 'iflow',
        providerName: 'iFlow',
        baseUrl: 'https://apis.iflow.cn/v1',
        model: 'iflow-default',
        models: ['iflow-default'],
        capabilities: 'iflow'
      }
    };

    function pageLifecycleUrl(path, extra) {
      const params = new URLSearchParams({
        pageId: state.pageId,
        shutdownOnClose: '1'
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
        shutdownOnClose: true,
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

    async function loadState() {
      const data = await requestJson('/api/state');
      state.accounts = data.accounts || [];
      renderAccounts(data.accounts || []);
      renderSessionFilters(data.accounts || []);
      renderPairing(data.pairing);
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
        loadAutomation(),
        loadMetrics()
      ]);
      $('account-count').textContent = String((data.accounts || []).length) + ' 个入口';
    }

    async function refreshRuntimeState() {
      const data = await requestJson('/api/state');
      renderBridge(data.bridge || { running: true });
      renderRuntimeStatus(data);
      renderPairing(data.pairing);
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

    async function loadMetrics() {
      const data = await requestJson('/api/metrics');
      renderMetrics(data || {});
    }

    function renderMetrics(m) {
      $('metric-messages').textContent = String(m.messagesReceived || 0);
      $('metric-turns-done').textContent = String(m.turnsCompleted || 0) + ' / ' + String(m.turnsFailed || 0);
      $('metric-deliveries').textContent = String(m.deliveriesSucceeded || 0) + ' / ' + String(m.deliveriesFailed || 0);
      $('metric-errors').textContent = String(m.errors || 0);
      $('metric-avg-turn').textContent = fmtDuration(m.avgTurnDurationMs);
      $('metric-last-turn').textContent = fmtDuration(m.lastTurnDurationMs);
      $('metric-active-turns').textContent = String(m.activeTurns || 0) + ' / ' + String(m.queuedTurns || 0);
      $('metric-pending').textContent = String(m.pendingDeliveryRetries || 0);
      $('metrics-uptime').textContent = m.uptimeMs ? ('运行 ' + fmtDuration(m.uptimeMs)) : '';
      renderMetricsByAccount(m.byAccount || {});
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
    let editingRuleId = null;

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
      $('metric-turns').textContent = active + ' 运行 / ' + queued + ' 排队 / 上限 ' + (maxTurns || '-');
      $('metric-events').textContent = '分发 ' + (bridge.eventDispatchConcurrency || '-') + ' / 补发 ' + (bridge.pendingDeliveryRetries || 0);
      $('metric-accounts').textContent = (weixin.accountCount || 0) + ' 个 / 轮询 ' + (weixin.accountPollConcurrency || '-');
      $('metric-error').textContent = bridge.lastError
        ? String(bridge.lastError).slice(0, 80)
        : '无';
      $('metric-error').title = bridge.lastError || '';
      $('status-updated').textContent = [
        '上次轮询 ' + fmtRelativeMs(bridge.lastPollAt),
        '上次提交 ' + fmtRelativeMs(bridge.lastCommitAt),
        '重启 ' + (bridge.restartCount || 0) + ' 次'
      ].join('  ');
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
        tr.appendChild(textCell('账号', account.accountId + (account.primary ? '  主账号' : '')));
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

    function populateModelOptions(presetKey, selectedModel) {
      const preset = providerPresets[presetKey] || providerPresets.default;
      const select = $('provider-model');
      const custom = $('provider-model-custom');
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

    function syncCustomModelVisibility() {
      const select = $('provider-model');
      const custom = $('provider-model-custom');
      const isCustom = select.value === CUSTOM_MODEL_OPTION;
      custom.style.display = isCustom ? '' : 'none';
      if (isCustom) {
        custom.focus();
      }
    }

    function getSelectedModel() {
      const select = $('provider-model');
      if (select.value === CUSTOM_MODEL_OPTION) {
        return $('provider-model-custom').value.trim();
      }
      return String(select.value || '').trim();
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
    }

    function applyProviderPreset(presetKey) {
      const preset = providerPresets[presetKey] || providerPresets.default;
      $('provider-name').value = preset.providerName;
      populateModelOptions(presetKey, preset.model);
      $('provider-base-url').value = preset.baseUrl;
      $('provider-message').textContent = '';
    }

    function readModelProviderPayload() {
      const preset = providerPresets[$('provider-preset').value] || providerPresets.default;
      const current = state.currentModelProvider || {};
      const providerName = $('provider-name').value.trim() || preset.providerName || current.providerName || 'OpenAI Compatible';
      const model = getSelectedModel();
      const baseUrl = $('provider-base-url').value.trim();
      const apiKey = $('provider-api-key').value.trim();
      const serviceEnvFile = $('provider-env-file').value.trim();
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
        serviceEnvFile
      };
      if (apiKey) {
        payload.apiKey = apiKey;
      }
      return payload;
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
      $('provider-message').textContent = data.restartRequired
        ? '已保存。关闭并重新打开应用后生效。'
        : '已保存。';
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

    async function startPairing() {
      setMessage('正在生成二维码...', false);
      const data = await requestJson('/api/pairing/start', {
        method: 'POST',
        body: JSON.stringify({ displayName: $('display-name').value })
      });
      renderPairing(data.pairing);
      if (!state.pairingTimer) {
        state.pairingTimer = window.setInterval(refreshPairingStatus, 2000);
      }
      setMessage('等待微信扫码确认', false);
    }

    async function refreshPairingStatus() {
      const data = await requestJson('/api/pairing/current');
      renderPairing(data.pairing);
    }

    const MATCH_MODE_LABELS = { contains: '包含', exact: '完全', prefix: '前缀', regex: '正则' };

    async function loadAutomation() {
      const data = await requestJson('/api/automation?archiveLimit=50');
      renderAutomation(data);
    }

    function renderAutomation(automation) {
      const data = automation || {};
      const templates = data.templates || [];
      const rules = data.rules || [];
      const archive = data.archive || [];
      fillTemplateOptions('rule-new-replytpl', templates);
      fillTemplateOptions('rule-new-prompttpl', templates);
      renderAutomationRules(rules, templates);
      renderAutomationTemplates(templates);
      renderAutomationArchive(archive, data.archiveTotal || archive.length);
    }

    function fillTemplateOptions(id, templates) {
      const select = $(id);
      if (!select) return;
      const selected = select.value;
      select.textContent = '';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '（不使用）';
      select.appendChild(none);
      for (const tpl of templates) {
        const option = document.createElement('option');
        option.value = tpl.id;
        option.textContent = tpl.name;
        select.appendChild(option);
      }
      select.value = selected;
    }

    function templateNameById(templates, id) {
      const found = (templates || []).find((tpl) => tpl.id === id);
      return found ? found.name : '';
    }

    function truncateInline(value, limit) {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      return text.length > limit ? text.slice(0, limit) + '…' : text;
    }

    function describeRuleAction(rule, templates) {
      const parts = [];
      if (rule.replyText) parts.push('回复：' + truncateInline(rule.replyText, 16));
      else if (rule.replyTemplateId) parts.push('回复模板：' + (templateNameById(templates, rule.replyTemplateId) || '?'));
      if (rule.promptText) parts.push('提示词：' + truncateInline(rule.promptText, 16));
      else if (rule.promptTemplateId) parts.push('提示词模板：' + (templateNameById(templates, rule.promptTemplateId) || '?'));
      if (rule.archive) parts.push('归档' + (rule.archiveTag ? ('#' + rule.archiveTag) : ''));
      if (rule.stopAfterMatch) parts.push('停止普通对话');
      return parts.length ? parts.join('，') : '无';
    }

    function automationEmptyRow(span, text) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = span;
      td.className = 'muted';
      td.textContent = text;
      tr.appendChild(td);
      return tr;
    }

    function renderAutomationRules(rules, templates) {
      const body = $('automation-rules-body');
      body.textContent = '';
      if (!rules.length) {
        body.appendChild(automationEmptyRow(6, '暂无规则'));
        return;
      }
      for (const rule of rules) {
        const tr = document.createElement('tr');
        const nameTd = document.createElement('td');
        nameTd.dataset.label = '名称 / 状态';
        const nameWrap = document.createElement('div');
        nameWrap.className = 'name-cell';
        const title = document.createElement('div');
        title.className = 'session-title';
        title.textContent = rule.name;
        const pill = document.createElement('span');
        pill.className = rule.enabled ? 'pill ok' : 'pill warn';
        pill.textContent = rule.enabled ? '启用' : '停用';
        nameWrap.appendChild(title);
        nameWrap.appendChild(pill);
        if (rule.externalScopeId) {
          const scope = document.createElement('div');
          scope.className = 'muted';
          scope.textContent = '限定：' + rule.externalScopeId;
          nameWrap.appendChild(scope);
        }
        nameTd.appendChild(nameWrap);
        tr.appendChild(nameTd);
        tr.appendChild(textCell('关键词', (rule.keywords || []).join('、')));
        tr.appendChild(textCell('匹配', MATCH_MODE_LABELS[rule.matchMode] || rule.matchMode));
        tr.appendChild(textCell('动作', describeRuleAction(rule, templates)));
        tr.appendChild(textCell('命中', String(rule.hitCount || 0)));
        const actionTd = document.createElement('td');
        actionTd.dataset.label = '操作';
        const wrap = document.createElement('div');
        wrap.className = 'actions account-actions';
        const edit = document.createElement('button');
        edit.textContent = '编辑';
        edit.onclick = () => startEditRule(rule);
        const toggle = document.createElement('button');
        toggle.textContent = rule.enabled ? '停用' : '启用';
        toggle.onclick = () => updateAutomationRule(rule.id, { enabled: !rule.enabled });
        const del = document.createElement('button');
        del.className = 'danger';
        del.textContent = '删除';
        del.onclick = () => { if (confirm('确认删除规则「' + rule.name + '」？')) deleteAutomationRule(rule.id); };
        wrap.appendChild(edit);
        wrap.appendChild(toggle);
        wrap.appendChild(del);
        actionTd.appendChild(wrap);
        tr.appendChild(actionTd);
        body.appendChild(tr);
      }
    }

    function renderAutomationTemplates(templates) {
      const body = $('automation-templates-body');
      body.textContent = '';
      if (!templates.length) {
        body.appendChild(automationEmptyRow(3, '暂无模板'));
        return;
      }
      for (const tpl of templates) {
        const tr = document.createElement('tr');
        const nameTd = document.createElement('td');
        nameTd.dataset.label = '名称';
        const nameInput = document.createElement('input');
        nameInput.value = tpl.name || '';
        nameTd.appendChild(nameInput);
        tr.appendChild(nameTd);
        const contentTd = document.createElement('td');
        contentTd.dataset.label = '内容';
        const input = document.createElement('input');
        input.value = tpl.content || '';
        contentTd.appendChild(input);
        tr.appendChild(contentTd);
        const actionTd = document.createElement('td');
        actionTd.dataset.label = '操作';
        const wrap = document.createElement('div');
        wrap.className = 'actions account-actions';
        const save = document.createElement('button');
        save.textContent = '保存';
        save.onclick = () => updateAutomationTemplate(tpl.id, { name: nameInput.value, content: input.value });
        const del = document.createElement('button');
        del.className = 'danger';
        del.textContent = '删除';
        del.onclick = () => { if (confirm('确认删除模板「' + tpl.name + '」？')) deleteAutomationTemplate(tpl.id); };
        wrap.appendChild(save);
        wrap.appendChild(del);
        actionTd.appendChild(wrap);
        tr.appendChild(actionTd);
        body.appendChild(tr);
      }
    }

    function renderAutomationArchive(archive, total) {
      const body = $('automation-archive-body');
      body.textContent = '';
      $('automation-archive-count').textContent = total ? ('共 ' + total + ' 条') : '';
      if (!archive.length) {
        body.appendChild(automationEmptyRow(4, '暂无归档'));
        return;
      }
      for (const record of archive) {
        const tr = document.createElement('tr');
        tr.appendChild(textCell('规则 / 标签', record.ruleName + (record.archiveTag ? (' #' + record.archiveTag) : '')));
        tr.appendChild(textCell('命中关键词', record.matchedKeyword || '-'));
        tr.appendChild(textCell('文本', record.text || '-'));
        tr.appendChild(textCell('时间', fmtTime(record.archivedAt) || '-'));
        body.appendChild(tr);
      }
    }

    function setAutomationMessage(text, danger) {
      const el = $('automation-message');
      el.textContent = text || '';
      el.style.color = danger ? '#e11d48' : '#64708a';
    }

    async function refreshAutomationFrom(data) {
      if (data && data.automation) {
        renderAutomation(data.automation);
      } else {
        await loadAutomation();
      }
    }

    async function createAutomationTemplate() {
      const name = $('tpl-new-name').value.trim();
      const content = $('tpl-new-content').value.trim();
      if (!name || !content) { setAutomationMessage('请填写模板名称和内容', true); return; }
      const data = await requestJson('/api/automation/templates', { method: 'POST', body: JSON.stringify({ name: name, content: content }) });
      $('tpl-new-name').value = '';
      $('tpl-new-content').value = '';
      setAutomationMessage('模板已新增', false);
      await refreshAutomationFrom(data);
    }

    async function updateAutomationTemplate(id, patch) {
      const data = await requestJson('/api/automation/templates/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) });
      setAutomationMessage('模板已更新', false);
      await refreshAutomationFrom(data);
    }

    async function deleteAutomationTemplate(id) {
      const data = await requestJson('/api/automation/templates/' + encodeURIComponent(id), { method: 'DELETE' });
      setAutomationMessage('模板已删除', false);
      await refreshAutomationFrom(data);
    }

    function readRuleForm() {
      const name = $('rule-new-name').value.trim();
      const keywords = $('rule-new-keywords').value.split(',').map((entry) => entry.trim()).filter(Boolean);
      if (!name || !keywords.length) {
        throw new Error('请填写规则名称和至少一个关键词');
      }
      const archiveTag = $('rule-new-archivetag').value.trim();
      return {
        name: name,
        keywords: keywords,
        matchMode: $('rule-new-matchmode').value,
        externalScopeId: $('rule-new-scope').value.trim(),
        replyText: $('rule-new-replytext').value.trim(),
        replyTemplateId: $('rule-new-replytpl').value,
        promptText: $('rule-new-prompttext').value.trim(),
        promptTemplateId: $('rule-new-prompttpl').value,
        archiveTag: archiveTag,
        archive: $('rule-new-archive').checked || Boolean(archiveTag),
        stopAfterMatch: $('rule-new-stop').checked,
        enabled: $('rule-new-enabled').checked
      };
    }

    function resetRuleForm() {
      editingRuleId = null;
      $('rule-new-name').value = '';
      $('rule-new-keywords').value = '';
      $('rule-new-matchmode').value = 'contains';
      $('rule-new-scope').value = '';
      $('rule-new-replytext').value = '';
      $('rule-new-replytpl').value = '';
      $('rule-new-prompttext').value = '';
      $('rule-new-prompttpl').value = '';
      $('rule-new-archivetag').value = '';
      $('rule-new-archive').checked = false;
      $('rule-new-stop').checked = false;
      $('rule-new-enabled').checked = true;
      $('rule-create').textContent = '新增规则';
      $('rule-cancel-edit').hidden = true;
      $('rule-form-summary').textContent = '新增关键词规则';
    }

    function startEditRule(rule) {
      editingRuleId = rule.id;
      $('rule-new-name').value = rule.name || '';
      $('rule-new-keywords').value = (rule.keywords || []).join(', ');
      $('rule-new-matchmode').value = rule.matchMode || 'contains';
      $('rule-new-scope').value = rule.externalScopeId || '';
      $('rule-new-replytext').value = rule.replyText || '';
      $('rule-new-replytpl').value = rule.replyTemplateId || '';
      $('rule-new-prompttext').value = rule.promptText || '';
      $('rule-new-prompttpl').value = rule.promptTemplateId || '';
      $('rule-new-archivetag').value = rule.archiveTag || '';
      $('rule-new-archive').checked = Boolean(rule.archive);
      $('rule-new-stop').checked = Boolean(rule.stopAfterMatch);
      $('rule-new-enabled').checked = rule.enabled !== false;
      $('rule-create').textContent = '更新规则';
      $('rule-cancel-edit').hidden = false;
      $('rule-form-summary').textContent = '编辑关键词规则：' + (rule.name || '');
      $('rule-form-details').open = true;
      $('rule-new-name').scrollIntoView({ block: 'center' });
    }

    async function submitRuleForm() {
      const payload = readRuleForm();
      if (editingRuleId) {
        const data = await requestJson('/api/automation/rules/' + encodeURIComponent(editingRuleId), { method: 'PATCH', body: JSON.stringify(payload) });
        resetRuleForm();
        setAutomationMessage('规则已更新', false);
        await refreshAutomationFrom(data);
        return;
      }
      const data = await requestJson('/api/automation/rules', { method: 'POST', body: JSON.stringify(payload) });
      resetRuleForm();
      setAutomationMessage('规则已新增', false);
      await refreshAutomationFrom(data);
    }

    async function updateAutomationRule(id, patch) {
      const data = await requestJson('/api/automation/rules/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) });
      setAutomationMessage('规则已更新', false);
      await refreshAutomationFrom(data);
    }

    async function deleteAutomationRule(id) {
      const data = await requestJson('/api/automation/rules/' + encodeURIComponent(id), { method: 'DELETE' });
      setAutomationMessage('规则已删除', false);
      await refreshAutomationFrom(data);
    }

    async function clearAutomationArchive() {
      if (!confirm('确认清空所有归档记录？')) return;
      const data = await requestJson('/api/automation/archive/clear', { method: 'POST' });
      setAutomationMessage('归档已清空', false);
      await refreshAutomationFrom(data);
    }

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
    $('sessions-refresh').onclick = () => loadSessions().catch((error) => setMessage(error.message, true));
    $('history-close').onclick = () => closeSessionHistory();
    $('history-modal').addEventListener('click', (event) => {
      if (event.target === $('history-modal')) {
        closeSessionHistory();
      }
    });
    $('history-search').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        void loadSessionHistory($('history-search').value.trim()).catch((error) => setMessage(error.message, true));
      }
    });
    $('tpl-create').onclick = () => createAutomationTemplate().catch((error) => setAutomationMessage(error.message, true));
    $('rule-create').onclick = () => submitRuleForm().catch((error) => setAutomationMessage(error.message, true));
    $('rule-cancel-edit').onclick = () => resetRuleForm();
    $('automation-archive-clear').onclick = () => clearAutomationArchive().catch((error) => setAutomationMessage(error.message, true));
    $('session-query').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        void loadSessions().catch((error) => setMessage(error.message, true));
      }
    });
    $('session-account').onchange = () => loadSessions().catch((error) => setMessage(error.message, true));
    $('session-sort').onchange = () => loadSessions().catch((error) => setMessage(error.message, true));
    $('settings-save').onclick = () => saveSettings().catch((error) => {
      $('settings-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('alert-test').onclick = () => testAlertWebhook().catch((error) => {
      $('settings-message').textContent = error.message;
    });
    $('provider-preset').onchange = () => applyProviderPreset($('provider-preset').value);
    $('provider-model').onchange = () => syncCustomModelVisibility();
    $('provider-save').onclick = () => saveProviderSettings().catch((error) => {
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
