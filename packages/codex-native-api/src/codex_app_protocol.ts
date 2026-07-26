import type {
  ProviderApprovalRequest,
  ProviderAppInfo,
  ProviderMcpServerStatus,
  ProviderPluginAppSummary,
  ProviderPluginDetail,
  ProviderPluginLoadError,
  ProviderPluginMarketplace,
  ProviderPluginSkillSummary,
  ProviderPluginSummary,
  ProviderSkillError,
  ProviderSkillInfo,
  ProviderSkillToolDependency,
  ProviderThreadGoal,
  ProviderUsageReport,
} from './provider.js';

export function normalizeNullableString(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry ?? '').trim()).filter(Boolean)
    : [];
}

export function normalizeOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function formatConfigKeyPath(segments: string[]): string {
  return segments
    .map((segment) => {
      const value = String(segment ?? '').trim();
      if (/^[A-Za-z0-9_]+$/u.test(value)) {
        return value;
      }
      return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
    })
    .join('.');
}

export function normalizeFeatureList(features: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    if (typeof feature !== 'string') {
      continue;
    }
    const value = feature.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export function normalizeProtocolTimestamp(value: unknown): number {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

export function normalizeTurnStatusKey(status: unknown): string {
  return String(status ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, '');
}

const normalizeBoolean = normalizeOptionalBoolean;
const normalizeTimestamp = normalizeProtocolTimestamp;

export interface CodexAppRateLimitsResponse {
  rateLimits?: CodexAppRateLimitSnapshot | null;
  rateLimitsByLimitId?: Record<string, CodexAppRateLimitSnapshot> | null;
}

export interface CodexAppRateLimitSnapshot {
  limitId?: string | null;
  limitName?: string | null;
  planType?: string | null;
  primary?: CodexAppRateLimitWindow | null;
  secondary?: CodexAppRateLimitWindow | null;
  credits?: CodexAppCreditsSnapshot | null;
}

export interface CodexAppRateLimitWindow {
  usedPercent?: number | null;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}

export interface CodexAppCreditsSnapshot {
  balance?: string | null;
  hasCredits?: boolean | null;
  unlimited?: boolean | null;
}

export interface CodexAppSkillToolDependency {
  type?: string | null;
  value?: string | null;
  command?: string | null;
  description?: string | null;
  transport?: string | null;
  url?: string | null;
}

export interface CodexAppSkillInterface {
  displayName?: string | null;
  defaultPrompt?: string | null;
  shortDescription?: string | null;
  brandColor?: string | null;
}

export interface CodexAppSkillMetadata {
  name?: string | null;
  description?: string | null;
  enabled?: boolean | null;
  path?: string | null;
  scope?: string | null;
  shortDescription?: string | null;
  interface?: CodexAppSkillInterface | null;
  dependencies?: {
    tools?: CodexAppSkillToolDependency[] | null;
  } | null;
}

export interface CodexAppSkillErrorInfo {
  path?: string | null;
  message?: string | null;
}

export interface CodexAppPluginInterface {
  brandColor?: string | null;
  capabilities?: string[] | null;
  category?: string | null;
  defaultPrompt?: string[] | null;
  developerName?: string | null;
  displayName?: string | null;
  longDescription?: string | null;
  shortDescription?: string | null;
  websiteUrl?: string | null;
}

export interface CodexAppPluginSourceLocal {
  type?: 'local' | string | null;
  path?: string | null;
}

export interface CodexAppPluginSourceMarketplace {
  type?: 'marketplace' | string | null;
  marketplaceName?: string | null;
}

export type CodexAppPluginSource = CodexAppPluginSourceLocal | CodexAppPluginSourceMarketplace | null;

export interface CodexAppPluginSummary {
  id?: string | null;
  name?: string | null;
  installed?: boolean | null;
  enabled?: boolean | null;
  installPolicy?: string | null;
  authPolicy?: string | null;
  interface?: CodexAppPluginInterface | null;
  source?: CodexAppPluginSource;
}

export interface CodexAppPluginMarketplace {
  name?: string | null;
  path?: string | null;
  interface?: {
    displayName?: string | null;
  } | null;
  plugins?: CodexAppPluginSummary[] | null;
}

export interface CodexAppMarketplaceLoadError {
  marketplacePath?: string | null;
  message?: string | null;
}

export interface CodexAppPluginAppSummary {
  id?: string | null;
  name?: string | null;
  needsAuth?: boolean | null;
  description?: string | null;
  installUrl?: string | null;
}

export interface CodexAppPluginSkillInterface {
  displayName?: string | null;
}

export interface CodexAppPluginSkillSummary {
  name?: string | null;
  path?: string | null;
  description?: string | null;
  enabled?: boolean | null;
  shortDescription?: string | null;
  interface?: CodexAppPluginSkillInterface | null;
}

export interface CodexAppPluginDetail {
  summary?: CodexAppPluginSummary | null;
  marketplaceName?: string | null;
  marketplacePath?: string | null;
  description?: string | null;
  apps?: CodexAppPluginAppSummary[] | null;
  mcpServers?: string[] | null;
  skills?: CodexAppPluginSkillSummary[] | null;
}

export interface CodexAppInfo {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  installUrl?: string | null;
  isAccessible?: boolean | null;
  isEnabled?: boolean | null;
  pluginDisplayNames?: string[] | null;
  appMetadata?: {
    categories?: string[] | null;
    developer?: string | null;
  } | null;
  branding?: {
    developer?: string | null;
  } | null;
}

export interface CodexAppMcpServerStatus {
  name?: string | null;
  isEnabled?: boolean | null;
  authStatus?: string | null;
  resourceTemplates?: unknown[] | null;
  resources?: unknown[] | null;
  tools?: Record<string, unknown> | null;
}

export interface PendingApproval {
  rpcId: string;
  rpcResponseId: string | number;
  transportKind: 'v2_command' | 'v2_file_change' | 'v2_permissions' | 'legacy_exec' | 'legacy_apply_patch';
  request: ProviderApprovalRequest;
}

export interface ApprovedExecution {
  requestId: string;
  kind: ProviderApprovalRequest['kind'];
  threadId: string;
  turnId: string | null;
  itemId: string | null;
  command: string | null;
  approvedAt: number;
  lastSignalAt: number;
  lastSignalKind: string;
  signalCount: number;
  completedAt: number | null;
  lastObservedTurnSnapshotKey: string | null;
}

const TERMINAL_TURN_STATUS_KEYS = new Set([
  'completed',
  'complete',
  'succeeded',
  'success',
  'finished',
  'failed',
  'error',
  'timedout',
  'timeout',
  'interrupted',
  'cancelled',
  'canceled',
  'aborted',
]);

export function mapPendingApproval(message: any): PendingApproval | null {
  const rpcId = String(message?.id ?? '').trim();
  const method = String(message?.method ?? '').trim();
  if (!rpcId || !method) {
    return null;
  }
  const rpcResponseId = typeof message?.id === 'number' ? message.id : rpcId;
  switch (method) {
    case 'item/commandExecution/requestApproval':
      return {
        rpcId,
        rpcResponseId,
        transportKind: 'v2_command',
        request: mapCommandExecutionApprovalRequest(rpcId, message.params),
      };
    case 'item/fileChange/requestApproval':
      return {
        rpcId,
        rpcResponseId,
        transportKind: 'v2_file_change',
        request: mapFileChangeApprovalRequest(rpcId, message.params),
      };
    case 'item/permissions/requestApproval':
      return {
        rpcId,
        rpcResponseId,
        transportKind: 'v2_permissions',
        request: mapPermissionsApprovalRequest(rpcId, message.params),
      };
    case 'execCommandApproval':
      return {
        rpcId,
        rpcResponseId,
        transportKind: 'legacy_exec',
        request: mapLegacyExecApprovalRequest(rpcId, message.params),
      };
    case 'applyPatchApproval':
      return {
        rpcId,
        rpcResponseId,
        transportKind: 'legacy_apply_patch',
        request: mapLegacyApplyPatchApprovalRequest(rpcId, message.params),
      };
    default:
      return null;
  }
}

export function mapCommandExecutionApprovalRequest(requestId: string, params: any): ProviderApprovalRequest {
  return {
    requestId,
    kind: 'command',
    threadId: String(params?.threadId ?? ''),
    turnId: normalizeNullableString(params?.turnId),
    itemId: normalizeNullableString(params?.itemId),
    reason: normalizeNullableString(params?.reason),
    command: normalizeNullableString(params?.command),
    cwd: normalizeNullableString(params?.cwd),
    availableDecisionKeys: Array.isArray(params?.availableDecisions)
      ? params.availableDecisions.map(normalizeApprovalDecisionKey).filter(Boolean)
      : [],
    execPolicyAmendment: Array.isArray(params?.proposedExecpolicyAmendment)
      ? params.proposedExecpolicyAmendment
        .map((entry: unknown) => String(entry ?? '').trim())
        .filter(Boolean)
      : null,
    networkPermission: normalizeBoolean(params?.additionalPermissions?.network?.enabled),
    fileReadPermissions: normalizeStringList(params?.additionalPermissions?.fileSystem?.read),
    fileWritePermissions: normalizeStringList(params?.additionalPermissions?.fileSystem?.write),
  };
}

export function mapFileChangeApprovalRequest(requestId: string, params: any): ProviderApprovalRequest {
  return {
    requestId,
    kind: 'file_change',
    threadId: String(params?.threadId ?? ''),
    turnId: normalizeNullableString(params?.turnId),
    itemId: normalizeNullableString(params?.itemId),
    reason: normalizeNullableString(params?.reason),
    grantRoot: normalizeNullableString(params?.grantRoot),
    availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
  };
}

export function mapPermissionsApprovalRequest(requestId: string, params: any): ProviderApprovalRequest {
  return {
    requestId,
    kind: 'permissions',
    threadId: String(params?.threadId ?? ''),
    turnId: normalizeNullableString(params?.turnId),
    itemId: normalizeNullableString(params?.itemId),
    reason: normalizeNullableString(params?.reason),
    networkPermission: normalizeBoolean(params?.permissions?.network?.enabled),
    fileReadPermissions: normalizeStringList(params?.permissions?.fileSystem?.read),
    fileWritePermissions: normalizeStringList(params?.permissions?.fileSystem?.write),
    availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
  };
}

export function mapLegacyExecApprovalRequest(requestId: string, params: any): ProviderApprovalRequest {
  return {
    requestId,
    kind: 'command',
    threadId: String(params?.conversationId ?? ''),
    turnId: null,
    itemId: normalizeNullableString(params?.approvalId) ?? normalizeNullableString(params?.callId),
    reason: normalizeNullableString(params?.reason),
    command: Array.isArray(params?.command)
      ? params.command.map((entry: unknown) => String(entry ?? '').trim()).filter(Boolean).join(' ')
      : null,
    cwd: normalizeNullableString(params?.cwd),
    availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
  };
}

export function mapLegacyApplyPatchApprovalRequest(requestId: string, params: any): ProviderApprovalRequest {
  return {
    requestId,
    kind: 'file_change',
    threadId: String(params?.conversationId ?? ''),
    turnId: null,
    itemId: normalizeNullableString(params?.callId),
    reason: normalizeNullableString(params?.reason),
    fileChanges: params?.fileChanges && typeof params.fileChanges === 'object'
      ? Object.keys(params.fileChanges).filter(Boolean)
      : [],
    grantRoot: normalizeNullableString(params?.grantRoot),
    availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
  };
}

export function buildApprovalResponseResult(pending: PendingApproval, option: 1 | 2 | 3): any {
  switch (pending.transportKind) {
    case 'v2_command':
      return {
        decision: buildV2CommandApprovalDecision(pending.request, option),
      };
    case 'v2_file_change':
      return {
        decision: buildV2FileChangeApprovalDecision(option),
      };
    case 'v2_permissions':
      return buildV2PermissionsApprovalDecision(pending.request, option);
    case 'legacy_exec':
    case 'legacy_apply_patch':
      return {
        decision: buildLegacyReviewDecision(option),
      };
    default:
      throw new Error(`Unsupported approval transport: ${pending.transportKind}`);
  }
}

export function createApprovedExecution(
  pending: PendingApproval,
  option: 1 | 2 | 3,
  now: number,
): ApprovedExecution | null {
  if (option === 3) {
    return null;
  }
  return {
    requestId: pending.rpcId,
    kind: pending.request.kind,
    threadId: pending.request.threadId,
    turnId: pending.request.turnId,
    itemId: pending.request.itemId,
    command: pending.request.command ?? null,
    approvedAt: now,
    lastSignalAt: now,
    lastSignalKind: 'approval_response_sent',
    signalCount: 0,
    completedAt: null,
    lastObservedTurnSnapshotKey: null,
  };
}

export function buildV2CommandApprovalDecision(request: ProviderApprovalRequest, option: 1 | 2 | 3): any {
  if (option === 1) {
    return 'accept';
  }
  if (option === 2) {
    if (
      request.execPolicyAmendment
      && request.execPolicyAmendment.length > 0
      && request.availableDecisionKeys?.includes('acceptWithExecpolicyAmendment')
    ) {
      return {
        acceptWithExecpolicyAmendment: {
          execpolicy_amendment: request.execPolicyAmendment,
        },
      };
    }
    if (request.availableDecisionKeys?.includes('acceptForSession')) {
      return 'acceptForSession';
    }
    throw new Error('Current approval request does not support session-wide approval');
  }
  if (request.availableDecisionKeys?.includes('decline')) {
    return 'decline';
  }
  if (request.availableDecisionKeys?.includes('cancel')) {
    return 'cancel';
  }
  throw new Error('Current approval request does not support denial');
}

export function buildV2FileChangeApprovalDecision(option: 1 | 2 | 3): string {
  if (option === 1) {
    return 'accept';
  }
  if (option === 2) {
    return 'acceptForSession';
  }
  return 'decline';
}

export function buildV2PermissionsApprovalDecision(request: ProviderApprovalRequest, option: 1 | 2 | 3) {
  return {
    permissions: option === 3
      ? {}
      : {
        ...(request.networkPermission != null ? {
          network: {
            enabled: request.networkPermission,
          },
        } : {}),
        ...(request.fileReadPermissions?.length || request.fileWritePermissions?.length ? {
          fileSystem: {
            read: request.fileReadPermissions ?? [],
            write: request.fileWritePermissions ?? [],
          },
        } : {}),
      },
    scope: option === 2 ? 'session' : 'turn',
  };
}

export function buildLegacyReviewDecision(option: 1 | 2 | 3): any {
  if (option === 1) {
    return 'approved';
  }
  if (option === 2) {
    return 'approved_for_session';
  }
  return 'denied';
}

export function normalizeApprovalDecisionKey(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  const entries = Object.entries(value);
  if (entries.length !== 1) {
    return '';
  }
  return String(entries[0]?.[0] ?? '').trim();
}

export function classifyApprovedExecutionSignal(method: unknown): string | null {
  const normalized = String(method ?? '').replace(/[^a-z]/gi, '').toLowerCase();
  switch (normalized) {
    case 'itemstarted':
      return 'item_started';
    case 'itemcompleted':
      return 'item_completed';
    case 'threadstatuschanged':
      return 'thread_status_changed';
    case 'turnstarted':
      return 'turn_started';
    case 'turncompleted':
      return 'turn_completed';
    case 'serverrequestresolved':
      return 'server_request_resolved';
    default:
      return isAgentDeltaNotificationMethod(normalized) ? 'assistant_delta' : null;
  }
}

export function isThreadLevelApprovedExecutionSignal(signalKind: string): boolean {
  return signalKind === 'thread_status_changed'
    || signalKind === 'turn_completed'
    || signalKind === 'server_request_resolved';
}

export function summarizeApprovedExecution(entry: ApprovedExecution) {
  return {
    requestId: entry.requestId,
    kind: entry.kind,
    threadId: entry.threadId,
    turnId: entry.turnId,
    itemId: entry.itemId,
    commandPreview: truncateDebugText(entry.command, 120),
    approvedAt: entry.approvedAt,
    lastSignalAt: entry.lastSignalAt,
    lastSignalKind: entry.lastSignalKind,
    signalCount: entry.signalCount,
    completedAt: entry.completedAt,
  };
}

export function summarizeApprovedExecutionSignal(entry: ApprovedExecution, signalKind: string) {
  return {
    requestId: entry.requestId,
    threadId: entry.threadId,
    turnId: entry.turnId,
    itemId: entry.itemId,
    signalKind,
    signalCount: entry.signalCount,
    commandPreview: truncateDebugText(entry.command, 120),
    completedAt: entry.completedAt,
  };
}

export function mapThreadGoal(raw: any): ProviderThreadGoal | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const objective = typeof raw.objective === 'string' ? raw.objective.trim() : '';
  if (!objective) {
    return null;
  }
  return {
    threadId: String(raw.threadId ?? raw.thread_id ?? ''),
    objective,
    status: typeof raw.status === 'string' ? raw.status : 'active',
    tokenBudget: Number.isFinite(raw.tokenBudget) ? Number(raw.tokenBudget) : null,
    tokensUsed: Number.isFinite(raw.tokensUsed) ? Number(raw.tokensUsed) : null,
    timeUsedSeconds: Number.isFinite(raw.timeUsedSeconds) ? Number(raw.timeUsedSeconds) : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  };
}

export function mapThreadSummary(raw) {
  return {
    threadId: String(raw.id),
    title: raw.name ? String(raw.name) : null,
    cwd: raw.cwd ? String(raw.cwd) : null,
    updatedAt: normalizeTimestamp(raw.updatedAt),
    preview: typeof raw.preview === 'string' ? raw.preview : '',
  };
}

export function mapThread(raw, includeTurns) {
  return {
    threadId: String(raw.id),
    title: raw.name ? String(raw.name) : null,
    cwd: raw.cwd ? String(raw.cwd) : null,
    path: raw.path ? String(raw.path) : null,
    updatedAt: normalizeTimestamp(raw.updatedAt),
    preview: typeof raw.preview === 'string' ? raw.preview : '',
    turns: includeTurns && Array.isArray(raw.turns) ? raw.turns.map(mapTurn) : [],
  };
}

export function mapTurn(raw) {
  return {
    id: String(raw?.id ?? ''),
    status: extractStructuredString(raw?.status),
    error: extractStructuredString(raw?.error),
    items: Array.isArray(raw?.items) ? raw.items.map(mapTurnItem) : [],
  };
}

export function mapTurnItem(raw) {
  return {
    type: typeof raw?.type === 'string' ? raw.type : 'unknown',
    role: typeof raw?.role === 'string' ? raw.role : null,
    phase: typeof raw?.phase === 'string' ? raw.phase : null,
    text: extractStructuredText(raw),
    savedPath: extractStructuredString(raw?.savedPath),
    result: extractStructuredString(raw?.result),
  };
}

export function mapModel(raw) {
  return {
    id: String(raw.id),
    model: String(raw.model),
    displayName: String(raw.displayName || raw.model),
    description: String(raw.description || ''),
    isDefault: Boolean(raw.isDefault),
    supportedReasoningEfforts: Array.isArray(raw.supportedReasoningEfforts)
      ? raw.supportedReasoningEfforts
        .map((entry) => entry?.reasoningEffort)
        .filter((value) => typeof value === 'string')
      : [],
    defaultReasoningEffort: typeof raw.defaultReasoningEffort === 'string' ? raw.defaultReasoningEffort : null,
  };
}

export function mapAppServerRateLimits(payload: CodexAppRateLimitsResponse | null | undefined): ProviderUsageReport | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const report: ProviderUsageReport = {
    provider: 'codex',
    accountId: null,
    userId: null,
    email: null,
    plan: null,
    buckets: [],
    credits: null,
  };
  const snapshots: CodexAppRateLimitSnapshot[] = [];
  if (payload.rateLimitsByLimitId && typeof payload.rateLimitsByLimitId === 'object') {
    const keys = Object.keys(payload.rateLimitsByLimitId).sort();
    for (const key of keys) {
      const snapshot = payload.rateLimitsByLimitId[key];
      if (snapshot && typeof snapshot === 'object') {
        snapshots.push(snapshot);
      }
    }
  } else if (payload.rateLimits && typeof payload.rateLimits === 'object') {
    if (payload.rateLimits.limitId || payload.rateLimits.primary || payload.rateLimits.secondary || payload.rateLimits.credits) {
      snapshots.push(payload.rateLimits);
    }
  }

  for (const snapshot of snapshots) {
    if (!report.plan && typeof snapshot.planType === 'string' && snapshot.planType.trim()) {
      report.plan = snapshot.planType.trim();
    }
    if (!report.credits && snapshot.credits && typeof snapshot.credits === 'object') {
      report.credits = {
        hasCredits: Boolean(snapshot.credits.hasCredits),
        unlimited: Boolean(snapshot.credits.unlimited),
        balance: typeof snapshot.credits.balance === 'string' && snapshot.credits.balance.trim()
          ? snapshot.credits.balance.trim()
          : null,
      };
    }
    const windows = appServerUsageWindows(snapshot);
    if (!windows.length) {
      continue;
    }
    const limitReached = windows.some((window) => window.usedPercent >= 100);
    report.buckets.push({
      name: appServerBucketName(snapshot),
      allowed: !limitReached,
      limitReached,
      windows,
    });
  }

  return report;
}

