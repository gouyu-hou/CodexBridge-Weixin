export type ThreadCommandOperationKind = 'archive' | 'restore' | 'pin' | 'unpin';
export type ThreadCommandSkillSubcommand = ThreadCommandOperationKind | 'search' | 'natural';

export type ThreadCommandInventoryItem = {
  threadId: string;
  title: string | null;
  alias: string | null;
  preview: string | null;
  updatedAt: number | null;
  archivedAt: number | null;
  pinnedAt: number | null;
  isCurrent: boolean;
};

export type PendingThreadCommandOperation = {
  kind: ThreadCommandOperationKind;
  createdAt: number;
  rawInput: string;
  providerProfileId: string;
  summary: string;
  reason: string | null;
  threads: ThreadCommandInventoryItem[];
};

export type ResolvedThreadOperationTarget =
  | { ok: false; message: string }
  | {
    ok: true;
    providerProfileId: string;
    threadId: string;
    archivedAt: number | null;
    pinnedAt: number | null;
  };

export type ThreadOperationOutcome =
  | { status: 'resolution_error'; message: string }
  | { status: 'already_archived' | 'not_archived' | 'already_pinned' | 'not_pinned'; providerProfileId: string; threadId: string }
  | { status: 'archive_failed' | 'restore_failed'; providerProfileId: string; threadId: string; error: string }
  | { status: 'applied'; operation: ThreadCommandOperationKind; providerProfileId: string; threadId: string };

export interface ThreadOperationHost {
  updateArchive(providerProfileId: string, threadId: string, archived: boolean): Promise<void>;
  setPinned(providerProfileId: string, threadId: string, pinned: boolean): void | Promise<void>;
  onApplied?(operation: ThreadCommandOperationKind, target: Extract<ResolvedThreadOperationTarget, { ok: true }>): void | Promise<void>;
}

export type ThreadCommandSkillResult =
  | {
    action: 'show_default_threads' | 'show_all_threads' | 'show_pinned_threads';
    confidence: number;
    reason: string | null;
  }
  | {
    action: 'search_threads' | 'open_thread' | 'peek_thread';
    confidence: number;
    summary: string | null;
    candidateThreadIds: string[];
  }
  | {
    action: 'rename_thread';
    confidence: number;
    summary: string;
    candidateThreadIds: string[];
    newName: string;
  }
  | {
    action: 'propose_archive_threads' | 'propose_restore_threads' | 'propose_pin_threads' | 'propose_unpin_threads';
    confidence: number;
    summary: string;
    reason: string | null;
    candidateThreadIds: string[];
  }
  | {
    action: 'clarify';
    confidence: number;
    question: string;
    candidates: Array<Record<string, unknown>>;
  }
  | {
    action: 'no_match' | 'reject' | 'local_only';
    confidence: number;
    reason: string | null;
  };

export type ThreadSearchSkillDecision =
  | { kind: 'local' }
  | { kind: 'results'; items: ThreadCommandInventoryItem[] }
  | { kind: 'clarify'; question: string; candidates: Array<Record<string, unknown>> }
  | { kind: 'message'; reason: string | null };

export type ThreadNaturalSkillDecision =
  | { kind: 'view'; includeArchived: boolean; onlyPinned: boolean }
  | { kind: 'search'; items: ThreadCommandInventoryItem[] }
  | { kind: 'target'; action: 'open' | 'peek'; target: ThreadCommandInventoryItem }
  | { kind: 'target'; action: 'rename'; target: ThreadCommandInventoryItem; newName: string }
  | { kind: 'clarify'; question: string; candidates: Array<Record<string, unknown>> }
  | { kind: 'no_match'; reason: string | null }
  | { kind: 'skill_failed'; reason: string | null; includeHelp: boolean }
  | { kind: 'manage'; operation: ThreadCommandOperationKind; result: ThreadCommandSkillResult };

export type ThreadManagementSkillDecision =
  | { kind: 'clarify'; question: string; candidates: Array<Record<string, unknown>> }
  | { kind: 'no_match'; reason: string | null }
  | { kind: 'skill_failed'; reason: string | null }
  | { kind: 'resolve'; result: ThreadCommandSkillResult };

