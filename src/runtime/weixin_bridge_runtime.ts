import { parseSlashCommand } from '../core/command_parser.js';
import { isAgentCommandEnabled } from '../core/command_availability.js';
import { writeSequencedDebugLog } from '../core/sequenced_stderr.js';
import { WeixinPoller } from '../platforms/weixin/poller.js';
import { createI18n, type Translator } from '../i18n/index.js';
import type { MissionHostNotification } from '../../packages/mission-control/src/index.js';
import type {
  InboundTextEvent,
  PlatformMediaDeliveryResult,
} from '../types/platform.js';
import type { OutputArtifact, ProviderApprovalRequest, ProviderTurnProgress } from '../types/provider.js';

type RuntimeErrorStage = 'poll' | 'commit' | 'runtime';

interface MetricErrorEvent {
  at: number;
  stage: RuntimeErrorStage | string;
  message: string;
}

interface DeliveryResult {
  success: boolean;
  deliveredCount: number;
  deliveredText: string;
  failedIndex: number | null;
  failedText: string;
  error: string;
  errorCode?: number | null;
}

const METRICS_RECENT_ERROR_WINDOW_MS = 60 * 60 * 1000;
const METRICS_RECENT_ERROR_RETENTION_MS = 24 * 60 * 60 * 1000;
const METRICS_RECENT_ERROR_LIMIT = 1000;

interface RuntimeResponseMessage {
  text?: string | null;
  artifact?: OutputArtifact | null;
  mediaPath?: string | null;
  caption?: string | null;
}

interface RuntimeResponse {
  type?: string | null;
  messages?: RuntimeResponseMessage[] | null;
  meta?: {
    codexTurn?: {
      outputState?: string | null;
      previewText?: string | null;
      finalSource?: string | null;
      errorMessage?: string | null;
    } | null;
    systemAction?: {
      kind?: string | null;
    } | null;
    runtimeDelivery?: {
      mode?: string | null;
      delivered?: boolean | null;
      rateLimited?: boolean | null;
      error?: string | null;
      errorCode?: number | null;
    } | null;
  } | null;
}

interface PlatformPluginLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  pollOnce(): Promise<{ syncCursor?: string | null; events: InboundTextEvent[] }>;
  commitSyncCursor?(syncCursor: string | null | undefined): Promise<void> | void;
  sendText(params: { externalScopeId: string; content: string }): Promise<DeliveryResult | null | undefined>;
  sendTyping?(params: { externalScopeId: string; status: 'start' | 'stop' }): Promise<void> | void;
  sendMedia?(params: { externalScopeId: string; filePath: string; caption?: string | null }): Promise<PlatformMediaDeliveryResult | null | undefined>;
}

interface BridgeCoordinatorLike {
  handleInboundEvent(
    event: InboundTextEvent,
    options: {
      onProgress?: ((progress: ProviderTurnProgress) => Promise<void>) | null;
      onApprovalRequest?: ((request: ProviderApprovalRequest) => Promise<void>) | null;
    },
  ): Promise<RuntimeResponse>;
  renderApprovalPrompt?(event: InboundTextEvent): Promise<string | null> | string | null;
  restartBridge?(params: { event: InboundTextEvent }): Promise<void>;
  runAgentJob?(
    job: any,
    options: {
      onProgress?: ((progress: ProviderTurnProgress) => Promise<void>) | null;
      onApprovalRequest?: ((request: ProviderApprovalRequest) => Promise<void>) | null;
      onNotification?: ((notification: MissionHostNotification) => Promise<void>) | null;
    },
  ): Promise<RuntimeResponse>;
  runAutomationJob?(
    job: any,
    options: {
      onProgress?: ((progress: ProviderTurnProgress) => Promise<void>) | null;
      onApprovalRequest?: ((request: ProviderApprovalRequest) => Promise<void>) | null;
    },
  ): Promise<RuntimeResponse>;
  renderAgentMissionNotification?(
    job: any,
    notification: MissionHostNotification,
  ): Promise<string | null> | string | null;
  cleanupInternalProviderThreads?(params?: { dryRun?: boolean; limit?: number }): Promise<unknown>;
  forceClearActiveTurn?(scopeRef: { platform: string; externalScopeId: string }): Promise<void> | void;
}

interface StreamState {
  lastObservedFinal: string;
  pendingPreview: string;
  inFlightPreview: string;
  previewPumpPromise: Promise<void> | null;
  previewStopped: boolean;
  firstPreviewSent: boolean;
  nextPreviewAt: number;
  smallPreviewDelayUntil: number;
  streamedText: string;
  sentChunkCount: number;
  streamingDisabled: boolean;
}

interface ScheduledDispatch {
  type: 'scheduled';
  completion: Promise<RuntimeResponse>;
  afterCommit?: (() => Promise<void> | void) | null;
}

interface FinalDelivery {
  source: string;
  mode: string;
  finalText: string;
  sentContent: string;
  delivered: boolean;
  rateLimited: boolean;
  error: string | null;
  errorCode?: number | null;
}

interface PendingInboundMerge {
  event: InboundTextEvent;
  timer: ReturnType<typeof setTimeout> | null;
  completion: Promise<RuntimeResponse>;
  resolve: (response: RuntimeResponse) => void;
  reject: (error: unknown) => void;
}

interface PendingScopeNotice {
  content: string;
  queuedAt: number;
}

interface PendingTextDelivery {
  id: string;
  externalScopeId: string;
  content: string;
  source: string;
  createdAt: number;
  nextAttemptAt: number;
  attemptCount: number;
  lastError: string;
  lastErrorCode: number | null;
}

interface WeixinBridgeRuntimeOptions {
  platformPlugin: PlatformPluginLike;
  bridgeCoordinator: BridgeCoordinatorLike;
  automationJobs?: any;
  agentJobs?: any;
  assistantRecords?: any;
  onError?: (error: unknown) => Promise<void> | void;
  previewSoftTargetBytes?: number;
  previewHardLimitBytes?: number;
  previewIntervalMs?: number;
  typingKeepaliveMs?: number;
  deliverProgressPreviews?: boolean;
  inboundAttachmentMergeWindowMs?: number;
  automationPollMs?: number;
  internalThreadCleanupMs?: number;
  healthCheckIntervalMs?: number;
  stalePollThresholdMs?: number;
  autoRestartDelayMs?: number;
  maxConcurrentTurns?: number;
  eventDispatchConcurrency?: number;
  locale?: string | null;
}

export class WeixinBridgeRuntime {
  static readonly NOTICE_COOLDOWN_MS = 30_000;
  static readonly DEFAULT_TYPING_KEEPALIVE_MS = 8_000;
  static readonly PREVIEW_MIN_TARGET_BYTES = 500;
  static readonly AUTOMATION_RATE_LIMIT_RETRY_MS = 10 * 60 * 1000;
  static readonly DELIVERY_SESSION_EXPIRED_RETRY_MS = 60 * 1000;
  static readonly DELIVERY_RETRY_INITIAL_MS = 15 * 1000;
  static readonly DELIVERY_RETRY_MAX_MS = 5 * 60 * 1000;
  static readonly DELIVERY_RETRY_MAX_ITEMS = 50;
  static readonly INBOUND_DEDUP_TTL_MS = 10 * 60 * 1000;
  static readonly INBOUND_DEDUP_MAX_ITEMS = 1000;
  static readonly DEFAULT_MAX_CONCURRENT_TURNS = 3;
  static readonly DEFAULT_EVENT_DISPATCH_CONCURRENCY = 12;

  platformPlugin: PlatformPluginLike;

  bridgeCoordinator: BridgeCoordinatorLike;

  automationJobs: any;
  agentJobs: any;
  assistantRecords: any;

  onError: (error: unknown) => Promise<void> | void;

  previewSoftTargetBytes: number;

  previewHardLimitBytes: number;

  previewIntervalMs: number;

  typingKeepaliveMs: number;

  deliverProgressPreviews: boolean;

  inboundAttachmentMergeWindowMs: number;

  automationPollMs: number;

  i18n: Translator;

  poller: WeixinPoller | null;

  pollerRunPromise: Promise<void> | null;

  backgroundTasks: Set<Promise<RuntimeResponse>>;

  scheduledAgentJobIds: Set<string>;

  scheduledAssistantReminderIds: Set<string>;

  scopeChains: Map<string, Promise<RuntimeResponse>>;

  typingKeepalives: Map<string, ReturnType<typeof setInterval>>;

  pendingInboundMerges: Map<string, PendingInboundMerge>;

  pendingBusyAppends: Map<string, PendingInboundMerge>;

  pendingScopeNotices: Map<string, PendingScopeNotice>;

  recentScopeNotices: Map<string, { content: string; sentAt: number }>;

  recentInboundDedupKeys: Map<string, number>;

  deliveryRetryQueue: PendingTextDelivery[];

  deliveryRetryPumpPromise: Promise<void> | null;

  automationSweepTimer: ReturnType<typeof setInterval> | null;

  automationSweepInFlight: Promise<void> | null;

  internalThreadCleanupMs: number;

  internalThreadCleanupTimer: ReturnType<typeof setInterval> | null;

  internalThreadCleanupInFlight: Promise<void> | null;

  healthCheckIntervalMs: number;

  stalePollThresholdMs: number;

  healthCheckTimer: ReturnType<typeof setInterval> | null;

  autoRestartDelayMs: number;

  autoRestartTimer: ReturnType<typeof setTimeout> | null;

  turnLimiter: AsyncLimiter;

  eventDispatchConcurrency: number;

  stopRequested: boolean;

  lastPollAt: number | null;

  lastCommitAt: number | null;

  lastErrorAt: number | null;

  lastError: string | null;

  lastErrorStage: RuntimeErrorStage | null;

  lastPollEventCount: number;

  lastPollSyncCursor: string | null;

  restartCount: number;

  runtimeGeneration: number;

  metricsStore: {
    read?: () => {
      totals?: Record<string, number>;
      byAccount?: Record<string, Record<string, number>>;
      recentErrors?: MetricErrorEvent[];
    } | null;
    write: (
      totals: Record<string, number>,
      byAccount?: Record<string, Record<string, number>>,
      recentErrors?: MetricErrorEvent[],
    ) => void;
  } | null;

  onAlert: (payload: { type: string; stage: string; message: string; at: number; restartCount?: number; pendingDeliveryRetries?: number }) => Promise<void> | void;

  turnTimeoutMs: number;

  pollTimeoutMs: number;

  metrics: {
    messagesReceived: number;
    turnsCompleted: number;
    turnsFailed: number;
    deliveriesSucceeded: number;
    deliveriesFailed: number;
    errors: number;
    pollErrors: number;
    runtimeErrors: number;
    commitErrors: number;
    totalTurnDurationMs: number;
    lastTurnDurationMs: number;
  };

  metricsRecentErrors: MetricErrorEvent[];

  metricsByAccount: Map<string, { messagesReceived: number; turnsCompleted: number; turnsFailed: number; totalTurnDurationMs: number }>;

  metricsStartedAt: number;

  metricsDirty: boolean;

  constructor({
    platformPlugin,
    bridgeCoordinator,
    automationJobs = null,
    agentJobs = null,
    assistantRecords = null,
    onError = async () => {},
    previewSoftTargetBytes = 2048,
    previewHardLimitBytes = 2048,
    previewIntervalMs = 3000,
    typingKeepaliveMs = WeixinBridgeRuntime.DEFAULT_TYPING_KEEPALIVE_MS,
    deliverProgressPreviews = false,
    inboundAttachmentMergeWindowMs = 3000,
    automationPollMs = 30_000,
    internalThreadCleanupMs = 24 * 60 * 60 * 1000,
    healthCheckIntervalMs = 30_000,
    stalePollThresholdMs = 3 * 60 * 1000,
    autoRestartDelayMs = 2000,
    maxConcurrentTurns = WeixinBridgeRuntime.DEFAULT_MAX_CONCURRENT_TURNS,
    eventDispatchConcurrency = WeixinBridgeRuntime.DEFAULT_EVENT_DISPATCH_CONCURRENCY,
    metricsStore = null,
    onAlert = async () => {},
    turnTimeoutMs = 0,
    pollTimeoutMs = 0,
    locale = null,
  }) {
    this.platformPlugin = platformPlugin;
    this.bridgeCoordinator = bridgeCoordinator;
    this.automationJobs = automationJobs;
    this.agentJobs = agentJobs;
    this.assistantRecords = assistantRecords;
    this.onError = onError;
    this.previewSoftTargetBytes = previewSoftTargetBytes;
    this.previewHardLimitBytes = previewHardLimitBytes;
    this.previewIntervalMs = previewIntervalMs;
    this.typingKeepaliveMs = typingKeepaliveMs;
    this.deliverProgressPreviews = Boolean(deliverProgressPreviews);
    this.inboundAttachmentMergeWindowMs = inboundAttachmentMergeWindowMs;
    this.automationPollMs = automationPollMs;
    this.internalThreadCleanupMs = internalThreadCleanupMs;
    this.healthCheckIntervalMs = healthCheckIntervalMs;
    this.stalePollThresholdMs = stalePollThresholdMs;
    this.autoRestartDelayMs = autoRestartDelayMs;
    this.turnLimiter = new AsyncLimiter(maxConcurrentTurns);
    this.eventDispatchConcurrency = normalizeConcurrency(
      eventDispatchConcurrency,
      WeixinBridgeRuntime.DEFAULT_EVENT_DISPATCH_CONCURRENCY,
    );
    this.i18n = createI18n(locale);
    this.poller = null;
    this.pollerRunPromise = null;
    this.backgroundTasks = new Set();
    this.scheduledAgentJobIds = new Set();
    this.scheduledAssistantReminderIds = new Set();
    this.scopeChains = new Map();
    this.typingKeepalives = new Map();
    this.pendingInboundMerges = new Map();
    this.pendingBusyAppends = new Map();
    this.pendingScopeNotices = new Map();
    this.recentScopeNotices = new Map();
    this.recentInboundDedupKeys = new Map();
    this.deliveryRetryQueue = [];
    this.deliveryRetryPumpPromise = null;
    this.automationSweepTimer = null;
    this.automationSweepInFlight = null;
    this.internalThreadCleanupTimer = null;
    this.internalThreadCleanupInFlight = null;
    this.healthCheckTimer = null;
    this.autoRestartTimer = null;
    this.stopRequested = false;
    this.lastPollAt = null;
    this.lastCommitAt = null;
    this.lastErrorAt = null;
    this.lastError = null;
    this.lastErrorStage = null;
    this.lastPollEventCount = 0;
    this.lastPollSyncCursor = null;
    this.restartCount = 0;
    this.runtimeGeneration = 0;
    this.metricsStore = metricsStore;
    this.onAlert = onAlert;
    this.turnTimeoutMs = Math.max(0, Number(turnTimeoutMs) || 0);
    this.pollTimeoutMs = Math.max(0, Number(pollTimeoutMs) || 0);
    const seeded = this.metricsStore?.read?.() ?? {};
    const seededTotals = seeded.totals ?? {};
    this.metrics = {
      messagesReceived: toCounter(seededTotals.messagesReceived),
      turnsCompleted: toCounter(seededTotals.turnsCompleted),
      turnsFailed: toCounter(seededTotals.turnsFailed),
      deliveriesSucceeded: toCounter(seededTotals.deliveriesSucceeded),
      deliveriesFailed: toCounter(seededTotals.deliveriesFailed),
      errors: toCounter(seededTotals.errors),
      pollErrors: toCounter(seededTotals.pollErrors),
      runtimeErrors: toCounter(seededTotals.runtimeErrors),
      commitErrors: toCounter(seededTotals.commitErrors),
      totalTurnDurationMs: toCounter(seededTotals.totalTurnDurationMs),
      lastTurnDurationMs: 0,
    };
    this.metricsRecentErrors = normalizeMetricErrorEvents(seeded.recentErrors);
    this.metricsByAccount = new Map();
    const seededByAccount = seeded.byAccount ?? {};
    for (const [accountId, totals] of Object.entries(seededByAccount)) {
      this.metricsByAccount.set(accountId, {
        messagesReceived: toCounter(totals?.messagesReceived),
        turnsCompleted: toCounter(totals?.turnsCompleted),
        turnsFailed: toCounter(totals?.turnsFailed),
        totalTurnDurationMs: toCounter(totals?.totalTurnDurationMs),
      });
    }
    this.metricsStartedAt = Date.now();
    this.metricsDirty = false;
  }