export function appServerBucketName(snapshot: CodexAppRateLimitSnapshot): string {
  if (typeof snapshot.limitName === 'string' && snapshot.limitName.trim()) {
    return snapshot.limitName.trim();
  }
  if (typeof snapshot.limitId === 'string' && snapshot.limitId.trim()) {
    return snapshot.limitId.trim();
  }
  return 'Rate limit';
}

export function appServerUsageWindows(snapshot: CodexAppRateLimitSnapshot) {
  const windows = [] as Array<{
    name: string;
    usedPercent: number;
    windowSeconds: number;
    resetAfterSeconds: number;
    resetAtUnix: number;
  }>;
  if (snapshot.primary) {
    windows.push(appServerUsageWindow('Primary', snapshot.primary));
  }
  if (snapshot.secondary) {
    windows.push(appServerUsageWindow('Secondary', snapshot.secondary));
  }
  return windows;
}

export function appServerUsageWindow(name: string, window: CodexAppRateLimitWindow) {
  const rawUsedPercent = Number(window?.usedPercent ?? 0);
  const usedPercent = Number.isFinite(rawUsedPercent)
    ? Math.max(0, Math.min(100, Math.round(rawUsedPercent)))
    : 0;
  const rawWindowMinutes = Number(window?.windowDurationMins ?? 0);
  const windowSeconds = Number.isFinite(rawWindowMinutes)
    ? Math.max(0, Math.round(rawWindowMinutes * 60))
    : 0;
  const resetAtUnix = Math.max(0, Math.floor(Number(window?.resetsAt ?? 0)));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const resetAfterSeconds = resetAtUnix > 0 ? Math.max(0, resetAtUnix - nowSeconds) : 0;
  return {
    name,
    usedPercent,
    windowSeconds,
    resetAfterSeconds,
    resetAtUnix,
  };
}