export type ThreadManagementProposalDecision =
  | { kind: 'skill_failed' }
  | { kind: 'no_match' }
  | {
    kind: 'proposal';
    summary: string;
    reason: string | null;
    threads: ThreadCommandInventoryItem[];
  };

export type ThreadPageRequest = {
  providerProfileId: string;
  cursor: string | null;
  previousCursors: Array<string | null>;
  searchTerm: string | null;
  pageNumber: number;
  includeArchived: boolean;
  onlyPinned: boolean;
};

export type ThreadPageResult<Item> = {
  items: readonly Item[];
  nextCursor: string | null;
};

export type ThreadPageDecision<Item> =
  | { kind: 'retry'; request: ThreadPageRequest }
  | { kind: 'empty_search' }
  | { kind: 'empty' }
  | {
    kind: 'render';
    state: ThreadPageRequest & {
      nextCursor: string | null;
      items: Item[];
    };
    items: Item[];
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };

export type ThreadCommandRoute =
  | { kind: 'home'; includeArchived: boolean; onlyPinned: boolean }
  | { kind: 'confirm' }
  | { kind: 'cancel' }
  | { kind: 'manage'; operation: ThreadCommandOperationKind; args: unknown[] }
  | { kind: 'natural'; args: unknown[] };

export interface ThreadCommandHost<Event, Response, PendingResult = Response> {
  getScopeKey(event: Event): string;
  rejectConfirm(event: Event): Promise<Response | null>;
  applyPending(event: Event, operation: PendingThreadCommandOperation): Promise<PendingResult>;
  renderConfirmed(
    event: Event,
    operation: PendingThreadCommandOperation,
    result: PendingResult,
  ): Response | Promise<Response>;
  renderNoPending(event: Event): Response | Promise<Response>;
  renderCancelled(event: Event): Response | Promise<Response>;
  renderHome(
    event: Event,
    options: { includeArchived: boolean; onlyPinned: boolean },
  ): Promise<Response>;
  natural(event: Event, args: unknown[]): Promise<Response>;
  areExplicitTargets(event: Event, args: unknown[]): boolean;
  manageExplicit(
    event: Event,
    operation: ThreadCommandOperationKind,
    args: unknown[],
  ): Promise<Response>;
  manageNatural(
    event: Event,
    operation: ThreadCommandOperationKind,
    args: unknown[],
  ): Promise<Response>;
}

export class ThreadCommandService<Event, Response, PendingResult = Response> {
  readonly host: ThreadCommandHost<Event, Response, PendingResult>;
  private readonly pendingOperationsByScope = new Map<string, PendingThreadCommandOperation>();

  constructor(host: ThreadCommandHost<Event, Response, PendingResult>) {
    this.host = host;
  }

  async handle(event: Event, args: readonly unknown[] = []): Promise<Response> {
    const route = resolveThreadCommandRoute(args);
    if (route.kind === 'confirm') {
      return this.confirm(event);
    }
    if (route.kind === 'cancel') {
      return this.cancel(event);
    }
    if (route.kind === 'home') {
      return this.host.renderHome(event, route);
    }
    if (route.kind === 'natural') {
      return this.host.natural(event, route.args);
    }
    if (this.host.areExplicitTargets(event, route.args)) {
      return this.host.manageExplicit(event, route.operation, route.args);
    }
    return this.host.manageNatural(event, route.operation, route.args);
  }

  getPendingOperation(scopeKey: string): PendingThreadCommandOperation | null {
    return this.pendingOperationsByScope.get(scopeKey) ?? null;
  }

  setPendingOperation(scopeKey: string, operation: PendingThreadCommandOperation): void {
    this.pendingOperationsByScope.set(scopeKey, operation);
  }

  clearPendingOperation(scopeKey: string): void {
    this.pendingOperationsByScope.delete(scopeKey);
  }