  async start(): Promise<void> {
    await this.startInBackground();
    await this.pollerRunPromise;
  }

  async startInBackground(): Promise<void> {
    if (this.poller) {
      return;
    }
    this.stopRequested = false;
    this.clearAutoRestartTimer();
    this.startHealthMonitor();
    await this.platformPlugin.start();
    this.automationJobs?.resetRunningJobs?.();
    if (typeof this.agentJobs?.recoverSupervisableMissions === 'function') {
      this.agentJobs.recoverSupervisableMissions();
    } else {
      this.agentJobs?.resetRunningJobs?.();
    }
    this.startAutomationScheduler();
    this.startInternalThreadCleanupScheduler();
    this.poller = new WeixinPoller({
      plugin: this.platformPlugin,
      onEvent: async (event) => this.dispatchInboundEvent(event),
      onSuccess: async ({ syncCursor, eventCount }) => {
        this.lastPollAt = Date.now();
        this.lastErrorAt = null;
        this.lastError = null;
        this.lastErrorStage = null;
        this.lastPollSyncCursor = typeof syncCursor === 'string' ? syncCursor : null;
        this.lastPollEventCount = Number.isFinite(eventCount) ? eventCount : 0;
        void this.flushDeliveryRetryQueue().catch(async (error) => {
          this.recordRuntimeError(error, 'runtime');
          await this.onError(error);
        });
      },
      onCommitSuccess: async ({ syncCursor }) => {
        this.lastCommitAt = Date.now();
        this.lastPollSyncCursor = typeof syncCursor === 'string' ? syncCursor : this.lastPollSyncCursor;
      },
      onError: async (error) => {
        this.recordRuntimeError(error, 'poll');
        await this.onError(error);
      },
      eventDispatchConcurrency: this.eventDispatchConcurrency,
      pollTimeoutMs: this.pollTimeoutMs,
    } as any);
    const poller = this.poller;
    const runPromise = poller.start()
      .catch(async (error) => {
        this.recordRuntimeError(error, 'runtime');
        await this.onError(error);
      })
      .finally(() => {
        if (this.poller === poller) {
          this.poller = null;
        }
        if (this.pollerRunPromise === runPromise) {
          this.pollerRunPromise = null;
        }
        if (!this.stopRequested) {
          this.scheduleAutoRestart();
        }
      });
    this.pollerRunPromise = runPromise;
  }

  async stop({ waitForIdle = true }: { waitForIdle?: boolean } = {}) {
    this.stopRequested = true;
    this.stopHealthMonitor();
    this.clearAutoRestartTimer();
    const poller = this.poller;
    const pollerRunPromise = this.pollerRunPromise;
    poller?.stop();
    this.poller = null;
    this.stopAutomationScheduler();
    this.stopInternalThreadCleanupScheduler();
    if (waitForIdle) {
      await pollerRunPromise?.catch(() => {});
      await this.flushAllPendingInboundMerges();
      this.discardPendingInboundMergesWithoutText();
      await this.waitForIdle();
      await this.clearPendingRuntimeWork();
    } else {
      void pollerRunPromise?.catch(() => {});
      await this.clearPendingRuntimeWork();
    }
    await this.platformPlugin.stop();
    this.persistMetrics();
  }

  async restart({ force = false, scopeRef = null }: {
    force?: boolean;
    scopeRef?: { platform: string; externalScopeId: string } | null;
  } = {}) {
    if (force) {
      this.runtimeGeneration += 1;
      if (scopeRef) {
        await this.clearRuntimeScope(scopeRef);
      }
    }
    await this.stop({ waitForIdle: !force });
    await this.startInBackground();
  }

  isRunning() {
    return Boolean(this.poller);
  }

  configureConcurrency({
    maxConcurrentTurns,
    eventDispatchConcurrency,
  }: {
    maxConcurrentTurns?: number | null;
    eventDispatchConcurrency?: number | null;
  }) {
    if (maxConcurrentTurns !== undefined && maxConcurrentTurns !== null) {
      this.turnLimiter.setMaxConcurrency(maxConcurrentTurns);
    }
    if (eventDispatchConcurrency !== undefined && eventDispatchConcurrency !== null) {
      this.eventDispatchConcurrency = normalizeConcurrency(
        eventDispatchConcurrency,
        WeixinBridgeRuntime.DEFAULT_EVENT_DISPATCH_CONCURRENCY,
      );
      if (this.poller) {
        this.poller.eventDispatchConcurrency = this.eventDispatchConcurrency;
      }
    }
  }

  getStatus() {
    return {
      running: this.isRunning(),
      stopping: this.stopRequested && !this.poller,
      lastPollAt: this.lastPollAt,
      lastCommitAt: this.lastCommitAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
      lastErrorStage: this.lastErrorStage,
      lastPollEventCount: this.lastPollEventCount,
      lastPollSyncCursor: this.lastPollSyncCursor,
      restartCount: this.restartCount,
      autoRestartScheduled: Boolean(this.autoRestartTimer),
      healthCheckActive: Boolean(this.healthCheckTimer),
      stalePollThresholdMs: this.stalePollThresholdMs,
      pendingDeliveryRetries: this.deliveryRetryQueue.length,
      maxConcurrentTurns: this.turnLimiter.maxConcurrency,
      activeTurns: this.turnLimiter.activeCount,
      queuedTurns: this.turnLimiter.queuedCount,
      eventDispatchConcurrency: this.eventDispatchConcurrency,
    };
  }

  getMetrics() {
    this.pruneMetricErrorEvents();
    const completed = this.metrics.turnsCompleted;
    const now = Date.now();
    const recentErrors = this.metricsRecentErrors
      .filter((event) => now - event.at <= METRICS_RECENT_ERROR_WINDOW_MS)
      .sort((a, b) => b.at - a.at);
    const replyFailures = this.metrics.turnsFailed + this.metrics.deliveriesFailed;
    const byAccount: Record<string, {
      messagesReceived: number;
      turnsCompleted: number;
      turnsFailed: number;
      avgTurnDurationMs: number;
    }> = {};
    for (const [accountId, totals] of this.metricsByAccount.entries()) {
      byAccount[accountId] = {
        messagesReceived: totals.messagesReceived,
        turnsCompleted: totals.turnsCompleted,
        turnsFailed: totals.turnsFailed,
        avgTurnDurationMs: totals.turnsCompleted > 0
          ? Math.round(totals.totalTurnDurationMs / totals.turnsCompleted)
          : 0,
      };
    }
    return {
      messagesReceived: this.metrics.messagesReceived,
      turnsCompleted: this.metrics.turnsCompleted,
      turnsFailed: this.metrics.turnsFailed,
      deliveriesSucceeded: this.metrics.deliveriesSucceeded,
      deliveriesFailed: this.metrics.deliveriesFailed,
      replyFailures,
      errors: this.metrics.errors,
      errorsRecentHour: recentErrors.length,
      errorBreakdown: {
        poll: this.metrics.pollErrors,
        runtime: this.metrics.runtimeErrors,
        commit: this.metrics.commitErrors,
      },
      currentError: this.lastErrorAt
        ? {
          at: this.lastErrorAt,
          ageMs: Math.max(0, now - this.lastErrorAt),
          stage: this.lastErrorStage,
          message: this.lastError ?? '',
        }
        : null,
      recentErrors: recentErrors.slice(0, 20),
      lastTurnDurationMs: this.metrics.lastTurnDurationMs,
      avgTurnDurationMs: completed > 0 ? Math.round(this.metrics.totalTurnDurationMs / completed) : 0,
      uptimeMs: Math.max(0, Date.now() - this.metricsStartedAt),
      pendingDeliveryRetries: this.deliveryRetryQueue.length,
      activeTurns: this.turnLimiter.activeCount,
      queuedTurns: this.turnLimiter.queuedCount,
      byAccount,
    };
  }

  resetMetrics() {
    this.metrics = {
      messagesReceived: 0,
      turnsCompleted: 0,
      turnsFailed: 0,
      deliveriesSucceeded: 0,
      deliveriesFailed: 0,
      errors: 0,
      pollErrors: 0,
      runtimeErrors: 0,
      commitErrors: 0,
      totalTurnDurationMs: 0,
      lastTurnDurationMs: 0,
    };
    this.metricsByAccount.clear();
    this.metricsRecentErrors = [];
    this.lastErrorAt = null;
    this.lastError = null;
    this.lastErrorStage = null;
    this.metricsStartedAt = Date.now();
    this.metricsDirty = true;
    this.persistMetrics();
    return this.getMetrics();
  }

  accountKeyOf(event: InboundTextEvent | null | undefined): string {
    const metadata = event && typeof event.metadata === 'object' ? event.metadata as Record<string, unknown> : {};
    const accountId = typeof metadata.weixinAccountId === 'string' ? metadata.weixinAccountId.trim() : '';
    return accountId || 'default';
  }

  accountMetricsFor(accountId: string) {
    let totals = this.metricsByAccount.get(accountId);
    if (!totals) {
      totals = { messagesReceived: 0, turnsCompleted: 0, turnsFailed: 0, totalTurnDurationMs: 0 };
      this.metricsByAccount.set(accountId, totals);
    }
    return totals;
  }

  recordTurnMetrics(startedAt: number, ok: boolean, accountId: string | null = null): void {
    const duration = Math.max(0, Date.now() - startedAt);
    this.metrics.lastTurnDurationMs = duration;
    this.metrics.totalTurnDurationMs += duration;
    if (ok) {
      this.metrics.turnsCompleted += 1;
    } else {
      this.metrics.turnsFailed += 1;
    }
    if (accountId) {
      const totals = this.accountMetricsFor(accountId);
      totals.totalTurnDurationMs += duration;
      if (ok) {
        totals.turnsCompleted += 1;
      } else {
        totals.turnsFailed += 1;
      }
    }
    this.metricsDirty = true;
  }

  recordDeliveryMetric(success: boolean): void {
    if (success) {
      this.metrics.deliveriesSucceeded += 1;
    } else {
      this.metrics.deliveriesFailed += 1;
    }
    this.metricsDirty = true;
  }

  persistMetrics(): void {
    if (!this.metricsStore || !this.metricsDirty) {
      return;
    }
    try {
      const byAccount: Record<string, Record<string, number>> = {};
      for (const [accountId, totals] of this.metricsByAccount.entries()) {
        byAccount[accountId] = { ...totals };
      }
      this.pruneMetricErrorEvents();
      this.metricsStore.write({ ...this.metrics }, byAccount, this.metricsRecentErrors);
      this.metricsDirty = false;
    } catch {
      // Metrics persistence is best-effort; never let it break the runtime.
    }
  }

  applyTurnTimeout<T>(promise: Promise<T>): Promise<T> {
    if (!this.turnTimeoutMs || this.turnTimeoutMs <= 0) {
      return promise;
    }
    return withTimeout(promise, this.turnTimeoutMs, 'bridge turn timed out');
  }

  isDuplicateInboundEvent(event: InboundTextEvent): boolean {
    const key = buildInboundEventDedupKey(event);
    if (!key) {
      return false;
    }
    const now = Date.now();
    this.pruneInboundDedupKeys(now);
    if (this.recentInboundDedupKeys.has(key)) {
      return true;
    }
    this.recentInboundDedupKeys.set(key, now);
    return false;
  }

  pruneInboundDedupKeys(now = Date.now()): void {
    for (const [key, seenAt] of this.recentInboundDedupKeys) {
      if (now - seenAt > WeixinBridgeRuntime.INBOUND_DEDUP_TTL_MS) {
        this.recentInboundDedupKeys.delete(key);
      }
    }
    while (this.recentInboundDedupKeys.size > WeixinBridgeRuntime.INBOUND_DEDUP_MAX_ITEMS) {
      const oldestKey = this.recentInboundDedupKeys.keys().next().value;
      if (!oldestKey) {
        return;
      }
      this.recentInboundDedupKeys.delete(oldestKey);
    }
  }

  async runOnce(): Promise<{ syncCursor?: string | null; events: InboundTextEvent[] }> {
    const result = await this.platformPlugin.pollOnce();
    const dispatch = await this.dispatchEvents(result.events ?? []);
    await dispatch.completion;
    await this.platformPlugin.commitSyncCursor?.(result.syncCursor);
    for (const afterCommit of dispatch.afterCommitActions) {
      await afterCommit();
    }
    return result;
  }

  async handleInboundEvent(event: InboundTextEvent): Promise<RuntimeResponse> {
    if (isLocalKeepalivePulse(event)) {
      debugRuntime('local_keepalive_pulse_swallowed', {
        scopeId: event.externalScopeId,
        textPreview: truncateDebugText(event?.text),
      });
      return { type: 'local_noop' };
    }
    if (this.isDuplicateInboundEvent(event)) {
      debugRuntime('inbound_duplicate_ignored', {
        scopeId: event.externalScopeId,
        textPreview: truncateDebugText(event?.text),
        dedupKey: buildInboundEventDedupKey(event),
      });
      return { type: 'duplicate_ignored' };
    }
    return this.scheduleInboundEvent(event);
  }

  async dispatchInboundEvent(event: InboundTextEvent): Promise<any> {
    if (isLocalKeepalivePulse(event)) {
      debugRuntime('local_keepalive_pulse_swallowed', {
        scopeId: event.externalScopeId,
        textPreview: truncateDebugText(event?.text),
      });
      return undefined;
    }
    if (this.isDuplicateInboundEvent(event)) {
      debugRuntime('inbound_duplicate_ignored', {
        scopeId: event.externalScopeId,
        textPreview: truncateDebugText(event?.text),
        dedupKey: buildInboundEventDedupKey(event),
      });
      return undefined;
    }
    this.metrics.messagesReceived += 1;
    this.accountMetricsFor(this.accountKeyOf(event)).messagesReceived += 1;
    this.metricsDirty = true;
    const command = parseSlashCommand(String(event?.text ?? ''));
    if (command) {
      await this.flushPendingInboundMerge(event.externalScopeId, { textOnly: true });
      if (isRecoverySlashCommand(command) && !hasHelpArg(command)) {
        await this.flushDeliveryRetryQueue({
          externalScopeId: event.externalScopeId,
          force: true,
        });
      }
      if (isStopSlashCommand(command)) {
        const response = await this.processStopCommandImmediately(event);
        const afterCommit = this.buildAfterCommitAction(response, event);
        return afterCommit ? { afterCommit } : undefined;
      }
      if (isRestartSlashCommand(command) && !hasHelpArg(command)) {
        const response = await this.processRestartCommandImmediately(event);
        const afterCommit = this.buildAfterCommitAction(response, event);
        return afterCommit ? { afterCommit } : undefined;
      }
      if (shouldScheduleSlashCommand(command)) {
        const task = this.processInboundEventWithOptions(event, { deferPostResponseAction: true }).catch(async (error) => {
          await this.onError(error);
          throw error;
        });
        this.trackBackgroundTask(task);
        return {
          type: 'scheduled',
          completion: task,
        };
      }
      const response = await this.processInboundEventWithOptions(event, { deferPostResponseAction: true });
      const afterCommit = this.buildAfterCommitAction(response, event);
      return afterCommit ? { afterCommit } : undefined;
    }
    const task = this.scheduleInboundEvent(event)
      .catch(async (error) => {
        await this.onError(error);
        throw error;
      });
    this.trackBackgroundTask(task);
    return {
      type: 'scheduled',
      completion: task,
    };
  }

