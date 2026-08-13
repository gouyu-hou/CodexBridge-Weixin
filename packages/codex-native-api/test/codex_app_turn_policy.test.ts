import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildApprovedExecutionStallError,
  computeApprovedExecutionIdleLimitMs,
  computeTerminalSettleMs,
} from '../src/codex_app_turn_policy.js';

test('turn policy bounds terminal settling and approved execution idle windows', () => {
  assert.equal(computeTerminalSettleMs(undefined), 60_000);
  assert.equal(computeTerminalSettleMs(5_000), 10_000);
  assert.equal(computeTerminalSettleMs(40_000), 20_000);
  assert.equal(computeTerminalSettleMs(500_000), 60_000);

  assert.equal(computeApprovedExecutionIdleLimitMs(undefined), 300_000);
  assert.equal(computeApprovedExecutionIdleLimitMs(60_000), 180_000);
  assert.equal(computeApprovedExecutionIdleLimitMs(720_000), 240_000);
  assert.equal(computeApprovedExecutionIdleLimitMs(1_800_000), 300_000);
});

test('buildApprovedExecutionStallError distinguishes missing and stalled follow-up signals', () => {
  const base = {
    requestId: 'request-1',
    kind: 'command' as const,
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    command: 'npm test',
    approvedAt: 1,
    lastSignalAt: 1,
    lastSignalKind: 'approval_accepted',
    completedAt: null,
    lastObservedTurnSnapshotKey: null,
  };
  const noSignal = buildApprovedExecutionStallError({
    entry: { ...base, signalCount: 0 },
    idleMs: 61_000,
  });
  assert.match(noSignal, /produced no follow-up signal for 61 seconds/u);
  assert.match(noSignal, /npm test/u);

  const stalled = buildApprovedExecutionStallError({
    entry: { ...base, kind: 'file_change', command: null, signalCount: 2, lastSignalKind: 'item_started' },
    idleMs: 90_000,
  });
  assert.match(stalled, /approved file change stopped making progress/u);
  assert.match(stalled, /after item_started/u);
});
