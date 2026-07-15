import { NotFoundError } from './errors.js';
import type { PluginRegistry } from '../runtime/plugin_registry.js';
import type { ProviderModelInfo, ProviderPluginContract, ProviderProfile } from '../types/provider.js';
import type { ProviderProfileRepository } from '../types/repository.js';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_MODELS = 500;

export interface ProviderModelCatalogResult {
  providerProfileId: string;
  providerKind: string;
  models: ProviderModelInfo[];
  source: 'provider' | 'profile';
  fetchedAt: number;
  expiresAt: number;
  refreshFailed: boolean;
  stale: boolean;
}

export interface ProviderModelCatalog {
  listModels(
    providerProfileId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<ProviderModelCatalogResult>;
  invalidate(providerProfileId?: string): void;
}

interface ProviderModelCatalogServiceOptions {
  providerProfiles: Pick<ProviderProfileRepository, 'getById'>;
  providerRegistry: Pick<PluginRegistry, 'getProvider'>;
  cacheTtlMs?: number;
  timeoutMs?: number;
  maxModels?: number;
  now?: () => number;
}

interface CacheEntry {
  providerProfileId: string;
  result: ProviderModelCatalogResult;
}

export class ProviderModelCatalogService implements ProviderModelCatalog {
  private readonly providerProfiles: Pick<ProviderProfileRepository, 'getById'>;

  private readonly providerRegistry: Pick<PluginRegistry, 'getProvider'>;

  private readonly cacheTtlMs: number;

  private readonly timeoutMs: number;

  private readonly maxModels: number;

  private readonly now: () => number;

  private readonly completed = new Map<string, CacheEntry>();

  private readonly lastSuccessful = new Map<string, CacheEntry>();

  private readonly inFlight = new Map<string, Promise<ProviderModelCatalogResult>>();

  private readonly profileGenerations = new Map<string, number>();

  private globalGeneration = 0;

  constructor(options: ProviderModelCatalogServiceOptions) {
    this.providerProfiles = options.providerProfiles;
    this.providerRegistry = options.providerRegistry;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxModels = Math.min(options.maxModels ?? DEFAULT_MAX_MODELS, DEFAULT_MAX_MODELS);
    this.now = options.now ?? Date.now;
  }

  async listModels(
    providerProfileId: string,
    options: { forceRefresh?: boolean } = {},
  ): Promise<ProviderModelCatalogResult> {
    const profile = this.providerProfiles.getById(providerProfileId);
    if (!profile) {
      throw new NotFoundError(`Provider profile not found: ${providerProfileId}`);
    }

    const identity = this.cacheIdentity(profile);
    const inFlight = this.inFlight.get(identity);
    if (inFlight) {
      return cloneResult(await inFlight);
    }

    const completed = this.completed.get(identity)?.result;
    if (!options.forceRefresh && completed && completed.expiresAt > this.now()) {
      return cloneResult(completed);
    }

    const request = this.refresh(profile, identity);
    this.inFlight.set(identity, request);
    try {
      return cloneResult(await request);
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
      this.lastSuccessful.clear();
      return;
    }

    this.profileGenerations.set(
      providerProfileId,
      (this.profileGenerations.get(providerProfileId) ?? 0) + 1,
    );
    this.deleteProfileEntries(this.completed, providerProfileId);
    this.deleteProfileEntries(this.lastSuccessful, providerProfileId);
  }

