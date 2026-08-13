import path from 'node:path';
import { formatPlatformScopeKey } from './contracts.js';
import {
  THREAD_COMMAND_SKILL_ACTIONS,
  type PendingThreadCommandOperation,
  type ThreadCommandInventoryItem,
  type ThreadCommandOperationKind,
  type ThreadCommandSkillSubcommand,
  type ThreadOperationOutcome,
} from './thread_command.js';
import {
  formatRelativeTimeLocalized,
  normalizeLocale,
  type Translator,
} from '../i18n/index.js';
import type { PlatformScopeRef } from '../types/core.js';
import type { InboundTextEvent } from '../types/platform.js';

export const THREAD_PAGE_SIZE = 20;
export const THREAD_COMMAND_SKILL_RESULT_LIMIT = 8;
export const THREAD_COMMAND_SKILL_LIST_LIMIT = 100_000;
const THREAD_PREVIEW_LIMIT = 72;
const THREAD_HISTORY_TURN_LIMIT = 3;
const THREAD_CLARIFY_CANDIDATE_LIMIT = 6;
const THREAD_COMMAND_SKILL_PATH = path.resolve('docs/command-skills/threads.md');

export function buildThreadBrowserKey(event) {
  return formatPlatformScopeKey(event.platform, event.externalScopeId);
}

export function buildThreadOperationKey(scopeRef: PlatformScopeRef) {
  return formatPlatformScopeKey(scopeRef.platform, scopeRef.externalScopeId);
}

export function formatThreadOperationKind(kind: ThreadCommandOperationKind, i18n: Translator): string {
  return i18n.t(`coordinator.threads.operation.${kind}`);
}

export function buildPendingThreadOperationLines(
  operation: PendingThreadCommandOperation,
  i18n: Translator,
): string[] {
  const lines = [
    i18n.t('coordinator.threads.pendingTitle'),
    i18n.t('coordinator.threads.pendingAction', {
      value: formatThreadOperationKind(operation.kind, i18n),
    }),
    i18n.t('coordinator.threads.pendingSummary', { value: operation.summary }),
  ];
  if (operation.reason) {
    lines.push(i18n.t('coordinator.threads.pendingReason', { value: operation.reason }));
  }
  lines.push(i18n.t('coordinator.threads.pendingItemsTitle', { count: operation.threads.length }));
  operation.threads.forEach((thread, index) => {
    const title = thread.alias ?? thread.title ?? thread.threadId;
    lines.push(`${index + 1}. ${title}`);
    lines.push(`   ${thread.threadId}`);
    if (thread.preview) {
      lines.push(`   ${i18n.t('coordinator.threadList.preview', { preview: thread.preview })}`);
    }
  });
  lines.push(i18n.t('coordinator.threads.confirmHint'));
  lines.push(i18n.t('coordinator.threads.cancelHint'));
  return lines;
}

export function renderThreadCommandClarifyLines(
  inventory: readonly ThreadCommandInventoryItem[],
  question: string,
  candidates: readonly Record<string, unknown>[],
  i18n: Translator,
): string[] {
  const lines = [question || i18n.t('coordinator.threadList.noMatch')];
  const byId = new Map(inventory.map((item) => [item.threadId, item] as const));
  for (const [index, candidate] of candidates.slice(0, THREAD_CLARIFY_CANDIDATE_LIMIT).entries()) {
    const threadId = compactWhitespace(candidate.threadId ?? candidate.id ?? '');
    const item = threadId ? byId.get(threadId) ?? null : null;
    const label = compactWhitespace(
      candidate.label
      ?? candidate.title
      ?? item?.alias
      ?? item?.title
      ?? threadId
      ?? i18n.t('common.unknown'),
    );
    lines.push(`${index + 1}. ${label}`);
    if (threadId) {
      lines.push(`   ${threadId}`);
    }
  }
  return lines;
}

