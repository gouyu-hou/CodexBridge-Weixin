import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { writeSequencedStderrLine } from './sequenced_stderr.js';
import { readCodexAccountIdentity } from './auth_state.js';
import {
  appServerBucketName,
  appServerUsageWindow,
  appServerUsageWindows,
  buildApprovalResponseResult,
  buildLegacyReviewDecision,
  buildV2CommandApprovalDecision,
  buildV2FileChangeApprovalDecision,
  buildV2PermissionsApprovalDecision,
  classifyApprovedExecutionSignal,
  createApprovedExecution,
  extractStructuredString,
  extractStructuredText,
  extractTextCandidate,
  formatConfigKeyPath,
  isThreadLevelApprovedExecutionSignal,
  isTurnTerminal,
  mapAppInfo,
  mapAppServerRateLimits,
  mapCommandExecutionApprovalRequest,
  mapFileChangeApprovalRequest,
  mapLegacyApplyPatchApprovalRequest,
  mapLegacyExecApprovalRequest,
  mapMcpServerStatus,
  mapModel,
  mapPendingApproval,
  mapPermissionsApprovalRequest,
  mapPluginAppSummary,
  mapPluginDetail,
  mapPluginLoadError,
  mapPluginMarketplace,
  mapPluginSkillSummary,
  mapPluginSummary,
  mapSandboxPolicy,
  mapSkillErrorInfo,
  mapSkillMetadata,
  mapSkillToolDependency,
  mapThread,
  mapThreadGoal,
  mapThreadSummary,
  mapTurn,
  mapTurnItem,
  mergeModelCatalog,
  normalizeApprovalDecisionKey,
  normalizeFeatureList,
  normalizeNullableString,
  normalizeOptionalBoolean as normalizeBoolean,
  normalizeProtocolTimestamp as normalizeTimestamp,
  normalizeStringList,
  normalizeTurnStatusKey,
  summarizeApprovedExecution,
  summarizeApprovedExecutionSignal,
  truncateDebugText,
} from './codex_app_protocol.js';
import type {
  ApprovedExecution,
  CodexAppInfo,
  CodexAppMarketplaceLoadError,
  CodexAppMcpServerStatus,
  CodexAppPluginAppSummary,
  CodexAppPluginDetail,
  CodexAppPluginMarketplace,
  CodexAppPluginSkillSummary,
  CodexAppPluginSummary,
  CodexAppRateLimitsResponse,
  CodexAppSkillErrorInfo,
  CodexAppSkillMetadata,
  PendingApproval,
} from './codex_app_protocol.js';
import {
  buildTurnSnapshotKey,
  classifyTurnCompletionState,
  classifyAgentOutput,
  extractAgentPhase,
  extractItemId,
  extractNotificationTurnId,
  extractProgressUpdate,
  extractTurnCommentaryText,
  extractTurnOutputText,
  hasUnsettledAssistantActivity,
  isAssistantVisibleItem,
  isUserVisibleItem,
  resolveTurnPreviewText,
  shouldWaitForSessionTaskMaterialization,
  shouldWaitForSettledOutputAfterTerminalTurn,
  shouldWaitForTaskCompleteBeforeMissing,
} from './codex_app_events.js';
import type {
  CodexAppProgressState as ProgressState,
} from './codex_app_events.js';
import type {
  ProviderAppInfo,
  ProviderApprovalRequest,
  ProviderMcpServerStatus,
  ProviderMcpOauthLoginResult,
  ProviderPluginDetail,
  ProviderPluginInstallResult,
  ProviderPluginLoadError,
  ProviderPluginMarketplace,
  ProviderPluginsListResult,
  ProviderPluginSummary,
  ProviderSkillError,
  ProviderSkillInfo,
  ProviderPluginAppSummary,
  ProviderPluginSkillSummary,
  ProviderSkillsListResult,
  ProviderSkillToolDependency,
  ProviderUsageReport,
  ProviderThreadListResult,
  ProviderThreadGoal,
  ProviderResponseItem,
  ProviderThreadStartResult,
  ProviderThreadSummary,
  ProviderTurnProgress,
  ProviderTurnResult,
} from './provider.js';

const APP_SERVER_CONNECT_TIMEOUT_MS = 20_000;

interface CodexAppLogger {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

interface CodexClientInfo {
  name: string;
  title: string;
  version: string;
}

interface CodexModelInfo {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string | null;
}

interface CodexAppSkillsListEntry {
  cwd?: string | null;
  errors?: CodexAppSkillErrorInfo[] | null;
  skills?: CodexAppSkillMetadata[] | null;
}

interface CodexAppPluginListResponse {
  featuredPluginIds?: string[] | null;
  marketplaceLoadErrors?: CodexAppMarketplaceLoadError[] | null;
  marketplaces?: CodexAppPluginMarketplace[] | null;
}

interface CodexAppPluginInstallResponse {
  authPolicy?: string | null;
  appsNeedingAuth?: CodexAppPluginAppSummary[] | null;
}

interface CodexAppMcpOauthLoginResponse {
  authorizationUrl?: string | null;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

interface CodexAppClientOptions {
  codexCliBin: string;
  codexCliArgs?: string[];
  launchCommand?: string | null;
  autolaunch?: boolean;
  modelCatalog?: CodexModelInfo[];
  modelCatalogMode?: 'merge' | 'overlay-only';
  enabledFeatures?: string[];
  clientInfo?: CodexClientInfo;
  spawnImpl?: typeof spawn;
  webSocketFactory?: (url: string) => WebSocket;
  platform?: NodeJS.Platform;
  logger?: CodexAppLogger;
  turnPollSleep?: (ms: number) => Promise<void>;
  turnPollNow?: () => number;
}

export interface CodexTextTurnInput {
  type: 'text';
  text: string;
  text_elements: [];
}

export interface CodexLocalImageTurnInput {
  type: 'localImage';
  path: string;
}

export type CodexTurnInput = CodexTextTurnInput | CodexLocalImageTurnInput;

export class CodexAppClient extends EventEmitter {
  codexCliBin: string;

  codexCliArgs: string[];

  launchCommand: string | null;

  autolaunch: boolean;

  modelCatalog: CodexModelInfo[];

  modelCatalogMode: 'merge' | 'overlay-only';

  enabledFeatures: string[];

  clientInfo: CodexClientInfo;

  spawnImpl: typeof spawn;

  webSocketFactory: (url: string) => WebSocket;

  platform: NodeJS.Platform;

  logger: CodexAppLogger;

  turnPollSleep: (ms: number) => Promise<void>;

  turnPollNow: () => number;

  child: ChildProcess | null;

  socket: WebSocket | null;

  stdioLineBuffer: string;

  pending: Map<string, PendingRequest>;

  pendingApprovals: Map<string, PendingApproval>;

  approvedExecutions: Map<string, ApprovedExecution>;

  requestId: number;

  port: number | null;

  connected: boolean;

  startPromise: Promise<void> | null;

  childStartError: Error | null;

  childStderrTail: string[];

  constructor({
    codexCliBin,
    codexCliArgs = [],
    launchCommand = null,
    autolaunch = false,
    modelCatalog = [],
    modelCatalogMode = 'merge',
    enabledFeatures = [],
    clientInfo = {
      name: 'codex-native-api',
      title: 'Codex Native API',
      version: '0.1.0',
    },
    spawnImpl = spawn,
    webSocketFactory = (url) => new WebSocket(url),
    platform = process.platform,
    logger = createNoopLogger(),
    turnPollSleep = sleep,
    turnPollNow = () => Date.now(),
  }: CodexAppClientOptions) {
    super();
    this.codexCliBin = codexCliBin;
    this.codexCliArgs = normalizeStringList(codexCliArgs);
    this.launchCommand = launchCommand;
    this.autolaunch = autolaunch;
    this.modelCatalog = modelCatalog;
    this.modelCatalogMode = modelCatalogMode;
    this.enabledFeatures = normalizeFeatureList(enabledFeatures);
    this.clientInfo = clientInfo;
    this.spawnImpl = spawnImpl;
    this.webSocketFactory = webSocketFactory;
    this.platform = platform;
    this.logger = logger;
    this.turnPollSleep = turnPollSleep;
    this.turnPollNow = turnPollNow;

    this.child = null;
    this.socket = null;
    this.stdioLineBuffer = '';
    this.pending = new Map();
    this.pendingApprovals = new Map();
    this.approvedExecutions = new Map();
    this.requestId = 0;
    this.port = null;
    this.connected = false;
    this.startPromise = null;
    this.childStartError = null;
    this.childStderrTail = [];
  }

