import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ThreadCommandService,
  executeThreadOperation,
  isThreadItemEligibleForOperation,
  listThreadInventoryForCommand,
  parseThreadCommandSkillResult,
  resolveSingleThreadSkillTarget,
  resolveThreadCommandRoute,
  resolveThreadManagementProposal,
  resolveThreadManagementSkillDecision,
  resolveThreadNaturalSkillDecision,
  resolveThreadPageResult,
  resolveThreadSearchSkillDecision,
  resolveThreadSkillCandidateItems,
  skillActionToThreadOperationKind,
  threadOperationKindToSkillAction,
  type ThreadCommandInventoryItem,
  type PendingThreadCommandOperation,
  type ThreadInventoryHost,
} from '../../src/core/thread_command.js';

test('ThreadCommandService dispatches views and management through its host', async () => {
  const calls: string[] = [];
  const service = new ThreadCommandService<string, string>({
    getScopeKey: (event) => event,
    rejectConfirm: async () => null,
    applyPending: async () => assert.fail('routing test does not confirm pending operations'),
    renderConfirmed: async () => assert.fail('routing test does not render confirmations'),
    renderNoPending: async () => 'no-pending',
    renderCancelled: async () => 'cancelled',
    renderHome: async (event, options) => record(`home:${event}:${options.includeArchived}:${options.onlyPinned}`),
    natural: async (event, args) => record(`natural:${event}:${args.join('|')}`),
    areExplicitTargets: (_event, args) => args[0] === 'thread-1',
    manageExplicit: async (event, operation, args) => record(`explicit:${event}:${operation}:${args.join('|')}`),
    manageNatural: async (event, operation, args) => record(`management:${event}:${operation}:${args.join('|')}`),
  });

  assert.equal(await service.handle('scope', ['all']), 'home:scope:true:false');
  assert.equal(await service.handle('scope', ['archive', 'thread-1']), 'explicit:scope:archive:thread-1');
  assert.equal(await service.handle('scope', ['delete', 'last week']), 'management:scope:archive:last week');
  assert.equal(await service.handle('scope', ['find', 'planning']), 'natural:scope:find|planning');
  assert.deepEqual(calls, [
    'home:scope:true:false',
    'explicit:scope:archive:thread-1',
    'management:scope:archive:last week',
    'natural:scope:find|planning',
  ]);

  function record(value: string): string {
    calls.push(value);
    return value;
  }
});

test('ThreadCommandService isolates pending operations by scope key', () => {
  const { service } = createPendingOperationHarness();
  const first = makePendingOperation('thread-1');
  const second = makePendingOperation('thread-2');

  service.setPendingOperation('scope-1', first);
  service.setPendingOperation('scope-2', second);
  assert.equal(service.getPendingOperation('scope-1'), first);
  assert.equal(service.getPendingOperation('scope-2'), second);
  service.clearPendingOperation('scope-1');
  assert.equal(service.getPendingOperation('scope-1'), null);
  assert.equal(service.getPendingOperation('scope-2'), second);
});

test('ThreadCommandService confirms pending operations and clears only after success', async () => {
  const { calls, service } = createPendingOperationHarness();
  const operation = makePendingOperation('thread-1');
  service.setPendingOperation('scope-1', operation);

  assert.equal(await service.handle('scope-1', ['confirm']), 'confirmed:thread-1');
  assert.deepEqual(calls, [
    'reject:scope-1',
    'apply:scope-1:thread-1',
    'render:scope-1:thread-1',
  ]);
  assert.equal(service.getPendingOperation('scope-1'), null);

  calls.length = 0;
  assert.equal(await service.handle('scope-1', ['confirm']), 'no-pending:scope-1');
  assert.deepEqual(calls, ['reject:scope-1', 'no-pending:scope-1']);
});

test('ThreadCommandService retains pending operations when confirm is blocked or fails', async () => {
  {
    const operation = makePendingOperation('blocked-thread');
    const { calls, service } = createPendingOperationHarness({ activeResponse: 'active-turn' });
    service.setPendingOperation('scope-1', operation);

    assert.equal(await service.handle('scope-1', ['confirm']), 'active-turn');
    assert.deepEqual(calls, ['reject:scope-1']);
    assert.equal(service.getPendingOperation('scope-1'), operation);
  }

  {
    const operation = makePendingOperation('failed-thread');
    const { calls, service } = createPendingOperationHarness({ confirmError: new Error('persist failed') });
    service.setPendingOperation('scope-1', operation);

    await assert.rejects(() => service.handle('scope-1', ['confirm']), /persist failed/u);
    assert.deepEqual(calls, ['reject:scope-1', 'apply:scope-1:failed-thread']);
    assert.equal(service.getPendingOperation('scope-1'), operation);
  }
});