export function formatThreadOperationOutcome(
  outcome: ThreadOperationOutcome,
  i18n: Translator,
): string {
  if (outcome.status === 'resolution_error') {
    return outcome.message;
  }
  if (outcome.status === 'already_archived') {
    return i18n.t('coordinator.thread.archiveAlreadyArchived', { threadId: outcome.threadId });
  }
  if (outcome.status === 'not_archived') {
    return i18n.t('coordinator.thread.restoreNotArchived', { threadId: outcome.threadId });
  }
  if (outcome.status === 'already_pinned') {
    return i18n.t('coordinator.thread.pinAlreadyPinned', { threadId: outcome.threadId });
  }
  if (outcome.status === 'not_pinned') {
    return i18n.t('coordinator.thread.unpinNotPinned', { threadId: outcome.threadId });
  }
  if (outcome.status === 'archive_failed') {
    return i18n.t('coordinator.thread.archiveFailed', {
      threadId: outcome.threadId,
      error: outcome.error,
    });
  }
  if (outcome.status === 'restore_failed') {
    return i18n.t('coordinator.thread.restoreFailed', {
      threadId: outcome.threadId,
      error: outcome.error,
    });
  }
  if (outcome.status !== 'applied') {
    throw new Error(`Unhandled thread operation outcome: ${outcome.status}`);
  }
  const key = outcome.operation === 'archive'
    ? 'archived'
    : outcome.operation === 'restore'
      ? 'restored'
      : outcome.operation === 'pin'
        ? 'pinned'
        : 'unpinned';
  return i18n.t(`coordinator.thread.${key}`, { threadId: outcome.threadId });
}

export function formatThreadOperationUsage(
  operation: ThreadCommandOperationKind,
  i18n: Translator,
): string {
  return operation === 'archive'
    ? i18n.t('coordinator.threads.delUsage')
    : i18n.t(`coordinator.threads.${operation}Usage`);
}

export function formatThreadOperationAction(
  operation: ThreadCommandOperationKind,
  i18n: Translator,
): string {
  return i18n.t(`coordinator.thread.${operation}Actions`);
}

