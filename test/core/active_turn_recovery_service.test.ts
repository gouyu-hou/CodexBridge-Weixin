import assert from 'node:assert/strict';
import test from 'node:test';
import { ActiveTurnRecoveryService, recoveryRetryDelayMs } from '../../src/core/active_turn_recovery_service.js';
import { ActiveTurnRegistry } from '../../src/core/active_turn_registry.js';
import { InMemoryActiveTurnCheckpointRepository } from '../../src/store/in_memory/in_memory_active_turn_checkpoint_repository.js';
import { InMemoryBridgeSessionRepository } from '../../src/store/in_memory/in_memory_bridge_session_repository.js';
import { InMemoryProviderProfileRepository } from '../../src/store/in_memory/in_memory_provider_profile_repository.js';
import { InMemoryPlatformBindingRepository } from '../../src/store/in_memory/in_memory_platform_binding_repository.js';
import { PluginRegistry } from '../../src/runtime/plugin_registry.js';
import type { ActiveTurnCheckpoint } from '../../src/types/core.js';

test('ActiveTurnRecoveryService returns completed provider output without replaying the turn', async () => {
  const harness = makeHarness({
    threadId: 'thread-1',
    cwd: '/repo',
    title: 'Recovered',
    turns: [{
      id: 'turn-1',
      status: 'completed',
      error: null,
      items: [{ type: 'agentMessage', role: 'assistant', phase: 'final_answer', text: 'recovered final answer' }],
    }],
  });

  const outcome = await harness.recovery.reconcileCheckpoint(harness.checkpoint);

  assert.equal(outcome.kind, 'completed');
  assert.equal(outcome.kind === 'completed' ? outcome.outputText : '', 'recovered final answer');
  assert.equal(harness.provider.readCalls, 1);
  assert.equal(harness.provider.startCalls, 0);
  assert.equal(harness.checkpoints.getByScope('weixin', 'wx-recovery')?.phase, 'completed_pending_delivery');
});

test('ActiveTurnRecoveryService keeps a known non-terminal turn locked', async () => {
  const harness = makeHarness({
    threadId: 'thread-1',
    cwd: '/repo',
    title: 'Running',
    turns: [{ id: 'turn-1', status: 'inProgress', error: null, items: [] }],
  });

  const outcome = await harness.recovery.reconcileCheckpoint(harness.checkpoint);

  assert.equal(outcome.kind, 'running');
  assert.equal(harness.activeTurns.resolveScopeTurn(scopeRef)?.recoveryPhase, 'running');
  assert.equal(harness.checkpoints.getByScope('weixin', 'wx-recovery')?.lastErrorCategory, null);
});

test('ActiveTurnRecoveryService uniquely rebinds a starting checkpoint without a turn id', async () => {
  const harness = makeHarness({
    threadId: 'thread-1',
    cwd: '/repo',
    title: 'Running',
    turns: [{ id: 'turn-rebound', status: 'running', error: null, items: [] }],
  }, { turnId: null, phase: 'starting' });

  const outcome = await harness.recovery.reconcileCheckpoint(harness.checkpoint);

  assert.equal(outcome.kind, 'running');
  assert.equal(harness.checkpoints.getByScope('weixin', 'wx-recovery')?.turnId, 'turn-rebound');
  assert.equal(harness.activeTurns.resolveScopeTurn(scopeRef)?.turnId, 'turn-rebound');
});

test('ActiveTurnRecoveryService marks ambiguous and interrupted turns terminal without replay', async () => {
  const ambiguous = makeHarness({
    threadId: 'thread-1',
    cwd: '/repo',
    title: 'Ambiguous',
    turns: [
      { id: 'running-a', status: 'running', error: null, items: [] },
      { id: 'running-b', status: 'running', error: null, items: [] },
    ],
  }, { turnId: null, phase: 'starting' });
  const interrupted = makeHarness({
    threadId: 'thread-1',
    cwd: '/repo',
    title: 'Interrupted',
    turns: [{ id: 'turn-1', status: 'failed', error: 'provider failed', items: [] }],
  });

  const ambiguousOutcome = await ambiguous.recovery.reconcileCheckpoint(ambiguous.checkpoint);
  const interruptedOutcome = await interrupted.recovery.reconcileCheckpoint(interrupted.checkpoint);

  assert.equal(ambiguousOutcome.kind, 'notice');
  assert.equal(ambiguousOutcome.kind === 'notice' ? ambiguousOutcome.noticeKind : '', 'uncertain');
  assert.equal(interruptedOutcome.kind, 'notice');
  assert.equal(interruptedOutcome.kind === 'notice' ? interruptedOutcome.noticeKind : '', 'interrupted');
  assert.equal(ambiguous.activeTurns.resolveScopeTurn(scopeRef), null);
  assert.equal(interrupted.activeTurns.resolveScopeTurn(scopeRef), null);
  assert.equal(ambiguous.provider.startCalls + interrupted.provider.startCalls, 0);
});