test('ThreadCommandService treats any non-null confirm rejection as terminal', async () => {
  const operation = makePendingOperation('blocked-thread');
  const { calls, service } = createPendingOperationHarness({ activeResponse: '' });
  service.setPendingOperation('scope-1', operation);

  assert.equal(await service.handle('scope-1', ['confirm']), '');
  assert.deepEqual(calls, ['reject:scope-1']);
  assert.equal(service.getPendingOperation('scope-1'), operation);
});

test('ThreadCommandService clears an applied operation before rendering the confirmation', async () => {
  const operation = makePendingOperation('render-failed-thread');
  const { calls, service } = createPendingOperationHarness({ renderError: new Error('render failed') });
  service.setPendingOperation('scope-1', operation);

  await assert.rejects(() => service.handle('scope-1', ['confirm']), /render failed/u);
  assert.deepEqual(calls, [
    'reject:scope-1',
    'apply:scope-1:render-failed-thread',
    'render:scope-1:render-failed-thread',
  ]);
  assert.equal(service.getPendingOperation('scope-1'), null);
});

test('ThreadCommandService cancels only an existing pending operation', async () => {
  const { calls, service } = createPendingOperationHarness();
  service.setPendingOperation('scope-1', makePendingOperation('thread-1'));

  assert.equal(await service.handle('scope-1', ['cancel']), 'cancelled:scope-1');
  assert.deepEqual(calls, ['cancelled:scope-1']);
  assert.equal(service.getPendingOperation('scope-1'), null);

  calls.length = 0;
  assert.equal(await service.handle('scope-1', ['cancel']), 'no-pending:scope-1');
  assert.deepEqual(calls, ['no-pending:scope-1']);
});

test('resolveThreadCommandRoute maps thread command aliases and views', () => {
  assert.deepEqual(resolveThreadCommandRoute([]), {
    kind: 'home',
    includeArchived: false,
    onlyPinned: false,
  });
  assert.deepEqual(resolveThreadCommandRoute(['all']), {
    kind: 'home',
    includeArchived: true,
    onlyPinned: false,
  });
  assert.deepEqual(resolveThreadCommandRoute(['pinned']), {
    kind: 'home',
    includeArchived: false,
    onlyPinned: true,
  });
  assert.deepEqual(resolveThreadCommandRoute(['pin']), {
    kind: 'home',
    includeArchived: false,
    onlyPinned: true,
  });
  assert.deepEqual(resolveThreadCommandRoute(['confirm']), { kind: 'confirm' });
  assert.deepEqual(resolveThreadCommandRoute(['ok']), { kind: 'confirm' });
  assert.deepEqual(resolveThreadCommandRoute(['cancel']), { kind: 'cancel' });
});

test('resolveThreadCommandRoute normalizes management aliases', () => {
  for (const alias of ['del', 'delete', 'archive']) {
    assert.deepEqual(resolveThreadCommandRoute([alias, 'thread-1']), {
      kind: 'manage',
      operation: 'archive',
      args: ['thread-1'],
    });
  }
  assert.deepEqual(resolveThreadCommandRoute(['restore', 'thread-1']), {
    kind: 'manage',
    operation: 'restore',
    args: ['thread-1'],
  });
  assert.deepEqual(resolveThreadCommandRoute(['pin', 'thread-1']), {
    kind: 'manage',
    operation: 'pin',
    args: ['thread-1'],
  });
  assert.deepEqual(resolveThreadCommandRoute(['unpin', 'thread-1']), {
    kind: 'manage',
    operation: 'unpin',
    args: ['thread-1'],
  });
});

test('resolveThreadCommandRoute preserves natural command arguments', () => {
  assert.deepEqual(resolveThreadCommandRoute(['find', 'yesterday']), {
    kind: 'natural',
    args: ['find', 'yesterday'],
  });
});

