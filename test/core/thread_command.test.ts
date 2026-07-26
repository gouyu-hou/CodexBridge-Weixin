import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveThreadCommandRoute,
  resolveThreadSkillCandidateItems,
  skillActionToThreadOperationKind,
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
