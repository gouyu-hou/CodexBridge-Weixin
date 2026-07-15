import { NotFoundError } from './errors.js';
import type { PluginRegistry } from '../runtime/plugin_registry.js';
import type {
  ProviderPluginContract,
  ProviderProfile,
  ProviderUsageBucket,
  ProviderUsageCredits,
  ProviderUsageReport,
  ProviderUsageWindow,
} from '../types/provider.js';
import type { ProviderProfileRepository } from '../types/repository.js';

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BUCKETS = 20;
const MAX_WINDOWS_PER_BUCKET = 10;

export interface ProviderUsageSnapshot {
  providerProfileId: string;
  providerKind: string;
  report: ProviderUsageReport | null;
  source: 'provider' | 'cache';
  fetchedAt: number;
  expiresAt: number;
  refreshFailed: boolean;
}

export interface ProviderUsageCatalog {
  getUsage(
    providerProfileId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<ProviderUsageSnapshot>;
  invalidate(providerProfileId?: string): void;
}

interface ProviderUsageServiceOptions {
  providerProfiles: Pick<ProviderProfileRepository, 'getById'>;
  providerRegistry: Pick<PluginRegistry, 'getProvider'>;
  cacheTtlMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

interface CacheEntry {
  providerProfileId: string;
  snapshot: ProviderUsageSnapshot;
}

export class ProviderUsageService implements ProviderUsageCatalog {
  private readonly providerProfiles: Pick<ProviderProfileRepository, 'getById'>;

  private readonly providerRegistry: Pick<PluginRegistry, 'getProvider'>;

  private readonly cacheTtlMs: number;

  private readonly timeoutMs: number;

  private readonly now: () => number;

  private readonly completed = new Map<string, CacheEntry>();

  private readonly inFlight = new Map<string, Promise<ProviderUsageSnapshot>>();

  private readonly profileGenerations = new Map<string, number>();

  private globalGeneration = 0;

