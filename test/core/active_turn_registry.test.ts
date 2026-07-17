import assert from 'node:assert/strict';
import test from 'node:test';
import { ActiveTurnRegistry } from '../../src/core/active_turn_registry.js';
import { InMemoryActiveTurnCheckpointRepository } from '../../src/store/in_memory/in_memory_active_turn_checkpoint_repository.js';
import type { ActiveTurnCheckpoint } from '../../src/types/core.js';
import type { ActiveTurnCheckpointRepository } from '../../src/types/repository.js';

const scopeRef = { platform: 'weixin', externalScopeId: 'wx-active' };

test('ActiveTurnRegistry does not expose a turn when its initial checkpoint write fails', () => {
  const checkpoints = new ThrowingCheckpointRepository();
  const registry = new ActiveTurnRegistry({
    checkpoints,
    now: () => 1_000,
    createId: () => 'checkpoint-1',
  });

  assert.throws(() => registry.beginScopeTurn(scopeRef, {}, {
    requestFingerprint: 'sha256:test',
    requestSummary: 'test request',
  }), /checkpoint write failed/u);
  assert.equal(registry.resolveScopeTurn(scopeRef), null);
});

test('ActiveTurnRegistry persists updates before mutating the local record', () => {
  const checkpoints = new ThrowingCheckpointRepository();
  checkpoints.failWrites = false;
  const registry = new ActiveTurnRegistry({
    checkpoints,
    now: () => 1_000,
    createId: () => 'checkpoint-1',
  });
  const record = registry.beginScopeTurn(scopeRef, {}, {
    requestFingerprint: 'sha256:test',
    requestSummary: 'test request',
  });
  checkpoints.failWrites = true;

  assert.throws(() => registry.updateScopeTurn(scopeRef, {
    threadId: 'thread-1',
    turnId: 'turn-1',
  }), /checkpoint write failed/u);
  assert.equal(record.threadId, null);
  assert.equal(record.turnId, null);
});

test('ActiveTurnRegistry restores live locks and expires pre-restart approvals', () => {
  const now = 10_000;
  const checkpoints = new InMemoryActiveTurnCheckpointRepository();
  checkpoints.save(makeCheckpoint({ id: 'running', externalScopeId: 'wx-running', expiresAt: now + 1_000 }));
  checkpoints.save(makeCheckpoint({
    id: 'approval',
    externalScopeId: 'wx-approval',
    approvalPending: true,
    expiresAt: now + 1_000,
  }));
  const registry = new ActiveTurnRegistry({ checkpoints, now: () => now });

  const result = registry.restoreCheckpoints();

  assert.equal(result.restored.length, 1);
  assert.equal(result.approvalExpired.length, 1);
  assert.equal(registry.resolveScopeTurn({ platform: 'weixin', externalScopeId: 'wx-running' })?.turnId, 'turn-1');
  assert.equal(registry.resolveScopeTurn({ platform: 'weixin', externalScopeId: 'wx-approval' }), null);
  const expired = checkpoints.getByScope('weixin', 'wx-approval');
  assert.equal(expired?.phase, 'approval_expired');
  assert.equal(expired?.approvalPending, false);
});

test('ActiveTurnRegistry links delivery and deletes only the expected checkpoint', () => {
  const checkpoints = new InMemoryActiveTurnCheckpointRepository();
  const registry = new ActiveTurnRegistry({
    checkpoints,
    now: () => 1_000,
    createId: () => 'checkpoint-1',
  });
  registry.beginScopeTurn(scopeRef, {
    bridgeSessionId: 'session-1',
    providerProfileId: 'openai-default',
    threadId: 'thread-1',
    turnId: 'turn-1',
  }, {
    requestFingerprint: 'sha256:test',
    requestSummary: 'test request',
  });

  const completed = registry.markCompletedPendingDelivery(scopeRef, 'openai-default:thread-1:turn-1:final');
  assert.equal(completed?.recoveryPhase, 'completed_pending_delivery');
  const longKey = registry.markCompletedPendingDelivery(
    scopeRef,
    `openai-default:${'thread-'.repeat(30)}turn-1:final`,
  );
  assert.match(longKey?.finalDeliveryKey ?? '', /^active-turn:[a-f0-9]{64}$/u);
  assert.equal(registry.linkOutboxDelivery(scopeRef, 'stale-id', 'outbox-1'), false);
  assert.equal(registry.linkOutboxDelivery(scopeRef, 'checkpoint-1', 'outbox-1'), true);
  assert.equal(checkpoints.getByScope('weixin', 'wx-active')?.outboxEntryId, 'outbox-1');
  assert.equal(registry.completeDurableTurn(scopeRef, 'stale-id'), false);
  assert.equal(registry.completeDurableTurn(scopeRef, 'checkpoint-1'), true);
  assert.equal(registry.resolveScopeTurn(scopeRef), null);
  assert.equal(checkpoints.getByScope('weixin', 'wx-active'), null);
});

test('ActiveTurnRegistry keeps its existing in-memory behavior without a checkpoint repository', () => {
  const registry = new ActiveTurnRegistry({ now: () => 1_000 });
  registry.beginScopeTurn(scopeRef);

  assert.equal(registry.updateScopeTurn(scopeRef, { threadId: 'thread-1' })?.threadId, 'thread-1');
  assert.equal(registry.endScopeTurn(scopeRef)?.threadId, 'thread-1');
  assert.equal(registry.resolveScopeTurn(scopeRef), null);
});

function makeCheckpoint(overrides: Partial<ActiveTurnCheckpoint> = {}): ActiveTurnCheckpoint {
  return {
    version: 1,
    id: 'checkpoint-1',
    platform: 'weixin',
    externalScopeId: 'wx-running',
    bridgeSessionId: 'session-1',
    providerProfileId: 'openai-default',
    threadId: 'thread-1',
    turnId: 'turn-1',
    requestFingerprint: 'sha256:test',
    requestSummary: 'test request',
    phase: 'running',
    previousPhase: null,
    approvalPending: false,
    finalDeliveryKey: null,
    outboxEntryId: null,
    reconciliationAttemptCount: 0,
    lastErrorCategory: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    lastReconciledAt: null,
    noticeDeliveredAt: null,
    expiresAt: 20_000,
    ...overrides,
  };
}

class ThrowingCheckpointRepository implements ActiveTurnCheckpointRepository {
  readonly delegate = new InMemoryActiveTurnCheckpointRepository();
  failWrites = true;

  getByScope(platform: string, externalScopeId: string) {
    return this.delegate.getByScope(platform, externalScopeId);
  }

  list() {
    return this.delegate.list();
  }

  save(checkpoint: ActiveTurnCheckpoint) {
    if (this.failWrites) {
      throw new Error('checkpoint write failed');
    }
    return this.delegate.save(checkpoint);
  }

  deleteByScope(platform: string, externalScopeId: string, expectedId: string | null = null) {
    return this.delegate.deleteByScope(platform, externalScopeId, expectedId);
  }
}
