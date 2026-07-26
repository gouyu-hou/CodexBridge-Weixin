import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isThreadItemEligibleForOperation,
  parseThreadCommandSkillResult,
  resolveSingleThreadSkillTarget,
  resolveThreadCommandRoute,
  resolveThreadSkillCandidateItems,
  skillActionToThreadOperationKind,
  threadOperationKindToSkillAction,
  type ThreadCommandInventoryItem,
} from '../../src/core/thread_command.js';

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