test('resolveThreadSkillCandidateItems preserves requested order and removes duplicates', () => {
  const inventory: ThreadCommandInventoryItem[] = [
    makeInventoryItem('thread-1'),
    makeInventoryItem('thread-2'),
  ];

  assert.deepEqual(
    resolveThreadSkillCandidateItems(inventory, [' thread-2 ', 'missing', 'thread-2', '', 'thread-1'])
      .map((item) => item.threadId),
    ['thread-2', 'thread-1'],
  );
});

test('skillActionToThreadOperationKind maps only management proposals', () => {
  assert.equal(skillActionToThreadOperationKind('propose_archive_threads'), 'archive');
  assert.equal(skillActionToThreadOperationKind('propose_restore_threads'), 'restore');
  assert.equal(skillActionToThreadOperationKind('propose_pin_threads'), 'pin');
  assert.equal(skillActionToThreadOperationKind('propose_unpin_threads'), 'unpin');
  assert.equal(skillActionToThreadOperationKind('search_threads'), null);
  assert.equal(skillActionToThreadOperationKind('clarify'), null);
});

test('resolveSingleThreadSkillTarget returns the first valid requested candidate', () => {
  const inventory = [makeInventoryItem('thread-1'), makeInventoryItem('thread-2')];

  assert.equal(
    resolveSingleThreadSkillTarget(inventory, ['missing', 'thread-2', 'thread-1'])?.threadId,
    'thread-2',
  );
  assert.equal(resolveSingleThreadSkillTarget(inventory, ['missing']), null);
});

test('thread operation helpers map skill actions and eligibility', () => {
  assert.equal(threadOperationKindToSkillAction('archive'), 'propose_archive_threads');
  assert.equal(threadOperationKindToSkillAction('restore'), 'propose_restore_threads');
  assert.equal(threadOperationKindToSkillAction('pin'), 'propose_pin_threads');
  assert.equal(threadOperationKindToSkillAction('unpin'), 'propose_unpin_threads');

  const active = makeInventoryItem('active');
  const archived = { ...makeInventoryItem('archived'), archivedAt: 10 };
  const pinned = { ...makeInventoryItem('pinned'), pinnedAt: 20 };
  assert.equal(isThreadItemEligibleForOperation(active, 'archive'), true);
  assert.equal(isThreadItemEligibleForOperation(archived, 'archive'), false);
  assert.equal(isThreadItemEligibleForOperation(archived, 'restore'), true);
  assert.equal(isThreadItemEligibleForOperation(active, 'restore'), false);
  assert.equal(isThreadItemEligibleForOperation(active, 'pin'), true);
  assert.equal(isThreadItemEligibleForOperation(pinned, 'pin'), false);
  assert.equal(isThreadItemEligibleForOperation(pinned, 'unpin'), true);
  assert.equal(isThreadItemEligibleForOperation(active, 'unpin'), false);
});

test('executeThreadOperation deduplicates targets and reports archive outcomes', async () => {
  const archiveCalls: Array<{ providerProfileId: string; threadId: string; archived: boolean }> = [];
  const applied: string[] = [];
  const result = await executeThreadOperation('archive', [
    { ok: false, message: 'missing thread' },
    makeOperationTarget('thread-1'),
    makeOperationTarget('thread-1'),
    { ...makeOperationTarget('thread-2'), archivedAt: 10 },
    makeOperationTarget('thread-3'),
  ], {
    updateArchive: async (providerProfileId, threadId, archived) => {
      archiveCalls.push({ providerProfileId, threadId, archived });
      if (threadId === 'thread-3') {
        throw new Error('archive unavailable');
      }
    },
    setPinned: () => assert.fail('archive must not update pin state'),
    onApplied: (_operation, target) => {
      applied.push(target.threadId);
    },
  });

  assert.deepEqual(result, {
    appliedCount: 1,
    outcomes: [
      { status: 'resolution_error', message: 'missing thread' },
      { status: 'applied', operation: 'archive', providerProfileId: 'profile-1', threadId: 'thread-1' },
      { status: 'already_archived', providerProfileId: 'profile-1', threadId: 'thread-2' },
      { status: 'archive_failed', providerProfileId: 'profile-1', threadId: 'thread-3', error: 'archive unavailable' },
    ],
  });
  assert.deepEqual(archiveCalls, [
    { providerProfileId: 'profile-1', threadId: 'thread-1', archived: true },
    { providerProfileId: 'profile-1', threadId: 'thread-3', archived: true },
  ]);
  assert.deepEqual(applied, ['thread-1']);
});

