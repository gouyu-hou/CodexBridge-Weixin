import { randomUUID } from 'node:crypto';
import { normalizeActiveTurnDeliveryKey } from './active_turn_delivery.js';
import { formatPlatformScopeKey } from './contracts.js';
import { createI18n, type Translator } from '../i18n/index.js';
import type {
  ActiveTurnCheckpoint,
  ActiveTurnRecoveryPhase,
  PlatformScopeRef,
  TurnArtifactDeliveryState,
} from '../types/core.js';
import type { ProviderApprovalRequest } from '../types/provider.js';
import type { ActiveTurnCheckpointRepository } from '../types/repository.js';

const ACTIVE_CHECKPOINT_RETENTION_MS = 24 * 60 * 60 * 1000;
const TERMINAL_CHECKPOINT_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface ActiveTurnRecord {
  scopeRef: PlatformScopeRef;
  bridgeSessionId: string | null;
  providerProfileId: string | null;
  threadId: string | null;
  turnId: string | null;
  interruptRequested: boolean;
  interruptDispatched: boolean;
  pendingApprovals: ProviderApprovalRequest[];
  artifactDelivery: TurnArtifactDeliveryState | null;
  checkpointId: string | null;
  requestFingerprint: string;
  requestSummary: string;
  recoveryPhase: ActiveTurnRecoveryPhase;
  previousRecoveryPhase: ActiveTurnRecoveryPhase | null;
  finalDeliveryKey: string | null;
  outboxEntryId: string | null;
  reconciliationAttemptCount: number;
  lastErrorCategory: string | null;
  lastReconciledAt: number | null;
  noticeDeliveredAt: number | null;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}

interface BeginScopeTurnOptions {
  bridgeSessionId?: string | null;
  providerProfileId?: string | null;
  threadId?: string | null;
  turnId?: string | null;
}

interface ActiveTurnRegistryOptions {
  now?: () => number;
  locale?: string | null;
  checkpoints?: ActiveTurnCheckpointRepository | null;
  createId?: () => string;
}

interface BeginScopeTurnRecoveryOptions {
  requestFingerprint?: string;
  requestSummary?: string;
}

export class ActiveTurnRegistry {
  private readonly now: () => number;

  private readonly scopeTurns: Map<string, ActiveTurnRecord>;

  private readonly i18n: Translator;

  private readonly checkpoints: ActiveTurnCheckpointRepository | null;

  private readonly createId: () => string;

  constructor({
    now = () => Date.now(),
    locale = null,
    checkpoints = null,
    createId = () => randomUUID(),
  }: ActiveTurnRegistryOptions = {}) {
    this.now = now;
    this.scopeTurns = new Map();
    this.i18n = createI18n(locale);
    this.checkpoints = checkpoints;
    this.createId = createId;
  }

  resolveScopeTurn(scopeRef: PlatformScopeRef): ActiveTurnRecord | null {
    return this.scopeTurns.get(buildScopeKey(scopeRef)) ?? null;
  }

  listActiveTurns(): ActiveTurnRecord[] {
    return [...this.scopeTurns.values()];
  }

  hasAnyActiveTurn(): boolean {
    return this.scopeTurns.size > 0;
  }

  beginScopeTurn(
    scopeRef: PlatformScopeRef,
    initial: BeginScopeTurnOptions = {},
    recovery: BeginScopeTurnRecoveryOptions = {},
  ): ActiveTurnRecord {
    const scopeKey = buildScopeKey(scopeRef);
    if (this.scopeTurns.has(scopeKey)) {
      throw new Error(this.i18n.t('service.activeTurn.alreadyExists', { scope: scopeKey }));
    }
    const now = this.now();
    const record: ActiveTurnRecord = {
      scopeRef: {
        platform: scopeRef.platform,
        externalScopeId: scopeRef.externalScopeId,
      },
      bridgeSessionId: initial.bridgeSessionId ?? null,
      providerProfileId: initial.providerProfileId ?? null,
      threadId: initial.threadId ?? null,
      turnId: initial.turnId ?? null,
      interruptRequested: false,
      interruptDispatched: false,
      pendingApprovals: [],
      artifactDelivery: null,
      checkpointId: this.checkpoints ? this.createId() : null,
      requestFingerprint: String(recovery.requestFingerprint ?? '').slice(0, 160),
      requestSummary: String(recovery.requestSummary ?? '').slice(0, 160),
      recoveryPhase: 'starting',
      previousRecoveryPhase: null,
      finalDeliveryKey: null,
      outboxEntryId: null,
      reconciliationAttemptCount: 0,
      lastErrorCategory: null,
      lastReconciledAt: null,
      noticeDeliveredAt: null,
      expiresAt: now + ACTIVE_CHECKPOINT_RETENTION_MS,
      createdAt: now,
      updatedAt: now,
    };
    this.persistRecord(record);
    this.scopeTurns.set(scopeKey, record);
    return record;
  }

