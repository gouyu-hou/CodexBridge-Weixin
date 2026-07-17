import { buildActiveTurnDeliveryKey } from './active_turn_delivery.js';
import { formatPlatformScopeKey } from './contracts.js';
import type { ActiveTurnRecord, ActiveTurnRegistry } from './active_turn_registry.js';
import type {
  ActiveTurnCheckpoint,
  ActiveTurnRecoveryPhase,
  PlatformScopeRef,
} from '../types/core.js';
import type {
  ActiveTurnCheckpointRepository,
  BridgeSessionRepository,
  PlatformBindingRepository,
  ProviderProfileRepository,
} from '../types/repository.js';
import type {
  ProviderPluginContract,
  ProviderThreadTurn,
  ProviderThreadTurnItem,
} from '../types/provider.js';

export type ActiveTurnRecoveryOutcome =
  | { kind: 'running'; checkpoint: ActiveTurnCheckpoint }
  | {
    kind: 'completed';
    checkpoint: ActiveTurnCheckpoint;
    outputText: string;
    turnId: string;
  }
  | {
    kind: 'notice';
    checkpoint: ActiveTurnCheckpoint;
    noticeKind: 'approval_expired' | 'interrupted' | 'uncertain';
  }
  | { kind: 'retry'; checkpoint: ActiveTurnCheckpoint; delayMs: number };

interface ProviderRegistryLike {
  getProvider<T extends { kind: string }>(providerKind: string): T;
}

interface ActiveTurnRecoveryServiceOptions {
  checkpoints: ActiveTurnCheckpointRepository;
  activeTurns: ActiveTurnRegistry;
  providerProfiles: ProviderProfileRepository;
  providerRegistry: ProviderRegistryLike;
  bridgeSessions?: BridgeSessionRepository | null;
  platformBindings?: PlatformBindingRepository | null;
  now?: () => number;
}

const TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;

export class ActiveTurnRecoveryService {
  private readonly checkpoints: ActiveTurnCheckpointRepository;
  private readonly activeTurns: ActiveTurnRegistry;
  private readonly providerProfiles: ProviderProfileRepository;
  private readonly providerRegistry: ProviderRegistryLike;
  private readonly bridgeSessions: BridgeSessionRepository | null;
  private readonly platformBindings: PlatformBindingRepository | null;
  private readonly now: () => number;
  private readonly checkpointReconciliationInFlight = new Map<string, Promise<ActiveTurnRecoveryOutcome>>();
  private readonly terminalNoticeClaims = new Set<string>();

  constructor({
    checkpoints,
    activeTurns,
    providerProfiles,
    providerRegistry,
    bridgeSessions = null,
    platformBindings = null,
    now = () => Date.now(),
  }: ActiveTurnRecoveryServiceOptions) {
    this.checkpoints = checkpoints;
    this.activeTurns = activeTurns;
    this.providerProfiles = providerProfiles;
    this.providerRegistry = providerRegistry;
    this.bridgeSessions = bridgeSessions;
    this.platformBindings = platformBindings;
    this.now = now;
  }

  restoreLocks() {
    return this.activeTurns.restoreCheckpoints();
  }

  async reconcileAll(): Promise<ActiveTurnRecoveryOutcome[]> {
    const outcomes = await Promise.all(this.checkpoints.list().map(async (checkpoint) => {
      if (checkpoint.phase === 'completed_pending_delivery' && checkpoint.outboxEntryId) {
        return null;
      }
      const noticeKind = terminalNoticeKind(checkpoint.phase);
      if (noticeKind) {
        return this.claimTerminalNotice(checkpoint, noticeKind);
      }
      return this.reconcileCheckpoint(checkpoint);
    }));
    return outcomes.filter((outcome): outcome is ActiveTurnRecoveryOutcome => Boolean(outcome));
  }

  acknowledgeNotice(checkpointId: string): boolean {
    const normalizedId = String(checkpointId ?? '').trim();
    const checkpoint = this.checkpoints.list().find((record) => record.id === normalizedId) ?? null;
    if (!checkpoint) {
      return false;
    }
    this.checkpoints.save({
      ...checkpoint,
      noticeDeliveredAt: this.now(),
      updatedAt: this.now(),
    });
    this.terminalNoticeClaims.delete(normalizedId);
    return true;
  }