export function mergeModelCatalog(baseModels, overlayModels) {
  if (overlayModels.length === 0) {
    return baseModels;
  }
  const overlayKeys = new Set(overlayModels.map((model) => model.model));
  const hasOverlayDefault = overlayModels.some((model) => model.isDefault);
  const merged = overlayModels.map((overlay) => {
    const base = baseModels.find((model) => model.model === overlay.model) ?? null;
    return {
      ...(base ?? {}),
      ...overlay,
      isDefault: overlay.isDefault || (!hasOverlayDefault && Boolean(base?.isDefault)),
    };
  });
  for (const base of baseModels) {
    if (!overlayKeys.has(base.model)) {
      merged.push({
        ...base,
        isDefault: hasOverlayDefault ? false : base.isDefault,
      });
    }
  }
  return merged;
}

export function mapSandboxPolicy(mode) {
  if (mode === 'read-only') {
    return { type: 'readOnly' };
  }
  if (mode === 'danger-full-access') {
    return { type: 'dangerFullAccess' };
  }
  return { type: 'workspaceWrite' };
}

export function isTurnTerminal(status) {
  const normalized = normalizeTurnStatusKey(status);
  return Boolean(normalized) && TERMINAL_TURN_STATUS_KEYS.has(normalized);
}

export function mapSkillToolDependency(raw: CodexAppSkillToolDependency): ProviderSkillToolDependency | null {
  const type = normalizeNullableString(raw?.type);
  const value = normalizeNullableString(raw?.value);
  if (!type || !value) {
    return null;
  }
  return {
    type,
    value,
    command: normalizeNullableString(raw?.command),
    description: normalizeNullableString(raw?.description),
    transport: normalizeNullableString(raw?.transport),
    url: normalizeNullableString(raw?.url),
  };
}