test('ActiveTurnRecoveryService retries transient provider reads with bounded backoff', async () => {
  const harness = makeHarness(new Error('provider unavailable'));

  const outcome = await harness.recovery.reconcileCheckpoint(harness.checkpoint);

  assert.equal(outcome.kind, 'retry');
  assert.equal(outcome.kind === 'retry' ? outcome.delayMs : 0, 2_000);
  assert.equal(harness.checkpoints.getByScope('weixin', 'wx-recovery')?.phase, 'reconciling');
  assert.equal(harness.checkpoints.getByScope('weixin', 'wx-recovery')?.lastErrorCategory, 'provider_unavailable');
  assert.equal(recoveryRetryDelayMs(100), 30_000);
});

test('ActiveTurnRecoveryService does not refresh the active recovery deadline while a turn keeps running', async () => {
  const harness = makeHarness({
    threadId: 'thread-1',
    cwd: '/repo',
    title: 'Running',
    turns: [{ id: 'turn-1', status: 'running', error: null, items: [] }],
  });

  const first = await harness.recovery.reconcileCheckpoint(harness.checkpoint);
  assert.equal(first.kind, 'running');
  harness.clock.value = 20_001;
  const second = await harness.recovery.reconcileCheckpoint(
    harness.checkpoints.getByScope('weixin', 'wx-recovery')!,
  );

  assert.equal(second.kind, 'notice');
  assert.equal(second.kind === 'notice' ? second.noticeKind : '', 'uncertain');
});

test('ActiveTurnRecoveryService single-flights concurrent full reconciliation', async () => {
  const harness = makeHarness({
    threadId: 'thread-1',
    cwd: '/repo',
    title: 'Completed',
    turns: [{
      id: 'turn-1',
      status: 'completed',
      error: null,
      items: [{ type: 'agentMessage', role: 'assistant', phase: 'final_answer', text: 'done' }],
    }],
  });
  let releaseRead: (() => void) | null = null;
  let readStarted: (() => void) | null = null;
  const started = new Promise<void>((resolve) => { readStarted = resolve; });
  const gate = new Promise<void>((resolve) => { releaseRead = resolve; });
  const originalRead = harness.provider.readThread.bind(harness.provider);
  harness.provider.readThread = async (...args: any[]) => {
    readStarted?.();
    await gate;
    return originalRead(...args);
  };

  const first = harness.recovery.reconcileAll();
  await started;
  const second = harness.recovery.reconcileAll();
  releaseRead?.();
  const [firstOutcomes, secondOutcomes] = await Promise.all([first, second]);

  assert.equal(harness.provider.readCalls, 1);
  assert.equal(firstOutcomes[0]?.kind, 'completed');
  assert.equal(secondOutcomes[0]?.kind, 'completed');
});

test('ActiveTurnRecoveryService claims terminal notices until delivery is acknowledged or released', async () => {
  const harness = makeHarness({
    threadId: 'thread-1',
    cwd: '/repo',
    title: 'Interrupted',
    turns: [],
  }, {
    phase: 'interrupted',
    lastErrorCategory: 'provider_turn_interrupted',
  });

  const [first, second] = await Promise.all([
    harness.recovery.reconcileAll(),
    harness.recovery.reconcileAll(),
  ]);

  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(first[0]?.kind, 'notice');
  assert.equal(harness.recovery.releaseNotice('checkpoint-1'), true);
  assert.equal((await harness.recovery.reconcileAll()).length, 1);
  assert.equal(harness.recovery.acknowledgeNotice('checkpoint-1'), true);
  assert.equal((await harness.recovery.reconcileAll()).length, 0);
});