  async processStopCommandImmediately(event: InboundTextEvent): Promise<RuntimeResponse> {
    await this.stopTypingKeepalive(event.externalScopeId);
    await this.safeSendTyping(event.externalScopeId, 'stop');
    try {
      return await this.processInboundEventWithOptions(event, {
        deferPostResponseAction: true,
        suppressTyping: true,
      });
    } finally {
      await this.stopTypingKeepalive(event.externalScopeId);
      await this.safeSendTyping(event.externalScopeId, 'stop');
    }
  }

  async processRestartCommandImmediately(event: InboundTextEvent): Promise<RuntimeResponse> {
    this.runtimeGeneration += 1;
    await this.clearRuntimeScope({
      platform: event.platform,
      externalScopeId: event.externalScopeId,
    });
    const supported = typeof this.bridgeCoordinator?.restartBridge === 'function';
    const content = supported
      ? [
        this.i18n.t('coordinator.restart.queued'),
        this.i18n.t('coordinator.restart.continue'),
      ].join('\n')
      : this.i18n.t('coordinator.restart.unsupported');
    const delivery = await this.sendTextWithRetry({
      externalScopeId: event.externalScopeId,
      content,
    });
    if (!delivery.success) {
      this.enqueueTextDeliveryRetry({
        externalScopeId: event.externalScopeId,
        content: delivery.failedText || content,
        delivery,
        source: 'restart_message',
      });
    }
    return {
      type: 'message',
      messages: [{ text: content }],
      meta: {
        ...(supported
          ? {
            systemAction: {
              kind: 'restart_bridge',
            },
          }
          : {}),
        runtimeDelivery: {
          mode: 'restart_command',
          delivered: delivery.success,
          rateLimited: this.isRateLimitedDeliveryFailure(delivery),
          error: delivery.error || null,
          errorCode: delivery.errorCode ?? null,
        },
      },
    };
  }

  async waitForIdle(): Promise<void> {
    if (this.automationSweepInFlight) {
      await this.automationSweepInFlight.catch(() => {});
    }
    const tasks = [...this.backgroundTasks];
    if (tasks.length === 0) {
      return;
    }
    await Promise.allSettled(tasks);
  }

  async dispatchEvents(events: InboundTextEvent[]): Promise<{
    completion: Promise<void>;
    afterCommitActions: Array<() => Promise<void> | void>;
  }> {
    const outcomes = await mapWithConcurrency(events, this.eventDispatchConcurrency, async (event) => {
      const outcome = await this.dispatchInboundEvent(event);
      const completion = extractCompletionPromise(outcome);
      const afterCommit = extractAfterCommitAction(outcome);
      return { completion, afterCommit };
    });
    const completions = outcomes
      .map((outcome) => outcome.completion)
      .filter((completion): completion is Promise<void> => Boolean(completion));
    const afterCommitActions = outcomes
      .map((outcome) => outcome.afterCommit)
      .filter((afterCommit): afterCommit is () => Promise<void> | void => Boolean(afterCommit));
    return {
      completion: completions.length === 0 ? Promise.resolve() : Promise.all(completions).then(() => {}),
      afterCommitActions,
    };
  }

  async scheduleInboundEvent(event: InboundTextEvent): Promise<RuntimeResponse> {
    const scopeId = String(event?.externalScopeId ?? '');
    if (!scopeId) {
      return this.processInboundEvent(event);
    }
    await this.flushDeliveryRetryQueue({ externalScopeId: scopeId });

    const pending = this.pendingInboundMerges.get(scopeId) ?? null;
    if (pending) {
      if (parseSlashCommand(String(event?.text ?? ''))) {
        void this.flushPendingInboundMerge(scopeId, { textOnly: true });
        return this.enqueueScopeWork(scopeId, async () => this.processInboundEvent(event));
      }
      const mergedEvent = mergeInboundEvents(pending.event, event);
      if (shouldDelayInboundEvent(mergedEvent)) {
        pending.event = mergedEvent;
        debugRuntime('pending_inbound_merge_updated', {
          scopeId,
          attachmentCount: Array.isArray(mergedEvent.attachments) ? mergedEvent.attachments.length : 0,
          hasText: Boolean(String(mergedEvent.text ?? '').trim()),
        });
        return pending.completion;
      }
      this.pendingInboundMerges.delete(scopeId);
      this.clearPendingInboundTimer(pending);
      const operation = this.enqueueScopeWork(scopeId, async () => this.processInboundEvent(mergedEvent));
      operation.then(pending.resolve, pending.reject);
      return operation;
    }

    if (this.scopeChains.has(scopeId)) {
      debugRuntime('scope_busy_append_requested', {
        scopeId,
        textPreview: truncateDebugText(event?.text),
        attachmentCount: Array.isArray(event?.attachments) ? event.attachments.length : 0,
      });
      return this.appendInboundEventWhileBusy(event);
    }

    if (shouldDelayInboundEvent(event)) {
      const deferred = createPendingInboundMerge(event);
      this.pendingInboundMerges.set(scopeId, deferred);
      debugRuntime('pending_inbound_merge_started', {
        scopeId,
        attachmentCount: Array.isArray(event.attachments) ? event.attachments.length : 0,
      });
      return deferred.completion;
    }

    return this.enqueueScopeWork(scopeId, async () => this.processInboundEvent(event));
  }

  async respondWhileScopeBusy(event: InboundTextEvent): Promise<RuntimeResponse> {
    const content = [
      this.i18n.t('coordinator.blocked.active'),
      this.i18n.t('coordinator.blocked.waitOrStop'),
    ].join('\n');
    const typingStart = this.safeSendTyping(event.externalScopeId, 'start');
    try {
      const delivery = await this.sendTextWithRetry({
        externalScopeId: event.externalScopeId,
        content,
      });
      if (!delivery.success && this.isRateLimitedDeliveryFailure(delivery)) {
        await this.ensureScopeNoticeDelivered(
          event.externalScopeId,
          this.i18n.t('runtime.error.weixinRateLimitedNotice'),
        );
      }
      return {
        type: 'message',
        messages: [{ text: content }],
      };
    } finally {
      await typingStart;
      await this.safeSendTyping(event.externalScopeId, 'stop');
    }
  }

  appendInboundEventWhileBusy(event: InboundTextEvent): Promise<RuntimeResponse> {
    const scopeId = String(event?.externalScopeId ?? '');
    if (!scopeId) {
      return this.processInboundEvent(event);
    }
    const existing = this.pendingBusyAppends.get(scopeId) ?? null;
    if (existing) {
      existing.event = mergeInboundEvents(existing.event, event);
      debugRuntime('busy_append_merged', {
        scopeId,
        textPreview: truncateDebugText(existing.event?.text),
        attachmentCount: Array.isArray(existing.event.attachments) ? existing.event.attachments.length : 0,
      });
      return existing.completion;
    }

    const pending = createPendingInboundMerge(event);
    this.pendingBusyAppends.set(scopeId, pending);
    const previous = this.scopeChains.get(scopeId) ?? Promise.resolve({ type: 'message', messages: [] });
    const operation = previous.catch(() => ({ type: 'message', messages: [] })).then(async () => {
      const queued = this.pendingBusyAppends.get(scopeId);
      if (!queued) {
        return { type: 'message', messages: [] };
      }
      this.pendingBusyAppends.delete(scopeId);
      debugRuntime('busy_append_processing', {
        scopeId,
        textPreview: truncateDebugText(queued.event?.text),
        attachmentCount: Array.isArray(queued.event.attachments) ? queued.event.attachments.length : 0,
      });
      return this.processInboundEvent(queued.event);
    });
    this.scopeChains.set(scopeId, operation);
    operation
      .then(pending.resolve, pending.reject)
      .finally(() => {
        if (this.scopeChains.get(scopeId) === operation) {
          this.scopeChains.delete(scopeId);
        }
      });
    debugRuntime('busy_append_queued', {
      scopeId,
      textPreview: truncateDebugText(event?.text),
      attachmentCount: Array.isArray(event?.attachments) ? event.attachments.length : 0,
    });
    return pending.completion;
  }

  armPendingInboundMerge(scopeId: string, pending: PendingInboundMerge): void {
    this.clearPendingInboundTimer(pending);
    pending.timer = setTimeout(() => {
      void this.flushPendingInboundMerge(scopeId);
    }, this.inboundAttachmentMergeWindowMs);
  }

  clearPendingInboundTimer(pending: PendingInboundMerge): void {
    if (!pending.timer) {
      return;
    }
    clearTimeout(pending.timer);
    pending.timer = null;
  }

  async flushPendingInboundMerge(
    externalScopeId: string,
    { textOnly = false }: { textOnly?: boolean } = {},
  ): Promise<void> {
    const scopeId = String(externalScopeId ?? '');
    if (!scopeId) {
      return;
    }
    const pending = this.pendingInboundMerges.get(scopeId);
    if (!pending) {
      return;
    }
    if (textOnly && !String(pending.event.text ?? '').trim()) {
      return;
    }
    this.pendingInboundMerges.delete(scopeId);
    this.clearPendingInboundTimer(pending);
    debugRuntime('pending_inbound_merge_flushed', {
      scopeId,
      attachmentCount: Array.isArray(pending.event.attachments) ? pending.event.attachments.length : 0,
      hasText: Boolean(String(pending.event.text ?? '').trim()),
    });
    const operation = this.enqueueScopeWork(scopeId, async () => this.processInboundEvent(pending.event));
    operation.then(pending.resolve, pending.reject);
    await operation.catch(() => {});
  }

  async flushAllPendingInboundMerges(): Promise<void> {
    const scopeIds = [...this.pendingInboundMerges.keys()];
    if (scopeIds.length === 0) {
      return;
    }
    await Promise.all(scopeIds.map(async (scopeId) => {
      await this.flushPendingInboundMerge(scopeId, { textOnly: true });
    }));
  }

  async runWithTurnSlot<T>(
    externalScopeId: string,
    kind: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const queuedBefore = this.turnLimiter.queuedCount;
    debugRuntime('turn_slot_wait', {
      scopeId: externalScopeId,
      kind,
      active: this.turnLimiter.activeCount,
      queued: queuedBefore,
      max: this.turnLimiter.maxConcurrency,
    });
    const acquired = this.turnLimiter.acquire();
    const release = typeof acquired === 'function' ? acquired : await acquired;
    debugRuntime('turn_slot_acquired', {
      scopeId: externalScopeId,
      kind,
      active: this.turnLimiter.activeCount,
      queued: this.turnLimiter.queuedCount,
      max: this.turnLimiter.maxConcurrency,
    });
    try {
      return await operation();
    } finally {
      release();
      debugRuntime('turn_slot_released', {
        scopeId: externalScopeId,
        kind,
        active: this.turnLimiter.activeCount,
        queued: this.turnLimiter.queuedCount,
        max: this.turnLimiter.maxConcurrency,
      });
    }
  }

  async processInboundEvent(event: InboundTextEvent): Promise<RuntimeResponse> {
    return this.processInboundEventWithOptions(event, { deferPostResponseAction: false });
  }

  async processInboundEventWithOptions(
    event: InboundTextEvent,
    options: {
      deferPostResponseAction?: boolean;
      suppressProgressDelivery?: boolean;
      suppressTyping?: boolean;
    } = {},
  ): Promise<RuntimeResponse> {
    const runtimeGeneration = this.runtimeGeneration;
    await this.flushPendingScopeNotice(event.externalScopeId);
    await this.flushDeliveryRetryQueue({ externalScopeId: event.externalScopeId });
    const streamState = createStreamState();
    debugRuntime('process_inbound_event_start', {
      scopeId: event.externalScopeId,
      deferPostResponseAction: Boolean(options.deferPostResponseAction),
      textPreview: truncateDebugText(event?.text),
      attachmentCount: Array.isArray(event?.attachments) ? event.attachments.length : 0,
    });
    const suppressTyping = Boolean(options.suppressTyping);
    const typingStart = suppressTyping
      ? Promise.resolve()
      : this.safeSendTyping(event.externalScopeId, 'start');
    const stopTypingKeepalive = suppressTyping
      ? async () => {}
      : this.startTypingKeepalive(event.externalScopeId);
    try {
      const turnStartedAt = Date.now();
      let response: RuntimeResponse;
      try {
        response = await this.runWithTurnSlot(event.externalScopeId, 'inbound', async () =>
          this.applyTurnTimeout(this.bridgeCoordinator.handleInboundEvent(event, {
            onProgress: async (progress) => {
              if (runtimeGeneration !== this.runtimeGeneration) {
                return;
              }
              if (options.suppressProgressDelivery || !this.deliverProgressPreviews) {
                return;
              }
              await this.handleProgressUpdate(event, streamState, progress);
            },
            onApprovalRequest: async () => {
              await this.notifyApprovalPrompt(event);
            },
          })));
      } catch (turnError) {
        this.recordTurnMetrics(turnStartedAt, false, this.accountKeyOf(event));
        throw turnError;
      }
      this.recordTurnMetrics(turnStartedAt, true, this.accountKeyOf(event));
      debugRuntime('coordinator_response', {
        scopeId: event.externalScopeId,
        type: response?.type ?? null,
        messageCount: Array.isArray(response?.messages) ? response.messages.length : null,
        messages: Array.isArray(response?.messages)
          ? response.messages.map((message) => ({
            text: truncateDebugText(message?.text),
            artifactKind: message?.artifact?.kind ?? null,
            artifactPath: String(message?.artifact?.path ?? ''),
            mediaPath: String(message?.mediaPath ?? ''),
            caption: truncateDebugText(message?.caption),
          }))
          : null,
      });
      if (response?.type !== 'message') {
        debugRuntime('skip_non_message_response', {
          scopeId: event.externalScopeId,
          type: response?.type ?? null,
        });
        return response;
      }
      if (runtimeGeneration !== this.runtimeGeneration) {
        debugRuntime('skip_stale_runtime_response', {
          scopeId: event.externalScopeId,
          previousGeneration: runtimeGeneration,
          currentGeneration: this.runtimeGeneration,
        });
        return response;
      }
      const codexTurnMeta = response?.meta?.codexTurn ?? null;
      const finalText = extractResponseMessageText(response);
      const artifactMessages = extractResponseArtifactMessages(response);
      const hasComparableFinalText = Boolean(normalizeComparableText(finalText));
      const hasCompleteMediaOnlyFinal = !hasComparableFinalText
        && artifactMessages.length > 0
        && (codexTurnMeta?.outputState ?? 'complete') === 'complete';
      if (hasCompleteMediaOnlyFinal) {
        await this.stopPreviewStreaming(streamState);
        const finalDelivery: FinalDelivery = {
          source: codexTurnMeta?.finalSource ?? 'thread_items_media',
          mode: 'media_only_complete',
          finalText: '',
          sentContent: '',
          delivered: true,
          rateLimited: false,
          error: null,
        };
        response.meta = {
          ...(response.meta ?? {}),
          runtimeDelivery: {
            mode: finalDelivery.mode,
            delivered: finalDelivery.delivered,
            rateLimited: finalDelivery.rateLimited,
            error: finalDelivery.error,
            errorCode: finalDelivery.errorCode ?? null,
          },
        };
        debugRuntime('final_delivery_decision', {
          scopeId: event.externalScopeId,
          outputState: codexTurnMeta?.outputState ?? null,
          finalSource: finalDelivery.source,
          finalText: '',
          streamedPreview: truncateDebugText(streamState.streamedText),
          previewChunkCount: streamState.sentChunkCount,
          completionMode: finalDelivery.mode,
          deliveryContent: finalDelivery.sentContent,
        });
      } else if (hasComparableFinalText || codexTurnMeta) {
        const finalDelivery = await this.ensureFinalDelivered(event, streamState, response, codexTurnMeta);
        response.meta = {
          ...(response.meta ?? {}),
          runtimeDelivery: {
            mode: finalDelivery.mode,
            delivered: finalDelivery.delivered,
            rateLimited: finalDelivery.rateLimited,
            error: finalDelivery.error,
            errorCode: finalDelivery.errorCode ?? null,
          },
        };
        debugRuntime('final_delivery_decision', {
          scopeId: event.externalScopeId,
          outputState: codexTurnMeta?.outputState ?? null,
          finalSource: finalDelivery.source,
          finalText: truncateDebugText(finalDelivery.finalText),
          streamedPreview: truncateDebugText(streamState.streamedText),
          previewChunkCount: streamState.sentChunkCount,
          completionMode: finalDelivery.mode,
          deliveryContent: truncateDebugText(finalDelivery.sentContent),
        });
      } else {
        await this.stopPreviewStreaming(streamState);
      }
      if (artifactMessages.length > 0) {
        await this.deliverArtifactMessages(event, artifactMessages);
      }
      if (!options.deferPostResponseAction) {
        await this.runPostResponseAction(response, event);
      }
      return response;
    } finally {
      await typingStart;
      await stopTypingKeepalive();
    }
  }