  releaseNotice(checkpointId: string): boolean {
    const normalizedId = String(checkpointId ?? '').trim();
    if (!normalizedId) {
      return false;
    }
    return this.terminalNoticeClaims.delete(normalizedId);
  }

  private claimTerminalNotice(
    checkpoint: ActiveTurnCheckpoint,
    noticeKind: 'approval_expired' | 'interrupted' | 'uncertain',
  ): ActiveTurnRecoveryOutcome | null {
    if (checkpoint.noticeDeliveredAt || this.terminalNoticeClaims.has(checkpoint.id)) {
      return null;
    }
    this.terminalNoticeClaims.add(checkpoint.id);
    return { kind: 'notice', checkpoint, noticeKind };
  }

  getStatus() {
    const records = this.checkpoints.list();
    const now = this.now();
    const oldestCreatedAt = records.reduce<number | null>((oldest, record) => (
      oldest === null ? record.createdAt : Math.min(oldest, record.createdAt)
    ), null);
    const lastReconciledAt = records.reduce<number | null>((latest, record) => {
      if (!record.lastReconciledAt) {
        return latest;
      }
      return latest === null ? record.lastReconciledAt : Math.max(latest, record.lastReconciledAt);
    }, null);
    const latestError = [...records]
      .filter((record) => record.lastErrorCategory)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
    return {
      total: records.length,
      running: records.filter((record) => record.phase === 'running').length,
      reconciling: records.filter((record) => record.phase === 'reconciling').length,
      uncertain: records.filter((record) => record.phase === 'uncertain').length,
      completedPendingDelivery: records.filter((record) => record.phase === 'completed_pending_delivery').length,
      interrupted: records.filter((record) => record.phase === 'interrupted').length,
      approvalExpired: records.filter((record) => record.phase === 'approval_expired').length,
      oldestAgeMs: oldestCreatedAt === null ? null : Math.max(0, now - oldestCreatedAt),
      lastReconciledAt,
      lastErrorCategory: latestError?.lastErrorCategory ?? null,
    };
  }

  async reconcileCheckpoint(checkpoint: ActiveTurnCheckpoint): Promise<ActiveTurnRecoveryOutcome> {
    const key = buildScopeKey(checkpoint.platform, checkpoint.externalScopeId);
    const existing = this.checkpointReconciliationInFlight.get(key);
    if (existing) {
      return existing;
    }
    const task = this.reconcileCheckpointInternal(checkpoint).finally(() => {
      if (this.checkpointReconciliationInFlight.get(key) === task) {
        this.checkpointReconciliationInFlight.delete(key);
      }
    });
    this.checkpointReconciliationInFlight.set(key, task);
    return task;
  }