test('ActiveTurnRecoveryService refuses to recover when the persisted scope binding is gone', async () => {
  const harness = makeHarness({
    threadId: 'thread-1',
    cwd: '/repo',
    title: 'Completed',
    turns: [{
      id: 'turn-1',
      status: 'completed',
      error: null,
      items: [{ type: 'agentMessage', role: 'assistant', phase: 'final_answer', text: 'must not deliver' }],
    }],
  });
  const bridgeSessions = new InMemoryBridgeSessionRepository();
  const platformBindings = new InMemoryPlatformBindingRepository();
  const recovery = new ActiveTurnRecoveryService({
    checkpoints: harness.checkpoints,
    activeTurns: harness.activeTurns,
    providerProfiles: harness.providerProfiles,
    providerRegistry: harness.providerRegistry,
    bridgeSessions,
    platformBindings,
    now: () => harness.clock.value,
  });

  const outcome = await recovery.reconcileCheckpoint(harness.checkpoint);

  assert.equal(outcome.kind, 'notice');
  assert.equal(outcome.kind === 'notice' ? outcome.noticeKind : '', 'uncertain');
  assert.equal(harness.provider.readCalls, 0);
});

test('ActiveTurnRecoveryService exposes aggregate status and acknowledges notices once', async () => {
  const harness = makeHarness({
    threadId: 'thread-1',
    cwd: '/repo',
    title: 'Interrupted',
    turns: [{ id: 'turn-1', status: 'failed', error: 'secret provider error', items: [] }],
  });
  const outcome = await harness.recovery.reconcileCheckpoint(harness.checkpoint);
  assert.equal(outcome.kind, 'notice');

  assert.equal(harness.recovery.acknowledgeNotice('checkpoint-1'), true);
  const status = harness.recovery.getStatus();

  assert.deepEqual(status, {
    total: 1,
    running: 0,
    reconciling: 0,
    uncertain: 0,
    completedPendingDelivery: 0,
    interrupted: 1,
    approvalExpired: 0,
    oldestAgeMs: 9_000,
    lastReconciledAt: 10_000,
    lastErrorCategory: 'provider_turn_interrupted',
  });
  assert.equal(JSON.stringify(status).includes('wx-recovery'), false);
  assert.equal(JSON.stringify(status).includes('secret provider error'), false);
  assert.equal((await harness.recovery.reconcileAll()).length, 0);
});

const scopeRef = { platform: 'weixin', externalScopeId: 'wx-recovery' };

function makeHarness(
  threadOrError: Record<string, unknown> | Error,
  checkpointOverrides: Partial<ActiveTurnCheckpoint> = {},
) {
  const clock = { value: 10_000 };
  const checkpoint = makeCheckpoint(checkpointOverrides);
  const checkpoints = new InMemoryActiveTurnCheckpointRepository();
  checkpoints.save(checkpoint);
  const activeTurns = new ActiveTurnRegistry({ checkpoints, now: () => clock.value });
  activeTurns.restoreCheckpoints();
  const providerProfiles = new InMemoryProviderProfileRepository();
  providerProfiles.save({
    id: 'openai-default',
    providerKind: 'fake-provider',
    displayName: 'Fake Provider',
    config: {},
    createdAt: clock.value,
    updatedAt: clock.value,
  });
  const provider = {
    kind: 'fake-provider',
    readCalls: 0,
    startCalls: 0,
    async readThread() {
      this.readCalls += 1;
      if (threadOrError instanceof Error) {
        throw threadOrError;
      }
      return threadOrError;
    },
    async startTurn() {
      this.startCalls += 1;
      throw new Error('recovery must not replay');
    },
  };
  const providerRegistry = new PluginRegistry();
  providerRegistry.registerProvider(provider);
  const recovery = new ActiveTurnRecoveryService({
    checkpoints,
    activeTurns,
    providerProfiles,
    providerRegistry,
    now: () => clock.value,
  });
  return { recovery, checkpoint, checkpoints, activeTurns, provider, providerProfiles, providerRegistry, clock };
}

function makeCheckpoint(overrides: Partial<ActiveTurnCheckpoint> = {}): ActiveTurnCheckpoint {
  return {
    version: 1,
    id: 'checkpoint-1',
    platform: 'weixin',
    externalScopeId: 'wx-recovery',
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