  async handleProgressUpdate(
    event: InboundTextEvent,
    streamState: StreamState,
    progress: ProviderTurnProgress | null | undefined,
  ): Promise<void> {
    if (
      !progress
      || !['commentary', 'final_answer'].includes(progress.outputKind)
      || streamState.streamingDisabled
      || streamState.previewStopped
    ) {
      return;
    }
    debugRuntime('progress_update_received', {
      scopeId: event.externalScopeId,
      outputKind: progress.outputKind,
      deltaPreview: truncateDebugText(progress.delta, 120),
      textLength: String(progress.text ?? '').length,
      pendingPreviewLength: streamState.pendingPreview.length,
      streamedLength: streamState.streamedText.length,
    });
    let delta = '';
    if (progress.outputKind === 'final_answer') {
      const nextText = String(progress.text ?? '');
      if (nextText) {
        if (streamState.lastObservedFinal) {
          if (!nextText.startsWith(streamState.lastObservedFinal)) {
            if (streamState.lastObservedFinal.startsWith(nextText)) {
              return;
            }
            streamState.streamingDisabled = true;
            streamState.pendingPreview = '';
            streamState.lastObservedFinal = nextText;
            return;
          }
          delta = nextText.slice(streamState.lastObservedFinal.length);
        } else {
          delta = String(progress.delta ?? nextText);
        }
        streamState.lastObservedFinal = nextText;
      } else {
        delta = String(progress.delta ?? '');
      }
    } else {
      delta = String(progress.delta ?? progress.text ?? '');
    }

    delta = trimOverlappingPreviewDelta(streamState, delta);
    if (!delta) {
      return;
    }

    streamState.pendingPreview += delta;

    this.ensurePreviewPump(event, streamState);
  }

  ensurePreviewPump(event: InboundTextEvent, streamState: StreamState): void {
    if (streamState.previewPumpPromise || streamState.previewStopped || streamState.streamingDisabled || !streamState.pendingPreview) {
      return;
    }
    streamState.previewPumpPromise = this.runPreviewPump(event, streamState)
      .finally(() => {
        streamState.previewPumpPromise = null;
      });
  }

  async runPreviewPump(event: InboundTextEvent, streamState: StreamState): Promise<void> {
    while (!streamState.previewStopped && !streamState.streamingDisabled) {
      if (!streamState.pendingPreview) {
        return;
      }
      const waitUntil = Math.max(streamState.nextPreviewAt, streamState.smallPreviewDelayUntil);
      await waitForPreviewWindow(streamState, waitUntil);
      if (streamState.previewStopped || streamState.streamingDisabled || !streamState.pendingPreview) {
        return;
      }
      const chunk = streamState.firstPreviewSent
        ? extractTimedPreviewChunk(
          streamState.pendingPreview,
          this.previewSoftTargetBytes,
          this.previewHardLimitBytes,
        )
        : extractImmediatePreviewChunk(streamState.pendingPreview, this.previewHardLimitBytes);
      if (!chunk) {
        return;
      }
      if (
        utf8ByteLength(chunk) < WeixinBridgeRuntime.PREVIEW_MIN_TARGET_BYTES
        && this.previewIntervalMs > 0
      ) {
        if (streamState.smallPreviewDelayUntil === 0) {
          streamState.smallPreviewDelayUntil = Date.now() + this.previewIntervalMs;
          continue;
        }
      }
      streamState.smallPreviewDelayUntil = 0;
      streamState.pendingPreview = streamState.pendingPreview.slice(chunk.length).replace(/^[\s\n]+/u, '');
      await this.sendPreviewChunk(event, streamState, chunk.trim());
      if (streamState.streamingDisabled || streamState.previewStopped) {
        return;
      }
      if (!streamState.firstPreviewSent) {
        streamState.firstPreviewSent = true;
      }
      streamState.nextPreviewAt = Date.now() + this.previewIntervalMs;
    }
  }

  async sendPreviewChunk(event: InboundTextEvent, streamState: StreamState, chunk: string): Promise<void> {
    const normalizedChunk = String(chunk ?? '').trim();
    if (!normalizedChunk) {
      return;
    }
    streamState.inFlightPreview = normalizedChunk;
    try {
      const delivery = await this.sendTextWithRetry({
        externalScopeId: event.externalScopeId,
        content: normalizedChunk,
      });
      if (!delivery.success) {
        streamState.streamingDisabled = true;
        streamState.pendingPreview = '';
        debugRuntime('preview_delivery_failed', {
          scopeId: event.externalScopeId,
          failedText: truncateDebugText(delivery.failedText),
          deliveredText: truncateDebugText(delivery.deliveredText),
          error: delivery.error,
        });
        if (delivery.deliveredText) {
          appendPreviewText(streamState, delivery.deliveredText);
        }
        return;
      }
      appendPreviewText(streamState, delivery.deliveredText || normalizedChunk);
    } finally {
      if (streamState.inFlightPreview === normalizedChunk) {
        streamState.inFlightPreview = '';
      }
    }
  }

  async stopPreviewStreaming(streamState: StreamState): Promise<void> {
    streamState.previewStopped = true;
    streamState.pendingPreview = '';
    streamState.smallPreviewDelayUntil = 0;
    const pump = streamState.previewPumpPromise;
    if (pump) {
      await pump;
    }
  }

  async ensureFinalDelivered(
    event: InboundTextEvent,
    streamState: StreamState,
    response: RuntimeResponse,
    codexTurnMeta: RuntimeResponse['meta'] extends infer T
      ? T extends { codexTurn?: infer U | null }
        ? U | null
        : null
      : null,
  ): Promise<FinalDelivery> {
    await this.stopPreviewStreaming(streamState);

    const outputState = codexTurnMeta?.outputState ?? 'complete';
    const errorMessage = String(codexTurnMeta?.errorMessage ?? '').trim();
    const finalText = extractResponseMessageText(response);
    const artifactMessages = extractResponseArtifactMessages(response);
    const normalizedFinal = normalizeComparableText(finalText);
    debugRuntime('final_delivery_begin', {
      scopeId: event.externalScopeId,
      outputState,
      finalSource: codexTurnMeta?.finalSource ?? null,
      errorMessage,
      finalTextPreview: truncateDebugText(finalText),
      artifactCount: artifactMessages.length,
      streamedPreview: truncateDebugText(streamState.streamedText),
      previewChunkCount: streamState.sentChunkCount,
    });
    if (codexTurnMeta?.finalSource === 'commentary_only') {
      const failureMessage = this.i18n.t('runtime.error.finalAnswerMissing');
      const failureDelivery = await this.sendTextWithRetry({
        externalScopeId: event.externalScopeId,
        content: failureMessage,
      });
      if (!failureDelivery.success && !this.isAutomationEvent(event)) {
        this.enqueueTextDeliveryRetry({
          externalScopeId: event.externalScopeId,
          content: failureDelivery.failedText || failureMessage,
          delivery: failureDelivery,
          source: 'final_answer_missing',
        });
      }
      return {
        source: 'commentary_only',
        mode: 'commentary_only_suppressed',
        finalText: '',
        sentContent: failureDelivery.deliveredText || failureMessage,
        delivered: failureDelivery.success,
        rateLimited: this.isRateLimitedDeliveryFailure(failureDelivery),
        error: failureDelivery.error || null,
        errorCode: failureDelivery.errorCode ?? null,
      };
    }
    if (outputState !== 'complete') {
      let partialCommitDelivery: DeliveryResult | null = null;
      if (
        outputState === 'partial'
        && normalizedFinal
        && codexTurnMeta?.finalSource !== 'commentary_only'
      ) {
        const previewText = resolveDeliveredFinalPreviewText(streamState.streamedText, finalText);
        const commitContent = resolveFinalCommitContent(finalText, previewText);
        if (!commitContent) {
          return {
            source: codexTurnMeta?.finalSource ?? 'progress_only',
            mode: 'partial_preview_already_sent',
            finalText,
            sentContent: '',
            delivered: true,
            rateLimited: false,
            error: null,
          };
        }
        const delivery = await this.sendTextWithRetry({
          externalScopeId: event.externalScopeId,
          content: commitContent,
        });
        partialCommitDelivery = delivery;
        if (delivery.success) {
          return {
            source: codexTurnMeta?.finalSource ?? 'progress_only',
            mode: 'partial_preview_commit',
            finalText,
            sentContent: delivery.deliveredText || commitContent,
            delivered: true,
            rateLimited: false,
            error: null,
          };
        }
      }
      const failureMessage = errorMessage
        ? this.formatProviderFailureMessage(errorMessage)
        : outputState === 'interrupted'
          ? this.i18n.t('runtime.error.interrupted')
          : outputState === 'timeout'
            ? this.i18n.t('runtime.error.timeout')
            : outputState === 'stale_session'
              ? this.i18n.t('runtime.error.staleSession')
              : this.i18n.t('runtime.error.incomplete');
      const failureDelivery = await this.sendTextWithRetry({
        externalScopeId: event.externalScopeId,
        content: failureMessage,
      });
      if (!failureDelivery.success && !this.isAutomationEvent(event)) {
        this.enqueueTextDeliveryRetry({
          externalScopeId: event.externalScopeId,
          content: failureDelivery.failedText || failureMessage,
          delivery: failureDelivery,
          source: 'failure_message',
        });
      }
      if (
        !failureDelivery.success
        && (
          this.isRateLimitedDeliveryFailure(failureDelivery)
          || this.isRateLimitedDeliveryFailure(partialCommitDelivery)
        )
        && !this.isAutomationEvent(event)
      ) {
        await this.ensureScopeNoticeDelivered(
          event.externalScopeId,
          this.i18n.t('runtime.error.weixinRateLimitedNotice'),
        );
      }
      const failureMode = outputState === 'partial'
        ? 'explicit_partial_failure'
        : outputState === 'interrupted'
          ? 'explicit_interrupted_failure'
          : outputState === 'timeout'
            ? 'explicit_timeout_failure'
            : outputState === 'stale_session'
              ? 'explicit_stale_session_failure'
              : outputState === 'provider_error'
                ? 'explicit_provider_error_failure'
              : 'explicit_missing_failure';
      return {
        source: codexTurnMeta?.finalSource ?? 'none',
        mode: failureMode,
        finalText: '',
        sentContent: failureDelivery.deliveredText || failureMessage,
        delivered: failureDelivery.success,
        rateLimited: this.isRateLimitedDeliveryFailure(failureDelivery)
          || this.isRateLimitedDeliveryFailure(partialCommitDelivery),
        error: failureDelivery.error || null,
        errorCode: failureDelivery.errorCode ?? partialCommitDelivery?.errorCode ?? null,
      };
    }
    if (!normalizedFinal) {
      if (artifactMessages.length > 0) {
        return {
          source: codexTurnMeta?.finalSource ?? 'thread_items_media',
          mode: 'media_only_complete',
          finalText: '',
          sentContent: '',
          delivered: true,
          rateLimited: false,
          error: null,
        };
      }
      throw new Error(this.i18n.t('runtime.error.finalTextMissing', { scopeId: event.externalScopeId }));
    }

    const previewText = resolveDeliveredFinalPreviewText(streamState.streamedText, finalText);
    if (normalizeComparableText(previewText) === normalizedFinal) {
        return {
          source: codexTurnMeta?.finalSource ?? 'thread_items',
          mode: 'preview_already_complete',
          finalText,
          sentContent: '',
          delivered: true,
          rateLimited: false,
          error: null,
        };
      }

    let lastAttemptedContent = '';
    let lastFailedDelivery: DeliveryResult | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const commitContent = resolveFinalCommitContent(finalText, previewText);
      if (!commitContent) {
        return {
          source: codexTurnMeta?.finalSource ?? 'thread_items',
          mode: attempt === 1 ? 'preview_already_complete' : 'final_resumed_complete',
          finalText,
          sentContent: '',
          delivered: true,
          rateLimited: false,
          error: null,
        };
      }
      lastAttemptedContent = commitContent;
      debugRuntime('final_delivery_attempt', {
        scopeId: event.externalScopeId,
        attempt,
        contentPreview: truncateDebugText(commitContent),
      });
      const delivery = await this.sendTextWithRetry({
        externalScopeId: event.externalScopeId,
        content: commitContent,
      });
      if (delivery.success) {
        return {
          source: codexTurnMeta?.finalSource ?? 'thread_items',
          mode: commitContent === finalText ? 'full_final_commit' : 'tail_final_commit',
          finalText,
          sentContent: delivery.deliveredText || commitContent,
          delivered: true,
          rateLimited: false,
          error: null,
        };
      }
      lastFailedDelivery = delivery;
      debugRuntime('final_delivery_attempt_failed', {
        scopeId: event.externalScopeId,
        attempt,
        deliveredText: truncateDebugText(delivery.deliveredText),
        failedText: truncateDebugText(delivery.failedText),
        error: delivery.error,
      });
    }