test('executeThreadOperation applies restore, pin, and unpin state transitions', async () => {
  const archiveCalls: string[] = [];
  const pinCalls: string[] = [];
  const host = {
    updateArchive: async (_providerProfileId: string, threadId: string, archived: boolean) => {
      archiveCalls.push(`${threadId}:${archived}`);
    },
    setPinned: (_providerProfileId: string, threadId: string, pinned: boolean) => {
      pinCalls.push(`${threadId}:${pinned}`);
    },
  };

  const restore = await executeThreadOperation('restore', [
    makeOperationTarget('active'),
    { ...makeOperationTarget('archived'), archivedAt: 10 },
  ], host);
  const pin = await executeThreadOperation('pin', [
    { ...makeOperationTarget('pinned'), pinnedAt: 10 },
    makeOperationTarget('unpinned'),
  ], host);
  const unpin = await executeThreadOperation('unpin', [
    makeOperationTarget('unpinned'),
    { ...makeOperationTarget('pinned'), pinnedAt: 10 },
  ], host);

  assert.deepEqual(restore.outcomes.map((outcome) => outcome.status), ['not_archived', 'applied']);
  assert.deepEqual(pin.outcomes.map((outcome) => outcome.status), ['already_pinned', 'applied']);
  assert.deepEqual(unpin.outcomes.map((outcome) => outcome.status), ['not_pinned', 'applied']);
  assert.deepEqual(archiveCalls, ['archived:false']);
  assert.deepEqual(pinCalls, ['unpinned:true', 'pinned:false']);
});

test('executeThreadOperation continues after a restore failure', async () => {
  const result = await executeThreadOperation('restore', [
    { ...makeOperationTarget('restore-failed'), archivedAt: 10 },
    { ...makeOperationTarget('restore-applied'), archivedAt: 10 },
  ], {
    updateArchive: async (_providerProfileId, threadId) => {
      if (threadId === 'restore-failed') {
        throw new Error('restore unavailable');
      }
    },
    setPinned: () => assert.fail('restore must not update pin state'),
  });

  assert.deepEqual(result, {
    appliedCount: 1,
    outcomes: [
      {
        status: 'restore_failed',
        providerProfileId: 'profile-1',
        threadId: 'restore-failed',
        error: 'restore unavailable',
      },
      {
        status: 'applied',
        operation: 'restore',
        providerProfileId: 'profile-1',
        threadId: 'restore-applied',
      },
    ],
  });
});

test('executeThreadOperation propagates pin persistence failures', async () => {
  await assert.rejects(() => executeThreadOperation('pin', [
    makeOperationTarget('pin-failed'),
  ], {
    updateArchive: async () => assert.fail('pin must not update archive state'),
    setPinned: () => {
      throw new Error('pin unavailable');
    },
  }), /pin unavailable/u);
});

test('parseThreadCommandSkillResult normalizes supported result shapes', () => {
  assert.deepEqual(parseThreadCommandSkillResult(JSON.stringify({
    action: 'open_thread',
    confidence: 2,
    thread_ids: [' thread-2 ', '', 'thread-2'],
    message: ' open it ',
  })), {
    action: 'open_thread',
    confidence: 1,
    summary: 'open it',
    candidateThreadIds: ['thread-2', 'thread-2'],
  });
  assert.deepEqual(parseThreadCommandSkillResult({
    action: 'clarify',
    confidence: -1,
    question: ' Which thread? ',
    candidates: [{ threadId: 'thread-1' }, null, 'invalid'],
  }), {
    action: 'clarify',
    confidence: 0,
    question: 'Which thread?',
    candidates: [{ threadId: 'thread-1' }],
  });
});

test('parseThreadCommandSkillResult rejects incomplete or unsupported results', () => {
  assert.equal(parseThreadCommandSkillResult('not json'), null);
  assert.equal(parseThreadCommandSkillResult({ action: 'unknown' }), null);
  assert.equal(parseThreadCommandSkillResult({ action: 'open_thread', candidateThreadIds: [] }), null);
  assert.equal(parseThreadCommandSkillResult({
    action: 'rename_thread',
    candidateThreadIds: ['thread-1'],
    summary: 'rename it',
  }), null);
});