  constructor(options: ProviderUsageServiceOptions) {
    this.providerProfiles = options.providerProfiles;
    this.providerRegistry = options.providerRegistry;
    this.cacheTtlMs = Math.max(0, Number(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS));
    this.timeoutMs = Math.max(1, Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    this.now = options.now ?? Date.now;
  }

  async getUsage(
    providerProfileId: string,
    options: { forceRefresh?: boolean } = {},
  ): Promise<ProviderUsageSnapshot> {
    const profile = this.providerProfiles.getById(providerProfileId);
    if (!profile) {
      throw new NotFoundError(`Provider profile not found: ${providerProfileId}`);
    }

    const identity = this.cacheIdentity(profile);
    const inFlight = this.inFlight.get(identity);
    if (inFlight) {
      return cloneSnapshot(await inFlight);
    }

    const cached = this.completed.get(identity)?.snapshot;
    if (!options.forceRefresh && cached && cached.expiresAt > this.now()) {
      return cloneSnapshot(cached, 'cache');
    }

    const request = this.refresh(profile, identity);
    this.inFlight.set(identity, request);
    try {
      return cloneSnapshot(await request);
    } finally {
      if (this.inFlight.get(identity) === request) {
        this.inFlight.delete(identity);
      }
    }
  }

  invalidate(providerProfileId?: string): void {
    if (providerProfileId === undefined) {
      this.globalGeneration += 1;
      this.completed.clear();
      return;
    }
    this.profileGenerations.set(
      providerProfileId,
      (this.profileGenerations.get(providerProfileId) ?? 0) + 1,
    );
    for (const [identity, entry] of this.completed) {
      if (entry.providerProfileId === providerProfileId) {
        this.completed.delete(identity);
      }
    }
  }

  private async refresh(profile: ProviderProfile, identity: string): Promise<ProviderUsageSnapshot> {
    const fetchedAt = this.now();
    let report: ProviderUsageReport | null = null;
    let refreshFailed = false;
    try {
      const provider = this.providerRegistry.getProvider<ProviderPluginContract>(profile.providerKind);
      if (typeof provider?.getUsage === 'function') {
        report = normalizeReport(
          await withTimeout(
            provider.getUsage({ providerProfile: profile }),
            this.timeoutMs,
          ),
          profile.providerKind,
        );
      }
    } catch (error) {
      report = null;
      refreshFailed = !(error instanceof NotFoundError);
    }

    const snapshot: ProviderUsageSnapshot = {
      providerProfileId: profile.id,
      providerKind: profile.providerKind,
      report,
      source: 'provider',
      fetchedAt,
      expiresAt: fetchedAt + this.cacheTtlMs,
      refreshFailed,
    };
    if (this.isCurrentIdentity(profile, identity)) {
      this.completed.set(identity, {
        providerProfileId: profile.id,
        snapshot: cloneSnapshot(snapshot),
      });
    }
    return snapshot;
  }

  private cacheIdentity(profile: ProviderProfile): string {
    return JSON.stringify([
      this.globalGeneration,
      profile.id,
      profile.updatedAt,
      this.profileGenerations.get(profile.id) ?? 0,
    ]);
  }

  private isCurrentIdentity(profile: ProviderProfile, identity: string): boolean {
    const current = this.providerProfiles.getById(profile.id);
    return current !== null && this.cacheIdentity(current) === identity;
  }
}

function normalizeReport(value: unknown, providerKind: string): ProviderUsageReport | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    provider: normalizeText(value.provider, 80) || providerKind,
    accountId: normalizeOptionalText(value.accountId, 320),
    userId: normalizeOptionalText(value.userId, 320),
    email: normalizeOptionalText(value.email, 320),
    plan: normalizeOptionalText(value.plan, 120),
    buckets: normalizeBuckets(value.buckets),
    credits: normalizeCredits(value.credits),
  };
}

function normalizeBuckets(value: unknown): ProviderUsageBucket[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const buckets: ProviderUsageBucket[] = [];
  for (const candidate of value.slice(0, MAX_BUCKETS)) {
    if (!isRecord(candidate)) {
      continue;
    }
    buckets.push({
      name: normalizeText(candidate.name, 120),
      allowed: candidate.allowed === true,
      limitReached: candidate.limitReached === true,
      windows: normalizeWindows(candidate.windows),
    });
  }
  return buckets;
}

function normalizeWindows(value: unknown): ProviderUsageWindow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const windows: ProviderUsageWindow[] = [];
  for (const candidate of value.slice(0, MAX_WINDOWS_PER_BUCKET)) {
    if (!isRecord(candidate)) {
      continue;
    }
    windows.push({
      name: normalizeText(candidate.name, 120),
      usedPercent: clampPercent(candidate.usedPercent),
      windowSeconds: normalizeNonNegativeInteger(candidate.windowSeconds),
      resetAfterSeconds: normalizeNonNegativeInteger(candidate.resetAfterSeconds),
      resetAtUnix: normalizeNonNegativeInteger(candidate.resetAtUnix),
    });
  }
  return windows;
}

function normalizeCredits(value: unknown): ProviderUsageCredits | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    hasCredits: value.hasCredits === true,
    unlimited: value.unlimited === true,
    balance: normalizeOptionalText(value.balance, 120),
  };
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  return normalizeText(value, maxLength) || null;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function clampPercent(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

function cloneSnapshot(
  snapshot: ProviderUsageSnapshot,
  source: ProviderUsageSnapshot['source'] = snapshot.source,
): ProviderUsageSnapshot {
  return {
    ...snapshot,
    source,
    report: snapshot.report ? {
      ...snapshot.report,
      buckets: snapshot.report.buckets.map((bucket) => ({
        ...bucket,
        windows: bucket.windows.map((window) => ({ ...window })),
      })),
      credits: snapshot.report.credits ? { ...snapshot.report.credits } : null,
    } : null,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('provider usage timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