  async confirm(event: Event): Promise<Response> {
    const activeResponse = await this.host.rejectConfirm(event);
    if (activeResponse) {
      return activeResponse;
    }
    const scopeKey = this.host.getScopeKey(event);
    const operation = this.getPendingOperation(scopeKey);
    if (!operation) {
      return this.host.renderNoPending(event);
    }
    const result = await this.host.applyPending(event, operation);
    this.clearPendingOperation(scopeKey);
    return this.host.renderConfirmed(event, operation, result);
  }

  async cancel(event: Event): Promise<Response> {
    const scopeKey = this.host.getScopeKey(event);
    if (!this.getPendingOperation(scopeKey)) {
      return this.host.renderNoPending(event);
    }
    this.clearPendingOperation(scopeKey);
    return this.host.renderCancelled(event);
  }
}

export function resolveThreadCommandRoute(args: readonly unknown[]): ThreadCommandRoute {
  const action = String(args[0] ?? '').trim().toLowerCase();
  if (action === 'confirm' || action === 'ok') {
    return { kind: 'confirm' };
  }
  if (action === 'cancel') {
    return { kind: 'cancel' };
  }
  if (action === 'all') {
    return { kind: 'home', includeArchived: true, onlyPinned: false };
  }
  if (action === 'pinned' || (action === 'pin' && args.length === 1)) {
    return { kind: 'home', includeArchived: false, onlyPinned: true };
  }
  if (!action) {
    return { kind: 'home', includeArchived: false, onlyPinned: false };
  }

  const operation = normalizeThreadOperation(action);
  if (operation) {
    return { kind: 'manage', operation, args: [...args.slice(1)] };
  }
  return { kind: 'natural', args: [...args] };
}

export interface ThreadInventorySourceItem {
  threadId: string;
  title?: unknown;
  preview?: unknown;
  updatedAt?: unknown;
  archivedAt?: unknown;
  pinnedAt?: unknown;
}

export interface ThreadInventoryHost {
  listThreads(options: {
    limit: number;
    includeArchived: boolean;
    onlyPinned: boolean;
  }): Promise<{ items: readonly ThreadInventorySourceItem[] }>;
  getThreadAlias(threadId: string): string | null;
  isCurrentThread(threadId: string): boolean;
}

export async function listThreadInventoryForCommand(
  host: ThreadInventoryHost,
  {
    limit,
    includeArchived = true,
    onlyPinned = false,
  }: {
    limit: number;
    includeArchived?: boolean;
    onlyPinned?: boolean;
  },
): Promise<ThreadCommandInventoryItem[]> {
  const result = await host.listThreads({ limit, includeArchived, onlyPinned });
  return result.items.map((item) => ({
    threadId: item.threadId,
    title: normalizeNullableText(item.title),
    alias: normalizeNullableText(host.getThreadAlias(item.threadId)),
    preview: normalizeNullableText(truncateText(String(item.preview ?? '').trim(), 160)),
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : null,
    archivedAt: typeof item.archivedAt === 'number' ? item.archivedAt : null,
    pinnedAt: typeof item.pinnedAt === 'number' ? item.pinnedAt : null,
    isCurrent: host.isCurrentThread(item.threadId),
  }));
}

export function resolveThreadSkillCandidateItems(
  inventory: readonly ThreadCommandInventoryItem[],
  candidateThreadIds: readonly string[],
): ThreadCommandInventoryItem[] {
  const byId = new Map(inventory.map((item) => [item.threadId, item] as const));
  const seen = new Set<string>();
  const items: ThreadCommandInventoryItem[] = [];
  for (const threadId of candidateThreadIds) {
    const normalizedThreadId = String(threadId ?? '').trim();
    if (!normalizedThreadId || seen.has(normalizedThreadId)) {
      continue;
    }
    const item = byId.get(normalizedThreadId);
    if (!item) {
      continue;
    }
    seen.add(normalizedThreadId);
    items.push(item);
  }
  return items;
}

export function resolveSingleThreadSkillTarget(
  inventory: readonly ThreadCommandInventoryItem[],
  candidateThreadIds: readonly string[],
): ThreadCommandInventoryItem | null {
  return resolveThreadSkillCandidateItems(inventory, candidateThreadIds)[0] ?? null;
}