    if (this.isRateLimitedDeliveryFailure(lastFailedDelivery) && !this.isAutomationEvent(event)) {
      await this.ensureScopeNoticeDelivered(
        event.externalScopeId,
        this.i18n.t('runtime.error.weixinRateLimitedNotice'),
      );
    }
    if (!this.isAutomationEvent(event)) {
      this.enqueueTextDeliveryRetry({
        externalScopeId: event.externalScopeId,
        content: lastFailedDelivery?.failedText || lastAttemptedContent,
        delivery: lastFailedDelivery,
        source: 'final_answer',
      });
    }

    return {
      source: codexTurnMeta?.finalSource ?? 'thread_items',
      mode: 'final_delivery_incomplete',
      finalText,
      sentContent: lastAttemptedContent,
      delivered: false,
      rateLimited: this.isRateLimitedDeliveryFailure(lastFailedDelivery),
      error: lastFailedDelivery?.error || null,
      errorCode: lastFailedDelivery?.errorCode ?? null,
    };
  }

  formatProviderFailureMessage(errorMessage: string): string {
    const normalized = String(errorMessage ?? '').trim();
    const detail = normalized.replace(/[。.!！]+$/u, '');
    if (/subscription credits are exhausted/i.test(normalized)) {
      return this.i18n.t('runtime.error.codexCreditsExhausted', {
        detail,
      });
    }
    if (/usage limit reached/i.test(normalized)) {
      return this.i18n.t('runtime.error.codexUsageLimitReached', {
        detail,
      });
    }
    return this.i18n.t('runtime.error.codex', { error: normalized });
  }

  async safeSendTyping(externalScopeId: string, status: 'start' | 'stop'): Promise<void> {
    if (typeof this.platformPlugin.sendTyping !== 'function') {
      return;
    }
    try {
      await this.platformPlugin.sendTyping({ externalScopeId, status });
    } catch {
      // Ignore WeChat typing failures; progress delivery matters more than presence.
    }
  }

  startTypingKeepalive(externalScopeId: string): () => Promise<void> {
    if (typeof this.platformPlugin.sendTyping !== 'function' || this.typingKeepaliveMs <= 0) {
      return async () => {
        await this.safeSendTyping(externalScopeId, 'stop');
      };
    }
    void this.stopTypingKeepalive(externalScopeId);
    const timer = setInterval(() => {
      void this.safeSendTyping(externalScopeId, 'start');
    }, this.typingKeepaliveMs);
    this.typingKeepalives.set(externalScopeId, timer);
    return async () => {
      if (this.typingKeepalives.get(externalScopeId) === timer) {
        this.typingKeepalives.delete(externalScopeId);
      }
      clearInterval(timer);
      await this.safeSendTyping(externalScopeId, 'stop');
    };
  }

  async stopTypingKeepalive(externalScopeId: string): Promise<void> {
    const timer = this.typingKeepalives.get(externalScopeId);
    if (timer) {
      clearInterval(timer);
      this.typingKeepalives.delete(externalScopeId);
    }
  }

  async clearRuntimeScope(scopeRef: { platform: string; externalScopeId: string }): Promise<void> {
    const scopeId = String(scopeRef?.externalScopeId ?? '').trim();
    if (!scopeId) {
      return;
    }
    const pending = this.pendingInboundMerges.get(scopeId);
    if (pending) {
      this.clearPendingInboundTimer(pending);
      pending.resolve({
        type: 'message',
        messages: [],
      });
      this.pendingInboundMerges.delete(scopeId);
    }
    const busyAppend = this.pendingBusyAppends.get(scopeId);
    if (busyAppend) {
      this.clearPendingInboundTimer(busyAppend);
      busyAppend.resolve({
        type: 'message',
        messages: [],
      });
      this.pendingBusyAppends.delete(scopeId);
    }
    this.scopeChains.delete(scopeId);
    await this.stopTypingKeepalive(scopeId);
    await this.safeSendTyping(scopeId, 'stop');
    await this.bridgeCoordinator.forceClearActiveTurn?.({
      platform: String(scopeRef.platform ?? 'weixin'),
      externalScopeId: scopeId,
    });
    debugRuntime('runtime_scope_cleared', {
      platform: String(scopeRef.platform ?? 'weixin'),
      scopeId,
    });
  }

  async clearPendingRuntimeWork(): Promise<void> {
    for (const pending of this.pendingInboundMerges.values()) {
      this.clearPendingInboundTimer(pending);
      pending.resolve({
        type: 'message',
        messages: [],
      });
    }
    this.pendingInboundMerges.clear();
    for (const pending of this.pendingBusyAppends.values()) {
      this.clearPendingInboundTimer(pending);
      pending.resolve({
        type: 'message',
        messages: [],
      });
    }
    this.pendingBusyAppends.clear();
    this.scopeChains.clear();
    this.backgroundTasks.clear();
    for (const scopeId of [...this.typingKeepalives.keys()]) {
      await this.stopTypingKeepalive(scopeId);
      await this.safeSendTyping(scopeId, 'stop');
    }
    debugRuntime('runtime_pending_work_cleared', {
      pendingDeliveryRetries: this.deliveryRetryQueue.length,
    });
  }

  discardPendingInboundMergesWithoutText(): void {
    for (const [scopeId, pending] of this.pendingInboundMerges) {
      if (String(pending.event.text ?? '').trim()) {
        continue;
      }
      this.clearPendingInboundTimer(pending);
      pending.resolve({
        type: 'message',
        messages: [],
      });
      this.pendingInboundMerges.delete(scopeId);
    }
  }

  startHealthMonitor(): void {
    if (this.healthCheckTimer || this.healthCheckIntervalMs <= 0) {
      return;
    }
    this.healthCheckTimer = setInterval(() => {
      this.persistMetrics();
      void this.runHealthCheck();
    }, this.healthCheckIntervalMs);
  }

  stopHealthMonitor(): void {
    if (!this.healthCheckTimer) {
      return;
    }
    clearInterval(this.healthCheckTimer);
    this.healthCheckTimer = null;
  }

  async runHealthCheck(): Promise<void> {
    if (this.stopRequested || !this.poller) {
      return;
    }
    if (!this.lastPollAt) {
      return;
    }
    const ageMs = Date.now() - this.lastPollAt;
    if (ageMs < this.stalePollThresholdMs) {
      return;
    }
    this.recordRuntimeError(new Error(`bridge health check detected stale poller after ${ageMs}ms`), 'runtime');
    this.poller.stop();
    await this.platformPlugin.stop().catch(() => {});
  }

  clearAutoRestartTimer(): void {
    if (!this.autoRestartTimer) {
      return;
    }
    clearTimeout(this.autoRestartTimer);
    this.autoRestartTimer = null;
  }

  scheduleAutoRestart(): void {
    if (this.stopRequested || this.autoRestartTimer) {
      return;
    }
    this.restartCount += 1;
    const attempt = this.restartCount;
    this.autoRestartTimer = setTimeout(() => {
      this.autoRestartTimer = null;
      if (this.stopRequested || this.poller) {
        return;
      }
      void this.startInBackground().catch(async (error) => {
        this.recordRuntimeError(error, 'runtime');
        await this.onError(error);
        if (!this.stopRequested) {
          this.scheduleAutoRestart();
        }
      });
    }, this.autoRestartDelayMs);
    debugRuntime('auto_restart_scheduled', {
      attempt,
      delayMs: this.autoRestartDelayMs,
    });
  }

  recordRuntimeError(error: unknown, stage: RuntimeErrorStage) {
    const now = Date.now();
    this.lastErrorAt = now;
    this.lastErrorStage = stage;
    this.lastError = error instanceof Error
      ? error.message || error.stack || String(error)
      : String(error ?? 'unknown error');
    this.metrics.errors += 1;
    if (stage === 'poll') {
      this.metrics.pollErrors += 1;
    } else if (stage === 'commit') {
      this.metrics.commitErrors += 1;
    } else {
      this.metrics.runtimeErrors += 1;
    }
    this.metricsRecentErrors.push({
      at: now,
      stage,
      message: this.lastError.slice(0, 500),
    });
    this.pruneMetricErrorEvents();
    this.metricsDirty = true;
    const message = this.lastError;
    void Promise.resolve(this.onAlert({
      type: 'weixin_error',
      stage,
      message,
      at: now,
      restartCount: this.restartCount,
      pendingDeliveryRetries: this.deliveryRetryQueue.length,
    })).catch(() => {});
  }

  pruneMetricErrorEvents(): void {
    const threshold = Date.now() - METRICS_RECENT_ERROR_RETENTION_MS;
    this.metricsRecentErrors = this.metricsRecentErrors
      .filter((event) => Number.isFinite(event.at) && event.at >= threshold)
      .slice(-METRICS_RECENT_ERROR_LIMIT);
  }

  async sendTextWithRetry({
    externalScopeId,
    content,
  }: {
    externalScopeId: string;
    content: string;
  }): Promise<DeliveryResult> {
    const result = await this.platformPlugin.sendText({ externalScopeId, content });
    const normalized = this.normalizeTextDeliveryResult(result, content);
    this.recordDeliveryMetric(normalized.success);
    return normalized;
  }

  normalizeTextDeliveryResult(
    result: DeliveryResult | null | undefined,
    content: string,
  ): DeliveryResult {
    return result ?? {
      success: false,
      deliveredCount: 0,
      deliveredText: '',
      failedIndex: 0,
      failedText: String(content ?? '').trim(),
      error: this.i18n.t('runtime.error.unknownDeliveryFailure'),
      errorCode: null,
    };
  }

  enqueueTextDeliveryRetry({
    externalScopeId,
    content,
    delivery = null,
    source = 'text',
  }: {
    externalScopeId: string;
    content: string;
    delivery?: { error?: string | null; errorCode?: number | null } | null;
    source?: string;
  }): void {
    const scopeId = String(externalScopeId ?? '').trim();
    const normalizedContent = String(content ?? '').trim();
    if (!scopeId || !normalizedContent) {
      return;
    }
    const now = Date.now();
    const existing = this.deliveryRetryQueue.find((entry) => (
      entry.externalScopeId === scopeId
      && entry.content === normalizedContent
      && entry.source === source
    ));
    if (existing) {
      existing.lastError = String(delivery?.error ?? existing.lastError ?? '').trim();
      existing.lastErrorCode = typeof delivery?.errorCode === 'number' ? delivery.errorCode : existing.lastErrorCode;
      existing.nextAttemptAt = Math.min(existing.nextAttemptAt, now + this.resolveQueuedDeliveryRetryMs(delivery, existing.attemptCount + 1));
      return;
    }
    this.deliveryRetryQueue.push({
      id: `${now}-${Math.random().toString(36).slice(2)}`,
      externalScopeId: scopeId,
      content: normalizedContent,
      source,
      createdAt: now,
      nextAttemptAt: now + this.resolveQueuedDeliveryRetryMs(delivery, 1),
      attemptCount: 0,
      lastError: String(delivery?.error ?? '').trim(),
      lastErrorCode: typeof delivery?.errorCode === 'number' ? delivery.errorCode : null,
    });
    if (this.deliveryRetryQueue.length > WeixinBridgeRuntime.DELIVERY_RETRY_MAX_ITEMS) {
      this.deliveryRetryQueue.splice(0, this.deliveryRetryQueue.length - WeixinBridgeRuntime.DELIVERY_RETRY_MAX_ITEMS);
    }
    debugRuntime('text_delivery_retry_queued', {
      scopeId,
      source,
      queueLength: this.deliveryRetryQueue.length,
      contentPreview: truncateDebugText(normalizedContent),
      error: delivery?.error ?? null,
      errorCode: delivery?.errorCode ?? null,
    });
  }

  async flushDeliveryRetryQueue({
    externalScopeId = null,
    force = false,
  }: {
    externalScopeId?: string | null;
    force?: boolean;
  } = {}): Promise<void> {
    if (this.deliveryRetryPumpPromise) {
      return this.deliveryRetryPumpPromise;
    }
    const task = this.flushDeliveryRetryQueueInternal({ externalScopeId, force })
      .finally(() => {
        if (this.deliveryRetryPumpPromise === task) {
          this.deliveryRetryPumpPromise = null;
        }
      });
    this.deliveryRetryPumpPromise = task;
    return task;
  }

  async flushDeliveryRetryQueueInternal({
    externalScopeId = null,
    force = false,
  }: {
    externalScopeId?: string | null;
    force?: boolean;
  }): Promise<void> {
    const scopeFilter = String(externalScopeId ?? '').trim();
    if (this.deliveryRetryQueue.length === 0) {
      return;
    }
    const now = Date.now();
    for (const entry of [...this.deliveryRetryQueue]) {
      if (scopeFilter && entry.externalScopeId !== scopeFilter) {
        continue;
      }
      if (!force && entry.nextAttemptAt > now) {
        continue;
      }
      if (this.scopeChains.has(entry.externalScopeId)) {
        continue;
      }
      let delivery: DeliveryResult;
      try {
        delivery = this.normalizeTextDeliveryResult(
          await this.platformPlugin.sendText({
            externalScopeId: entry.externalScopeId,
            content: entry.content,
          }),
          entry.content,
        );
      } catch (error) {
        delivery = this.normalizeTextDeliveryResult({
          success: false,
          deliveredCount: 0,
          deliveredText: '',
          failedIndex: 0,
          failedText: entry.content,
          error: error instanceof Error ? error.message : String(error ?? 'unknown error'),
          errorCode: null,
        }, entry.content);
      }
      if (delivery.success) {
        this.deliveryRetryQueue = this.deliveryRetryQueue.filter((candidate) => candidate.id !== entry.id);
        debugRuntime('text_delivery_retry_succeeded', {
          scopeId: entry.externalScopeId,
          source: entry.source,
          queueLength: this.deliveryRetryQueue.length,
          contentPreview: truncateDebugText(delivery.deliveredText || entry.content),
        });
        continue;
      }
      const nextAttemptCount = entry.attemptCount + 1;
      entry.attemptCount = nextAttemptCount;
      entry.lastError = delivery.error || this.i18n.t('runtime.error.unknownDeliveryFailure');
      entry.lastErrorCode = delivery.errorCode ?? null;
      entry.nextAttemptAt = Date.now() + this.resolveQueuedDeliveryRetryMs(delivery, nextAttemptCount);
      debugRuntime('text_delivery_retry_failed', {
        scopeId: entry.externalScopeId,
        source: entry.source,
        attemptCount: entry.attemptCount,
        nextAttemptAt: entry.nextAttemptAt,
        error: entry.lastError,
        errorCode: entry.lastErrorCode,
      });
    }
  }

  resolveQueuedDeliveryRetryMs(
    detail: { error?: string | null; errorCode?: number | null } | null | undefined,
    attemptCount: number,
  ): number {
    if (this.isRateLimitedDeliveryFailure(detail) || this.isSessionExpiredDeliveryFailure(detail)) {
      return this.resolveDeliveryRetryMs(detail);
    }
    const base = WeixinBridgeRuntime.DELIVERY_RETRY_INITIAL_MS;
    const multiplier = Math.max(1, 2 ** Math.min(5, Math.max(0, attemptCount - 1)));
    return Math.min(WeixinBridgeRuntime.DELIVERY_RETRY_MAX_MS, base * multiplier);
  }

  async sendSystemTextDirect({
    externalScopeId,
    content,
  }: {
    externalScopeId: string;
    content: string;
  }): Promise<DeliveryResult> {
    const result = await this.platformPlugin.sendText({ externalScopeId, content });
    const normalized = this.normalizeTextDeliveryResult(result, content);
    this.recordDeliveryMetric(normalized.success);
    return normalized;
  }

  async sendMediaWithRetry({
    externalScopeId,
    filePath,
    caption,
  }: {
    externalScopeId: string;
    filePath: string;
    caption?: string | null;
  }): Promise<PlatformMediaDeliveryResult> {
    if (typeof this.platformPlugin.sendMedia !== 'function') {
      return {
        success: false,
        messageId: null,
        sentPath: String(filePath ?? ''),
        sentCaption: String(caption ?? '').trim(),
        error: this.i18n.t('runtime.error.unknownDeliveryFailure'),
      };
    }
    let lastResult: PlatformMediaDeliveryResult | null | undefined = null;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) {
        await sleep(Math.max(0, this.previewIntervalMs));
      }
      debugRuntime('artifact_delivery_attempt', {
        scopeId: externalScopeId,
        filePath: String(filePath ?? ''),
        caption: truncateDebugText(caption),
        attempt,
        maxAttempts,
      });
      const result = await this.platformPlugin.sendMedia({
        externalScopeId,
        filePath,
        caption,
      });
      lastResult = result;
      debugRuntime('artifact_delivery_result', {
        scopeId: externalScopeId,
        filePath: String(filePath ?? ''),
        success: Boolean(result?.success),
        messageId: result?.messageId ?? null,
        sentPath: result?.sentPath ?? null,
        sentCaption: truncateDebugText(result?.sentCaption),
        error: result?.error ?? null,
        errorCode: result?.errorCode ?? null,
        attempt,
      });
      if (result?.success || !this.isRateLimitedDeliveryFailure(result) || attempt >= maxAttempts) {
        break;
      }
    }
    return lastResult ?? {
      success: false,
      messageId: null,
      sentPath: String(filePath ?? ''),
      sentCaption: String(caption ?? '').trim(),
      error: this.i18n.t('runtime.error.unknownDeliveryFailure'),
      errorCode: null,
    };
  }

  async deliverArtifactMessages(
    event: InboundTextEvent,
    artifacts: OutputArtifact[],
  ): Promise<void> {
    debugRuntime('artifact_delivery_begin', {
      scopeId: event.externalScopeId,
      artifactCount: artifacts.length,
      artifacts: artifacts.map((artifact) => ({
        kind: artifact?.kind ?? null,
        path: String(artifact?.path ?? ''),
        caption: truncateDebugText(artifact?.caption),
      })),
    });
    const deliveryErrors: string[] = [];
    let rateLimitedFailure = false;
    for (const artifact of artifacts) {
      const filePath = String(artifact?.path ?? '').trim();
      if (!filePath) {
        continue;
      }
      const result = await this.sendMediaWithRetry({
        externalScopeId: event.externalScopeId,
        filePath,
        caption: artifact.caption ?? null,
      });
      if (!result.success) {
        rateLimitedFailure ||= this.isRateLimitedDeliveryFailure(result);
        const errorMessage = this.describeDeliveryFailure(result, result.sentPath);
        deliveryErrors.push(errorMessage);
        debugRuntime('artifact_delivery_failed', {
          scopeId: event.externalScopeId,
          filePath,
          error: errorMessage,
        });
      } else {
        debugRuntime('artifact_delivery_succeeded', {
          scopeId: event.externalScopeId,
          filePath,
          messageId: result.messageId ?? null,
          sentPath: result.sentPath ?? null,
        });
      }
    }
    if (deliveryErrors.length === 0) {
      debugRuntime('artifact_delivery_complete', {
        scopeId: event.externalScopeId,
        artifactCount: artifacts.length,
        errorCount: 0,
      });
      return;
    }
    debugRuntime('artifact_delivery_complete', {
      scopeId: event.externalScopeId,
      artifactCount: artifacts.length,
      errorCount: deliveryErrors.length,
      firstError: deliveryErrors[0] ?? null,
    });
    const failureDelivery = await this.sendTextWithRetry({
      externalScopeId: event.externalScopeId,
      content: this.i18n.t('runtime.error.attachmentDeliveryFailed', {
        error: deliveryErrors[0] ?? this.i18n.t('runtime.error.unknownDeliveryFailure'),
      }),
    });
    if (!failureDelivery.success) {
      this.enqueueTextDeliveryRetry({
        externalScopeId: event.externalScopeId,
        content: failureDelivery.failedText || this.i18n.t('runtime.error.attachmentDeliveryFailed', {
          error: deliveryErrors[0] ?? this.i18n.t('runtime.error.unknownDeliveryFailure'),
        }),
        delivery: failureDelivery,
        source: 'artifact_failure_message',
      });
    }
    if (!failureDelivery.success && (rateLimitedFailure || this.isRateLimitedDeliveryFailure(failureDelivery))) {
      await this.ensureScopeNoticeDelivered(
        event.externalScopeId,
        this.i18n.t('runtime.error.weixinRateLimitedNotice'),
      );
    }
  }

  async runPostResponseAction(response: RuntimeResponse, event: InboundTextEvent): Promise<void> {
    const action = response?.meta?.systemAction ?? null;
    if (!action) {
      return;
    }
    if (action.kind === 'run_agent_sweep') {
      await this.runAutomationSweep();
      return;
    }
    if (action.kind === 'restart_bridge') {
      if (typeof this.bridgeCoordinator?.restartBridge !== 'function') {
        return;
      }
      await this.bridgeCoordinator.restartBridge({ event });
    }
  }

  buildAfterCommitAction(
    response: RuntimeResponse,
    event: InboundTextEvent,
  ): (() => Promise<void>) | null {
    const action = response?.meta?.systemAction ?? null;
    if (!action || !['restart_bridge', 'run_agent_sweep'].includes(String(action.kind ?? ''))) {
      return null;
    }
    return async () => {
      await this.runPostResponseAction(response, event);
    };
  }

  async enqueueScopeWork(
    externalScopeId: string,
    operation: () => Promise<RuntimeResponse>,
  ): Promise<RuntimeResponse> {
    const scopeId = String(externalScopeId ?? '');
    const previous = this.scopeChains.get(scopeId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.scopeChains.set(scopeId, next);
    try {
      return await next;
    } finally {
      if (this.scopeChains.get(scopeId) === next) {
        this.scopeChains.delete(scopeId);
      }
    }
  }

  trackBackgroundTask(task: Promise<RuntimeResponse>): void {
    this.backgroundTasks.add(task);
    task
      .catch(() => {})
      .finally(() => {
        this.backgroundTasks.delete(task);
      });
  }

  async notifyApprovalPrompt(event: InboundTextEvent): Promise<void> {
    try {
      const content = await this.buildApprovalPromptText(event);
      if (!content) {
        return;
      }
      let rateLimitedFailure = false;
      let delivery = await this.sendTextWithRetry({
        externalScopeId: event.externalScopeId,
        content,
      });
      rateLimitedFailure ||= this.isRateLimitedDeliveryFailure(delivery);
      if (delivery.success) {
        return;
      }
      debugRuntime('approval_prompt_delivery_failed', {
        scopeId: event.externalScopeId,
        failedText: truncateDebugText(delivery.failedText || content),
        error: delivery.error,
      });
      const fallback = this.i18n.t('coordinator.allow.promptFallback');
      if (!fallback || fallback === content) {
        throw new Error(delivery.error || this.i18n.t('runtime.error.unknownDeliveryFailure'));
      }
      delivery = await this.sendTextWithRetry({
        externalScopeId: event.externalScopeId,
        content: fallback,
      });
      rateLimitedFailure ||= this.isRateLimitedDeliveryFailure(delivery);
      if (delivery.success) {
        return;
      }
      debugRuntime('approval_prompt_fallback_failed', {
        scopeId: event.externalScopeId,
        failedText: truncateDebugText(delivery.failedText || fallback),
        error: delivery.error,
      });
      if (rateLimitedFailure) {
        await this.ensureScopeNoticeDelivered(
          event.externalScopeId,
          this.i18n.t('runtime.error.weixinRateLimitedApprovalNotice'),
        );
      }
      throw new Error(delivery.error || this.i18n.t('runtime.error.unknownDeliveryFailure'));
    } catch (error) {
      await this.onError(error);
    }
  }

  startAutomationScheduler(): void {
    if ((!this.automationJobs && !this.agentJobs && !this.assistantRecords) || this.automationPollMs <= 0) {
      return;
    }
    this.stopAutomationScheduler();
    void this.runAutomationSweep();
    this.automationSweepTimer = setInterval(() => {
      void this.runAutomationSweep();
    }, this.automationPollMs);
  }

  stopAutomationScheduler(): void {
    if (!this.automationSweepTimer) {
      return;
    }
    clearInterval(this.automationSweepTimer);
    this.automationSweepTimer = null;
  }

  startInternalThreadCleanupScheduler(): void {
    if (this.internalThreadCleanupMs <= 0 || typeof this.bridgeCoordinator.cleanupInternalProviderThreads !== 'function') {
      return;
    }
    this.stopInternalThreadCleanupScheduler();
    void this.runInternalThreadCleanup();
    this.internalThreadCleanupTimer = setInterval(() => {
      void this.runInternalThreadCleanup();
    }, this.internalThreadCleanupMs);
  }

  stopInternalThreadCleanupScheduler(): void {
    if (!this.internalThreadCleanupTimer) {
      return;
    }
    clearInterval(this.internalThreadCleanupTimer);
    this.internalThreadCleanupTimer = null;
  }

  async runInternalThreadCleanup(): Promise<void> {
    if (typeof this.bridgeCoordinator.cleanupInternalProviderThreads !== 'function') {
      return;
    }
    if (this.internalThreadCleanupInFlight) {
      return this.internalThreadCleanupInFlight;
    }
    const task = this.bridgeCoordinator.cleanupInternalProviderThreads({ dryRun: false })
      .then(() => undefined)
      .catch(async (error) => {
        await this.onError(error);
      })
      .finally(() => {
        if (this.internalThreadCleanupInFlight === task) {
          this.internalThreadCleanupInFlight = null;
        }
      });
    this.internalThreadCleanupInFlight = task;
    return task;
  }

  async runAutomationSweep(): Promise<void> {
    if (!this.automationJobs && !this.agentJobs && !this.assistantRecords) {
      return;
    }
    if (this.automationSweepInFlight) {
      return this.automationSweepInFlight;
    }
    const task = this.runAutomationSweepInternal()
      .catch(async (error) => {
        await this.onError(error);
      })
      .finally(() => {
        if (this.automationSweepInFlight === task) {
          this.automationSweepInFlight = null;
        }
      });
    this.automationSweepInFlight = task;
    return task;
  }

  async runAutomationSweepInternal(): Promise<void> {
    const automationJobs = this.automationJobs?.claimDueJobs?.('weixin') ?? [];
    if (Array.isArray(automationJobs)) {
      for (const job of automationJobs) {
        const task = this.runAutomationJob(job);
        this.trackBackgroundTask(task);
      }
    }
    if (isAgentCommandEnabled()) {
      const agentJobs = typeof this.agentJobs?.claimSupervisableJobs === 'function'
        ? this.agentJobs.claimSupervisableJobs('weixin')
        : this.agentJobs?.claimQueuedJobs?.('weixin') ?? [];
      if (Array.isArray(agentJobs)) {
        for (const job of agentJobs) {
          const jobId = typeof job?.id === 'string' ? job.id : '';
          if (jobId && this.scheduledAgentJobIds.has(jobId)) {
            continue;
          }
          if (jobId) {
            this.scheduledAgentJobIds.add(jobId);
          }
          const task = this.runAgentJob(job)
            .finally(() => {
              if (jobId) {
                this.scheduledAgentJobIds.delete(jobId);
              }
            });
          this.trackBackgroundTask(task);
        }
      }
    }
    const reminders = this.assistantRecords?.listDueReminders?.('weixin')
      ?? this.assistantRecords?.claimDueReminders?.('weixin')
      ?? [];
    if (Array.isArray(reminders)) {
      for (const reminder of reminders) {
        const reminderId = typeof reminder?.id === 'string' ? reminder.id : '';
        if (reminderId && this.scheduledAssistantReminderIds.has(reminderId)) {
          continue;
        }
        if (reminderId) {
          this.scheduledAssistantReminderIds.add(reminderId);
        }
        const task = this.deliverAssistantReminder(reminder)
          .finally(() => {
            if (reminderId) {
              this.scheduledAssistantReminderIds.delete(reminderId);
            }
          });
        this.trackBackgroundTask(task);
      }
    }
  }

  async deliverAssistantReminder(record: any): Promise<RuntimeResponse> {
    const scopeId = String(record?.scopeId ?? '');
    if (!scopeId) {
      return { type: 'message', messages: [] };
    }
    const content = renderAssistantReminderMessage(record, this.i18n);
    if (!content) {
      return { type: 'message', messages: [] };
    }
    const delivery = await this.sendTextWithRetry({
      externalScopeId: scopeId,
      content,
    });
    const reminderId = typeof record?.id === 'string' ? record.id : '';
    const deliveryFinishedAt = Date.now();
    if (delivery.success) {
      if (!reminderId) {
        return { type: 'message', messages: [{ text: content }] };
      }
      this.assistantRecords?.markReminderDelivered?.(reminderId, {
        deliveredAt: deliveryFinishedAt,
      });
    } else if (reminderId) {
      this.assistantRecords?.markReminderDeliveryDeferred?.(reminderId, {
        failedAt: deliveryFinishedAt,
        retryAfter: deliveryFinishedAt + this.resolveDeliveryRetryMs(delivery),
        error: delivery.error || this.i18n.t('runtime.error.unknownDeliveryFailure'),
        errorCode: delivery.errorCode ?? null,
      });
    }
    return { type: 'message', messages: [{ text: content }] };
  }

  async runAgentJob(job: any): Promise<RuntimeResponse> {
    if (!isAgentCommandEnabled()) {
      return {
        type: 'message',
        messages: [],
      };
    }
    const scopeId = String(job?.externalScopeId ?? '');
    if (!scopeId || await this.isScopeBusyForAgent(job)) {
      if (job?.id && typeof this.agentJobs?.claimSupervisableJobs !== 'function') {
        this.agentJobs?.updateJob?.(job.id, {
          status: 'queued',
          running: false,
        });
      }
      return {
        type: 'message',
        messages: [],
      };
    }
    if (typeof this.bridgeCoordinator?.runAgentJob !== 'function') {
      const error = 'Bridge coordinator does not support agent jobs.';
      if (job?.id) {
        this.agentJobs?.failJob?.(job.id, { error });
      }
      await this.sendTextWithRetry({
        externalScopeId: scopeId,
        content: this.i18n.t('runtime.error.agentFailed', {
          title: String(job?.title ?? 'agent'),
          error,
        }),
      });
      return {
        type: 'message',
        messages: [],
      };
    }
    const event: InboundTextEvent = {
      platform: String(job.platform ?? 'weixin'),
      externalScopeId: scopeId,
      text: `/agent job ${job.id}`,
      cwd: typeof job.cwd === 'string' ? job.cwd : null,
      locale: typeof job.locale === 'string' ? job.locale : null,
      metadata: {
        codexbridge: {
          agentJobId: job.id,
        },
      },
    };
    try {
      return await this.enqueueScopeWork(scopeId, async () => this.processAgentJobEvent(event, job));
    } catch (error) {
      const message = formatAutomationError(error);
      this.agentJobs?.failJob?.(job.id, {
        error: message,
      });
      await this.sendTextWithRetry({
        externalScopeId: scopeId,
        content: this.i18n.t('runtime.error.agentFailed', {
          title: String(job.title ?? 'agent'),
          error: message,
        }),
      });
      throw error;
    }
  }

  async processAgentJobEvent(event: InboundTextEvent, job: any): Promise<RuntimeResponse> {
    const runtimeGeneration = this.runtimeGeneration;
    await this.flushPendingScopeNotice(event.externalScopeId);
    await this.flushDeliveryRetryQueue({ externalScopeId: event.externalScopeId });
    const streamState = createStreamState();
    const typingStart = this.safeSendTyping(event.externalScopeId, 'start');
    const stopTypingKeepalive = this.startTypingKeepalive(event.externalScopeId);
    try {
      const response: RuntimeResponse = await this.runWithTurnSlot(event.externalScopeId, 'agent', async () =>
        this.bridgeCoordinator.runAgentJob?.(job, {
          onProgress: async (progress) => {
            if (runtimeGeneration !== this.runtimeGeneration) {
              return;
            }
            if (!this.deliverProgressPreviews) {
              return;
            }
            await this.handleProgressUpdate(event, streamState, progress);
          },
          onApprovalRequest: async () => {
            await this.notifyApprovalPrompt(event);
          },
          onNotification: async (notification) => {
            await this.handleAgentMissionNotification(event, job, notification);
          },
        }) ?? {
        type: 'message',
        messages: [],
      } as RuntimeResponse);
      if (response?.type !== 'message') {
        return response;
      }
      if (runtimeGeneration !== this.runtimeGeneration) {
        debugRuntime('skip_stale_agent_response', {
          scopeId: event.externalScopeId,
          previousGeneration: runtimeGeneration,
          currentGeneration: this.runtimeGeneration,
        });
        return response;
      }
      const codexTurnMeta = response?.meta?.codexTurn ?? null;
      const finalText = extractResponseMessageText(response);
      const artifactMessages = extractResponseArtifactMessages(response);
      if (normalizeComparableText(finalText) || codexTurnMeta) {
        await this.ensureFinalDelivered(event, streamState, response, codexTurnMeta);
      } else {
        await this.stopPreviewStreaming(streamState);
      }
      if (artifactMessages.length > 0) {
        await this.deliverArtifactMessages(event, artifactMessages);
      }
      return response;
    } finally {
      await typingStart;
      await stopTypingKeepalive();
    }
  }

  async handleAgentMissionNotification(
    event: InboundTextEvent,
    job: any,
    notification: MissionHostNotification,
  ): Promise<void> {
    if (!isAgentCommandEnabled()) {
      return;
    }
    const content = typeof this.bridgeCoordinator.renderAgentMissionNotification === 'function'
      ? await this.bridgeCoordinator.renderAgentMissionNotification(job, notification)
      : null;
    if (!content) {
      return;
    }
    await this.ensureScopeNoticeDelivered(event.externalScopeId, content);
  }

  async runAutomationJob(job: any): Promise<RuntimeResponse> {
    const scopeId = String(job?.externalScopeId ?? '');
    if (!scopeId || await this.isScopeBusyForAutomation(job)) {
      this.automationJobs?.deferJob?.(job.id, Date.now() + 60_000);
      return {
        type: 'message',
        messages: [],
      };
    }

    const event: InboundTextEvent = {
      platform: String(job.platform ?? 'weixin'),
      externalScopeId: scopeId,
      text: String(job.prompt ?? '').trim(),
      cwd: typeof job.cwd === 'string' ? job.cwd : null,
      locale: typeof job.locale === 'string' ? job.locale : null,
      metadata: {
        codexbridge: {
          overrideBridgeSessionId: job.bridgeSessionId,
          automationJobId: job.id,
          automationMode: job.mode,
        },
      },
    };

    try {
      const response = await this.enqueueScopeWork(scopeId, async () => this.processInboundEventWithOptions(event, {
        deferPostResponseAction: false,
        suppressProgressDelivery: true,
        suppressTyping: true,
      }));
      const responseSession = (response as { session?: { bridgeSessionId?: string | null } } | null)?.session ?? null;
      const reboundBridgeSessionId = typeof responseSession?.bridgeSessionId === 'string'
        ? responseSession.bridgeSessionId.trim()
        : '';
      if (reboundBridgeSessionId && reboundBridgeSessionId !== String(job.bridgeSessionId ?? '')) {
        this.automationJobs?.updateJob?.(job.id, {
          bridgeSessionId: reboundBridgeSessionId,
        });
      }
      const deliveryMeta = response?.meta?.runtimeDelivery ?? null;
      if (
        deliveryMeta?.delivered === false
        && (
          deliveryMeta?.rateLimited
          || this.isSessionExpiredDeliveryFailure(deliveryMeta)
        )
      ) {
        this.automationJobs?.deferJob?.(
          job.id,
          Date.now() + this.resolveDeliveryRetryMs(deliveryMeta),
        );
        return response;
      }
      const liveJob = this.automationJobs?.getById?.(job.id) ?? job;
      const preview = buildAutomationResultPreview(response) || liveJob?.lastResultPreview || null;
      const delivered = deliveryMeta?.delivered !== false;
      const error = delivered
        ? null
        : String(deliveryMeta?.error ?? liveJob?.lastError ?? this.i18n.t('runtime.error.unknownDeliveryFailure')).trim();
      this.automationJobs?.completeJob?.(job.id, {
        resultPreview: preview,
        error,
        deliveredAt: delivered ? Date.now() : null,
      });
      return response;
    } catch (error) {
      const message = formatAutomationError(error);
      this.automationJobs?.completeJob?.(job.id, {
        resultPreview: null,
        error: message,
        deliveredAt: Date.now(),
      });
      await this.sendTextWithRetry({
        externalScopeId: scopeId,
        content: this.i18n.t('runtime.error.automationFailed', {
          title: String(job.title ?? 'automation'),
          error: message,
        }),
      });
      throw error;
    }
  }

  async isScopeBusyForAutomation(job: any): Promise<boolean> {
    const scopeId = String(job?.externalScopeId ?? '');
    if (!scopeId) {
      return true;
    }
    if (this.pendingInboundMerges.has(scopeId) || this.scopeChains.has(scopeId)) {
      return true;
    }
    const scopeRef = {
      platform: String(job?.platform ?? 'weixin'),
      externalScopeId: scopeId,
    };
    if (typeof (this.bridgeCoordinator as any)?.reconcileActiveTurn === 'function') {
      const activeTurn = await (this.bridgeCoordinator as any).reconcileActiveTurn(scopeRef);
      if (activeTurn) {
        return true;
      }
    }
    return false;
  }

  async isScopeBusyForAgent(job: any): Promise<boolean> {
    const scopeId = String(job?.externalScopeId ?? '');
    if (!scopeId) {
      return true;
    }
    if (this.pendingInboundMerges.has(scopeId) || this.scopeChains.has(scopeId)) {
      return true;
    }
    const scopeRef = {
      platform: String(job?.platform ?? 'weixin'),
      externalScopeId: scopeId,
    };
    if (typeof (this.bridgeCoordinator as any)?.reconcileActiveTurn === 'function') {
      const activeTurn = await (this.bridgeCoordinator as any).reconcileActiveTurn(scopeRef);
      if (activeTurn) {
        return true;
      }
    }
    return false;
  }

  async flushPendingScopeNotice(externalScopeId: string): Promise<void> {
    const scopeId = String(externalScopeId ?? '').trim();
    if (!scopeId) {
      return;
    }
    const pending = this.pendingScopeNotices.get(scopeId);
    if (!pending) {
      return;
    }
    if (this.shouldSuppressScopeNotice(scopeId, pending.content)) {
      this.pendingScopeNotices.delete(scopeId);
      return;
    }
    const delivery = await this.sendSystemTextDirect({
      externalScopeId: scopeId,
      content: pending.content,
    });
    if (!delivery.success) {
      debugRuntime('pending_scope_notice_failed', {
        scopeId,
        contentPreview: truncateDebugText(pending.content),
        error: delivery.error,
        errorCode: delivery.errorCode ?? null,
      });
      return;
    }
    this.pendingScopeNotices.delete(scopeId);
    this.noteScopeNoticeDelivered(scopeId, pending.content);
  }

  shouldSuppressScopeNotice(scopeId: string, content: string): boolean {
    const recent = this.recentScopeNotices.get(scopeId);
    if (!recent || recent.content !== content) {
      return false;
    }
    return (Date.now() - recent.sentAt) < WeixinBridgeRuntime.NOTICE_COOLDOWN_MS;
  }

  isAutomationEvent(event: InboundTextEvent): boolean {
    const metadata = event?.metadata as { codexbridge?: { automationJobId?: unknown } } | undefined;
    return typeof metadata?.codexbridge?.automationJobId === 'string'
      && metadata.codexbridge.automationJobId.trim().length > 0;
  }

  noteScopeNoticeDelivered(scopeId: string, content: string): void {
    this.recentScopeNotices.set(scopeId, {
      content,
      sentAt: Date.now(),
    });
  }

  async ensureScopeNoticeDelivered(externalScopeId: string, content: string): Promise<void> {
    const scopeId = String(externalScopeId ?? '').trim();
    const normalizedContent = String(content ?? '').trim();
    if (!scopeId || !normalizedContent) {
      return;
    }
    if (this.shouldSuppressScopeNotice(scopeId, normalizedContent)) {
      return;
    }
    const delivery = await this.sendSystemTextDirect({
      externalScopeId: scopeId,
      content: normalizedContent,
    });
    if (delivery.success) {
      this.pendingScopeNotices.delete(scopeId);
      this.noteScopeNoticeDelivered(scopeId, normalizedContent);
      return;
    }
    this.pendingScopeNotices.set(scopeId, {
      content: normalizedContent,
      queuedAt: Date.now(),
    });
    debugRuntime('scope_notice_queued', {
      scopeId,
      contentPreview: truncateDebugText(normalizedContent),
      error: delivery.error,
      errorCode: delivery.errorCode ?? null,
    });
  }

  isRateLimitedDeliveryFailure(detail: { error?: string | null; errorCode?: number | null } | null | undefined): boolean {
    const errorCode = typeof detail?.errorCode === 'number' ? detail.errorCode : null;
    if (errorCode === -2) {
      return true;
    }
    const message = String(detail?.error ?? '').trim();
    return /\b(?:ret|errcode)\b[^-\d]*-2\b/i.test(message)
      || /:\s*-2\b/.test(message);
  }

  isSessionExpiredDeliveryFailure(detail: { error?: string | null; errorCode?: number | null } | null | undefined): boolean {
    const errorCode = typeof detail?.errorCode === 'number' ? detail.errorCode : null;
    if (errorCode === -14) {
      return true;
    }
    const message = String(detail?.error ?? '').trim();
    return /\b(?:ret|errcode)\b[^-\d]*-14\b/i.test(message)
      || /:\s*-14\b/.test(message)
      || /session\s+(?:expired|paused)/i.test(message);
  }

  resolveDeliveryRetryMs(detail: { error?: string | null; errorCode?: number | null } | null | undefined): number {
    if (this.isRateLimitedDeliveryFailure(detail)) {
      return WeixinBridgeRuntime.AUTOMATION_RATE_LIMIT_RETRY_MS;
    }
    if (this.isSessionExpiredDeliveryFailure(detail)) {
      return WeixinBridgeRuntime.DELIVERY_SESSION_EXPIRED_RETRY_MS;
    }
    return WeixinBridgeRuntime.DELIVERY_SESSION_EXPIRED_RETRY_MS;
  }

  describeDeliveryFailure(
    detail: { error?: string | null; errorCode?: number | null } | null | undefined,
    fallback: string,
  ): string {
    if (this.isRateLimitedDeliveryFailure(detail)) {
      return this.i18n.t('runtime.error.weixinRateLimited');
    }
    return String(
      detail?.error
      || fallback
      || this.i18n.t('runtime.error.unknownDeliveryFailure'),
    ).trim();
  }

  async buildApprovalPromptText(event: InboundTextEvent): Promise<string> {
    const compactPrompt = typeof this.bridgeCoordinator.renderApprovalPrompt === 'function'
      ? await this.bridgeCoordinator.renderApprovalPrompt(event)
      : '';
    if (String(compactPrompt ?? '').trim()) {
      return String(compactPrompt).trim();
    }
    const response = await this.bridgeCoordinator.handleInboundEvent({
      ...event,
      text: '/allow',
    }, {});
    return extractResponseMessageText(response);
  }
}