  updateScopeTurn(
    scopeRef: PlatformScopeRef,
    updates: Partial<ActiveTurnRecord> = {},
  ): ActiveTurnRecord | null {
    const record = this.resolveScopeTurn(scopeRef);
    if (!record) {
      return null;
    }
    const now = this.now();
    const next = {
      ...record,
      ...updates,
      scopeRef: record.scopeRef,
      updatedAt: now,
    };
    this.persistRecord(next);
    Object.assign(record, next);
    return record;
  }

  requestInterrupt(scopeRef: PlatformScopeRef): ActiveTurnRecord | null {
    return this.updateScopeTurn(scopeRef, {
      interruptRequested: true,
    });
  }

  noteInterruptDispatched(scopeRef: PlatformScopeRef, value = true): ActiveTurnRecord | null {
    return this.updateScopeTurn(scopeRef, {
      interruptDispatched: value,
    });
  }

  addPendingApproval(scopeRef: PlatformScopeRef, request: ProviderApprovalRequest): ActiveTurnRecord | null {
    const record = this.resolveScopeTurn(scopeRef);
    if (!record) {
      return null;
    }
    const next = record.pendingApprovals.filter((entry) => entry.requestId !== request.requestId);
    next.push(request);
    return this.updateScopeTurn(scopeRef, {
      pendingApprovals: next,
    });
  }

  clearPendingApproval(scopeRef: PlatformScopeRef, requestId: string): ActiveTurnRecord | null {
    const record = this.resolveScopeTurn(scopeRef);
    if (!record) {
      return null;
    }
    return this.updateScopeTurn(scopeRef, {
      pendingApprovals: record.pendingApprovals.filter((entry) => entry.requestId !== requestId),
    });
  }

  clearPendingApprovals(scopeRef: PlatformScopeRef): ActiveTurnRecord | null {
    return this.updateScopeTurn(scopeRef, {
      pendingApprovals: [],
    });
  }

  endScopeTurn(scopeRef: PlatformScopeRef): ActiveTurnRecord | null {
    const scopeKey = buildScopeKey(scopeRef);
    const record = this.scopeTurns.get(scopeKey) ?? null;
    if (record?.checkpointId && this.checkpoints) {
      this.checkpoints.deleteByScope(
        scopeRef.platform,
        scopeRef.externalScopeId,
        record.checkpointId,
      );
    }
    this.scopeTurns.delete(scopeKey);
    return record;
  }

  restoreCheckpoints(): {
    restored: ActiveTurnCheckpoint[];
    approvalExpired: ActiveTurnCheckpoint[];
    uncertain: ActiveTurnCheckpoint[];
  } {
    const restored: ActiveTurnCheckpoint[] = [];
    const approvalExpired: ActiveTurnCheckpoint[] = [];
    const uncertain: ActiveTurnCheckpoint[] = [];
    if (!this.checkpoints) {
      return { restored, approvalExpired, uncertain };
    }
    const now = this.now();
    for (const checkpoint of this.checkpoints.list()) {
      if (checkpoint.approvalPending) {
        const expiredApproval = this.checkpoints.save({
          ...checkpoint,
          previousPhase: checkpoint.phase,
          phase: 'approval_expired',
          approvalPending: false,
          noticeDeliveredAt: null,
          updatedAt: now,
          expiresAt: now + TERMINAL_CHECKPOINT_RETENTION_MS,
        });
        approvalExpired.push(expiredApproval);
        continue;
      }
      if (isTerminalRecoveryPhase(checkpoint.phase)) {
        if (checkpoint.expiresAt <= now) {
          this.checkpoints.deleteByScope(
            checkpoint.platform,
            checkpoint.externalScopeId,
            checkpoint.id,
          );
        }
        continue;
      }
      if (checkpoint.expiresAt <= now) {
        const timedOut = this.checkpoints.save({
          ...checkpoint,
          previousPhase: checkpoint.phase,
          phase: 'uncertain',
          updatedAt: now,
          expiresAt: now + TERMINAL_CHECKPOINT_RETENTION_MS,
          lastErrorCategory: 'recovery_timeout',
        });
        uncertain.push(timedOut);
        continue;
      }
      const record = recordFromCheckpoint(checkpoint);
      this.scopeTurns.set(buildScopeKey(record.scopeRef), record);
      restored.push({ ...checkpoint });
    }
    return { restored, approvalExpired, uncertain };
  }

  markCompletedPendingDelivery(
    scopeRef: PlatformScopeRef,
    finalDeliveryKey: string,
  ): ActiveTurnRecord | null {
    const record = this.resolveScopeTurn(scopeRef);
    if (!record) {
      return null;
    }
    return this.updateScopeTurn(scopeRef, {
      previousRecoveryPhase: record.recoveryPhase,
      recoveryPhase: 'completed_pending_delivery',
      finalDeliveryKey: normalizeActiveTurnDeliveryKey(finalDeliveryKey) || null,
      expiresAt: this.now() + ACTIVE_CHECKPOINT_RETENTION_MS,
    });
  }