export function mapSkillMetadata(raw: CodexAppSkillMetadata): ProviderSkillInfo | null {
  const name = normalizeNullableString(raw?.name);
  const description = normalizeNullableString(raw?.description);
  const skillPath = normalizeNullableString(raw?.path);
  const scope = normalizeNullableString(raw?.scope);
  if (!name || !description || !skillPath || !scope) {
    return null;
  }
  const dependencies = Array.isArray(raw?.dependencies?.tools)
    ? raw.dependencies.tools.map(mapSkillToolDependency).filter(Boolean)
    : [];
  return {
    name,
    description,
    enabled: raw?.enabled !== false,
    path: skillPath,
    scope,
    shortDescription: normalizeNullableString(raw?.interface?.shortDescription)
      ?? normalizeNullableString(raw?.shortDescription),
    displayName: normalizeNullableString(raw?.interface?.displayName),
    defaultPrompt: normalizeNullableString(raw?.interface?.defaultPrompt),
    brandColor: normalizeNullableString(raw?.interface?.brandColor),
    dependencies,
  };
}

export function mapSkillErrorInfo(raw: CodexAppSkillErrorInfo): ProviderSkillError | null {
  const skillPath = normalizeNullableString(raw?.path);
  const message = normalizeNullableString(raw?.message);
  if (!skillPath || !message) {
    return null;
  }
  return {
    path: skillPath,
    message,
  };
}