export function resolveThreadSearchSkillDecision(
  result: ThreadCommandSkillResult | null,
  inventory: readonly ThreadCommandInventoryItem[],
  resultLimit: number,
): ThreadSearchSkillDecision {
  if (!result || result.action === 'local_only') {
    return { kind: 'local' };
  }
  if (result.action === 'search_threads') {
    return {
      kind: 'results',
      items: resolveThreadSkillCandidateItems(inventory, result.candidateThreadIds).slice(0, resultLimit),
    };
  }
  if (result.action === 'clarify') {
    return {
      kind: 'clarify',
      question: result.question,
      candidates: result.candidates,
    };
  }
  return {
    kind: 'message',
    reason: 'reason' in result ? result.reason : null,
  };
}

export function resolveThreadNaturalSkillDecision(
  result: ThreadCommandSkillResult | null,
  inventory: readonly ThreadCommandInventoryItem[],
  resultLimit: number,
): ThreadNaturalSkillDecision {
  if (!result) {
    return { kind: 'skill_failed', reason: null, includeHelp: true };
  }
  if (result.action === 'show_default_threads') {
    return { kind: 'view', includeArchived: false, onlyPinned: false };
  }
  if (result.action === 'show_all_threads') {
    return { kind: 'view', includeArchived: true, onlyPinned: false };
  }
  if (result.action === 'show_pinned_threads') {
    return { kind: 'view', includeArchived: false, onlyPinned: true };
  }
  if (result.action === 'search_threads') {
    return {
      kind: 'search',
      items: resolveThreadSkillCandidateItems(inventory, result.candidateThreadIds).slice(0, resultLimit),
    };
  }
  if (result.action === 'open_thread' || result.action === 'peek_thread' || result.action === 'rename_thread') {
    const target = resolveSingleThreadSkillTarget(inventory, result.candidateThreadIds);
    if (!target) {
      return { kind: 'no_match', reason: null };
    }
    if (result.action === 'rename_thread') {
      return { kind: 'target', action: 'rename', target, newName: result.newName };
    }
    return {
      kind: 'target',
      action: result.action === 'open_thread' ? 'open' : 'peek',
      target,
    };
  }
  if (result.action === 'clarify') {
    return {
      kind: 'clarify',
      question: result.question,
      candidates: result.candidates,
    };
  }
  if (result.action === 'no_match') {
    return { kind: 'no_match', reason: result.reason };
  }
  if (result.action === 'reject' || result.action === 'local_only') {
    return { kind: 'skill_failed', reason: result.reason, includeHelp: false };
  }
  const operation = skillActionToThreadOperationKind(result.action);
  return operation
    ? { kind: 'manage', operation, result }
    : { kind: 'skill_failed', reason: null, includeHelp: false };
}

export function resolveThreadManagementSkillDecision(
  result: ThreadCommandSkillResult | null,
): ThreadManagementSkillDecision {
  if (!result) {
    return { kind: 'skill_failed', reason: null };
  }
  if (result.action === 'clarify') {
    return {
      kind: 'clarify',
      question: result.question,
      candidates: result.candidates,
    };
  }
  if (result.action === 'no_match') {
    return { kind: 'no_match', reason: result.reason };
  }
  if (result.action === 'reject' || result.action === 'local_only') {
    return { kind: 'skill_failed', reason: result.reason };
  }
  return { kind: 'resolve', result };
}

export function resolveThreadManagementProposal(
  operation: ThreadCommandOperationKind,
  result: ThreadCommandSkillResult,
  inventory: readonly ThreadCommandInventoryItem[],
  resultLimit: number,
): ThreadManagementProposalDecision {
  if (result.action !== threadOperationKindToSkillAction(operation)) {
    return { kind: 'skill_failed' };
  }
  if (!('candidateThreadIds' in result) || !('summary' in result)) {
    return { kind: 'skill_failed' };
  }
  const threads = resolveThreadSkillCandidateItems(inventory, result.candidateThreadIds)
    .filter((item) => isThreadItemEligibleForOperation(item, operation))
    .slice(0, resultLimit);
  if (threads.length === 0) {
    return { kind: 'no_match' };
  }
  return {
    kind: 'proposal',
    summary: result.summary,
    reason: 'reason' in result ? result.reason : null,
    threads,
  };
}

