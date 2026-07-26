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

function normalizeThreadOperation(action: string): ThreadCommandOperationKind | null {
  if (action === 'del' || action === 'delete' || action === 'archive') {
    return 'archive';
  }
  if (action === 'restore' || action === 'pin' || action === 'unpin') {
    return action;
  }
  return null;
}