export function mapPluginLoadError(raw: CodexAppMarketplaceLoadError): ProviderPluginLoadError | null {
  const marketplacePath = normalizeNullableString(raw?.marketplacePath);
  const message = normalizeNullableString(raw?.message);
  if (!marketplacePath || !message) {
    return null;
  }
  return {
    marketplacePath,
    message,
  };
}

export function mapPluginMarketplace(raw: CodexAppPluginMarketplace): ProviderPluginMarketplace | null {
  const name = normalizeNullableString(raw?.name);
  if (!name) {
    return null;
  }
  return {
    name,
    path: normalizeNullableString(raw?.path),
    displayName: normalizeNullableString(raw?.interface?.displayName),
    plugins: Array.isArray(raw?.plugins)
      ? raw.plugins.map((plugin) => mapPluginSummary(plugin, {
        marketplaceName: name,
        marketplacePath: normalizeNullableString(raw?.path),
        marketplaceDisplayName: normalizeNullableString(raw?.interface?.displayName),
      })).filter(Boolean) as ProviderPluginSummary[]
      : [],
  };
}

export function mapPluginSummary(
  raw: CodexAppPluginSummary | null | undefined,
  context: {
    marketplaceName?: string | null;
    marketplacePath?: string | null;
    marketplaceDisplayName?: string | null;
  } = {},
): ProviderPluginSummary | null {
  const id = normalizeNullableString(raw?.id);
  const name = normalizeNullableString(raw?.name);
  if (!id || !name) {
    return null;
  }
  const sourceType = normalizeNullableString((raw?.source as any)?.type);
  const defaultPrompts = Array.isArray(raw?.interface?.defaultPrompt)
    ? raw.interface.defaultPrompt.map((entry) => normalizeNullableString(entry)).filter(Boolean) as string[]
    : [];
  return {
    id,
    name,
    installed: raw?.installed !== false,
    enabled: raw?.enabled !== false,
    installPolicy: normalizeNullableString(raw?.installPolicy) ?? 'AVAILABLE',
    authPolicy: normalizeNullableString(raw?.authPolicy) ?? 'ON_USE',
    marketplaceName: normalizeNullableString(context.marketplaceName) ?? 'unknown',
    marketplacePath: normalizeNullableString(context.marketplacePath),
    marketplaceDisplayName: normalizeNullableString(context.marketplaceDisplayName),
    displayName: normalizeNullableString(raw?.interface?.displayName),
    shortDescription: normalizeNullableString(raw?.interface?.shortDescription),
    longDescription: normalizeNullableString(raw?.interface?.longDescription),
    category: normalizeNullableString(raw?.interface?.category),
    capabilities: Array.isArray(raw?.interface?.capabilities)
      ? raw.interface.capabilities.map((entry) => String(entry ?? '').trim()).filter(Boolean)
      : [],
    developerName: normalizeNullableString(raw?.interface?.developerName),
    brandColor: normalizeNullableString(raw?.interface?.brandColor),
    defaultPrompts,
    websiteUrl: normalizeNullableString(raw?.interface?.websiteUrl),
    sourceType,
    sourcePath: normalizeNullableString((raw?.source as any)?.path),
    sourceRemoteMarketplaceName: normalizeNullableString((raw?.source as any)?.marketplaceName),
  };
}