export function resolveThreadPageResult<Item>(
  request: ThreadPageRequest,
  result: ThreadPageResult<Item>,
): ThreadPageDecision<Item> {
  if (result.items.length === 0 && request.previousCursors.length > 0) {
    return {
      kind: 'retry',
      request: {
        ...request,
        cursor: request.previousCursors.at(-1) ?? null,
        previousCursors: request.previousCursors.slice(0, -1),
        pageNumber: Math.max(1, request.pageNumber - 1),
      },
    };
  }
  if (result.items.length === 0) {
    return { kind: request.searchTerm ? 'empty_search' : 'empty' };
  }
  const items = [...result.items];
  return {
    kind: 'render',
    state: {
      ...request,
      nextCursor: result.nextCursor,
      items,
    },
    items,
    hasPreviousPage: request.previousCursors.length > 0,
    hasNextPage: Boolean(result.nextCursor),
  };
}

export function skillActionToThreadOperationKind(
  action: ThreadCommandSkillResult['action'],
): ThreadCommandOperationKind | null {
  if (action === 'propose_archive_threads') {
    return 'archive';
  }
  if (action === 'propose_restore_threads') {
    return 'restore';
  }
  if (action === 'propose_pin_threads') {
    return 'pin';
  }
  if (action === 'propose_unpin_threads') {
    return 'unpin';
  }
  return null;
}

export function threadOperationKindToSkillAction(
  kind: ThreadCommandOperationKind,
): ThreadCommandSkillResult['action'] {
  if (kind === 'archive') {
    return 'propose_archive_threads';
  }
  if (kind === 'restore') {
    return 'propose_restore_threads';
  }
  if (kind === 'pin') {
    return 'propose_pin_threads';
  }
  return 'propose_unpin_threads';
}

export function isThreadItemEligibleForOperation(
  item: ThreadCommandInventoryItem,
  kind: ThreadCommandOperationKind,
): boolean {
  if (kind === 'archive') {
    return typeof item.archivedAt !== 'number';
  }
  if (kind === 'restore') {
    return typeof item.archivedAt === 'number';
  }
  if (kind === 'pin') {
    return typeof item.archivedAt !== 'number' && typeof item.pinnedAt !== 'number';
  }
  return typeof item.pinnedAt === 'number';
}