  linkOutboxDelivery(
    scopeRef: PlatformScopeRef,
    expectedCheckpointId: string,
    outboxEntryId: string,
  ): boolean {
    const record = this.resolveScopeTurn(scopeRef);
    if (record?.checkpointId === expectedCheckpointId) {
      this.updateScopeTurn(scopeRef, {
        outboxEntryId: String(outboxEntryId ?? '').slice(0, 160) || null,
      });
      return true;
    }
    const checkpoint = this.checkpoints?.getByScope(scopeRef.platform, scopeRef.externalScopeId) ?? null;
    if (!checkpoint || checkpoint.id !== expectedCheckpointId) {
      return false;
    }
    this.checkpoints!.save({
      ...checkpoint,
      outboxEntryId: String(outboxEntryId ?? '').slice(0, 160) || null,
      updatedAt: this.now(),
    });
    return true;
  }

  completeDurableTurn(scopeRef: PlatformScopeRef, expectedCheckpointId: string): boolean {
    const key = buildScopeKey(scopeRef);
    const record = this.scopeTurns.get(key) ?? null;
    if (record && record.checkpointId !== expectedCheckpointId) {
      return false;
    }
    const persisted = this.checkpoints?.getByScope(scopeRef.platform, scopeRef.externalScopeId) ?? null;
    if (persisted && persisted.id !== expectedCheckpointId) {
      return false;
    }
    if (!record && !persisted) {
      return false;
    }
    if (
      this.checkpoints
      && !this.checkpoints.deleteByScope(
        scopeRef.platform,
        scopeRef.externalScopeId,
        expectedCheckpointId,
      )
    ) {
      return false;
    }
    this.scopeTurns.delete(key);
    return true;
  }

  completeOutboxDelivery(outboxEntryId: string): boolean {
    if (!this.checkpoints) {
      return false;
    }
    const normalizedId = String(outboxEntryId ?? '').trim();
    const checkpoint = this.checkpoints.list().find((record) => record.outboxEntryId === normalizedId) ?? null;
    if (!checkpoint) {
      return false;
    }
    return this.completeDurableTurn({
      platform: checkpoint.platform,
      externalScopeId: checkpoint.externalScopeId,
    }, checkpoint.id);
  }

  releaseScopeLock(scopeRef: PlatformScopeRef, expectedCheckpointId: string): boolean {
    const key = buildScopeKey(scopeRef);
    const record = this.scopeTurns.get(key) ?? null;
    if (!record || record.checkpointId !== expectedCheckpointId) {
      return false;
    }
    this.scopeTurns.delete(key);
    return true;
  }

  private persistRecord(record: ActiveTurnRecord): void {
    if (!this.checkpoints || !record.checkpointId) {
      return;
    }
    this.checkpoints.save(checkpointFromRecord(record));
  }
}

function buildScopeKey(scopeRef: PlatformScopeRef): string {
  return formatPlatformScopeKey(scopeRef.platform, scopeRef.externalScopeId);
}

function checkpointFromRecord(record: ActiveTurnRecord): ActiveTurnCheckpoint {
  return {
    version: 1,
    id: record.checkpointId!,
    platform: record.scopeRef.platform,
    externalScopeId: record.scopeRef.externalScopeId,
    bridgeSessionId: record.bridgeSessionId,
    providerProfileId: record.providerProfileId,
    threadId: record.threadId,
    turnId: record.turnId,
    requestFingerprint: record.requestFingerprint,
    requestSummary: record.requestSummary,
    phase: record.recoveryPhase,
    previousPhase: record.previousRecoveryPhase,
    approvalPending: record.pendingApprovals.length > 0,
    finalDeliveryKey: record.finalDeliveryKey,
    outboxEntryId: record.outboxEntryId,
    reconciliationAttemptCount: record.reconciliationAttemptCount,
    lastErrorCategory: record.lastErrorCategory,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastReconciledAt: record.lastReconciledAt,
    noticeDeliveredAt: record.noticeDeliveredAt,
    expiresAt: record.expiresAt,
  };
}

function recordFromCheckpoint(checkpoint: ActiveTurnCheckpoint): ActiveTurnRecord {
  return {
    scopeRef: {
      platform: checkpoint.platform,
      externalScopeId: checkpoint.externalScopeId,
    },
    bridgeSessionId: checkpoint.bridgeSessionId,
    providerProfileId: checkpoint.providerProfileId,
    threadId: checkpoint.threadId,
    turnId: checkpoint.turnId,
    interruptRequested: false,
    interruptDispatched: false,
    pendingApprovals: [],
    artifactDelivery: null,
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
    createdAt: checkpoint.createdAt,
    updatedAt: checkpoint.updatedAt,
  };
}

function isTerminalRecoveryPhase(phase: ActiveTurnRecoveryPhase): boolean {
  return phase === 'approval_expired' || phase === 'interrupted' || phase === 'uncertain';
}