  private async reconcileCheckpointInternal(checkpoint: ActiveTurnCheckpoint): Promise<ActiveTurnRecoveryOutcome> {
    if (checkpoint.approvalPending || checkpoint.phase === 'approval_expired') {
      const expired = this.transition(checkpoint, 'approval_expired', {
        approvalPending: false,
        lastErrorCategory: null,
      }, false);
      return { kind: 'notice', checkpoint: expired, noticeKind: 'approval_expired' };
    }

    const now = this.now();
    if (checkpoint.expiresAt <= now) {
      return this.terminalNotice(checkpoint, 'uncertain', 'recovery_timeout');
    }

    const reconciling = this.transition(checkpoint, 'reconciling', {
      reconciliationAttemptCount: checkpoint.reconciliationAttemptCount + 1,
      lastReconciledAt: now,
      lastErrorCategory: null,
    });
    const providerProfile = reconciling.providerProfileId
      ? this.providerProfiles.getById(reconciling.providerProfileId)
      : null;
    if (!providerProfile || !reconciling.threadId || !this.hasValidBinding(reconciling)) {
      return this.terminalNotice(reconciling, 'uncertain', 'recovery_identity_missing');
    }

    let providerPlugin: ProviderPluginContract;
    try {
      providerPlugin = this.providerRegistry.getProvider<ProviderPluginContract>(providerProfile.providerKind);
    } catch {
      return this.terminalNotice(reconciling, 'uncertain', 'provider_unavailable');
    }
    if (typeof providerPlugin.readThread !== 'function') {
      return this.terminalNotice(reconciling, 'uncertain', 'thread_read_unsupported');
    }

    let thread;
    try {
      thread = await providerPlugin.readThread({
        providerProfile,
        threadId: reconciling.threadId,
        includeTurns: true,
      });
    } catch {
      const retrying = this.transition(reconciling, 'reconciling', {
        lastErrorCategory: 'provider_unavailable',
      });
      return {
        kind: 'retry',
        checkpoint: retrying,
        delayMs: recoveryRetryDelayMs(retrying.reconciliationAttemptCount),
      };
    }
    if (!thread) {
      return this.terminalNotice(reconciling, 'uncertain', 'thread_missing');
    }

    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    let turn = reconciling.turnId
      ? turns.find((candidate) => candidate.id === reconciling.turnId) ?? null
      : null;
    if (!reconciling.turnId) {
      const runningTurns = turns.filter((candidate) => !isProviderTurnTerminal(candidate.status));
      if (runningTurns.length !== 1 || !runningTurns[0]?.id) {
        return this.terminalNotice(reconciling, 'uncertain', 'turn_ambiguous');
      }
      turn = runningTurns[0];
    }
    if (!turn) {
      return this.terminalNotice(reconciling, 'uncertain', 'turn_missing');
    }

    if (!isProviderTurnTerminal(turn.status)) {
      const running = this.transition(reconciling, 'running', {
        turnId: turn.id,
        lastErrorCategory: null,
      });
      return { kind: 'running', checkpoint: running };
    }
    if (!isSuccessfulProviderTurn(turn.status)) {
      return this.terminalNotice(reconciling, 'interrupted', 'provider_turn_interrupted');
    }

    const outputText = extractRecoveredTurnOutput(turn);
    const deliveryKey = buildRecoveredDeliveryKey(
      reconciling.providerProfileId,
      reconciling.threadId,
      turn.id,
    );
    const completed = this.transition(reconciling, 'completed_pending_delivery', {
      turnId: turn.id,
      finalDeliveryKey: deliveryKey,
      lastErrorCategory: outputText ? null : 'output_unavailable',
    });
    if (!outputText) {
      return {
        kind: 'retry',
        checkpoint: completed,
        delayMs: recoveryRetryDelayMs(completed.reconciliationAttemptCount),
      };
    }
    return {
      kind: 'completed',
      checkpoint: completed,
      outputText,
      turnId: turn.id,
    };
  }

  private terminalNotice(
    checkpoint: ActiveTurnCheckpoint,
    phase: 'interrupted' | 'uncertain',
    lastErrorCategory: string,
  ): ActiveTurnRecoveryOutcome {
    const terminal = this.transition(checkpoint, phase, {
      lastErrorCategory,
      expiresAt: this.now() + TERMINAL_RETENTION_MS,
    }, false);
    return { kind: 'notice', checkpoint: terminal, noticeKind: phase };
  }

  private hasValidBinding(checkpoint: ActiveTurnCheckpoint): boolean {
    if (!this.bridgeSessions && !this.platformBindings) {
      return true;
    }
    if (!checkpoint.bridgeSessionId || !checkpoint.providerProfileId || !checkpoint.threadId) {
      return false;
    }
    const session = this.bridgeSessions?.getById(checkpoint.bridgeSessionId) ?? null;
    if (
      this.bridgeSessions
      && (
        !session
        || session.providerProfileId !== checkpoint.providerProfileId
        || session.codexThreadId !== checkpoint.threadId
      )
    ) {
      return false;
    }
    if (this.platformBindings) {
      const binding = this.platformBindings.getByScope(checkpoint.platform, checkpoint.externalScopeId);
      if (!binding || binding.bridgeSessionId !== checkpoint.bridgeSessionId) {
        return false;
      }
    }
    return true;
  }