test('resolveThreadSearchSkillDecision classifies local, result, clarify, and message paths', () => {
  const inventory = [makeInventoryItem('thread-1'), makeInventoryItem('thread-2')];

  assert.deepEqual(resolveThreadSearchSkillDecision(null, inventory, 3), { kind: 'local' });
  assert.deepEqual(resolveThreadSearchSkillDecision({
    action: 'local_only',
    confidence: 0.9,
    reason: 'use local search',
  }, inventory, 3), { kind: 'local' });
  assert.deepEqual(resolveThreadSearchSkillDecision({
    action: 'search_threads',
    confidence: 0.9,
    summary: 'matches',
    candidateThreadIds: ['thread-2', 'missing', 'thread-2', 'thread-1'],
  }, inventory, 1), {
    kind: 'results',
    items: [inventory[1]],
  });
  assert.deepEqual(resolveThreadSearchSkillDecision({
    action: 'clarify',
    confidence: 0.7,
    question: 'Which project?',
    candidates: [{ label: 'A' }],
  }, inventory, 3), {
    kind: 'clarify',
    question: 'Which project?',
    candidates: [{ label: 'A' }],
  });
  assert.deepEqual(resolveThreadSearchSkillDecision({
    action: 'no_match',
    confidence: 0.8,
    reason: 'nothing found',
  }, inventory, 3), {
    kind: 'message',
    reason: 'nothing found',
  });
});

test('resolveThreadNaturalSkillDecision maps views, targets, searches, and operations', () => {
  const inventory = [makeInventoryItem('thread-1'), makeInventoryItem('thread-2')];

  assert.deepEqual(resolveThreadNaturalSkillDecision({
    action: 'show_all_threads',
    confidence: 0.9,
    reason: null,
  }, inventory, 3), {
    kind: 'view',
    includeArchived: true,
    onlyPinned: false,
  });
  assert.deepEqual(resolveThreadNaturalSkillDecision({
    action: 'open_thread',
    confidence: 0.9,
    summary: 'open it',
    candidateThreadIds: ['missing', 'thread-2'],
  }, inventory, 3), {
    kind: 'target',
    action: 'open',
    target: inventory[1],
  });
  assert.deepEqual(resolveThreadNaturalSkillDecision({
    action: 'rename_thread',
    confidence: 0.9,
    summary: 'rename it',
    candidateThreadIds: ['thread-1'],
    newName: 'Planning',
  }, inventory, 3), {
    kind: 'target',
    action: 'rename',
    target: inventory[0],
    newName: 'Planning',
  });
  assert.deepEqual(resolveThreadNaturalSkillDecision({
    action: 'search_threads',
    confidence: 0.9,
    summary: 'matches',
    candidateThreadIds: ['thread-2', 'thread-1'],
  }, inventory, 1), {
    kind: 'search',
    items: [inventory[1]],
  });
  const proposal = {
    action: 'propose_pin_threads' as const,
    confidence: 0.9,
    summary: 'pin it',
    reason: null,
    candidateThreadIds: ['thread-1'],
  };
  assert.deepEqual(resolveThreadNaturalSkillDecision(proposal, inventory, 3), {
    kind: 'manage',
    operation: 'pin',
    result: proposal,
  });
  assert.deepEqual(resolveThreadNaturalSkillDecision({
    action: 'peek_thread',
    confidence: 0.9,
    summary: 'peek',
    candidateThreadIds: ['missing'],
  }, inventory, 3), {
    kind: 'no_match',
    reason: null,
  });
});

test('resolveThreadNaturalSkillDecision preserves clarify and failure reasons', () => {
  const inventory = [makeInventoryItem('thread-1')];

  assert.deepEqual(resolveThreadNaturalSkillDecision(null, inventory, 3), {
    kind: 'skill_failed',
    reason: null,
    includeHelp: true,
  });
  assert.deepEqual(resolveThreadNaturalSkillDecision({
    action: 'clarify',
    confidence: 0.8,
    question: 'Which thread?',
    candidates: [],
  }, inventory, 3), {
    kind: 'clarify',
    question: 'Which thread?',
    candidates: [],
  });
  assert.deepEqual(resolveThreadNaturalSkillDecision({
    action: 'reject',
    confidence: 0.8,
    reason: 'not a thread request',
  }, inventory, 3), {
    kind: 'skill_failed',
    reason: 'not a thread request',
    includeHelp: false,
  });
  assert.deepEqual(resolveThreadNaturalSkillDecision({
    action: 'no_match',
    confidence: 0.8,
    reason: 'none',
  }, inventory, 3), {
    kind: 'no_match',
    reason: 'none',
  });
});