  private async refresh(profile: ProviderProfile, identity: string): Promise<ProviderModelCatalogResult> {
    const fetchedAt = this.now();
    try {
      const provider = this.providerRegistry.getProvider<ProviderPluginContract>(profile.providerKind);
      if (typeof provider.listModels !== 'function') {
        const fallback = this.profileFallback(profile, fetchedAt, false);
        this.cacheCompleted(profile, identity, fallback);
        return fallback;
      }

      const rawModels = await withTimeout(
        provider.listModels({ providerProfile: profile }),
        this.timeoutMs,
      );
      const models = normalizeModels(rawModels, this.maxModels);
      if (models.length === 0) {
        throw new Error('empty provider model catalog');
      }

      const result: ProviderModelCatalogResult = {
        providerProfileId: profile.id,
        providerKind: profile.providerKind,
        models,
        source: 'provider',
        fetchedAt,
        expiresAt: fetchedAt + this.cacheTtlMs,
        refreshFailed: false,
        stale: false,
      };
      if (this.isCurrentIdentity(profile, identity)) {
        const entry = { providerProfileId: profile.id, result: cloneResult(result) };
        this.completed.set(identity, entry);
        this.lastSuccessful.set(identity, entry);
      }
      return result;
    } catch {
      const stale = this.lastSuccessful.get(identity)?.result;
      if (stale) {
        const staleResult = {
          ...cloneResult(stale),
          expiresAt: fetchedAt + this.cacheTtlMs,
          refreshFailed: true,
          stale: true,
        };
        this.cacheCompleted(profile, identity, staleResult);
        return staleResult;
      }

      const fallback = this.profileFallback(profile, fetchedAt, true);
      this.cacheCompleted(profile, identity, fallback);
      return fallback;
    }
  }

  private profileFallback(
    profile: ProviderProfile,
    fetchedAt: number,
    refreshFailed: boolean,
  ): ProviderModelCatalogResult {
    const config = isRecord(profile.config) ? profile.config : {};
    const defaultModel = normalizeText(config.defaultModel);
    const entries: unknown[] = [];

    if (Array.isArray(config.modelCatalog)) {
      entries.push(...config.modelCatalog);
    }
    if (Array.isArray(config.modelIds)) {
      entries.push(...config.modelIds.map((id) => ({ id, model: id })));
    }
    if (defaultModel) {
      entries.push({ id: defaultModel, model: defaultModel, isDefault: true });
    }

    const models = normalizeModels(entries, this.maxModels).map((item) => ({
      ...item,
      isDefault: item.isDefault || item.id === defaultModel,
    }));
    return {
      providerProfileId: profile.id,
      providerKind: profile.providerKind,
      models,
      source: 'profile',
      fetchedAt,
      expiresAt: fetchedAt + this.cacheTtlMs,
      refreshFailed,
      stale: false,
    };
  }

  private cacheCompleted(profile: ProviderProfile, identity: string, result: ProviderModelCatalogResult): void {
    if (this.isCurrentIdentity(profile, identity)) {
      this.completed.set(identity, {
        providerProfileId: profile.id,
        result: cloneResult(result),
      });
    }
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
    const currentProfile = this.providerProfiles.getById(profile.id);
    return currentProfile !== null && this.cacheIdentity(currentProfile) === identity;
  }

  private deleteProfileEntries(entries: Map<string, CacheEntry>, providerProfileId: string): void {
    for (const [identity, entry] of entries) {
      if (entry.providerProfileId === providerProfileId) {
        entries.delete(identity);
      }
    }
  }
}

function normalizeModels(rawModels: unknown, maxModels: number): ProviderModelInfo[] {
  if (!Array.isArray(rawModels) || maxModels <= 0) {
    return [];
  }

  const models: ProviderModelInfo[] = [];
  const seen = new Set<string>();
  for (const rawModel of rawModels) {
    if (models.length >= maxModels) {
      break;
    }
    if (!isRecord(rawModel)) {
      continue;
    }
    const id = normalizeText(rawModel.id) || normalizeText(rawModel.model);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const model = normalizeText(rawModel.model) || id;
    const supportedReasoningEfforts = normalizeStringList(rawModel.supportedReasoningEfforts);
    models.push({
      id,
      model,
      displayName: normalizeText(rawModel.displayName),
      description: normalizeText(rawModel.description),
      isDefault: rawModel.isDefault === true,
      supportedReasoningEfforts,
      defaultReasoningEffort: normalizeText(rawModel.defaultReasoningEffort) || null,
    });
  }
  return models;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const values: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of value) {
    const normalized = normalizeText(rawValue);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      values.push(normalized);
    }
  }
  return values;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneResult(result: ProviderModelCatalogResult): ProviderModelCatalogResult {
  return {
    ...result,
    models: result.models.map((model) => ({
      ...model,
      supportedReasoningEfforts: [...model.supportedReasoningEfforts],
    })),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('provider model catalog timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