function createStreamState(): StreamState {
  return {
    lastObservedFinal: '',
    pendingPreview: '',
    inFlightPreview: '',
    previewPumpPromise: null,
    previewStopped: false,
    firstPreviewSent: false,
    nextPreviewAt: 0,
    smallPreviewDelayUntil: 0,
    streamedText: '',
    sentChunkCount: 0,
    streamingDisabled: false,
  };
}

function extractResponseMessageText(response: RuntimeResponse): string {
  return Array.isArray(response?.messages)
    ? response.messages
      .filter((message) => !String(message?.artifact?.path ?? message?.mediaPath ?? '').trim())
      .map((message) => String(message?.text ?? '').trim())
      .filter(Boolean)
      .join('\n\n')
      .trim()
    : '';
}

function extractResponseArtifactMessages(response: RuntimeResponse): OutputArtifact[] {
  if (!Array.isArray(response?.messages)) {
    return [];
  }
  return response.messages
    .map((message) => normalizeResponseArtifact(message))
    .filter(Boolean) as OutputArtifact[];
}

function buildAutomationResultPreview(response: RuntimeResponse): string | null {
  const finalText = extractResponseMessageText(response);
  if (finalText) {
    return truncateDebugText(finalText, 160) || finalText.slice(0, 160);
  }
  const artifacts = extractResponseArtifactMessages(response);
  if (artifacts.length > 0) {
    const first = artifacts[0];
    return `${first.kind}: ${first.displayName ?? first.path}`;
  }
  return null;
}