export function mapPluginSkillSummary(raw: CodexAppPluginSkillSummary): ProviderPluginSkillSummary | null {
  const name = normalizeNullableString(raw?.name);
  const skillPath = normalizeNullableString(raw?.path);
  const description = normalizeNullableString(raw?.description);
  if (!name || !skillPath || !description) {
    return null;
  }
  return {
    name,
    path: skillPath,
    description,
    enabled: raw?.enabled !== false,
    shortDescription: normalizeNullableString(raw?.shortDescription),
    displayName: normalizeNullableString(raw?.interface?.displayName),
  };
}

export function mapPluginAppSummary(raw: CodexAppPluginAppSummary): ProviderPluginAppSummary | null {
  const id = normalizeNullableString(raw?.id);
  const name = normalizeNullableString(raw?.name);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    needsAuth: Boolean(raw?.needsAuth),
    description: normalizeNullableString(raw?.description),
    installUrl: normalizeNullableString(raw?.installUrl),
  };
}

export function mapPluginDetail(
  raw: CodexAppPluginDetail | null | undefined,
  fallback: {
    marketplaceName?: string | null;
    marketplacePath?: string | null;
  } = {},
): ProviderPluginDetail | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const summary = mapPluginSummary(raw.summary ?? null, {
    marketplaceName: normalizeNullableString(raw?.marketplaceName) ?? normalizeNullableString(fallback.marketplaceName),
    marketplacePath: normalizeNullableString(raw?.marketplacePath) ?? normalizeNullableString(fallback.marketplacePath),
  });
  if (!summary) {
    return null;
  }
  return {
    summary,
    marketplaceName: normalizeNullableString(raw?.marketplaceName) ?? summary.marketplaceName,
    marketplacePath: normalizeNullableString(raw?.marketplacePath) ?? summary.marketplacePath,
    description: normalizeNullableString(raw?.description),
    apps: Array.isArray(raw?.apps) ? raw.apps.map(mapPluginAppSummary).filter(Boolean) as ProviderPluginAppSummary[] : [],
    mcpServers: Array.isArray(raw?.mcpServers) ? raw.mcpServers.map((entry) => String(entry ?? '').trim()).filter(Boolean) : [],
    skills: Array.isArray(raw?.skills) ? raw.skills.map(mapPluginSkillSummary).filter(Boolean) as ProviderPluginSkillSummary[] : [],
  };
}

