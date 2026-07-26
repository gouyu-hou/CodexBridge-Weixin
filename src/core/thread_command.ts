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

export type ThreadCommandRoute =
  | { kind: 'home'; includeArchived: boolean; onlyPinned: boolean }
  | { kind: 'confirm' }
  | { kind: 'cancel' }
  | { kind: 'manage'; operation: ThreadCommandOperationKind; args: unknown[] }
  | { kind: 'natural'; args: unknown[] };

export interface ThreadCommandHost<Event, Response> {
  confirm(event: Event): Promise<Response>;
  cancel(event: Event): Promise<Response>;
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

export class ThreadCommandService<Event, Response> {
  readonly host: ThreadCommandHost<Event, Response>;

  constructor(host: ThreadCommandHost<Event, Response>) {
    this.host = host;
  }

  async handle(event: Event, args: readonly unknown[] = []): Promise<Response> {
    const route = resolveThreadCommandRoute(args);
    if (route.kind === 'confirm') {
      return this.host.confirm(event);
    }
    if (route.kind === 'cancel') {
      return this.host.cancel(event);
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