function formatAutomationError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error ?? 'unknown error');
}

function normalizeResponseArtifact(message: RuntimeResponseMessage): OutputArtifact | null {
  const direct = message?.artifact && typeof message.artifact === 'object'
    ? message.artifact
    : null;
  const artifactPath = String(direct?.path ?? message?.mediaPath ?? '').trim();
  if (!artifactPath) {
    return null;
  }
  return {
    kind: direct?.kind ?? inferRuntimeArtifactKind(artifactPath),
    path: artifactPath,
    displayName: direct?.displayName ?? null,
    mimeType: direct?.mimeType ?? null,
    sizeBytes: direct?.sizeBytes ?? null,
    caption: typeof message?.caption === 'string' ? message.caption : (direct?.caption ?? null),
    source: direct?.source ?? 'provider_native',
    turnId: direct?.turnId ?? null,
  };
}

function inferRuntimeArtifactKind(filePath: string): OutputArtifact['kind'] {
  const normalized = String(filePath ?? '').toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp)(?:$|\?)/iu.test(normalized)) {
    return 'image';
  }
  if (/\.(mp4|mov|mkv|webm)(?:$|\?)/iu.test(normalized)) {
    return 'video';
  }
  if (/\.(mp3|wav|ogg|m4a|flac|amr)(?:$|\?)/iu.test(normalized)) {
    return 'audio';
  }
  return 'file';
}