  logDebug(event: string, payload: unknown = null): void {
    try {
      this.logger.debug?.(`[codex-app] ${event} ${JSON.stringify(payload)}`);
    } catch {
      this.logger.debug?.(`[codex-app] ${event}`);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async start(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (this.startPromise) {
      await this.startPromise;
      return;
    }
    const task = this.startServer().finally(() => {
      if (this.startPromise === task) {
        this.startPromise = null;
      }
    });
    this.startPromise = task;
    await task;
  }

  async stop(): Promise<void> {
    this.connected = false;
    this.socket?.close();
    this.socket = null;
    this.childStartError = null;
    this.childStderrTail = [];
    const child = this.child;
    if (child && child.exitCode === null) {
      await terminateChildProcess(child, this.platform).catch(() => {});
    }
    this.child = null;
    this.pendingApprovals.clear();
    this.approvedExecutions.clear();
    this.rejectPending(new Error('Codex app client stopped'));
  }

  async listThreads({
    limit = 20,
    cursor = null,
    searchTerm = null,
    archived = false,
  }: {
    limit?: number;
    cursor?: string | null;
    searchTerm?: string | null;
    archived?: boolean | null;
  } = {}): Promise<ProviderThreadListResult> {
    const result: any = await this.request('thread/list', {
      limit,
      cursor,
      sortKey: 'updated_at',
      searchTerm,
      archived: Boolean(archived),
    }, { timeoutMs: 30_000 });
    const rows = Array.isArray(result?.data) ? result.data : [];
    return {
      items: rows.map(mapThreadSummary),
      nextCursor: typeof result?.nextCursor === 'string' ? result.nextCursor : null,
    };
  }

  async readThread(threadId: string, includeTurns = false): Promise<ProviderThreadSummary | null> {
    const result: any = await this.request('thread/read', { threadId, includeTurns }, { timeoutMs: 10_000 });
    return result?.thread ? mapThread(result.thread, includeTurns) : null;
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.request('thread/archive', { threadId }, { timeoutMs: 30_000 });
  }

  async unarchiveThread(threadId: string): Promise<void> {
    await this.request('thread/unarchive', { threadId }, { timeoutMs: 30_000 });
  }

  async startThread({
    cwd = null,
    title = null,
    model = null,
    serviceTier = null,
    sandboxMode = 'workspace-write',
    approvalPolicy = 'on-request',
    ephemeral = null,
  }: {
    cwd?: string | null;
    title?: string | null;
    model?: string | null;
    serviceTier?: string | null;
    sandboxMode?: string;
    approvalPolicy?: string;
    ephemeral?: boolean | null;
  } = {}): Promise<ProviderThreadStartResult> {
    const result: any = await this.request('thread/start', {
      cwd,
      title,
      approvalPolicy,
      model,
      modelProvider: null,
      serviceTier,
      sandbox: sandboxMode,
      config: null,
      serviceName: null,
      baseInstructions: null,
      developerInstructions: null,
      personality: null,
      ephemeral,
      experimentalRawEvents: true,
      persistExtendedHistory: false,
    }, { timeoutMs: 30_000 });
    return {
      threadId: String(result.thread.id),
      cwd: result.cwd ? String(result.cwd) : null,
      title: result.thread?.name ? String(result.thread.name) : null,
    };
  }

  async resumeThread({ threadId }: { threadId: string }): Promise<unknown> {
    return this.request('thread/resume', {
      threadId,
      cwd: null,
      approvalPolicy: null,
      baseInstructions: null,
      developerInstructions: null,
      config: null,
      sandbox: null,
      model: null,
      modelProvider: null,
      personality: null,
      experimentalRawEvents: true,
      persistExtendedHistory: false,
    }, { timeoutMs: 30_000 });
  }

  async getThreadGoal(threadId: string): Promise<ProviderThreadGoal | null> {
    const result: any = await this.request('thread/goal/get', {
      threadId,
    }, { timeoutMs: 10_000 });
    return mapThreadGoal(result?.goal ?? null);
  }

  async setThreadGoal({
    threadId,
    objective = null,
    status = null,
    suppressAutoTurn = false,
  }: {
    threadId: string;
    objective?: string | null;
    status?: string | null;
    suppressAutoTurn?: boolean;
  }): Promise<ProviderThreadGoal | null> {
    const autoStartedTurnPromise = suppressAutoTurn
      ? this.captureNextTurnStartedForThread(threadId, 750)
      : Promise.resolve(null);
    const result: any = await this.request('thread/goal/set', {
      threadId,
      objective,
      status,
    }, { timeoutMs: 15_000 });
    const autoStartedTurnId = await autoStartedTurnPromise;
    if (suppressAutoTurn && autoStartedTurnId) {
      try {
        await this.interruptTurn({ threadId, turnId: autoStartedTurnId });
      } catch (error) {
        this.logDebug('thread_goal_auto_turn_interrupt_failed', {
          threadId,
          turnId: autoStartedTurnId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return mapThreadGoal(result?.goal ?? null);
  }

  async clearThreadGoal(threadId: string): Promise<boolean> {
    const result: any = await this.request('thread/goal/clear', {
      threadId,
    }, { timeoutMs: 15_000 });
    return result?.cleared === true;
  }

  async startTurn({
    threadId,
    inputText,
    input = null,
    cwd = null,
    model = null,
    effort = null,
    serviceTier = null,
    personality = null,
    sandboxMode = 'workspace-write',
    approvalPolicy = 'on-request',
    collaborationMode = 'default',
    developerInstructions = '',
    onProgress = null,
    onTurnStarted = null,
    onApprovalRequest = null,
    timeoutMs = 15 * 60 * 1000,
  }: {
    threadId: string;
    inputText: string;
    input?: CodexTurnInput[] | null;
    cwd?: string | null;
    model?: string | null;
    effort?: string | null;
    serviceTier?: string | null;
    personality?: string | null;
    sandboxMode?: string;
    approvalPolicy?: string;
    collaborationMode?: string;
    developerInstructions?: string;
    onProgress?: ((progress: ProviderTurnProgress) => Promise<void> | void) | null;
    onTurnStarted?: ((meta: Record<string, unknown>) => Promise<void> | void) | null;
    onApprovalRequest?: ((request: ProviderApprovalRequest) => Promise<void> | void) | null;
    timeoutMs?: number;
  }): Promise<ProviderTurnResult> {
    this.logDebug('turn_start_requested', {
      threadId,
      cwd,
      model,
      effort,
      serviceTier,
      personality,
      approvalPolicy,
      sandboxMode,
      collaborationMode,
      timeoutMs,
      inputCount: Array.isArray(input) ? input.length : 1,
      inputSummary: summarizeTurnInput(
        Array.isArray(input) && input.length > 0
          ? input
          : [{
            type: 'text',
            text: inputText,
            text_elements: [],
          }],
      ),
    });
    const result: any = await this.request('turn/start', {
      threadId,
      input: Array.isArray(input) && input.length > 0
        ? input
        : [{
          type: 'text',
          text: inputText,
          text_elements: [],
        }],
      cwd,
      approvalPolicy,
      sandboxPolicy: mapSandboxPolicy(sandboxMode),
      model,
      serviceTier,
      effort,
      summary: null,
      personality,
      outputSchema: null,
      collaborationMode: serializeCollaborationMode({
        collaborationMode,
        model,
        effort,
        developerInstructions,
      }),
    }, { timeoutMs: 30_000 });
    const turn = result?.turn;
    if (!turn?.id) {
      throw new Error('Codex turn/start returned no turn id');
    }
    this.logDebug('turn_start_acknowledged', {
      threadId,
      turnId: String(turn.id),
      status: String(turn.status ?? ''),
    });
    if (typeof onTurnStarted === 'function') {
      await onTurnStarted({
        turnId: String(turn.id),
        threadId,
      });
    }
    return this.waitForTurnResult({
      threadId,
      turnId: String(turn.id),
      onProgress,
      onApprovalRequest,
      timeoutMs,
    });
  }

  async interruptTurn({ threadId, turnId }: { threadId: string; turnId: string }): Promise<void> {
    await this.request('turn/interrupt', { threadId, turnId }, { timeoutMs: 15_000 });
  }

  getPendingApprovals({
    threadId = null,
    turnId = null,
  }: {
    threadId?: string | null;
    turnId?: string | null;
  } = {}): ProviderApprovalRequest[] {
    return [...this.pendingApprovals.values()]
      .map((entry) => entry.request)
      .filter((entry) => {
        if (threadId && entry.threadId !== threadId) {
          return false;
        }
        if (turnId && entry.turnId !== turnId) {
          return false;
        }
        return true;
      });
  }

  async respondToApproval({
    requestId,
    option,
  }: {
    requestId: string;
    option: 1 | 2 | 3;
  }): Promise<void> {
    const pending = this.pendingApprovals.get(String(requestId)) ?? null;
    if (!pending) {
      throw new Error(`Unknown approval request: ${requestId}`);
    }
    const result = buildApprovalResponseResult(pending, option);
    const approvedExecution = createApprovedExecution(pending, option, this.turnPollNow());
    if (approvedExecution) {
      this.approvedExecutions.set(approvedExecution.requestId, approvedExecution);
    }
    try {
      this.send({
        jsonrpc: '2.0',
        id: pending.rpcResponseId,
        result,
      });
    } catch (error) {
      if (approvedExecution) {
        this.approvedExecutions.delete(approvedExecution.requestId);
      }
      throw error;
    }
    this.pendingApprovals.delete(String(requestId));
    if (approvedExecution) {
      this.logDebug('approval_response_sent', summarizeApprovedExecution(approvedExecution));
    }
  }

  async listModels(): Promise<CodexModelInfo[]> {
    const models = [];
    let cursor = null;
    do {
      const result: any = await this.request('model/list', {
        cursor,
        limit: 100,
        includeHidden: false,
      }, { timeoutMs: 30_000 });
      const rows = Array.isArray(result?.data) ? result.data : [];
      models.push(...rows.map(mapModel));
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : null;
    } while (cursor);
    if (this.modelCatalogMode === 'overlay-only' && this.modelCatalog.length > 0) {
      return this.modelCatalog;
    }
    return mergeModelCatalog(models, this.modelCatalog);
  }

  async readUsage(): Promise<ProviderUsageReport | null> {
    const result = await this.request('account/rateLimits/read', {}, { timeoutMs: 15_000 });
    return mapAppServerRateLimits(result);
  }

  async listSkills({
    cwd = null,
    forceReload = false,
  }: {
    cwd?: string | null;
    forceReload?: boolean;
  } = {}): Promise<ProviderSkillsListResult> {
    const result: any = await this.request('skills/list', {
      cwds: cwd ? [cwd] : [],
      forceReload,
    }, { timeoutMs: 30_000 });
    const rows = Array.isArray(result?.data) ? result.data : [];
    const entry = rows.find((item: CodexAppSkillsListEntry) => normalizeNullableString(item?.cwd) === cwd)
      ?? rows[0]
      ?? null;
    return {
      cwd: normalizeNullableString(entry?.cwd) ?? cwd ?? null,
      skills: Array.isArray(entry?.skills) ? entry.skills.map(mapSkillMetadata).filter(Boolean) : [],
      errors: Array.isArray(entry?.errors) ? entry.errors.map(mapSkillErrorInfo).filter(Boolean) : [],
    };
  }

  async setSkillEnabled({
    enabled,
    name = null,
    path = null,
  }: {
    enabled: boolean;
    name?: string | null;
    path?: string | null;
  }): Promise<void> {
    await this.request('skills/config/write', {
      enabled,
      name,
      path,
    }, { timeoutMs: 30_000 });
  }

  async listPlugins({
    cwd = null,
  }: {
    cwd?: string | null;
  } = {}): Promise<ProviderPluginsListResult> {
    const result: CodexAppPluginListResponse = await this.request('plugin/list', {
      cwds: cwd ? [cwd] : [],
    }, { timeoutMs: 30_000 });
    return {
      featuredPluginIds: Array.isArray(result?.featuredPluginIds)
        ? result.featuredPluginIds.map((value) => String(value ?? '').trim()).filter(Boolean)
        : [],
      marketplaceLoadErrors: Array.isArray(result?.marketplaceLoadErrors)
        ? result.marketplaceLoadErrors.map(mapPluginLoadError).filter(Boolean) as ProviderPluginLoadError[]
        : [],
      marketplaces: Array.isArray(result?.marketplaces)
        ? result.marketplaces.map(mapPluginMarketplace).filter(Boolean) as ProviderPluginMarketplace[]
        : [],
    };
  }

  async readPlugin({
    pluginName,
    marketplaceName = null,
    marketplacePath = null,
  }: {
    pluginName: string;
    marketplaceName?: string | null;
    marketplacePath?: string | null;
  }): Promise<ProviderPluginDetail | null> {
    const params: Record<string, unknown> = {
      pluginName,
    };
    if (marketplacePath) {
      params.marketplacePath = marketplacePath;
    } else if (marketplaceName) {
      params.remoteMarketplaceName = marketplaceName;
    }
    const result: any = await this.request('plugin/read', params, { timeoutMs: 30_000 });
    return mapPluginDetail(result?.plugin ?? null, {
      marketplaceName,
      marketplacePath,
    });
  }

  async installPlugin({
    pluginName,
    marketplaceName = null,
    marketplacePath = null,
  }: {
    pluginName: string;
    marketplaceName?: string | null;
    marketplacePath?: string | null;
  }): Promise<ProviderPluginInstallResult> {
    const params: Record<string, unknown> = {
      pluginName,
    };
    if (marketplacePath) {
      params.marketplacePath = marketplacePath;
    } else if (marketplaceName) {
      params.remoteMarketplaceName = marketplaceName;
    }
    const result: CodexAppPluginInstallResponse = await this.request('plugin/install', params, { timeoutMs: 30_000 });
    return {
      authPolicy: normalizeNullableString(result?.authPolicy),
      appsNeedingAuth: Array.isArray(result?.appsNeedingAuth)
        ? result.appsNeedingAuth.map(mapPluginAppSummary).filter(Boolean) as ProviderPluginAppSummary[]
        : [],
    };
  }

  async uninstallPlugin({
    pluginId,
  }: {
    pluginId: string;
  }): Promise<void> {
    await this.request('plugin/uninstall', {
      pluginId,
    }, { timeoutMs: 30_000 });
  }

  async listApps(): Promise<ProviderAppInfo[]> {
    const apps = [];
    let cursor = null;
    do {
      const result: any = await this.request('app/list', {
        cursor,
        limit: 100,
      }, { timeoutMs: 30_000 });
      const rows = Array.isArray(result?.data) ? result.data : [];
      apps.push(...rows.map(mapAppInfo).filter(Boolean));
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : null;
    } while (cursor);
    return apps;
  }

  async listMcpServerStatuses(): Promise<ProviderMcpServerStatus[]> {
    const servers = [];
    let cursor = null;
    do {
      const result: any = await this.request('mcpServerStatus/list', {
        cursor,
        limit: 100,
      }, { timeoutMs: 30_000 });
      const rows = Array.isArray(result?.data) ? result.data : [];
      servers.push(...rows.map(mapMcpServerStatus).filter(Boolean));
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : null;
    } while (cursor);
    return servers;
  }

  async setAppEnabled({
    appId,
    enabled,
  }: {
    appId: string;
    enabled: boolean;
  }): Promise<void> {
    await this.writeConfigValue({
      keyPath: formatConfigKeyPath(['apps', appId, 'enabled']),
      value: enabled,
    });
  }

  async setMcpServerEnabled({
    name,
    enabled,
  }: {
    name: string;
    enabled: boolean;
  }): Promise<void> {
    await this.writeConfigValue({
      keyPath: formatConfigKeyPath(['mcp_servers', name, 'enabled']),
      value: enabled,
    });
  }

  async startMcpServerOauthLogin({
    name,
    scopes = null,
    timeoutSecs = null,
  }: {
    name: string;
    scopes?: string[] | null;
    timeoutSecs?: number | null;
  }): Promise<ProviderMcpOauthLoginResult> {
    const result: CodexAppMcpOauthLoginResponse = await this.request('mcpServer/oauth/login', {
      name,
      scopes,
      timeoutSecs,
    }, { timeoutMs: 30_000 });
    const authorizationUrl = normalizeNullableString(result?.authorizationUrl);
    if (!authorizationUrl) {
      throw new Error(`mcpServer/oauth/login returned no authorization URL for ${name}`);
    }
    return { authorizationUrl };
  }

  async reloadMcpServers(): Promise<void> {
    await this.request('config/mcpServer/reload', {}, { timeoutMs: 30_000 });
  }

  async writeConfigValue({
    keyPath,
    value,
    mergeStrategy = 'upsert',
    filePath = null,
    expectedVersion = null,
  }: {
    keyPath: string;
    value: unknown;
    mergeStrategy?: 'replace' | 'upsert';
    filePath?: string | null;
    expectedVersion?: string | null;
  }): Promise<void> {
    await this.request('config/value/write', {
      keyPath,
      value,
      mergeStrategy,
      filePath,
      expectedVersion,
    }, { timeoutMs: 30_000 });
  }

  async startServer(): Promise<void> {
    if (this.autolaunch && this.launchCommand?.trim()) {
      const launcher = this.spawnImpl(this.launchCommand, {
        shell: true,
        detached: true,
        stdio: 'ignore',
      });
      launcher.unref?.();
    }
    this.childStartError = null;
    this.childStderrTail = [];
    this.stdioLineBuffer = '';
    this.port = null;
    const featureArgs = this.enabledFeatures.flatMap((feature) => ['--enable', feature]);
    const launchSpec = createCodexAppServerLaunchSpec({
      command: this.codexCliBin,
      args: [...this.codexCliArgs, 'app-server', ...featureArgs, '--listen', 'stdio://'],
      platform: this.platform,
    });
    try {
      this.child = launchSpec.args
        ? this.spawnImpl(launchSpec.command, launchSpec.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          ...launchSpec.options,
        })
        : this.spawnImpl(launchSpec.command, {
          stdio: ['pipe', 'pipe', 'pipe'],
          ...launchSpec.options,
        });
    } catch (error) {
      throw createCodexLaunchError({
        command: launchSpec.displayCommand,
        error,
        platform: this.platform,
      });
    }
    this.logDebug('app_server_spawned', {
      command: launchSpec.displayCommand,
      spawnCommand: launchSpec.command,
      spawnArgs: launchSpec.args,
      port: this.port,
      codexCliArgs: this.codexCliArgs,
      enabledFeatures: this.enabledFeatures,
      autolaunch: this.autolaunch,
      launchCommand: this.launchCommand,
    });
    this.child.stdout?.on('data', (chunk) => this.handleStdioData(chunk));
    this.child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) {
        rememberCodexStderrLine(this.childStderrTail, text);
        this.logger.debug?.(`[codex-app] codex.stderr ${text}`);
      }
    });
    this.child.on('error', (error) => {
      this.childStartError = createCodexLaunchError({
        command: launchSpec.displayCommand,
        error,
        platform: this.platform,
      });
    });
    this.child.on('exit', () => {
      this.connected = false;
      this.socket = null;
    });
    this.connected = true;
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (this.childStartError) {
      throw this.childStartError;
    }
    if (this.child && this.child.exitCode !== null) {
      throw createCodexAppServerExitedError({
        command: this.codexCliBin,
        exitCode: this.child.exitCode,
        stderrTail: this.childStderrTail,
      });
    }
    await this.initialize();
  }

  handleStdioData(chunk: unknown): void {
    this.stdioLineBuffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
    for (;;) {
      const newlineIndex = this.stdioLineBuffer.indexOf('\n');
      if (newlineIndex < 0) {
        break;
      }
      const line = this.stdioLineBuffer.slice(0, newlineIndex).trim();
      this.stdioLineBuffer = this.stdioLineBuffer.slice(newlineIndex + 1);
      if (line) {
        this.handleMessage(line);
      }
    }
  }

  async connectWebSocket(): Promise<void> {
    const url = `ws://127.0.0.1:${this.port}`;
    const started = Date.now();
    while (Date.now() - started < APP_SERVER_CONNECT_TIMEOUT_MS) {
      if (this.childStartError) {
        throw this.childStartError;
      }
      if (this.child && this.child.exitCode !== null && !this.connected) {
        throw createCodexAppServerExitedError({
          command: this.codexCliBin,
          exitCode: this.child.exitCode,
          stderrTail: this.childStderrTail,
        });
      }
      try {
        await new Promise<void>((resolve, reject) => {
          const ws = this.webSocketFactory(url);
          const onError = (error: any) => {
            ws.close();
            reject(error instanceof Error ? error : new Error(String(error?.message ?? 'WebSocket connect failed')));
          };
          ws.addEventListener('open', () => {
            this.socket = ws;
            this.connected = true;
            ws.addEventListener('message', (message) => this.handleMessage(String(message.data)));
            ws.addEventListener('close', () => {
              this.connected = false;
              this.socket = null;
            });
            resolve();
          }, { once: true });
          ws.addEventListener('error', onError, { once: true });
        });
        return;
      } catch {
        await sleep(250);
      }
    }
    if (this.childStartError) {
      throw this.childStartError;
    }
    throw createCodexConnectTimeoutError({
      command: this.codexCliBin,
      url,
      stderrTail: this.childStderrTail,
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      clientInfo: this.clientInfo,
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: [
          'codex/event/agent_reasoning_delta',
          'codex/event/reasoning_content_delta',
          'codex/event/reasoning_raw_content_delta',
          'codex/event/exec_command_output_delta',
        ],
      },
    }, { timeoutMs: 30_000 });
    this.send({ jsonrpc: '2.0', method: 'initialized' });
  }

  async request(method: string, params: any, { timeoutMs = 30_000 }: { timeoutMs?: number } = {}): Promise<any> {
    if (!this.child || !this.connected) {
      await this.start();
    }
    const id = String(++this.requestId);
    const startedAt = this.turnPollNow();
    this.logDebug('rpc_request_start', {
      id,
      method,
      timeoutMs,
      params: summarizeRpcParams(method, params),
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }
        this.pending.delete(id);
        this.logDebug('rpc_request_timeout', {
          id,
          method,
          elapsedMs: this.turnPollNow() - startedAt,
        });
        reject(new Error(`Timed out waiting for Codex JSON-RPC response to ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          this.logDebug('rpc_request_result', {
            id,
            method,
            elapsedMs: this.turnPollNow() - startedAt,
            result: summarizeRpcResult(method, result),
          });
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          this.logDebug('rpc_request_error', {
            id,
            method,
            elapsedMs: this.turnPollNow() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          });
          reject(error);
        },
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  send(payload: any): void {
    if (!this.child?.stdin?.writable) {
      throw new Error('Codex app-server stdio is not open');
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  handleMessage(raw: string): void {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if ('id' in message && !('method' in message)) {
      const pending = this.pending.get(String(message.id));
      if (!pending) {
        return;
      }
      this.pending.delete(String(message.id));
      if (message.error) {
        pending.reject(new Error(message.error.message || 'JSON-RPC error'));
        return;
      }
      pending.resolve(message.result);
      return;
    }

    if ('method' in message) {
      this.noteApprovedExecutionSignalFromNotification(message);
      this.logDebug('rpc_notification', summarizeNotificationMessage(message));
      if ('id' in message && this.handleServerRequest(message)) {
        return;
      }
      this.emit('notification', message);
    }
  }

  handleServerRequest(message: any): boolean {
    const pendingApproval = mapPendingApproval(message);
    if (!pendingApproval) {
      this.emit('server_request', message);
      return false;
    }
    this.pendingApprovals.set(pendingApproval.rpcId, pendingApproval);
    this.emit('approval_request', pendingApproval.request);
    return true;
  }

  rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  captureNextTurnStartedForThread(threadId: string, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (turnId: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.off('notification', onNotification);
        resolve(turnId);
      };
      const onNotification = (message: any) => {
        if (String(message?.method ?? '') !== 'turn/started') {
          return;
        }
        if (extractThreadIdFromNotification(message) !== threadId) {
          return;
        }
        finish(extractNotificationTurnId(message?.params ?? null));
      };
      const timer = setTimeout(() => finish(null), Math.max(100, timeoutMs));
      this.on('notification', onNotification);
    });
  }

  getApprovedExecutions({
    threadId = null,
    turnId = null,
    activeOnly = false,
  }: {
    threadId?: string | null;
    turnId?: string | null;
    activeOnly?: boolean;
  } = {}): ApprovedExecution[] {
    return [...this.approvedExecutions.values()].filter((entry) => {
      if (threadId && entry.threadId !== threadId) {
        return false;
      }
      if (turnId && entry.turnId && entry.turnId !== turnId) {
        return false;
      }
      if (activeOnly && entry.completedAt) {
        return false;
      }
      return true;
    });
  }

  noteApprovedExecutionSignalFromNotification(message: any): void {
    const signalKind = classifyApprovedExecutionSignal(message?.method);
    if (!signalKind) {
      return;
    }
    const threadId = extractThreadIdFromNotification(message);
    if (!threadId) {
      return;
    }
    this.noteApprovedExecutionSignal({
      threadId,
      turnId: extractNotificationTurnId(message?.params ?? null),
      itemId: extractItemId(message?.params ?? null),
      signalKind,
      markCompleted: signalKind === 'item_completed' || signalKind === 'turn_completed',
    });
  }

  noteApprovedExecutionSignal({
    threadId,
    turnId = null,
    itemId = null,
    signalKind,
    markCompleted = false,
  }: {
    threadId: string;
    turnId?: string | null;
    itemId?: string | null;
    signalKind: string;
    markCompleted?: boolean;
  }): void {
    const now = this.turnPollNow();
    for (const entry of this.approvedExecutions.values()) {
      if (entry.completedAt) {
        continue;
      }
      if (entry.threadId !== threadId) {
        continue;
      }
      if (turnId && entry.turnId && entry.turnId !== turnId) {
        continue;
      }
      if (!turnId && entry.turnId && !isThreadLevelApprovedExecutionSignal(signalKind)) {
        continue;
      }
      const firstSignal = entry.signalCount === 0;
      entry.lastSignalAt = now;
      entry.lastSignalKind = signalKind;
      entry.signalCount += 1;
      if (
        markCompleted
        && (
          !itemId
          || !entry.itemId
          || entry.itemId === itemId
        )
      ) {
        entry.completedAt = now;
      }
      if (firstSignal || entry.completedAt) {
        this.logDebug('approval_signal', summarizeApprovedExecutionSignal(entry, signalKind));
      }
    }
  }

  observeApprovedExecutionTurnSnapshot({
    threadId,
    turnId,
    turn,
  }: {
    threadId: string;
    turnId: string;
    turn: any;
  }): void {
    const activeEntries = this.getApprovedExecutions({ threadId, turnId, activeOnly: true });
    if (activeEntries.length === 0 || !turn) {
      return;
    }
    const snapshotKey = buildTurnSnapshotKey(turn);
    let changed = false;
    for (const entry of activeEntries) {
      if (!entry.lastObservedTurnSnapshotKey) {
        entry.lastObservedTurnSnapshotKey = snapshotKey;
        continue;
      }
      if (entry.lastObservedTurnSnapshotKey !== snapshotKey) {
        entry.lastObservedTurnSnapshotKey = snapshotKey;
        changed = true;
      }
    }
    if (changed) {
      this.noteApprovedExecutionSignal({
        threadId,
        turnId,
        signalKind: 'turn_snapshot_changed',
      });
    }
  }

  inspectApprovedExecutionStall({
    threadId,
    turnId,
    timeoutMs,
  }: {
    threadId: string;
    turnId: string;
    timeoutMs: number;
  }): null | {
    entry: ApprovedExecution;
    idleMs: number;
    idleLimitMs: number;
  } {
    const activeEntries = this.getApprovedExecutions({ threadId, turnId, activeOnly: true });
    if (activeEntries.length === 0) {
      return null;
    }
    const now = this.turnPollNow();
    const idleLimitMs = computeApprovedExecutionIdleLimitMs(timeoutMs);
    let stalledEntry: ApprovedExecution | null = null;
    let stalledIdleMs = 0;
    for (const entry of activeEntries) {
      const idleMs = Math.max(0, now - Math.max(entry.lastSignalAt, entry.approvedAt));
      if (idleMs < idleLimitMs) {
        continue;
      }
      if (!stalledEntry || idleMs > stalledIdleMs) {
        stalledEntry = entry;
        stalledIdleMs = idleMs;
      }
    }
    if (!stalledEntry) {
      return null;
    }
    return {
      entry: stalledEntry,
      idleMs: stalledIdleMs,
      idleLimitMs,
    };
  }

  clearApprovedExecutionsForTurn({
    threadId,
    turnId,
  }: {
    threadId: string;
    turnId: string;
  }): void {
    for (const [requestId, entry] of this.approvedExecutions.entries()) {
      if (entry.threadId !== threadId) {
        continue;
      }
      if (entry.turnId && entry.turnId !== turnId) {
        continue;
      }
      this.approvedExecutions.delete(requestId);
    }
  }

  async waitForTurnResult({
    threadId,
    turnId,
    onProgress,
    onApprovalRequest,
    timeoutMs,
  }: {
    threadId: string;
    turnId: string;
    onProgress?: ((progress: ProviderTurnProgress) => Promise<void> | void) | null;
    onApprovalRequest?: ((request: ProviderApprovalRequest) => Promise<void> | void) | null;
    timeoutMs: number;
  }): Promise<ProviderTurnResult> {
    const deadline = this.turnPollNow() + timeoutMs;
    let firstTerminalWithoutOutputAt = null;
    let lastTurnSnapshotKey = null;
    let stableTerminalReadCount = 0;
    let pollCount = 0;
    let includeTurnsUnsupported = false;
    let includeTurnsUnsupportedAt = 0;
    let pendingApprovalWaitLogged = false;
    let lastPendingApprovalCount = 0;
    const terminalSettleMs = computeTerminalSettleMs(timeoutMs);
    const progressState: ProgressState = {
      commentaryText: '',
      finalAnswerText: '',
      sawAssistantActivity: false,
      lastAssistantActivityAt: 0,
    };
    const itemOutputKinds = new Map();
    let sawTerminalNotification = false;
    const onNotification = (notification) => {
      if (isTerminalNotificationForThread(notification, threadId, turnId)) {
        sawTerminalNotification = true;
      }
      const progress = extractProgressUpdate(notification, turnId, itemOutputKinds, progressState);
      if (!progress) {
        return;
      }
      if (progress.outputKind === 'final_answer') {
        progressState.finalAnswerText += progress.delta;
      } else {
        progressState.commentaryText += progress.delta;
      }
      progressState.sawAssistantActivity = true;
      progressState.lastAssistantActivityAt = this.turnPollNow();
      if (typeof onProgress === 'function') {
        void onProgress({
          text: progress.outputKind === 'final_answer'
            ? progressState.finalAnswerText
            : progressState.commentaryText,
          delta: progress.delta,
          outputKind: progress.outputKind,
        });
      }
    };
    const onApprovalEvent = (request: ProviderApprovalRequest) => {
      if (request.threadId !== threadId) {
        return;
      }
      if (request.turnId && request.turnId !== turnId) {
        return;
      }
      if (typeof onApprovalRequest === 'function') {
        void onApprovalRequest(request);
      }
    };
    this.on('notification', onNotification);
    this.on('approval_request', onApprovalEvent);
    this.logDebug('turn_wait_start', {
      threadId,
      turnId,
      timeoutMs,
      deadline,
      terminalSettleMs,
    });
    try {
      while (true) {
        const pendingApprovalCount = this.getPendingApprovals({ threadId, turnId }).length;
        const pastDeadline = this.turnPollNow() >= deadline;
        if (pastDeadline && pendingApprovalCount === 0) {
          break;
        }
        if (pastDeadline && pendingApprovalCount > 0) {
          if (!pendingApprovalWaitLogged || pendingApprovalCount !== lastPendingApprovalCount) {
            this.logDebug('turn_wait_continue', {
              threadId,
              turnId,
              pollCount,
              reason: 'pending_approval_wait',
              pendingApprovalCount,
            });
          }
          pendingApprovalWaitLogged = true;
          lastPendingApprovalCount = pendingApprovalCount;
        } else {
          pendingApprovalWaitLogged = false;
          lastPendingApprovalCount = pendingApprovalCount;
        }
        pollCount += 1;
        let thread = null;
        try {
          thread = await this.readThread(threadId, !includeTurnsUnsupported);
        } catch (error) {
          if (isThreadMaterializationPendingError(error)) {
            this.logDebug('turn_poll_retry', {
              threadId,
              turnId,
              pollCount,
              reason: 'thread_materialization_pending',
            });
            await this.turnPollSleep(1000);
            continue;
          }
          if (isRequestTimeoutError(error)) {
            this.logDebug('turn_poll_retry', {
              threadId,
              turnId,
              pollCount,
              reason: 'thread_read_timeout',
            });
            await this.turnPollSleep(1000);
            continue;
          }
          if (isIncludeTurnsUnsupportedError(error)) {
            includeTurnsUnsupported = true;
            includeTurnsUnsupportedAt ||= this.turnPollNow();
            this.logDebug('turn_poll_retry', {
              threadId,
              turnId,
              pollCount,
              reason: 'thread_read_include_turns_unsupported',
            });
            try {
              thread = await this.readThread(threadId, false);
            } catch (fallbackError) {
              if (isThreadMaterializationPendingError(fallbackError) || isRequestTimeoutError(fallbackError)) {
                await this.turnPollSleep(250);
                continue;
              }
              throw fallbackError;
            }
          } else {
            throw error;
          }
        }
        const turn = includeTurnsUnsupported
          ? null
          : thread?.turns?.find((entry) => entry.id === turnId) ?? null;
        this.logDebug('turn_poll_snapshot', {
          threadId,
          turnId,
          pollCount,
          elapsedMs: timeoutMs - Math.max(0, deadline - this.turnPollNow()),
          threadFound: Boolean(thread),
          threadPath: thread?.path ?? null,
          turn: summarizeTurnSnapshot(turn),
          progress: summarizeProgressState(progressState),
        });
        if (includeTurnsUnsupported) {
          const previewText = progressState.finalAnswerText || progressState.commentaryText;
          const settleAnchor = Math.max(
            includeTurnsUnsupportedAt,
            progressState.lastAssistantActivityAt || 0,
          );
          const settleElapsedMs = settleAnchor ? this.turnPollNow() - settleAnchor : 0;
          if (
            (
              !sawTerminalNotification
              || !previewText
              || settleElapsedMs < 500
            )
            && this.turnPollNow() + 250 < deadline
          ) {
            await this.turnPollSleep(250);
            continue;
          }
          if (previewText) {
            const result = {
              turnId,
              threadId,
              title: thread?.title ?? null,
              outputText: previewText,
              outputArtifacts: [],
              outputMedia: [],
              outputState: sawTerminalNotification ? 'complete' : 'partial',
              previewText: progressState.finalAnswerText,
              finalSource: progressState.finalAnswerText ? 'progress_only' : 'commentary_only',
              status: sawTerminalNotification ? 'completed' : null,
            };
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
            return result;
          }
          if (sawTerminalNotification) {
            const result = {
              turnId,
              threadId,
              title: thread?.title ?? null,
              outputText: '',
              outputArtifacts: [],
              outputMedia: [],
              outputState: 'missing',
              previewText: '',
              finalSource: 'none',
              status: 'completed',
            };
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
            return result;
          }
          await this.turnPollSleep(250);
          continue;
        }
        if (turn) {
          this.observeApprovedExecutionTurnSnapshot({
            threadId,
            turnId,
            turn,
          });
        }
        const approvedExecutionStall = this.inspectApprovedExecutionStall({
          threadId,
          turnId,
          timeoutMs,
        });
        if (approvedExecutionStall) {
          this.logDebug('turn_wait_error', {
            threadId,
            turnId,
            pollCount,
            reason: 'approved_execution_stalled',
            idleMs: approvedExecutionStall.idleMs,
            idleLimitMs: approvedExecutionStall.idleLimitMs,
            approval: summarizeApprovedExecution(approvedExecutionStall.entry),
          });
          throw new Error(buildApprovedExecutionStallError(approvedExecutionStall));
        }
        if (turn && isTurnTerminal(turn.status)) {
          const outputText = extractTurnOutputText(turn);
          if (outputText) {
            this.noteApprovedExecutionSignal({
              threadId,
              turnId,
              signalKind: 'turn_terminal',
              markCompleted: true,
            });
            const outputArtifacts = extractTurnOutputArtifacts(turn);
            const result = {
              turnId,
              threadId,
              title: thread?.title ?? null,
              outputText,
              outputArtifacts,
              outputMedia: normalizeLegacyImageMedia(outputArtifacts),
              outputState: 'complete',
              previewText: progressState.finalAnswerText,
              finalSource: 'thread_items',
              status: turn.status,
            };
            const enrichedResult = attachSessionResponseItems(result, thread?.path ?? null);
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(enrichedResult));
            return enrichedResult;
          }
          const outputArtifacts = extractTurnOutputArtifacts(turn);
          if (outputArtifacts.length > 0) {
            this.noteApprovedExecutionSignal({
              threadId,
              turnId,
              signalKind: 'turn_terminal',
              markCompleted: true,
            });
            const result = {
              turnId,
              threadId,
              title: thread?.title ?? null,
              outputText: '',
              outputArtifacts,
              outputMedia: normalizeLegacyImageMedia(outputArtifacts),
              outputState: 'complete',
              previewText: progressState.finalAnswerText,
              finalSource: 'thread_items_media',
              status: turn.status,
            };
            const enrichedResult = attachSessionResponseItems(result, thread?.path ?? null);
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(enrichedResult));
            return enrichedResult;
          }
          const sessionState = inspectTurnCompletionFromSessionPath(thread?.path ?? null, turnId);
          const hasAssistantVisibleItems = turn.items.some((item) => isAssistantVisibleItem(item));
          const completionState = classifyTurnCompletionState(turn);
          this.logDebug('turn_terminal_state', {
            threadId,
            turnId,
            pollCount,
            turn: summarizeTurnSnapshot(turn),
            hasAssistantVisibleItems,
            completionState,
            sessionState: summarizeSessionState(thread?.path ?? null, sessionState),
            progress: summarizeProgressState(progressState),
          });
          if (completionState === 'interrupted') {
            this.noteApprovedExecutionSignal({
              threadId,
              turnId,
              signalKind: 'turn_terminal',
              markCompleted: true,
            });
            const result = {
              turnId,
              threadId,
              title: thread?.title ?? null,
              outputText: '',
              outputState: 'interrupted',
              previewText: progressState.finalAnswerText,
              finalSource: progressState.finalAnswerText ? 'progress_only' : 'none',
              status: turn.status,
            };
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
            return result;
          }
          if (turn.error) {
            this.logDebug('turn_wait_error', {
              threadId,
              turnId,
              pollCount,
              error: turn.error,
            });
            throw new Error(turn.error);
          }
          if (sessionState.lastAgentMessage && hasAssistantVisibleItems) {
            this.noteApprovedExecutionSignal({
              threadId,
              turnId,
              signalKind: 'session_task_complete',
              markCompleted: true,
            });
            const result = buildSessionTaskCompleteResult({
              turnId,
              threadId,
              title: thread?.title ?? null,
              status: turn.status,
              previewText: progressState.finalAnswerText,
              sessionState,
            });
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
            return result;
          }
          const sessionTaskCompleteNeedsMaterializationWait = shouldWaitForSessionTaskMaterialization(
            sessionState,
            hasAssistantVisibleItems,
          );
          if (shouldWaitForSettledOutputAfterTerminalTurn(turn, progressState) || sessionTaskCompleteNeedsMaterializationWait) {
            const snapshotKey = buildTurnSnapshotKey(turn);
            if (snapshotKey === lastTurnSnapshotKey) {
              stableTerminalReadCount += 1;
            } else {
              lastTurnSnapshotKey = snapshotKey;
              stableTerminalReadCount = 1;
            }
            firstTerminalWithoutOutputAt ??= this.turnPollNow();
            if (
              (
                this.turnPollNow() - firstTerminalWithoutOutputAt < terminalSettleMs
                || stableTerminalReadCount < 3
              )
              && this.turnPollNow() + 1000 < deadline
            ) {
              this.logDebug('turn_wait_continue', {
                threadId,
                turnId,
                pollCount,
                reason: sessionTaskCompleteNeedsMaterializationWait
                  ? 'session_task_materialization_wait'
                  : 'terminal_settle_wait',
                stableTerminalReadCount,
                terminalElapsedMs: this.turnPollNow() - firstTerminalWithoutOutputAt,
                terminalSettleMs,
              });
              await this.turnPollSleep(1000);
              continue;
            }
          }
          if (sessionState.lastAgentMessage || sessionState.outputArtifacts.length > 0) {
            this.noteApprovedExecutionSignal({
              threadId,
              turnId,
              signalKind: 'session_task_complete',
              markCompleted: true,
            });
            const result = buildSessionTaskCompleteResult({
              turnId,
              threadId,
              title: thread?.title ?? null,
              status: turn.status,
              previewText: progressState.finalAnswerText,
              sessionState,
            });
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
            return result;
          }
          if (sessionState.hasTaskComplete) {
            this.noteApprovedExecutionSignal({
              threadId,
              turnId,
              signalKind: 'session_task_complete',
              markCompleted: true,
            });
            const previewText = resolveTurnPreviewText(turn, progressState);
            if (!previewText && sessionState.runtimeError) {
              const result = {
                turnId,
                threadId,
                title: thread?.title ?? null,
                outputText: '',
                outputState: 'provider_error',
                previewText: '',
                finalSource: 'session_runtime_error',
                status: turn.status,
                errorMessage: sessionState.runtimeError,
              };
              this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
              return result;
            }
            const result = {
              turnId,
              threadId,
              title: thread?.title ?? null,
              outputText: '',
              outputState: previewText ? 'partial' : 'missing',
              previewText,
              finalSource: progressState.finalAnswerText
                ? 'progress_only'
                : progressState.commentaryText
                  ? 'commentary_only'
                  : 'session_task_complete_empty',
              status: turn.status,
            };
            this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
            return result;
          }
          if (shouldWaitForTaskCompleteBeforeMissing(thread?.path ?? null, sessionState)) {
            if (this.turnPollNow() + 1000 < deadline) {
              this.logDebug('turn_wait_continue', {
                threadId,
                turnId,
                pollCount,
                reason: 'waiting_for_session_task_complete',
                sessionPath: thread?.path ?? null,
              });
              await this.turnPollSleep(1000);
              continue;
            }
            const previewText = resolveTurnPreviewText(turn, progressState);
            if (previewText) {
              const result = {
                turnId,
                threadId,
                title: thread?.title ?? null,
                outputText: '',
                outputState: 'partial',
                previewText,
                finalSource: progressState.finalAnswerText ? 'progress_only' : 'commentary_only',
                status: turn.status,
              };
              this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
              return result;
            }
            this.logDebug('turn_wait_error', {
              threadId,
              turnId,
              pollCount,
              reason: 'task_complete_timeout_without_preview',
            });
            throw new Error(`Timed out waiting for Codex turn ${turnId}`);
          }
          if (hasUnsettledAssistantActivity(turn, progressState)) {
            if (this.turnPollNow() + 1000 < deadline) {
              this.logDebug('turn_wait_continue', {
                threadId,
                turnId,
                pollCount,
                reason: 'unsettled_assistant_activity',
                progress: summarizeProgressState(progressState),
              });
              await this.turnPollSleep(1000);
              continue;
            }
            const previewText = resolveTurnPreviewText(turn, progressState);
            if (previewText) {
              const result = {
                turnId,
                threadId,
                title: thread?.title ?? null,
                outputText: '',
                outputState: 'partial',
                previewText,
                finalSource: progressState.finalAnswerText ? 'progress_only' : 'commentary_only',
                status: turn.status,
              };
              this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
              return result;
            }
            this.logDebug('turn_wait_error', {
              threadId,
              turnId,
              pollCount,
              reason: 'assistant_activity_timeout_without_preview',
            });
            throw new Error(`Timed out waiting for Codex turn ${turnId}`);
          }
          const previewText = resolveTurnPreviewText(turn, progressState);
          const result = {
            turnId,
            threadId,
            title: thread?.title ?? null,
            outputText: '',
            outputState: previewText ? 'partial' : 'missing',
            previewText,
            finalSource: progressState.finalAnswerText
              ? 'progress_only'
              : progressState.commentaryText
                ? 'commentary_only'
                : 'none',
            status: turn.status,
          };
          this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
          return result;
        }
        await this.turnPollSleep(1000);
      }
      const previewText = progressState.finalAnswerText || progressState.commentaryText;
      if (previewText) {
        const result = {
          turnId,
          threadId,
          title: null,
          outputText: '',
          outputState: 'partial',
          previewText,
          finalSource: progressState.finalAnswerText ? 'progress_only' : 'commentary_only',
          status: null,
        };
        this.logDebug('turn_wait_return', summarizeTurnResultForDebug(result));
        return result;
      }
      this.logDebug('turn_wait_error', {
        threadId,
        turnId,
        pollCount,
        reason: 'overall_timeout_without_preview',
      });
      throw new Error(`Timed out waiting for Codex turn ${turnId}`);
    } finally {
      this.clearApprovedExecutionsForTurn({ threadId, turnId });
      this.off('notification', onNotification);
      this.off('approval_request', onApprovalEvent);
    }
  }
}

function serializeCollaborationMode({ collaborationMode, model, effort, developerInstructions = '' }: any) {
  if (!collaborationMode) {
    return null;
  }
  const settings: any = {
    model,
    developer_instructions: developerInstructions,
  };
  if (effort) {
    settings.reasoning_effort = effort;
  }
  if (collaborationMode === 'default') {
    return {
      mode: 'default',
      settings,
    };
  }
  return {
    mode: collaborationMode,
    settings,
  };
}

export function createNoopLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

export function createStderrLogger({
  envVar = 'CODEX_NATIVE_API_DEBUG',
}: {
  envVar?: string;
} = {}) {
  if (process.env[envVar] !== '1') {
    return createNoopLogger();
  }
  return {
    debug(message: string) {
      writeSequencedStderrLine(message);
    },
    info(message: string) {
      writeSequencedStderrLine(message);
    },
    warn(message: string) {
      writeSequencedStderrLine(message);
    },
    error(message: string) {
      writeSequencedStderrLine(message);
    },
  };
}

function summarizeTurnInput(input: CodexTurnInput[]) {
  return input.map((item) => {
    if (item.type === 'text') {
      return {
        type: item.type,
        textPreview: truncateDebugText(item.text, 160),
      };
    }
    return {
      type: item.type,
      path: item.path,
    };
  });
}

function summarizeRpcParams(method: string, params: any) {
  switch (method) {
    case 'thread/goal/get':
    case 'thread/goal/clear':
    case 'thread/archive':
    case 'thread/unarchive':
      return {
        threadId: String(params?.threadId ?? ''),
      };
    case 'thread/goal/set':
      return {
        threadId: String(params?.threadId ?? ''),
        objective: typeof params?.objective === 'string' ? params.objective : null,
        status: typeof params?.status === 'string' ? params.status : null,
      };
    case 'thread/read':
      return {
        threadId: String(params?.threadId ?? ''),
        includeTurns: Boolean(params?.includeTurns),
      };
    case 'thread/start':
      return {
        cwd: params?.cwd ?? null,
        title: params?.title ?? null,
        model: params?.model ?? null,
        serviceTier: params?.serviceTier ?? null,
        sandbox: params?.sandbox ?? null,
        approvalPolicy: params?.approvalPolicy ?? null,
        ephemeral: params?.ephemeral ?? null,
      };
    case 'turn/start':
      return {
        threadId: String(params?.threadId ?? ''),
        cwd: params?.cwd ?? null,
        model: params?.model ?? null,
        serviceTier: params?.serviceTier ?? null,
        effort: params?.effort ?? null,
        approvalPolicy: params?.approvalPolicy ?? null,
        sandboxPolicy: params?.sandboxPolicy ?? null,
        collaborationMode: params?.collaborationMode?.mode ?? null,
        inputSummary: summarizeTurnInput(Array.isArray(params?.input) ? params.input : []),
      };
    case 'turn/interrupt':
      return {
        threadId: String(params?.threadId ?? ''),
        turnId: String(params?.turnId ?? ''),
      };
    default:
      return summarizePlainObject(params);
  }
}

function summarizeRpcResult(method: string, result: any) {
  switch (method) {
    case 'thread/goal/get':
    case 'thread/goal/set':
      return mapThreadGoal(result?.goal ?? null);
    case 'thread/goal/clear':
      return {
        cleared: result?.cleared === true,
      };
    case 'thread/archive':
      return {};
    case 'thread/unarchive':
      return {
        threadId: String(result?.thread?.id ?? ''),
      };
    case 'thread/read':
      return summarizeThreadReadResult(result?.thread ?? null);
    case 'thread/start':
      return {
        threadId: String(result?.thread?.id ?? ''),
        cwd: result?.cwd ?? null,
      };
    case 'turn/start':
      return {
        turnId: String(result?.turn?.id ?? ''),
        status: String(result?.turn?.status ?? ''),
      };
    default:
      return summarizePlainObject(result);
  }
}

function summarizeNotificationMessage(message: any) {
  return {
    method: String(message?.method ?? ''),
    id: 'id' in (message ?? {}) ? String(message.id ?? '') : null,
    threadId: extractThreadIdFromNotification(message),
    turnId: extractNotificationTurnId(message?.params ?? null),
    itemId: extractItemId(message?.params ?? null),
    outputKind: typeof message?.params?.item?.output_kind === 'string'
      ? message.params.item.output_kind
      : null,
  };
}

function summarizeThreadReadResult(thread: any) {
  if (!thread) {
    return null;
  }
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  return {
    threadId: String(thread?.id ?? ''),
    title: typeof thread?.name === 'string' ? thread.name : null,
    path: typeof thread?.path === 'string' ? thread.path : null,
    turnCount: turns.length,
    turns: turns.slice(-3).map((turn) => summarizeTurnSnapshot(turn)),
  };
}

function summarizeTurnSnapshot(turn: any) {
  if (!turn) {
    return null;
  }
  const items = Array.isArray(turn?.items) ? turn.items : [];
  return {
    id: String(turn?.id ?? ''),
    status: String(turn?.status ?? ''),
    itemCount: items.length,
    visibleItemCount: items.filter((item) => isAssistantVisibleItem(item) || isUserVisibleItem(item)).length,
    outputTextPresent: Boolean(extractTurnOutputText(turn)),
    outputArtifactCount: extractTurnOutputArtifacts(turn).length,
    error: typeof turn?.error === 'string' ? turn.error : null,
  };
}

function summarizeProgressState(progressState: Partial<ProgressState>) {
  return {
    commentaryLength: String(progressState?.commentaryText ?? '').length,
    finalAnswerLength: String(progressState?.finalAnswerText ?? '').length,
    sawAssistantActivity: Boolean(progressState?.sawAssistantActivity),
    lastAssistantActivityAt: progressState?.lastAssistantActivityAt ?? 0,
  };
}

interface SessionTurnCompletionState {
  hasTaskComplete: boolean;
  lastAgentMessage: string | null;
  toolSuggestionMessage: string | null;
  responseItems: ProviderResponseItem[];
  outputArtifacts: Array<{ kind?: string | null; path?: string | null }>;
  runtimeError: string | null;
}

function summarizeSessionState(
  sessionPath: string | null | undefined,
  sessionState: SessionTurnCompletionState,
) {
  return {
    sessionPath: sessionPath ?? null,
    hasTaskComplete: sessionState.hasTaskComplete,
    lastAgentMessagePreview: truncateDebugText(sessionState.lastAgentMessage, 160),
    toolSuggestionPreview: truncateDebugText(sessionState.toolSuggestionMessage, 160),
    runtimeError: truncateDebugText(sessionState.runtimeError, 160),
    responseItemCount: sessionState.responseItems.length,
    responseItemTypes: sessionState.responseItems
      .map((item) => typeof item?.type === 'string' ? item.type : null)
      .filter((value): value is string => Boolean(value))
      .slice(0, 8),
    outputArtifactCount: sessionState.outputArtifacts.length,
    outputArtifacts: sessionState.outputArtifacts.map((artifact) => ({
      kind: artifact.kind ?? null,
      path: artifact.path ?? null,
    })),
  };
}

function summarizeTurnResultForDebug(result: ProviderTurnResult) {
  return {
    threadId: result.threadId ?? null,
    turnId: result.turnId ?? null,
    status: result.status ?? null,
    outputState: result.outputState ?? null,
    finalSource: result.finalSource ?? null,
    errorMessage: truncateDebugText(result.errorMessage, 160),
    outputTextPreview: truncateDebugText(result.outputText, 160),
    previewTextPreview: truncateDebugText(result.previewText, 160),
    responseItemCount: Array.isArray(result.responseItems) ? result.responseItems.length : 0,
    responseItemTypes: Array.isArray(result.responseItems)
      ? result.responseItems
        .map((item) => typeof item?.type === 'string' ? item.type : null)
        .filter((value): value is string => Boolean(value))
        .slice(0, 8)
      : [],
    outputArtifactCount: Array.isArray(result.outputArtifacts) ? result.outputArtifacts.length : 0,
    outputArtifacts: Array.isArray(result.outputArtifacts)
      ? result.outputArtifacts.map((artifact) => ({
        kind: artifact.kind ?? null,
        path: artifact.path ?? null,
        caption: truncateDebugText(artifact.caption, 120),
      }))
      : [],
  };
}

function summarizePlainObject(value: any) {
  if (!value || typeof value !== 'object') {
    return value ?? null;
  }
  const summary: Record<string, unknown> = {};
  Object.keys(value).slice(0, 12).forEach((key) => {
    const raw = value[key];
    if (raw == null || typeof raw === 'number' || typeof raw === 'boolean') {
      summary[key] = raw;
      return;
    }
    if (typeof raw === 'string') {
      summary[key] = truncateDebugText(raw, 120);
      return;
    }
    if (Array.isArray(raw)) {
      summary[key] = { length: raw.length };
      return;
    }
    summary[key] = { keys: Object.keys(raw).slice(0, 8) };
  });
  return summary;
}

function extractThreadIdFromNotification(message: any): string | null {
  const params = message?.params ?? null;
  if (typeof params?.threadId === 'string') {
    return params.threadId;
  }
  if (typeof params?.conversationId === 'string') {
    return params.conversationId;
  }
  if (typeof params?.item?.threadId === 'string') {
    return params.item.threadId;
  }
  if (typeof params?.event?.threadId === 'string') {
    return params.event.threadId;
  }
  return null;
}

function isThreadMaterializationPendingError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /not materialized yet/i.test(message)
    || /includeTurns is unavailable before first user message/i.test(message)
    || /empty session file/i.test(message);
}

function isIncludeTurnsUnsupportedError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /ephemeral threads do not support includeTurns/i.test(message);
}

function isRequestTimeoutError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Timed out waiting for Codex JSON-RPC response to /i.test(message);
}

function isTerminalNotificationForThread(
  notification: any,
  threadId: string,
  turnId: string,
): boolean {
  if (extractThreadIdFromNotification(notification) !== threadId) {
    return false;
  }
  const method = String(notification?.method ?? '').replace(/[^a-z]/gi, '').toLowerCase();
  if (method === 'turncompleted') {
    return true;
  }
  if (method === 'itemcompleted') {
    const notificationTurnId = extractNotificationTurnId(notification?.params ?? null);
    return !notificationTurnId || notificationTurnId === turnId;
  }
  return false;
}

function computeTerminalSettleMs(timeoutMs) {
  const numericTimeout = Number(timeoutMs || 0);
  if (!Number.isFinite(numericTimeout) || numericTimeout <= 0) {
    return 60_000;
  }
  return Math.min(60_000, Math.max(10_000, Math.floor(numericTimeout / 2)));
}

function computeApprovedExecutionIdleLimitMs(timeoutMs) {
  const numericTimeout = Number(timeoutMs || 0);
  if (!Number.isFinite(numericTimeout) || numericTimeout <= 0) {
    return 300_000;
  }
  return Math.min(Math.max(180_000, Math.floor(numericTimeout / 3)), 300_000);
}

function buildApprovedExecutionStallError({
  entry,
  idleMs,
}: {
  entry: ApprovedExecution;
  idleMs: number;
}) {
  const idleSeconds = Math.max(1, Math.round(idleMs / 1000));
  const kindLabel = entry.kind === 'command'
    ? 'command'
    : entry.kind === 'file_change'
      ? 'file change'
      : 'permission grant';
  const commandSuffix = entry.command
    ? ` (${truncateDebugText(entry.command, 120)})`
    : '';
  if (entry.signalCount === 0) {
    return `Approval was accepted, but the approved ${kindLabel}${commandSuffix} produced no follow-up signal for ${idleSeconds} seconds. The provider may be stuck; use /retry to try again.`;
  }
  return `Approval was accepted, but the approved ${kindLabel}${commandSuffix} stopped making progress after ${entry.lastSignalKind} and stayed idle for ${idleSeconds} seconds. The provider may be stuck; use /retry to try again.`;
}

function extractTurnOutputArtifacts(turn) {
  const seen = new Set<string>();
  return turn.items
    .flatMap((item) => extractOutputArtifactFromItem(item))
    .filter((item) => {
      const key = `${item.kind}:${item.path}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function normalizeLegacyImageMedia(artifacts) {
  return artifacts.filter((artifact) => artifact?.kind === 'image');
}

function extractOutputArtifactFromItem(item) {
  const savedPath = typeof item?.savedPath === 'string' ? item.savedPath.trim() : '';
  if (savedPath && fs.existsSync(savedPath)) {
    return [buildArtifactFromFilePath(savedPath)];
  }
  const result = typeof item?.result === 'string' ? item.result.trim() : '';
  if (result && isLocalFilePath(result) && fs.existsSync(result)) {
    return [buildArtifactFromFilePath(result)];
  }
  if (isRemoteImageUrl(result)) {
    return [{
      kind: 'image' as const,
      path: result,
      displayName: path.basename(new URL(result).pathname) || null,
      mimeType: inferMimeTypeFromPath(result),
      sizeBytes: null,
      caption: null,
      source: 'provider_native' as const,
      turnId: null,
    }];
  }
  if (String(item?.type ?? '') === 'imageGeneration') {
    const inlineImage = decodeInlineImagePayload(result);
    if (inlineImage) {
      const outputPath = materializeInlineImage(savedPath, inlineImage);
      if (outputPath) {
        return [buildArtifactFromFilePath(outputPath)];
      }
    }
  }
  return [];
}

function buildArtifactFromFilePath(filePath) {
  const normalizedPath = String(filePath ?? '').trim();
  const kind = inferArtifactKindFromPath(normalizedPath);
  let sizeBytes = null;
  try {
    sizeBytes = fs.statSync(normalizedPath).size;
  } catch {
    sizeBytes = null;
  }
  return {
    kind,
    path: normalizedPath,
    displayName: path.basename(normalizedPath) || null,
    mimeType: inferMimeTypeFromPath(normalizedPath),
    sizeBytes,
    caption: null,
    source: 'provider_native' as const,
    turnId: null,
  };
}

function inferArtifactKindFromPath(filePath) {
  const extension = path.extname(String(filePath ?? '')).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(extension)) {
    return 'image';
  }
  if (['.mp4', '.mov', '.mkv', '.webm'].includes(extension)) {
    return 'video';
  }
  if (['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.amr'].includes(extension)) {
    return 'audio';
  }
  return 'file';
}

function inferMimeTypeFromPath(filePath) {
  const extension = path.extname(String(filePath ?? '')).toLowerCase();
  return ({
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.html': 'text/html',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.tgz': 'application/gzip',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
  })[extension] ?? null;
}

function isLocalFilePath(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return false;
  }
  if (/^(?:https?:)?\/\//iu.test(normalized)) {
    return false;
  }
  if (/^data:/iu.test(normalized)) {
    return false;
  }
  return path.isAbsolute(normalized);
}

function extractAllAssistantVisibleText(turn) {
  return turn.items
    .filter((item) => isAssistantVisibleItem(item))
    .map((item) => item.text)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function isRemoteImageUrl(value) {
  return /^https?:\/\/\S+/iu.test(String(value ?? ''));
}

function decodeInlineImagePayload(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const dataUrlMatch = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/iu);
  const base64 = dataUrlMatch?.[2] ?? (looksLikeBase64Image(raw) ? raw : '');
  if (!base64) {
    return null;
  }
  try {
    const buffer = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

function looksLikeBase64Image(value) {
  const normalized = String(value ?? '').replace(/\s+/g, '');
  if (!normalized || normalized.length < 64 || normalized.length % 4 !== 0) {
    return false;
  }
  return /^[A-Za-z0-9+/=]+$/u.test(normalized);
}

function materializeInlineImage(savedPath, buffer) {
  if (savedPath) {
    try {
      fs.mkdirSync(path.dirname(savedPath), { recursive: true });
      fs.writeFileSync(savedPath, buffer);
      return savedPath;
    } catch {
      return null;
    }
  }
  try {
    const fallbackPath = path.join(os.tmpdir(), `codex-native-api-inline-image-${Date.now()}.png`);
    fs.writeFileSync(fallbackPath, buffer);
    return fallbackPath;
  } catch {
    return null;
  }
}

function inspectTurnCompletionFromSessionPath(sessionPath, turnId) {
  if (!sessionPath || !turnId || !fs.existsSync(sessionPath)) {
    return emptySessionTurnCompletionState();
  }
  try {
    const lines = fs.readFileSync(sessionPath, 'utf8').split('\n');
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]?.trim();
      if (!line) {
        continue;
      }
      let entry = null;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = entry?.payload ?? null;
      if (entry?.type !== 'event_msg' || payload?.type !== 'task_complete') {
        continue;
      }
      if (String(payload.turn_id ?? '') !== turnId) {
        continue;
      }
      const responseItems = extractSessionResponseItemsForTurn(lines, index, turnId);
      const lastAgentMessage = selectSessionAgentMessage(
        responseItems,
        extractTextCandidate(payload.last_agent_message)?.trim() || null,
      );
      const toolSuggestionMessage = findSessionToolSuggestionMessageForTurn(lines, index, turnId);
      const runtimeError = findSessionRuntimeErrorForTurn(lines, index, turnId);
      return inspectSessionTurnArtifacts(lines, index, {
        hasTaskComplete: true,
        lastAgentMessage,
        toolSuggestionMessage,
        responseItems,
        runtimeError,
      });
    }
  } catch {
    return emptySessionTurnCompletionState();
  }
  return emptySessionTurnCompletionState();
}

function findSessionToolSuggestionMessageForTurn(lines: string[], taskCompleteIndex: number, turnId: string): string | null {
  for (let index = taskCompleteIndex - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let entry: any = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = entry?.payload ?? null;
    if (entry?.type === 'turn_context' && String(payload?.turn_id ?? '') === turnId) {
      break;
    }
    if (entry?.type === 'event_msg' && payload?.type === 'task_started' && String(payload?.turn_id ?? '') === turnId) {
      break;
    }
    if (entry?.type !== 'response_item') {
      continue;
    }
    const suggestion = extractToolSuggestResponseItemText(payload);
    if (suggestion) {
      return suggestion;
    }
  }
  return null;
}

function extractToolSuggestResponseItemText(payload: any): string | null {
  if (String(payload?.type ?? '') !== 'function_call' || String(payload?.name ?? '') !== 'tool_suggest') {
    return null;
  }
  let parsedArguments: any = null;
  if (typeof payload?.arguments === 'string') {
    try {
      parsedArguments = JSON.parse(payload.arguments);
    } catch {
      parsedArguments = null;
    }
  } else if (payload?.arguments && typeof payload.arguments === 'object') {
    parsedArguments = payload.arguments;
  }
  const reason = extractTextCandidate(parsedArguments?.suggest_reason)?.trim() || '';
  const toolType = String(parsedArguments?.tool_type ?? '').trim().toLowerCase();
  if (!reason) {
    return null;
  }
  const prefix = toolType === 'connector'
    ? '当前缺少所需连接。'
    : toolType === 'plugin'
      ? '当前缺少所需插件。'
      : '当前缺少所需扩展能力。';
  return `${prefix}\n${reason}\n请先完成对应的安装或认证，再重试原请求。`;
}

function findSessionRuntimeErrorForTurn(lines: string[], taskCompleteIndex: number, turnId: string): string | null {
  for (let index = taskCompleteIndex - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let entry: any = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = entry?.payload ?? null;
    if (entry?.type === 'turn_context') {
      if (String(payload?.turn_id ?? '') === turnId) {
        break;
      }
      continue;
    }
    if (entry?.type !== 'event_msg') {
      continue;
    }
    const eventType = String(payload?.type ?? '');
    if (eventType === 'task_started' && String(payload?.turn_id ?? '') === turnId) {
      break;
    }
    if (eventType === 'token_count') {
      const rateLimitError = describeSessionRateLimitError(payload?.rate_limits ?? payload?.rateLimits ?? null);
      if (rateLimitError) {
        return rateLimitError;
      }
    }
    const message = extractSessionErrorMessage(payload);
    if (message) {
      return message;
    }
  }
  return null;
}

function extractSessionErrorMessage(payload: any): string | null {
  const eventType = String(payload?.type ?? '').toLowerCase();
  if (!/error|failed|failure/.test(eventType)) {
    return null;
  }
  return extractTextCandidate(payload?.message)
    ?? extractTextCandidate(payload?.error)
    ?? extractTextCandidate(payload);
}

function describeSessionRateLimitError(rateLimits: any): string | null {
  if (!rateLimits || typeof rateLimits !== 'object') {
    return null;
  }
  const limitId = normalizeRateLimitString(rateLimits.limit_id ?? rateLimits.limitId) ?? 'codex';
  const credits = rateLimits.credits && typeof rateLimits.credits === 'object'
    ? rateLimits.credits
    : null;
  if (credits) {
    const hasCredits = normalizeRateLimitBoolean(credits.has_credits ?? credits.hasCredits);
    const unlimited = normalizeRateLimitBoolean(credits.unlimited) === true;
    const balance = normalizeRateLimitString(credits.balance);
    if (hasCredits === false && !unlimited) {
      return `Codex subscription credits are exhausted (${limitId} balance ${balance ?? '0'}).`;
    }
  }
  const reachedType = normalizeRateLimitString(rateLimits.rate_limit_reached_type ?? rateLimits.rateLimitReachedType);
  if (reachedType) {
    return `Codex usage limit reached (${limitId}: ${reachedType}).`;
  }
  const primaryUsed = normalizeRateLimitNumber(rateLimits.primary?.used_percent ?? rateLimits.primary?.usedPercent);
  if (primaryUsed !== null && primaryUsed >= 100) {
    return `Codex usage limit reached (${limitId} primary ${Math.round(primaryUsed)}%).`;
  }
  const secondaryUsed = normalizeRateLimitNumber(rateLimits.secondary?.used_percent ?? rateLimits.secondary?.usedPercent);
  if (secondaryUsed !== null && secondaryUsed >= 100) {
    return `Codex usage limit reached (${limitId} weekly ${Math.round(secondaryUsed)}%).`;
  }
  return null;
}

function normalizeRateLimitString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeRateLimitBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return null;
}

function normalizeRateLimitNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function inspectSessionTurnArtifacts(
  lines,
  taskCompleteIndex,
  state: Omit<SessionTurnCompletionState, 'outputArtifacts'>,
): SessionTurnCompletionState {
  const outputArtifacts = [];
  const seenArtifacts = new Set<string>();
  for (let index = taskCompleteIndex - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let entry = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = entry?.payload ?? null;
    if (entry?.type === 'event_msg' && payload?.type === 'task_started') {
      break;
    }
    if (entry?.type !== 'event_msg' || payload?.type !== 'image_generation_end') {
      continue;
    }
    const savedPath = typeof payload?.saved_path === 'string' ? payload.saved_path.trim() : '';
    if (!savedPath || !fs.existsSync(savedPath)) {
      continue;
    }
    const artifact = buildArtifactFromFilePath(savedPath);
    const key = `${artifact.kind}:${artifact.path}`;
    if (seenArtifacts.has(key)) {
      continue;
    }
    seenArtifacts.add(key);
    outputArtifacts.unshift(artifact);
  }
  return {
    hasTaskComplete: state.hasTaskComplete,
    lastAgentMessage: state.lastAgentMessage || state.toolSuggestionMessage || null,
    toolSuggestionMessage: state.toolSuggestionMessage ?? null,
    responseItems: state.responseItems,
    runtimeError: state.runtimeError ?? null,
    outputArtifacts,
  };
}

function buildSessionTaskCompleteResult({
  turnId,
  threadId,
  title,
  status,
  previewText,
  sessionState,
}) {
  return {
    turnId,
    threadId,
    title,
    outputText: sessionState.lastAgentMessage ?? '',
    responseItems: sessionState.responseItems,
    outputArtifacts: sessionState.outputArtifacts,
    outputMedia: normalizeLegacyImageMedia(sessionState.outputArtifacts),
    outputState: 'complete',
    previewText,
    finalSource: sessionState.outputArtifacts.length > 0
      ? 'session_task_complete_media'
      : 'session_task_complete',
    status,
  };
}

function emptySessionTurnCompletionState(): SessionTurnCompletionState {
  return {
    hasTaskComplete: false,
    lastAgentMessage: null,
    toolSuggestionMessage: null,
    responseItems: [],
    outputArtifacts: [],
    runtimeError: null,
  };
}

function extractSessionResponseItemsForTurn(
  lines: string[],
  taskCompleteIndex: number,
  turnId: string,
): ProviderResponseItem[] {
  const responseItems: ProviderResponseItem[] = [];
  for (let index = taskCompleteIndex - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let entry: any = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = entry?.payload ?? null;
    if (entry?.type === 'turn_context' && String(payload?.turn_id ?? '') === turnId) {
      break;
    }
    if (entry?.type === 'event_msg' && payload?.type === 'task_started' && String(payload?.turn_id ?? '') === turnId) {
      break;
    }
    if (entry?.type !== 'response_item' || !payload || typeof payload !== 'object') {
      continue;
    }
    responseItems.unshift(cloneSessionResponseItem(payload));
  }
  return responseItems;
}

function selectSessionAgentMessage(
  responseItems: ProviderResponseItem[],
  fallback: string | null,
): string | null {
  for (let index = responseItems.length - 1; index >= 0; index -= 1) {
    const payload = responseItems[index] as Record<string, unknown>;
    if (String(payload?.type ?? '') !== 'message' || String(payload?.role ?? '') !== 'assistant') {
      continue;
    }
    const phase = String(payload?.phase ?? '');
    if (phase && phase !== 'final_answer') {
      continue;
    }
    const text = extractTextCandidate(payload?.content)?.trim() || null;
    if (text) {
      return text;
    }
  }
  return fallback;
}

function cloneSessionResponseItem(payload: Record<string, unknown>): ProviderResponseItem {
  if (typeof structuredClone === 'function') {
    return structuredClone(payload);
  }
  return JSON.parse(JSON.stringify(payload));
}

function attachSessionResponseItems(
  result: ProviderTurnResult,
  sessionPath: string | null | undefined,
): ProviderTurnResult {
  if (!result.turnId || !sessionPath) {
    return result;
  }
  const sessionState = inspectTurnCompletionFromSessionPath(sessionPath, result.turnId);
  if (sessionState.responseItems.length === 0) {
    return result;
  }
  return {
    ...result,
    responseItems: sessionState.responseItems,
  };
}

function rememberCodexStderrLine(stderrTail: string[], text: string): void {
  stderrTail.push(text);
  while (stderrTail.length > 10) {
    stderrTail.shift();
  }
}

function createCodexAppServerLaunchSpec({
  command,
  args,
  platform,
}: {
  command: string;
  args: string[];
  platform: NodeJS.Platform;
}): {
  command: string;
  args?: string[] | null;
  options?: Record<string, unknown>;
  displayCommand: string;
} {
  if (platform === 'win32' && /\.(cmd|bat)$/iu.test(command)) {
    return {
      command: buildWindowsShellCommandLine([command, ...args]),
      args: null,
      options: {
        shell: true,
        windowsHide: true,
      },
      displayCommand: command,
    };
  }
  return {
    command,
    args,
    displayCommand: command,
  };
}

function createCodexLaunchError({
  command,
  error,
  platform,
}: {
  command: string;
  error: unknown;
  platform: NodeJS.Platform;
}): Error {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  if (code === 'ENOENT' || /spawn .* ENOENT/i.test(message)) {
    const windowsHint = platform === 'win32'
      ? ' Ensure the Codex CLI is installed and reachable on PATH, or set CODEX_REAL_BIN to the full path of codex.exe or codex.cmd.'
      : ' Ensure the Codex CLI is installed and reachable on PATH.';
    return new Error(`Failed to launch Codex app-server with "${command}": command not found.${windowsHint}`);
  }
  return new Error(`Failed to launch Codex app-server with "${command}": ${message}`);
}

function createCodexAppServerExitedError({
  command,
  exitCode,
  stderrTail,
}: {
  command: string;
  exitCode: number;
  stderrTail: string[];
}): Error {
  const detail = stderrTail.length > 0
    ? ` Last stderr: ${stderrTail.join(' | ')}`
    : '';
  return new Error(`Codex app-server exited before opening its WebSocket (command: "${command}", exit code: ${exitCode}).${detail}`);
}

function createCodexConnectTimeoutError({
  command,
  url,
  stderrTail,
}: {
  command: string;
  url: string;
  stderrTail: string[];
}): Error {
  const detail = stderrTail.length > 0
    ? ` Last stderr: ${stderrTail.join(' | ')}`
    : '';
  return new Error(`Timed out connecting to ${url} after launching "${command}".${detail}`);
}

function buildWindowsShellCommandLine(parts: string[]): string {
  return parts.map(quoteWindowsShellArgument).join(' ');
}

function quoteWindowsShellArgument(value: string): string {
  const normalized = String(value ?? '');
  if (!normalized) {
    return '""';
  }
  if (!/[\s"]/u.test(normalized)) {
    return normalized;
  }
  return `"${normalized.replace(/"/g, '""')}"`;
}

async function reservePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to reserve TCP port'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForChildExit(child: ChildProcess | null, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!child || child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for Codex child process to exit'));
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
    };
    child.on('exit', onExit);
  });
}

async function terminateChildProcess(child: ChildProcess, platform: NodeJS.Platform): Promise<void> {
  if (platform === 'win32' && typeof child.pid === 'number') {
    await terminateWindowsProcessTree(child.pid);
    return;
  }
  child.kill('SIGTERM');
  await waitForChildExit(child, 5000).catch(() => {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
    return waitForChildExit(child, 2000).catch(() => {});
  });
}

function terminateWindowsProcessTree(pid: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', () => {
      resolve();
    });
    killer.on('exit', () => {
      resolve();
    });
  });
}

export { readCodexAccountIdentity };