export async function executeThreadOperation(
  operation: ThreadCommandOperationKind,
  targets: readonly ResolvedThreadOperationTarget[],
  host: ThreadOperationHost,
): Promise<{ appliedCount: number; outcomes: ThreadOperationOutcome[] }> {
  const seen = new Set<string>();
  const outcomes: ThreadOperationOutcome[] = [];
  let appliedCount = 0;

  for (const target of targets) {
    if (target.ok === false) {
      outcomes.push({ status: 'resolution_error', message: target.message });
      continue;
    }
    const key = `${target.providerProfileId}:${target.threadId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const blockedStatus = resolveBlockedThreadOperationStatus(operation, target);
    if (blockedStatus) {
      outcomes.push({
        status: blockedStatus,
        providerProfileId: target.providerProfileId,
        threadId: target.threadId,
      });
      continue;
    }

    if (operation === 'archive' || operation === 'restore') {
      try {
        await host.updateArchive(target.providerProfileId, target.threadId, operation === 'archive');
      } catch (error) {
        outcomes.push({
          status: operation === 'archive' ? 'archive_failed' : 'restore_failed',
          providerProfileId: target.providerProfileId,
          threadId: target.threadId,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    } else {
      await host.setPinned(target.providerProfileId, target.threadId, operation === 'pin');
    }

    await host.onApplied?.(operation, target);
    outcomes.push({
      status: 'applied',
      operation,
      providerProfileId: target.providerProfileId,
      threadId: target.threadId,
    });
    appliedCount += 1;
  }

  return { appliedCount, outcomes };
}

function resolveBlockedThreadOperationStatus(
  operation: ThreadCommandOperationKind,
  target: Extract<ResolvedThreadOperationTarget, { ok: true }>,
): 'already_archived' | 'not_archived' | 'already_pinned' | 'not_pinned' | null {
  if (operation === 'archive') {
    return typeof target.archivedAt === 'number' ? 'already_archived' : null;
  }
  if (operation === 'restore') {
    return typeof target.archivedAt === 'number' ? null : 'not_archived';
  }
  if (operation === 'pin') {
    return typeof target.pinnedAt === 'number' ? 'already_pinned' : null;
  }
  return typeof target.pinnedAt === 'number' ? null : 'not_pinned';
}

export function parseThreadCommandSkillResult(value: unknown): ThreadCommandSkillResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) {
    return null;
  }
  const action = normalizeThreadCommandSkillAction(parsed.action);
  if (!action) {
    return null;
  }
  const confidence = clampConfidence(Number(parsed.confidence ?? 0.8));
  if (action === 'clarify') {
    return {
      action,
      confidence,
      question: compactWhitespace(parsed.question ?? parsed.message ?? ''),
      candidates: Array.isArray(parsed.candidates)
        ? parsed.candidates.filter((entry) => entry && typeof entry === 'object')
        : [],
    };
  }
  if (action === 'no_match' || action === 'reject' || action === 'local_only') {
    return {
      action,
      confidence,
      reason: normalizeNullableText(parsed.reason ?? parsed.message),
    };
  }
  if (action === 'show_default_threads' || action === 'show_all_threads' || action === 'show_pinned_threads') {
    return {
      action,
      confidence,
      reason: normalizeNullableText(parsed.reason ?? parsed.message),
    };
  }
  const candidateThreadIds = normalizeStringArray(
    parsed.candidateThreadIds
    ?? parsed.threadIds
    ?? parsed.thread_ids
    ?? parsed.targets,
  );
  if (candidateThreadIds.length === 0) {
    return null;
  }
  if (action === 'search_threads' || action === 'open_thread' || action === 'peek_thread') {
    return {
      action,
      confidence,
      summary: normalizeNullableText(parsed.summary ?? parsed.reason ?? parsed.message),
      candidateThreadIds,
    };
  }
  if (action === 'rename_thread') {
    const summary = compactWhitespace(parsed.summary ?? parsed.message ?? '');
    const newName = compactWhitespace(parsed.newName ?? parsed.name ?? parsed.title ?? '');
    if (!summary || !newName) {
      return null;
    }
    return {
      action,
      confidence,
      summary,
      candidateThreadIds,
      newName,
    };
  }
  const summary = compactWhitespace(parsed.summary ?? parsed.message ?? '');
  if (!summary) {
    return null;
  }
  return {
    action,
    confidence,
    summary,
    reason: normalizeNullableText(parsed.reason),
    candidateThreadIds,
  };
}

function normalizeThreadOperation(action: string): ThreadCommandOperationKind | null {
  if (action === 'del' || action === 'delete' || action === 'archive') {
    return 'archive';
  }
  if (action === 'restore' || action === 'pin' || action === 'unpin') {
    return action;
  }
  return null;
}

function normalizeThreadCommandSkillAction(value: unknown): ThreadCommandSkillResult['action'] | null {
  const normalized = compactWhitespace(value).toLowerCase();
  return THREAD_COMMAND_SKILL_ACTIONS.has(normalized as ThreadCommandSkillResult['action'])
    ? normalized as ThreadCommandSkillResult['action']
    : null;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.8;
  }
  return Math.max(0, Math.min(1, value));
}

function compactWhitespace(value: unknown): string {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = compactWhitespace(value);
  return normalized || null;
}

function truncateText(value: unknown, limit: number): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => compactWhitespace(entry)).filter(Boolean).slice(0, 12)
    : [];
}
import { parseJsonObject } from './json_object_parser.js';

export const THREAD_COMMAND_SKILL_ACTIONS = new Set([
  'show_default_threads',
  'show_all_threads',
  'show_pinned_threads',
  'search_threads',
  'open_thread',
  'peek_thread',
  'rename_thread',
  'propose_archive_threads',
  'propose_restore_threads',
  'propose_pin_threads',
  'propose_unpin_threads',
  'clarify',
  'no_match',
  'reject',
  'local_only',
] as const);