test('resolveThreadManagementSkillDecision preserves management-only result routing', () => {
  const proposal = {
    action: 'propose_archive_threads' as const,
    confidence: 0.9,
    summary: 'archive old threads',
    reason: null,
    candidateThreadIds: ['thread-1'],
  };

  assert.deepEqual(resolveThreadManagementSkillDecision(null), {
    kind: 'skill_failed',
    reason: null,
  });
  assert.deepEqual(resolveThreadManagementSkillDecision({
    action: 'clarify',
    confidence: 0.8,
    question: 'Which threads?',
    candidates: [],
  }), {
    kind: 'clarify',
    question: 'Which threads?',
    candidates: [],
  });
  assert.deepEqual(resolveThreadManagementSkillDecision({
    action: 'no_match',
    confidence: 0.8,
    reason: 'none',
  }), {
    kind: 'no_match',
    reason: 'none',
  });
  assert.deepEqual(resolveThreadManagementSkillDecision({
    action: 'reject',
    confidence: 0.8,
    reason: 'not allowed',
  }), {
    kind: 'skill_failed',
    reason: 'not allowed',
  });
  assert.deepEqual(resolveThreadManagementSkillDecision(proposal), {
    kind: 'resolve',
    result: proposal,
  });
});

test('resolveThreadManagementProposal validates action and selects eligible targets', () => {
  const active = makeInventoryItem('active');
  const archived = { ...makeInventoryItem('archived'), archivedAt: 10 };
  const result = {
    action: 'propose_archive_threads' as const,
    confidence: 0.9,
    summary: 'archive old threads',
    reason: 'old work',
    candidateThreadIds: ['archived', 'active', 'active'],
  };

  assert.deepEqual(resolveThreadManagementProposal('archive', result, [active, archived], 3), {
    kind: 'proposal',
    summary: 'archive old threads',
    reason: 'old work',
    threads: [active],
  });
  assert.deepEqual(resolveThreadManagementProposal('pin', result, [active, archived], 3), {
    kind: 'skill_failed',
  });
  assert.deepEqual(resolveThreadManagementProposal('restore', {
    ...result,
    action: 'propose_restore_threads',
    candidateThreadIds: ['active'],
  }, [active, archived], 3), {
    kind: 'no_match',
  });
});

test('resolveThreadPageResult handles fallback, empty, and render states', () => {
  const request = {
    providerProfileId: 'profile-1',
    cursor: 'cursor-2',
    previousCursors: [null, 'cursor-1'],
    searchTerm: null,
    pageNumber: 3,
    includeArchived: false,
    onlyPinned: false,
  };

  assert.deepEqual(resolveThreadPageResult(request, { items: [], nextCursor: null }), {
    kind: 'retry',
    request: {
      ...request,
      cursor: 'cursor-1',
      previousCursors: [null],
      pageNumber: 2,
    },
  });
  assert.deepEqual(resolveThreadPageResult({
    ...request,
    cursor: null,
    previousCursors: [],
    searchTerm: 'planning',
    pageNumber: 1,
  }, { items: [], nextCursor: null }), {
    kind: 'empty_search',
  });
  assert.deepEqual(resolveThreadPageResult({
    ...request,
    cursor: null,
    previousCursors: [],
    pageNumber: 1,
    onlyPinned: true,
  }, { items: [], nextCursor: null }), {
    kind: 'empty',
  });
  const item = { threadId: 'thread-1', title: 'Planning' };
  assert.deepEqual(resolveThreadPageResult(request, {
    items: [item],
    nextCursor: 'cursor-3',
  }), {
    kind: 'render',
    state: {
      ...request,
      nextCursor: 'cursor-3',
      items: [item],
    },
    items: [item],
    hasPreviousPage: true,
    hasNextPage: true,
  });
});

