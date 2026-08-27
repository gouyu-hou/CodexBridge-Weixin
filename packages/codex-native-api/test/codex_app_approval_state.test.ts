import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexAppApprovalState } from '../src/codex_app_approval_state.js';
import type { PendingApproval } from '../src/codex_app_protocol.js';

function commandApproval({
  rpcId,
  rpcResponseId = rpcId,
  threadId = 'thread-1',
  turnId = 'turn-1',
}: {
  rpcId: string;
  rpcResponseId?: string | number;
  threadId?: string;
  turnId?: string | null;
}): PendingApproval {
  return {
    rpcId,
    rpcResponseId,
    transportKind: 'v2_command',
    request: {
      requestId: rpcId,
      kind: 'command',
      threadId,
      turnId,
      itemId: `item-${rpcId}`,
      reason: 'run command',
      command: 'npm test',
      cwd: '/workspace',
      availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
      execPolicyAmendment: null,
      networkPermission: null,
      fileReadPermissions: [],
      fileWritePermissions: [],
    },
  };
}

test('approval state stores, retrieves, and filters requests in insertion order', () => {
  const state = new CodexAppApprovalState();
  const first = commandApproval({ rpcId: 'request-1' });
  const second = commandApproval({ rpcId: 'request-2', turnId: 'turn-2' });
  const third = commandApproval({ rpcId: 'request-3', threadId: 'thread-2', turnId: null });

  state.set(first);
  state.set(second);
  state.set(third);

  assert.equal(state.get('request-1'), first);
  assert.deepEqual(state.list().map((request) => request.requestId), [
    'request-1',
    'request-2',
    'request-3',
  ]);
  assert.deepEqual(state.list({ threadId: 'thread-1' }).map((request) => request.requestId), [
    'request-1',
    'request-2',
  ]);
  assert.deepEqual(state.list({ turnId: 'turn-2' }).map((request) => request.requestId), ['request-2']);
  assert.deepEqual(state.list({ threadId: 'thread-1', turnId: 'turn-1' }), [first.request]);
  assert.equal(state.get('missing'), null);
});

test('approval state preserves numeric JSON-RPC response ids', () => {
  const state = new CodexAppApprovalState();
  const pending = commandApproval({ rpcId: '0', rpcResponseId: 0 });

  state.set(pending);

  assert.equal(state.get(0), pending);
  assert.equal(state.prepare(0, 1).pending.rpcResponseId, 0);
});

test('approval state prepares response and approved-execution tracking without removing pending state', () => {
  const state = new CodexAppApprovalState({ now: () => 42 });
  const pending = commandApproval({ rpcId: 'request-1' });
  state.set(pending);

  const prepared = state.prepare('request-1', 2);

  assert.equal(prepared.pending, pending);
  assert.deepEqual(prepared.result, { decision: 'acceptForSession' });
  assert.deepEqual(prepared.approvedExecution, {
    requestId: 'request-1',
    kind: 'command',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-request-1',
    command: 'npm test',
    approvedAt: 42,
    lastSignalAt: 42,
    lastSignalKind: 'approval_response_sent',
    signalCount: 0,
    completedAt: null,
    lastObservedTurnSnapshotKey: null,
  });
  assert.equal(state.get('request-1'), pending);
});

test('approval state retains prepared requests until successful-send removal', () => {
  const state = new CodexAppApprovalState();
  const pending = commandApproval({ rpcId: 'request-retry' });
  state.set(pending);

  state.prepare('request-retry', 1);
  assert.equal(state.get('request-retry'), pending);

  state.remove('request-retry');
  assert.equal(state.get('request-retry'), null);
});

test('approval state does not track denied executions and rejects unknown requests', () => {
  const state = new CodexAppApprovalState({ now: () => 7 });
  state.set(commandApproval({ rpcId: 'request-denied' }));

  const prepared = state.prepare('request-denied', 3);

  assert.deepEqual(prepared.result, { decision: 'decline' });
  assert.equal(prepared.approvedExecution, null);
  assert.throws(() => state.prepare('missing', 1), /Unknown approval request: missing/u);
});

test('approval state clear removes every pending request', () => {
  const state = new CodexAppApprovalState();
  state.set(commandApproval({ rpcId: 'request-1' }));
  state.set(commandApproval({ rpcId: 'request-2' }));

  state.clear();

  assert.deepEqual(state.list(), []);
  assert.equal(state.get('request-1'), null);
});