function resolveFinalCommitContent(finalText: string, previewText: string): string {
  const finalContent = String(finalText ?? '').trim();
  const previewContent = String(previewText ?? '').trim();
  if (!previewContent) {
    return finalContent;
  }
  if (finalContent.startsWith(previewContent)) {
    const trailing = finalContent.slice(previewContent.length).trim();
    return trailing || '';
  }
  return finalContent;
}

function isComparablePrefix(prefixText: string, fullText: string): boolean {
  const prefix = normalizeComparableText(prefixText);
  const full = normalizeComparableText(fullText);
  if (!prefix) {
    return false;
  }
  return full.startsWith(prefix);
}

function resolveDeliveredFinalPreviewText(streamedText: string, finalText: string): string {
  const streamed = String(streamedText ?? '').trim();
  const finalContent = String(finalText ?? '').trim();
  if (!streamed || !finalContent) {
    return '';
  }
  if (isComparablePrefix(streamed, finalContent)) {
    return streamed;
  }
  if (normalizeComparableText(streamed).endsWith(normalizeComparableText(finalContent))) {
    return finalContent;
  }
  const overlap = findFinalPreviewSuffixOverlap(streamed, finalContent);
  return overlap;
}

function findFinalPreviewSuffixOverlap(streamedText: string, finalText: string): string {
  const streamed = String(streamedText ?? '').trim();
  const finalContent = String(finalText ?? '').trim();
  const maxLength = Math.min(streamed.length, finalContent.length);
  for (let length = maxLength; length > 0; length -= 1) {
    const candidate = finalContent.slice(0, length).trim();
    if (!candidate || !endsWithStablePreviewBoundary(candidate)) {
      continue;
    }
    if (streamed.endsWith(candidate)) {
      return candidate;
    }
  }
  return '';
}

function appendPreviewText(streamState: StreamState, chunk: string): void {
  streamState.sentChunkCount += 1;
  streamState.streamedText = streamState.streamedText
    ? `${streamState.streamedText}\n\n${chunk}`
    : chunk;
}

function trimOverlappingPreviewDelta(streamState: StreamState, delta: string): string {
  const incoming = String(delta ?? '');
  if (!incoming) {
    return '';
  }
  const existing = getPreviewComparisonText(streamState);
  if (!existing) {
    return incoming;
  }
  if (existing.endsWith(incoming)) {
    return '';
  }
  const maxOverlap = Math.min(existing.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (existing.slice(-overlap) === incoming.slice(0, overlap)) {
      return incoming.slice(overlap);
    }
  }
  return incoming;
}

function getPreviewComparisonText(streamState: StreamState): string {
  return [
    streamState.streamedText,
    streamState.inFlightPreview,
    streamState.pendingPreview,
  ].filter(Boolean).join('\n\n');
}

function extractImmediatePreviewChunk(text: string, hardLimitBytes: number): string {
  const boundary = findSentenceBoundary(text, hardLimitBytes);
  if (boundary > 0) {
    return text.slice(0, boundary);
  }
  return '';
}

function extractTimedPreviewChunk(text: string, softTargetBytes: number, hardLimitBytes: number): string {
  const bytes = utf8ByteLength(text);
  if (bytes <= 0) {
    return '';
  }
  const softBoundary = findStablePreviewBoundary(text, Math.min(bytes, softTargetBytes));
  if (softBoundary > 0) {
    return text.slice(0, softBoundary);
  }
  const hardBoundary = findStablePreviewBoundary(text, Math.min(bytes, hardLimitBytes));
  if (hardBoundary > 0) {
    return text.slice(0, hardBoundary);
  }
  if (bytes <= hardLimitBytes) {
    return '';
  }
  return trimForcedPreviewChunk(sliceByUtf8Bytes(text, hardLimitBytes));
}

function findSentenceBoundary(text: string, byteLimit: number): number {
  let sentenceBoundary = -1;
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    bytes += utf8ByteLength(text[index]);
    if (bytes > byteLimit) {
      break;
    }
    if (text[index] === '\n' && text[index + 1] === '\n') {
      return index + 2;
    }
    if ('。！？.!?；;'.includes(text[index])) {
      sentenceBoundary = index + 1;
      break;
    }
  }
  return sentenceBoundary;
}

function findStablePreviewBoundary(text: string, byteLimit: number): number {
  let paragraphBoundary = -1;
  let sentenceBoundary = -1;
  let lineBoundary = -1;
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    bytes += utf8ByteLength(text[index]);
    if (bytes > byteLimit) {
      break;
    }
    if (text[index] === '\n' && text[index + 1] === '\n') {
      paragraphBoundary = index + 2;
      continue;
    }
    if ('。！？.!?；;'.includes(text[index])) {
      sentenceBoundary = index + 1;
      continue;
    }
    if (text[index] === '\n') {
      lineBoundary = index + 1;
    }
  }
  if (utf8ByteLength(text) <= byteLimit && endsWithStablePreviewBoundary(text)) {
    return text.length;
  }
  return paragraphBoundary > 0
    ? paragraphBoundary
    : sentenceBoundary > 0
      ? sentenceBoundary
      : lineBoundary > 0
        ? lineBoundary
        : 0;
}

function endsWithStablePreviewBoundary(text: string): boolean {
  return /(?:\n\n|[。！？.!?；;])\s*$/u.test(String(text ?? ''));
}

function trimForcedPreviewChunk(text: string): string {
  const normalized = String(text ?? '').trim();
  if (!normalized) {
    return '';
  }
  const paragraphBoundary = normalized.lastIndexOf('\n\n');
  if (paragraphBoundary > 0) {
    return normalized.slice(0, paragraphBoundary + 2).trim();
  }
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    if ('。！？.!?；;\n '.includes(normalized[index])) {
      const candidate = normalized.slice(0, index + 1).trim();
      if (candidate) {
        return candidate;
      }
    }
  }
  return normalized;
}

function sliceByUtf8Bytes(text: string, byteLimit: number): string {
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const next = utf8ByteLength(text[index]);
    if (bytes + next > byteLimit) {
      break;
    }
    bytes += next;
    index += 1;
  }
  return text.slice(0, index);
}

function utf8ByteLength(text: string): number {
  return Buffer.byteLength(String(text ?? ''), 'utf8');
}

class AsyncLimiter {
  constructor(maxConcurrency: number) {
    this.maxConcurrency = normalizeConcurrency(maxConcurrency, WeixinBridgeRuntime.DEFAULT_MAX_CONCURRENT_TURNS);
    this.activeCount = 0;
    this.queue = [];
  }

  maxConcurrency: number;
  activeCount: number;
  queue: Array<() => void>;

  get queuedCount() {
    return this.queue.length;
  }

  acquire(): (() => void) | Promise<() => void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount += 1;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.activeCount += 1;
        resolve(() => this.release());
      });
    });
  }

  setMaxConcurrency(value: number): void {
    this.maxConcurrency = normalizeConcurrency(value, WeixinBridgeRuntime.DEFAULT_MAX_CONCURRENT_TURNS);
    this.drainQueue();
  }

  private release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.drainQueue();
  }

  private drainQueue(): void {
    while (this.activeCount < this.maxConcurrency) {
      const next = this.queue.shift();
      if (!next) {
        return;
      }
      next();
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R> | R,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const limit = Math.min(normalizeConcurrency(concurrency, 1), items.length);
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));
  return results;
}

function normalizeConcurrency(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(parsed, 64));
}

function toCounter(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
}

function normalizeMetricErrorEvents(value: unknown): MetricErrorEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const at = Number(item.at);
      if (!Number.isFinite(at) || at <= 0) {
        return null;
      }
      const stage = typeof item.stage === 'string' && item.stage.trim()
        ? item.stage.trim()
        : 'runtime';
      const message = typeof item.message === 'string' ? item.message : '';
      return {
        at,
        stage,
        message: message.slice(0, 500),
      };
    })
    .filter(Boolean) as MetricErrorEvent[];
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  }) as Promise<T>;
}

function debugRuntime(event, payload) {
  writeSequencedDebugLog('weixin-runtime', event, payload, { envVar: null });
}

function truncateDebugText(value, limit = 240) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!text) {
    return '';
  }
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForPreviewWindow(streamState: StreamState, waitUntil: number): Promise<void> {
  while (!streamState.previewStopped && !streamState.streamingDisabled) {
    const waitMs = Math.max(0, waitUntil - Date.now());
    if (waitMs <= 0) {
      return;
    }
    await sleep(Math.min(waitMs, 50));
  }
}

function createPendingInboundMerge(event: InboundTextEvent): PendingInboundMerge {
  let resolve: (response: RuntimeResponse) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const completion = new Promise<RuntimeResponse>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    event,
    timer: null,
    completion,
    resolve,
    reject,
  };
}

function buildInboundEventDedupKey(event: InboundTextEvent | null | undefined): string {
  const scopeId = String(event?.externalScopeId ?? '').trim();
  if (!scopeId) {
    return '';
  }
  const metadata = event?.metadata ?? {};
  const weixin = isRecord(metadata.weixin) ? metadata.weixin : null;
  const messageId = String(weixin?.messageId ?? '').trim();
  if (messageId) {
    return `weixin:${scopeId}:message:${messageId}`;
  }
  if (!weixin) {
    return '';
  }
  const senderId = String(weixin.senderId ?? '').trim();
  const attachmentCount = Array.isArray(event?.attachments) ? event.attachments.length : 0;
  const attachmentKey = Array.isArray(event?.attachments)
    ? event.attachments.map((attachment) => [
      attachment.kind,
      attachment.localPath,
      attachment.fileName,
      attachment.mimeType,
      attachment.transcriptText,
      attachment.durationSeconds,
    ].join('|')).join('::')
    : '';
  const text = normalizeComparableText(event?.text);
  if (!text && !attachmentKey) {
    return '';
  }
  return `weixin:${scopeId}:fallback:${senderId}:${text}:${attachmentCount}:${attachmentKey}`;
}

function shouldScheduleSlashCommand(command: { name?: string | null; args?: string[] | null } | null | undefined): boolean {
  const name = String(command?.name ?? '').trim().toLowerCase();
  if (!name || !['review', 'rv'].includes(name)) {
    return false;
  }
  const args = Array.isArray(command?.args) ? command.args : [];
  return !args.some((arg) => ['-h', '--help', '-help', '-helps'].includes(String(arg ?? '').trim().toLowerCase()));
}

function isStopSlashCommand(command: { name?: string | null } | null | undefined): boolean {
  const name = String(command?.name ?? '').trim().toLowerCase();
  return name === 'stop' || name === 'sp';
}

function isRestartSlashCommand(command: { name?: string | null } | null | undefined): boolean {
  const name = String(command?.name ?? '').trim().toLowerCase();
  return name === 'restart' || name === 'rs';
}

function isRecoverySlashCommand(command: { name?: string | null } | null | undefined): boolean {
  const name = String(command?.name ?? '').trim().toLowerCase();
  return ['retry', 'rt', 'reconnect', 'rc', 'restart', 'rs'].includes(name);
}

function hasHelpArg(command: { args?: string[] | null } | null | undefined): boolean {
  const args = Array.isArray(command?.args) ? command.args : [];
  return args.some((arg) => ['-h', '--help', '-help', '-helps'].includes(String(arg ?? '').trim().toLowerCase()));
}

function shouldDelayInboundEvent(event: InboundTextEvent): boolean {
  return !parseSlashCommand(String(event?.text ?? ''))
    && !isLocalKeepalivePulse(event)
    && hasAttachments(event)
    && !String(event?.text ?? '').trim();
}

function isLocalKeepalivePulse(event: InboundTextEvent | null | undefined): boolean {
  return !hasAttachments(event)
    && String(event?.text ?? '').trim() === '/';
}

function hasAttachments(event: InboundTextEvent | null | undefined): boolean {
  return Array.isArray(event?.attachments) && event.attachments.length > 0;
}

function mergeInboundEvents(baseEvent: InboundTextEvent, nextEvent: InboundTextEvent): InboundTextEvent {
  return {
    ...baseEvent,
    ...nextEvent,
    text: combineEventText(baseEvent.text, nextEvent.text),
    attachments: [
      ...(Array.isArray(baseEvent.attachments) ? baseEvent.attachments : []),
      ...(Array.isArray(nextEvent.attachments) ? nextEvent.attachments : []),
    ],
    cwd: nextEvent.cwd ?? baseEvent.cwd ?? null,
    locale: nextEvent.locale ?? baseEvent.locale ?? null,
    metadata: mergeEventMetadata(baseEvent.metadata, nextEvent.metadata),
  };
}

function combineEventText(baseText: string, nextText: string): string {
  const current = String(baseText ?? '').trim();
  const incoming = String(nextText ?? '').trim();
  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }
  return `${current}\n\n${incoming}`;
}

function mergeEventMetadata(
  baseMetadata: Record<string, unknown> | undefined,
  nextMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!baseMetadata && !nextMetadata) {
    return undefined;
  }
  const merged = {
    ...(baseMetadata ?? {}),
    ...(nextMetadata ?? {}),
  } as Record<string, unknown>;
  const baseWeixin = isRecord(baseMetadata?.weixin) ? baseMetadata?.weixin : null;
  const nextWeixin = isRecord(nextMetadata?.weixin) ? nextMetadata?.weixin : null;
  if (baseWeixin || nextWeixin) {
    const weixin = {
      ...(baseWeixin ?? {}),
      ...(nextWeixin ?? {}),
    } as Record<string, unknown>;
    const attachmentCount = Number(baseWeixin?.attachmentCount ?? 0) + Number(nextWeixin?.attachmentCount ?? 0);
    if (attachmentCount > 0) {
      weixin.attachmentCount = attachmentCount;
    }
    const attachmentErrors = [
      ...extractStringArray(baseWeixin?.attachmentErrors),
      ...extractStringArray(nextWeixin?.attachmentErrors),
    ];
    if (attachmentErrors.length > 0) {
      weixin.attachmentErrors = attachmentErrors;
    }
    merged.weixin = weixin;
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

function renderAssistantReminderMessage(record: any, i18n: Translator): string {
  const title = String(record?.title ?? '').trim() || i18n.t('runtime.assistant.untitledReminder');
  const content = String(record?.content ?? '').trim();
  const lines = [
    i18n.t('runtime.assistant.reminderTitle', { title }),
  ];
  if (content && content !== title) {
    lines.push(content);
  }
  if (Array.isArray(record?.attachments) && record.attachments.length > 0) {
    lines.push(i18n.t('runtime.assistant.attachmentCount', { count: record.attachments.length }));
    for (const attachment of record.attachments.slice(0, 3)) {
      const storagePath = String(attachment?.storagePath ?? '').trim();
      if (storagePath) {
        lines.push(storagePath);
      }
    }
  }
  lines.push(i18n.t('runtime.assistant.reminderActions'));
  return lines.join('\n');
}

function extractCompletionPromise(outcome: any): Promise<void> | null {
  const completion = outcome?.completion;
  if (!completion || typeof completion.then !== 'function') {
    return null;
  }
  return Promise.resolve(completion).then(() => {});
}

function extractAfterCommitAction(outcome: any): (() => Promise<void> | void) | null {
  if (!outcome || typeof outcome.afterCommit !== 'function') {
    return null;
  }
  return outcome.afterCommit;
}

function normalizeComparableText(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