test('listThreadInventoryForCommand normalizes source records through the host', async () => {
  const listCalls: unknown[] = [];
  const host: ThreadInventoryHost = {
    listThreads: async (options) => {
      listCalls.push(options);
      return {
        items: [
          {
            threadId: 't1',
            title: '  Hello  world  ',
            preview: `  ${'p'.repeat(200)}  `,
            updatedAt: 5,
            archivedAt: null,
            pinnedAt: 9,
          },
          {
            threadId: 't2',
            title: '',
            preview: ' a \n b ',
            updatedAt: 'x',
            archivedAt: 3,
          },
        ],
      };
    },
    getThreadAlias: (threadId) => (threadId === 't1' ? '  alias  ' : null),
    isCurrentThread: (threadId) => threadId === 't2',
  };

  const items = await listThreadInventoryForCommand(host, { limit: 7, onlyPinned: true });
  assert.deepEqual(listCalls, [{ limit: 7, includeArchived: true, onlyPinned: true }]);
  assert.deepEqual(items, [
    {
      threadId: 't1',
      title: 'Hello world',
      alias: 'alias',
      preview: `${'p'.repeat(159)}…`,
      updatedAt: 5,
      archivedAt: null,
      pinnedAt: 9,
      isCurrent: false,
    },
    {
      threadId: 't2',
      title: null,
      alias: null,
      preview: 'a b',
      updatedAt: null,
      archivedAt: 3,
      pinnedAt: null,
      isCurrent: true,
    },
  ]);
});

test('listThreadInventoryForCommand forwards explicit visibility options', async () => {
  const listCalls: unknown[] = [];
  const host: ThreadInventoryHost = {
    listThreads: async (options) => {
      listCalls.push(options);
      return { items: [] };
    },
    getThreadAlias: () => null,
    isCurrentThread: () => false,
  };

  assert.deepEqual(await listThreadInventoryForCommand(host, { limit: 3, includeArchived: false }), []);
  assert.deepEqual(listCalls, [{ limit: 3, includeArchived: false, onlyPinned: false }]);
});

function makeInventoryItem(threadId: string): ThreadCommandInventoryItem {
  return {
    threadId,
    title: threadId,
    alias: null,
    preview: null,
    updatedAt: null,
    archivedAt: null,
    pinnedAt: null,
    isCurrent: false,
  };
}

function makePendingOperation(threadId: string): PendingThreadCommandOperation {
  return {
    kind: 'archive',
    createdAt: 1,
    rawInput: `archive ${threadId}`,
    providerProfileId: 'profile-1',
    summary: `Archive ${threadId}`,
    reason: null,
    threads: [makeInventoryItem(threadId)],
  };
}

function createPendingOperationHarness({
  activeResponse = null,
  confirmError = null,
  renderError = null,
}: {
  activeResponse?: string | null;
  confirmError?: Error | null;
  renderError?: Error | null;
} = {}) {
  const calls: string[] = [];
  const host = {
    getScopeKey: (event: string) => event,
    rejectConfirm: async (event: string) => {
      calls.push(`reject:${event}`);
      return activeResponse;
    },
    applyPending: async (event: string, operation: PendingThreadCommandOperation) => {
      calls.push(`apply:${event}:${operation.threads[0]?.threadId}`);
      if (confirmError) {
        throw confirmError;
      }
      return operation.threads[0]?.threadId ?? '';
    },
    renderConfirmed: async (event: string, _operation: PendingThreadCommandOperation, threadId: string) => {
      calls.push(`render:${event}:${threadId}`);
      if (renderError) {
        throw renderError;
      }
      return `confirmed:${threadId}`;
    },
    renderNoPending: async (event: string) => {
      calls.push(`no-pending:${event}`);
      return `no-pending:${event}`;
    },
    renderCancelled: async (event: string) => {
      calls.push(`cancelled:${event}`);
      return `cancelled:${event}`;
    },
    renderHome: async () => 'home',
    natural: async () => 'natural',
    areExplicitTargets: () => false,
    manageExplicit: async () => 'explicit',
    manageNatural: async () => 'management',
  };
  return {
    calls,
    service: new ThreadCommandService<string, string>(host),
  };
}

function makeOperationTarget(threadId: string) {
  return {
    ok: true as const,
    providerProfileId: 'profile-1',
    threadId,
    archivedAt: null,
    pinnedAt: null,
  };
}