export function mapAppInfo(raw: CodexAppInfo): ProviderAppInfo | null {
  const id = normalizeNullableString(raw?.id);
  const name = normalizeNullableString(raw?.name);
  if (!id || !name) {
    return null;
  }
  const categories = Array.isArray(raw?.appMetadata?.categories)
    ? raw.appMetadata.categories.map((entry) => normalizeNullableString(entry)).filter(Boolean) as string[]
    : [];
  return {
    id,
    name,
    description: normalizeNullableString(raw?.description),
    installUrl: normalizeNullableString(raw?.installUrl),
    isAccessible: Boolean(raw?.isAccessible),
    isEnabled: raw?.isEnabled !== false,
    pluginDisplayNames: Array.isArray(raw?.pluginDisplayNames)
      ? raw.pluginDisplayNames.map((entry) => String(entry ?? '').trim()).filter(Boolean)
      : [],
    categories,
    developer: normalizeNullableString(raw?.appMetadata?.developer)
      ?? normalizeNullableString(raw?.branding?.developer),
  };
}

export function mapMcpServerStatus(raw: CodexAppMcpServerStatus): ProviderMcpServerStatus | null {
  const name = normalizeNullableString(raw?.name);
  if (!name) {
    return null;
  }
  return {
    name,
    isEnabled: raw?.isEnabled !== false,
    authStatus: normalizeNullableString(raw?.authStatus) ?? 'unsupported',
    toolCount: raw?.tools && typeof raw.tools === 'object' ? Object.keys(raw.tools).length : 0,
    resourceCount: Array.isArray(raw?.resources) ? raw.resources.length : 0,
    resourceTemplateCount: Array.isArray(raw?.resourceTemplates) ? raw.resourceTemplates.length : 0,
  };
}