  private transition(
    checkpoint: ActiveTurnCheckpoint,
    phase: ActiveTurnRecoveryPhase,
    patch: Partial<ActiveTurnCheckpoint>,
    keepLock = true,
  ): ActiveTurnCheckpoint {
    const now = this.now();
    const next: ActiveTurnCheckpoint = {
      ...checkpoint,
      ...patch,
      previousPhase: checkpoint.phase === phase ? checkpoint.previousPhase : checkpoint.phase,
      phase,
      updatedAt: now,
    };
    const scopeRef = toScopeRef(next);
    const active = this.activeTurns.resolveScopeTurn(scopeRef);
    let saved: ActiveTurnCheckpoint;
    if (active?.checkpointId === next.id) {
      this.activeTurns.updateScopeTurn(scopeRef, recordPatchFromCheckpoint(next));
      saved = this.checkpoints.getByScope(next.platform, next.externalScopeId) ?? next;
      if (!keepLock) {
        this.activeTurns.releaseScopeLock(scopeRef, next.id);
      }
    } else {
      saved = this.checkpoints.save(next);
    }
    return saved;
  }
}

export function recoveryRetryDelayMs(attemptCount: number): number {
  const normalized = Math.max(0, Math.floor(Number(attemptCount) || 0));
  return Math.min(30_000, 1_000 * (2 ** Math.min(5, normalized)));
}

export function extractRecoveredTurnOutput(turn: ProviderThreadTurn): string {
  const items = Array.isArray(turn.items) ? turn.items : [];
  const finalItems = items.filter((item) => (
    isAssistantItem(item) && ['final', 'final_answer'].includes(String(item.phase ?? '').toLowerCase())
  ));
  const selected = finalItems.length > 0 ? finalItems : items.filter(isAssistantItem);
  return selected
    .map((item) => String(item.text ?? '').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function isAssistantItem(item: ProviderThreadTurnItem): boolean {
  const role = String(item.role ?? '').toLowerCase();
  const type = String(item.type ?? '').replace(/[_-]/gu, '').toLowerCase();
  return role === 'assistant'
    || type === 'agentmessage'
    || type === 'assistantmessage';
}

function isProviderTurnTerminal(status: string | null | undefined): boolean {
  const normalized = String(status ?? '').trim().toLowerCase();
  return [
    'completed',
    'complete',
    'succeeded',
    'success',
    'finished',
    'failed',
    'error',
    'timed_out',
    'timeout',
    'interrupted',
    'cancelled',
    'canceled',
    'aborted',
  ].includes(normalized);
}

function isSuccessfulProviderTurn(status: string | null | undefined): boolean {
  return ['completed', 'complete', 'succeeded', 'success', 'finished']
    .includes(String(status ?? '').trim().toLowerCase());
}

function buildRecoveredDeliveryKey(
  providerProfileId: string | null,
  threadId: string,
  turnId: string,
): string {
  return buildActiveTurnDeliveryKey(providerProfileId, threadId, turnId);
}

function toScopeRef(checkpoint: ActiveTurnCheckpoint): PlatformScopeRef {
  return {
    platform: checkpoint.platform,
    externalScopeId: checkpoint.externalScopeId,
  };
}

function buildScopeKey(platform: string, externalScopeId: string): string {
  return formatPlatformScopeKey(platform, externalScopeId);
}

function recordPatchFromCheckpoint(checkpoint: ActiveTurnCheckpoint): Partial<ActiveTurnRecord> {
  return {
    bridgeSessionId: checkpoint.bridgeSessionId,
    providerProfileId: checkpoint.providerProfileId,
    threadId: checkpoint.threadId,
    turnId: checkpoint.turnId,
    checkpointId: checkpoint.id,
    requestFingerprint: checkpoint.requestFingerprint,
    requestSummary: checkpoint.requestSummary,
    recoveryPhase: checkpoint.phase,
    previousRecoveryPhase: checkpoint.previousPhase,
    finalDeliveryKey: checkpoint.finalDeliveryKey,
    outboxEntryId: checkpoint.outboxEntryId,
    reconciliationAttemptCount: checkpoint.reconciliationAttemptCount,
    lastErrorCategory: checkpoint.lastErrorCategory,
    lastReconciledAt: checkpoint.lastReconciledAt,
    noticeDeliveredAt: checkpoint.noticeDeliveredAt,
    expiresAt: checkpoint.expiresAt,
  };
}

function terminalNoticeKind(
  phase: ActiveTurnRecoveryPhase,
): 'approval_expired' | 'interrupted' | 'uncertain' | null {
  if (phase === 'approval_expired' || phase === 'interrupted' || phase === 'uncertain') {
    return phase;
  }
  return null;
}
