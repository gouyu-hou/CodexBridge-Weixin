import type {
  ActiveTurnCheckpoint,
  ActiveTurnRecoveryPhase,
} from '../../types/core.js';
import type { ActiveTurnCheckpointRepository } from '../../types/repository.js';
import { JsonFileStore } from './json_file_store.js';

interface ActiveTurnCheckpointFile {
  version: 1;
  records: unknown[];
}

const RECOVERY_PHASES = new Set<ActiveTurnRecoveryPhase>([
  'starting',
  'running',
  'reconciling',
  'approval_expired',
  'completed_pending_delivery',
  'interrupted',
  'uncertain',
]);

export class FileJsonActiveTurnCheckpointRepository implements ActiveTurnCheckpointRepository {
  private readonly store: JsonFileStore<ActiveTurnCheckpointFile>;

  constructor(filePath: string) {
    this.store = new JsonFileStore(filePath, { version: 1, records: [] });
  }

  getByScope(platform: string, externalScopeId: string): ActiveTurnCheckpoint | null {
    return this.list().find((record) => (
      record.platform === platform && record.externalScopeId === externalScopeId
    )) ?? null;
  }

  list(): ActiveTurnCheckpoint[] {
    const data = this.store.read();
    const candidates = isRecord(data) && Array.isArray(data.records) ? data.records : [];
    const byScope = new Map<string, ActiveTurnCheckpoint>();
    for (const candidate of candidates) {
      const record = normalizeCheckpoint(candidate);
      if (!record) {
        continue;
      }
      const key = buildScopeKey(record.platform, record.externalScopeId);
      const current = byScope.get(key);
      if (!current || record.updatedAt >= current.updatedAt) {
        byScope.set(key, record);
      }
    }
    return [...byScope.values()].map((record) => ({ ...record }));
  }

  save(checkpoint: ActiveTurnCheckpoint): ActiveTurnCheckpoint {
    const normalized = normalizeCheckpoint(checkpoint);
    if (!normalized) {
      throw new TypeError('Invalid active turn checkpoint.');
    }
    const records = this.list().filter((record) => (
      record.platform !== normalized.platform
      || record.externalScopeId !== normalized.externalScopeId
    ));
    records.push(normalized);
    this.write(records);
    return { ...normalized };
  }

  deleteByScope(
    platform: string,
    externalScopeId: string,
    expectedId: string | null = null,
  ): boolean {
    const records = this.list();
    const current = records.find((record) => (
      record.platform === platform && record.externalScopeId === externalScopeId
    ));
    if (!current || (expectedId && current.id !== expectedId)) {
      return false;
    }
    this.write(records.filter((record) => record !== current));
    return true;
  }

  private write(records: ActiveTurnCheckpoint[]): void {
    this.store.write({
      version: 1,
      records: records.map((record) => ({ ...record })),
    });
  }
}

function normalizeCheckpoint(value: unknown): ActiveTurnCheckpoint | null {
  if (!isRecord(value) || value.version !== 1) {
    return null;
  }
  const id = normalizeString(value.id, 160);
  const platform = normalizeString(value.platform, 80);
  const externalScopeId = normalizeString(value.externalScopeId, 200);
  const phase = normalizePhase(value.phase);
  const previousPhase = value.previousPhase === null || value.previousPhase === undefined
    ? null
    : normalizePhase(value.previousPhase);
  const createdAt = normalizePositiveInteger(value.createdAt);
  const updatedAt = normalizePositiveInteger(value.updatedAt);
  const expiresAt = normalizePositiveInteger(value.expiresAt);
  if (
    !id
    || !platform
    || !externalScopeId
    || !phase
    || (value.previousPhase !== null && value.previousPhase !== undefined && !previousPhase)
    || createdAt === null
    || updatedAt === null
    || expiresAt === null
  ) {
    return null;
  }
  return {
    version: 1,
    id,
    platform,
    externalScopeId,
    bridgeSessionId: normalizeNullableString(value.bridgeSessionId, 200),
    providerProfileId: normalizeNullableString(value.providerProfileId, 200),
    threadId: normalizeNullableString(value.threadId, 240),
    turnId: normalizeNullableString(value.turnId, 240),
    requestFingerprint: normalizeString(value.requestFingerprint, 160),
    requestSummary: normalizeString(value.requestSummary, 160),
    phase,
    previousPhase,
    approvalPending: Boolean(value.approvalPending),
    finalDeliveryKey: normalizeNullableString(value.finalDeliveryKey, 320),
    outboxEntryId: normalizeNullableString(value.outboxEntryId, 160),
    reconciliationAttemptCount: normalizeNonNegativeInteger(value.reconciliationAttemptCount),
    lastErrorCategory: normalizeNullableString(value.lastErrorCategory, 80),
    createdAt,
    updatedAt,
    lastReconciledAt: normalizeNullablePositiveInteger(value.lastReconciledAt),
    noticeDeliveredAt: normalizeNullablePositiveInteger(value.noticeDeliveredAt),
    expiresAt,
  };
}

function normalizePhase(value: unknown): ActiveTurnRecoveryPhase | null {
  return typeof value === 'string' && RECOVERY_PHASES.has(value as ActiveTurnRecoveryPhase)
    ? value as ActiveTurnRecoveryPhase
    : null;
}

function normalizeNullableString(value: unknown, maxLength: number): string | null {
  const normalized = normalizeString(value, maxLength);
  return normalized || null;
}

function normalizeString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizePositiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function normalizeNullablePositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizePositiveInteger(value);
}

function normalizeNonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function buildScopeKey(platform: string, externalScopeId: string): string {
  return `${platform}:${externalScopeId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