export function truncateDebugText(value: unknown, limit = 240): string {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!text) {
    return '';
  }
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

export function isAgentDeltaNotificationMethod(method) {
  const normalized = String(method ?? '').replace(/[^a-z]/gi, '').toLowerCase();
  return normalized === 'itemagentmessagedelta'
    || normalized === 'itemassistantmessagedelta'
    || normalized === 'itemmessagedelta';
}

export function extractTextCandidate(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  for (const key of ['text', 'delta', 'content', 'value', 'message']) {
    if (typeof value[key] === 'string') {
      return value[key];
    }
  }
  for (const key of ['parts', 'segments', 'content']) {
    const candidate = value[key];
    if (!Array.isArray(candidate)) {
      continue;
    }
    const text = candidate
      .map((entry) => extractTextCandidate(entry))
      .filter((entry) => typeof entry === 'string')
      .join('');
    if (text) {
      return text;
    }
  }
  return null;
}

export function extractStructuredText(value) {
  const directText = extractTextCandidate(value?.text)
    ?? extractTextCandidate(value?.content)
    ?? extractTextCandidate(value?.message)
    ?? extractTextCandidate(value?.value);
  return directText ?? extractTextCandidate(value);
}

export function extractStructuredString(value) {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  return extractTextCandidate(value) ?? extractTextCandidate(value?.message) ?? extractTextCandidate(value?.error);
}