export function buildThreadCommandSkillPrompt({
  event,
  command,
  subcommand,
  userInput,
  locale,
  now,
  cwd,
  inventory,
}: {
  event: InboundTextEvent;
  command: 'search' | 'threads';
  subcommand: ThreadCommandSkillSubcommand | null;
  userInput: string;
  locale: string | null;
  now: number;
  cwd: string | null;
  inventory: ThreadCommandInventoryItem[];
}): string {
  const payload = {
    command,
    subcommand: subcommand ?? 'search',
    rawText: String(event.text ?? ''),
    userInput,
    now: new Date(now).toISOString(),
    locale: normalizeLocale(locale) ?? 'zh-CN',
    scope: {
      platform: event.platform,
      externalScopeId: event.externalScopeId,
    },
    cwd,
    threads: inventory.map((item, index) => ({
      index: index + 1,
      threadId: item.threadId,
      title: item.title,
      alias: item.alias,
      preview: item.preview,
      updatedAt: typeof item.updatedAt === 'number' ? new Date(item.updatedAt).toISOString() : null,
      archived: typeof item.archivedAt === 'number',
      pinned: typeof item.pinnedAt === 'number',
      isCurrent: item.isCurrent,
    })),
    capabilities: {
      supportedActions: [...THREAD_COMMAND_SKILL_ACTIONS],
      maxResults: THREAD_COMMAND_SKILL_RESULT_LIMIT,
      supportedManagementOperations: ['archive', 'restore', 'pin', 'unpin'],
    },
    skillPath: THREAD_COMMAND_SKILL_PATH,
  };
  return [
    'CodexBridge command skill invocation.',
    '',
    `Please read and follow this command skill file: ${THREAD_COMMAND_SKILL_PATH}`,
    `Use it to interpret the /${command} thread command request below.`,
    'Return exactly one JSON object that matches the skill contract.',
    'Do not use Markdown. Do not explain. Do not open, rename, archive, restore, pin, unpin, or persist anything yourself.',
    '',
    'Invocation payload:',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

export function renderThreadsPageMessage({
  i18n,
  providerProfile,
  currentSession,
  items,
  pageNumber,
  searchTerm,
  includeArchived,
  onlyPinned,
  hasPreviousPage,
  hasNextPage,
}) {
  const currentItem = currentSession && currentSession.providerProfileId === providerProfile.id
    ? items.find((item) => item.threadId === currentSession.codexThreadId) ?? null
    : null;
  const currentTitle = currentSession && currentSession.providerProfileId === providerProfile.id
    ? formatCurrentBindingTitle(currentItem?.title ?? currentSession.title, currentSession.codexThreadId, i18n)
    : i18n.t('common.none');
  const lines = [
    i18n.t('coordinator.threadList.title', { providerProfileId: providerProfile.id }),
    i18n.t('coordinator.threadList.currentBinding', { title: currentTitle }),
    i18n.t('coordinator.threadList.page', { pageNumber }),
  ];
  if (includeArchived) {
    lines.push(i18n.t('coordinator.threadList.includeArchived'));
  }
  if (onlyPinned) {
    lines.push(i18n.t('coordinator.threadList.onlyPinned'));
  }
  if (searchTerm) {
    lines.push(i18n.t('coordinator.threadList.search', { term: searchTerm }));
  }
  lines.push('');
  lines.push('------');
  lines.push('');
  for (const [index, item] of items.entries()) {
    const marker = currentSession?.providerProfileId === providerProfile.id && currentSession.codexThreadId === item.threadId
      ? '👉 '
      : '';
    const archivedTag = typeof item.archivedAt === 'number'
      ? ` ${i18n.t('coordinator.threadList.archivedTag')}`
      : '';
    const pinnedTag = typeof item.pinnedAt === 'number'
      ? ` ${i18n.t('coordinator.threadList.pinnedTag')}`
      : '';
    lines.push(`${marker}${index + 1}. ${formatThreadTitle(item.title, item.preview, i18n)}${pinnedTag}${archivedTag}`);
    lines.push(`   ${i18n.t('coordinator.threadList.preview', { preview: normalizeThreadPreview(item.preview, i18n) })}`);
    lines.push(`   ${i18n.t('coordinator.threadList.updatedAt', { value: formatRelativeTime(item.updatedAt, i18n) })}`);
    lines.push('');
  }
  lines.push(buildThreadsFooter({ i18n }));
  return lines.join('\n').trim();
}

function buildThreadsFooter({ i18n }: {
  i18n: Translator;
}) {
  const commands = i18n.locale === 'en'
    ? [
      'Common commands:',
      '/new        new session',
      '/project    mobile project control',
      '/stop       stop the current reply',
      '/retry      retry the previous request',
      '/reconnect  refresh the connection',
      '/model      view/change model',
      '/provider   view/change provider',
      '/up         start upload mode, then submit multiple files/images together',
      '/up status  view staged uploads',
      '/up cancel  cancel upload mode',
      '/rename this name    rename the current session to "name"',
      '/search name    search historical sessions whose name contains "name"',
      '/open name    switch directly to the session named "name"',
      '/status   view current session',
      '/threads  view historical sessions',
      '/next     next history page',
      '/prev     previous history page',
      '/compact    compact context',
    ]
    : [
      '常用命令：',
      '/new        新会话',
      '/project    手机项目控制/查看项目目录',
      '/stop       停止当前回复',
      '/retry      重试上一条',
      '/reconnect  刷新连接',
      '/model      看/改模型',
      '/provider   看/改供应商',
      '/up         开启上传模式，连续上传文件/图片后再统一提交',
      '/up status  查看已暂存的上传文件',
      '/up cancel  取消上传模式',
      '/rename this name    给当前会话改名为“name”',
      '/search name    搜索名字里包含“name”的历史会话。',
      '/open name    直接切换到名为“name”的会话。',
      '/status   看当前会话',
      '/threads  看历史会话列表',
      '/next     历史会话下一页',
      '/prev     历史会话上一页',
      '/compact    压缩上下文',
    ];
  return ['------', '', ...commands].join('\n');
}

export function formatCurrentBindingTitle(title, threadId, i18n: Translator) {
  const normalizedTitle = trimToNull(title);
  if (normalizedTitle) {
    return normalizedTitle;
  }
  const normalizedThreadId = trimToNull(threadId);
  if (normalizedThreadId) {
    return `${i18n.t('coordinator.thread.untitled')} (${normalizedThreadId})`;
  }
  return i18n.t('coordinator.thread.untitled');
}

export function renderThreadPeek(thread, i18n: Translator) {
  const turns = extractRecentThreadTurns(thread.turns);
  const lines = [
    i18n.t('coordinator.threadPeek.title', { title: formatThreadTitle(thread.title, thread.preview, i18n) }),
    i18n.t('coordinator.threadPeek.thread', { threadId: thread.threadId }),
    i18n.t('coordinator.threadPeek.preview', { preview: normalizeThreadPreview(thread.preview, i18n) }),
  ];
  if (turns.length === 0) {
    lines.push('', i18n.t('coordinator.threadPeek.noTurns'));
    return lines.join('\n');
  }
  lines.push('', i18n.t('coordinator.threadPeek.recentTurns', { count: turns.length }));
  for (const [index, turn] of turns.entries()) {
    lines.push('');
    lines.push(i18n.t('coordinator.threadPeek.user', {
      index: index + 1,
      text: truncateText(turn.userText || i18n.t('common.empty'), 220),
    }));
    lines.push(formatAssistantTurnLine(turn.status, truncateText(turn.assistantText || i18n.t('common.empty'), 260), i18n));
  }
  return lines.join('\n');
}

export function extractRecentThreadTurns(turns) {
  if (!Array.isArray(turns) || turns.length === 0) {
    return [];
  }
  const recent = [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const userText = joinTurnRoleText(turn?.items, 'user');
    const assistantText = joinTurnRoleText(turn?.items, 'assistant', { preferFinalAnswer: true });
    if (!userText && !assistantText) {
      continue;
    }
    recent.unshift({
      userText,
      assistantText,
      status: classifyPreviewTurnStatus(turn?.status, assistantText),
    });
    if (recent.length >= THREAD_HISTORY_TURN_LIMIT) {
      break;
    }
  }
  return recent;
}

function joinTurnRoleText(items, role, options: { preferFinalAnswer?: boolean } = {}) {
  return compactWhitespace(collectTurnItemTexts(items, role, options).join(' '));
}

export function collectTurnItemTexts(items, role, options: { preferFinalAnswer?: boolean } = {}): string[] {
  if (!Array.isArray(items)) {
    return [];
  }
  const roleItems = items.filter((item) => isLogicalTurnItemRole(item, role));
  if (roleItems.length === 0) {
    return [];
  }
  let selectedItems = roleItems;
  if (role === 'assistant' && options.preferFinalAnswer) {
    const finalAnswerItems = roleItems.filter((item) => String(item?.phase ?? '').trim().toLowerCase() === 'final_answer');
    if (finalAnswerItems.length > 0) {
      selectedItems = finalAnswerItems;
    }
  }
  return selectedItems
    .map((item) => String(item?.text ?? '').trim())
    .filter(Boolean);
}

function isLogicalTurnItemRole(item, role): boolean {
  const explicitRole = String(item?.role ?? '').trim().toLowerCase();
  if (explicitRole) {
    return explicitRole === role;
  }
  const type = String(item?.type ?? '').trim();
  if (role === 'user') {
    return type === 'userMessage';
  }
  if (role === 'assistant') {
    return type === 'agentMessage' || type === 'assistantMessage';
  }
  return false;
}

export function classifyPreviewTurnStatus(status, assistantText) {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (assistantText && ['completed', 'complete', 'succeeded', 'success', 'finished'].includes(normalized)) {
    return 'complete';
  }
  if (['interrupted', 'cancelled', 'canceled', 'aborted'].includes(normalized)) {
    return 'interrupted';
  }
  if (['failed', 'error'].includes(normalized)) {
    return 'failed';
  }
  return assistantText ? 'partial' : 'missing';
}

export function isProviderTurnTerminal(status) {
  const normalized = String(status ?? '').trim().toLowerCase();
  return [
    'completed',
    'complete',
    'succeeded',
    'success',
    'finished',
    'failed',
    'error',
    'timed_out',
    'timeout',
    'interrupted',
    'cancelled',
    'canceled',
    'aborted',
  ].includes(normalized);
}

function formatAssistantTurnLine(status, text, i18n: Translator) {
  switch (status) {
    case 'interrupted':
      return i18n.t('coordinator.threadPeek.assistant.interrupted', { text });
    case 'failed':
      return i18n.t('coordinator.threadPeek.assistant.failed', { text });
    case 'partial':
      return i18n.t('coordinator.threadPeek.assistant.partial', { text });
    default:
      return i18n.t('coordinator.threadPeek.assistant.complete', { text });
  }
}

export function formatThreadTitle(title, preview, i18n: Translator) {
  const resolved = compactWhitespace(title || '');
  if (resolved) {
    return truncateText(resolved, 48);
  }
  const fallback = compactWhitespace(preview || '');
  if (fallback) {
    return truncateText(fallback, 48);
  }
  return i18n.t('coordinator.thread.untitled');
}

export function normalizeThreadPreview(preview, i18n: Translator) {
  const normalized = compactWhitespace(preview || '');
  return normalized ? truncateText(normalized, THREAD_PREVIEW_LIMIT) : i18n.t('coordinator.thread.emptyPreview');
}

function trimToNull(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function compactWhitespace(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function truncateText(value, limit) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function formatRelativeTime(value, i18n: Translator, now = Date.now()) {
  return formatRelativeTimeLocalized(value, i18n.locale, now);
}
