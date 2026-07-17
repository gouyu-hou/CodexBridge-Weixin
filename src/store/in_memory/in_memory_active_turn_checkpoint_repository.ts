import type { ActiveTurnCheckpoint } from '../../types/core.js';
import type { ActiveTurnCheckpointRepository } from '../../types/repository.js';

export class InMemoryActiveTurnCheckpointRepository implements ActiveTurnCheckpointRepository {
  private readonly records = new Map<string, ActiveTurnCheckpoint>();

  getByScope(platform: string, externalScopeId: string): ActiveTurnCheckpoint | null {
    const value = this.records.get(buildScopeKey(platform, externalScopeId));
    return value ? { ...value } : null;
  }

  list(): ActiveTurnCheckpoint[] {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  save(checkpoint: ActiveTurnCheckpoint): ActiveTurnCheckpoint {
    const saved = { ...checkpoint };
    this.records.set(buildScopeKey(saved.platform, saved.externalScopeId), saved);
    return { ...saved };
  }

  deleteByScope(
    platform: string,
    externalScopeId: string,
    expectedId: string | null = null,
  ): boolean {
    const key = buildScopeKey(platform, externalScopeId);
    const current = this.records.get(key);
    if (!current || (expectedId && current.id !== expectedId)) {
      return false;
    }
    return this.records.delete(key);
  }
}

function buildScopeKey(platform: string, externalScopeId: string): string {
  return `${platform}:${externalScopeId}`;
}
