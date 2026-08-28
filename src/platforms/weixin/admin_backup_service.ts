import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BridgeSession, SessionSettings, ThreadMetadata } from '../../types/core.js';
import type { ProviderProfile } from '../../types/provider.js';
import type { PlatformBinding } from '../../types/repository.js';
import {
  WeixinAccountStore,
  isValidWeixinAccountId,
  type SavedWeixinAccount,
} from './account_store.js';
import {
  reloadContextTokensForAccount,
  replaceContextTokensForAccount,
} from './official/context_tokens.js';
import { writeJsonFileAtomically, writeTextFileAtomically } from '../../store/file_json/json_file_io.js';

const FULL_BACKUP_SERVICE_ENV_KEYS = [
  'WEIXIN_PRIMARY_ACCOUNT_ID',
  'WEIXIN_ACCOUNT_ID',
  'WEIXIN_MAX_CONCURRENT_TURNS',
  'WEIXIN_EVENT_DISPATCH_CONCURRENCY',
  'WEIXIN_ATTACHMENT_CONCURRENCY',
  'WEIXIN_ACCOUNT_POLL_CONCURRENCY',
  'WEIXIN_LOG_CLEANUP_ENABLE',
  'WEIXIN_LOG_RETENTION_DAYS',
  'WEIXIN_LOG_MAX_BYTES',
  'WEIXIN_LOG_CLEANUP_INTERVAL_MINUTES',
  'WEIXIN_ALERT_WEBHOOK_URL',
  'CODEX_DEFAULT_PROVIDER_PROFILE_ID',
  'CODEX_COMPAT_PROVIDER_ID',
  'CODEX_COMPAT_PROVIDER_NAME',
  'CODEX_COMPAT_BASE_URL',
  'CODEX_COMPAT_DEFAULT_MODEL',
  'CODEX_COMPAT_MODEL',
  'CODEX_COMPAT_MODEL_IDS',
  'CODEX_COMPAT_CAPABILITIES',
  'CODEX_COMPAT_API_KEY',
] as const;

export interface WeixinAdminBackupRepositories {
  providerProfiles?: WeixinAdminBackupReadRepository<ProviderProfile> | null;
  bridgeSessions?: WeixinAdminBackupReadRepository<BridgeSession> | null;
  platformBindings?: WeixinAdminBackupReadRepository<PlatformBinding> | null;
  sessionSettings?: WeixinAdminBackupReadRepository<SessionSettings> | null;
  threadMetadata?: WeixinAdminBackupReadRepository<ThreadMetadata> | null;
}

export interface WeixinAdminBackupReadRepository<T> {
  list(): T[];
  save?(record: T): T;
  replaceAll?(records: T[]): void;
}

export interface WeixinAdminBackupRuntimeRepository<T> extends WeixinAdminBackupReadRepository<T> {
  save(record: T): T;
  replaceAll(records: T[]): void;
}

export interface WeixinAdminBackupAccount {
  accountId: string;
  token: string;
  baseUrl: string;
  userId: string;
  displayName?: string;
  disabled?: boolean;
  group?: string;
  role?: string;
  permissions?: SavedWeixinAccount['permissions'];
  modelProvider?: SavedWeixinAccount['model_provider'];
  contextTokens?: Record<string, string>;
  syncCursor?: string;
}

export interface ValidatedWeixinAdminBackupImport {
  accounts: WeixinAdminBackupAccount[];
  serviceEnv: Record<string, string>;
  runtime: {
    providerProfiles: ProviderProfile[];
    bridgeSessions: BridgeSession[];
    platformBindings: PlatformBinding[];
    sessionSettings: SessionSettings[];
    threadMetadata: ThreadMetadata[];
  };
}

interface RuntimeSnapshot {
  providerProfiles: ProviderProfile[];
  bridgeSessions: BridgeSession[];
  platformBindings: PlatformBinding[];
  sessionSettings: SessionSettings[];
  threadMetadata: ThreadMetadata[];
}

export interface WeixinAdminBackupServiceOptions {
  accountStore: WeixinAccountStore;
  stateDir: string;
  env?: NodeJS.ProcessEnv | Record<string, unknown>;
  repositories?: WeixinAdminBackupRepositories | null;
  getState(): Record<string, unknown>;
  getSessionSummaries(): unknown[];
  getLogs(): unknown;
  getAdminUrl(): string | null;
}

interface ImportFileSnapshot {
  filePath: string;
  existed: boolean;
  content: string;
}

interface ImportEnvSnapshot {
  key: string;
  existed: boolean;
  value: unknown;
}

interface ImportCounts {
  accounts: number;
  providerProfiles: number;
  bridgeSessions: number;
  platformBindings: number;
  sessionSettings: number;
  threadMetadata: number;
  configuration: number;
}

export type WeixinAdminBackupImportResult = {
  status: 200 | 400 | 409;
  body: Record<string, unknown>;
};

export class WeixinAdminBackupService {
  constructor({
    accountStore,
    stateDir,
    env = process.env,
    repositories = null,
    getState,
    getSessionSummaries,
    getLogs,
    getAdminUrl,
  }: WeixinAdminBackupServiceOptions) {
    this.accountStore = accountStore;
    this.stateDir = stateDir;
    this.env = env;
    this.repositories = repositories;
    this.getState = getState;
    this.getSessionSummaries = getSessionSummaries;
    this.getLogs = getLogs;
    this.getAdminUrl = getAdminUrl;
  }

  accountStore: WeixinAccountStore;
  stateDir: string;
  env: NodeJS.ProcessEnv | Record<string, unknown>;
  repositories: WeixinAdminBackupRepositories | null;
  getState: () => Record<string, unknown>;
  getSessionSummaries: () => unknown[];
  getLogs: () => unknown;
  getAdminUrl: () => string | null;

  exportBackup() {
    const state = this.getState();
    const bridge = isRecord(state.bridge) ? state.bridge : {};
    const {
      deliveryOutbox: _deliveryOutbox,
      pendingDeliveryRetries: _pendingDeliveryRetries,
      ...backupBridgeState
    } = bridge;
    const runtime = this.repositories;
    return {
      schemaVersion: 1,
      kind: 'full-backup',
      containsSecrets: true,
      exportedAt: new Date().toISOString(),
      stateDir: this.stateDir,
      adminUrl: this.getAdminUrl(),
      state: { ...state, bridge: backupBridgeState },
      accounts: this.accountStore.listAccounts().map((accountId) => ({
        accountId,
        ...this.accountStore.loadAccount(accountId),
        context_tokens: this.accountStore.readJson<Record<string, string>>(
          this.accountStore.contextTokensFile(accountId),
        ) ?? {},
        sync_cursor: this.accountStore.loadSyncCursor(accountId),
      })),
      configuration: { serviceEnv: exportFullBackupServiceEnv(this.env) },
      runtime: {
        providerProfiles: runtime?.providerProfiles?.list?.() ?? [],
        bridgeSessions: runtime?.bridgeSessions?.list?.() ?? [],
        platformBindings: runtime?.platformBindings?.list?.() ?? [],
        sessionSettings: runtime?.sessionSettings?.list?.() ?? [],
        threadMetadata: runtime?.threadMetadata?.list?.() ?? [],
      },
      sessionSummaries: this.getSessionSummaries(),
      logs: this.getLogs(),
    };
  }

  validateImport(body: Record<string, unknown>): {
    payload: ValidatedWeixinAdminBackupImport;
    errors: string[];
  } {
    const errors: string[] = [];
    const schemaVersion = Number(body.schemaVersion ?? 1);
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 1) {
      errors.push(`unsupported schemaVersion: ${String(body.schemaVersion ?? '')}`);
    }
    if (body.kind === 'diagnostic' || body.containsSecrets === false) {
      errors.push('diagnostic exports cannot be imported as backups');
    }

    const accountRecords = validateImportRecordArray(body.accounts, 'accounts', errors);
    validateUniqueImportRecords(
      accountRecords,
      'accounts',
      errors,
      (record) => normalizeAccountId(String(record.accountId ?? '')).toLowerCase(),
    );
    const accounts = accountRecords.map((account, index) => {
      const label = `accounts[${index}]`;
      validateRequiredString(account, 'accountId', label, errors);
      validateRequiredString(account, 'token', label, errors);
      const baseUrl = resolveStringAliases(account, ['base_url', 'baseUrl'], label, errors);
      const userId = resolveStringAliases(account, ['user_id', 'userId'], label, errors);
      validateOptionalString(account, 'display_name', label, errors);
      validateOptionalBoolean(account, 'disabled', label, errors);
      validateOptionalString(account, 'group', label, errors);
      validateOptionalString(account, 'role', label, errors);
      validateAccountPermissions(account.permissions, `${label}.permissions`, errors);
      const modelProvider = resolveAccountModelProviderAliases(account, label, errors);
      const accountId = normalizeAccountId(String(account.accountId ?? ''));
      if (!isValidWeixinAccountId(accountId)) {
        errors.push(`accounts[${index}].accountId is invalid`);
      }
      if (!normalizeEnvString(account.token)) {
        errors.push(`accounts[${index}].token is required`);
      }
      if (!baseUrl) {
        errors.push(`accounts[${index}].base_url is required`);
      } else if (!isValidHttpUrl(baseUrl)) {
        errors.push(`${label}.base_url must be an http(s) URL`);
      }
      if (account.context_tokens !== undefined) {
        if (!isRecord(account.context_tokens)) {
          errors.push(`accounts[${index}].context_tokens must be an object`);
        } else {
          for (const [peerId, token] of Object.entries(account.context_tokens)) {
            if (!peerId.trim() || typeof token !== 'string' || !token) {
              errors.push(`accounts[${index}].context_tokens contains an invalid token`);
              break;
            }
          }
        }
      }
      if (account.sync_cursor !== undefined && typeof account.sync_cursor !== 'string') {
        errors.push(`accounts[${index}].sync_cursor must be a string`);
      }
      return normalizeImportAccount(account, {
        baseUrl: baseUrl ?? '',
        userId: userId ?? '',
        modelProvider,
      });
    });

    const rawConfiguration = body.configuration === undefined ? {} : body.configuration;
    if (!isRecord(rawConfiguration)) {
      errors.push('configuration must be an object');
    }
    const rawServiceEnv = isRecord(rawConfiguration) && rawConfiguration.serviceEnv !== undefined
      ? rawConfiguration.serviceEnv
      : {};
    if (!isRecord(rawServiceEnv)) {
      errors.push('configuration.serviceEnv must be an object');
    }
    const serviceEnv: Record<string, string> = {};
    if (isRecord(rawServiceEnv)) {
      const allowedKeys = new Set<string>(FULL_BACKUP_SERVICE_ENV_KEYS);
      for (const [key, value] of Object.entries(rawServiceEnv)) {
        if (!allowedKeys.has(key)) {
          errors.push(`configuration.serviceEnv.${key} is not supported`);
        } else if (typeof value !== 'string') {
          errors.push(`configuration.serviceEnv.${key} must be a string`);
        } else if (/[\r\n]/u.test(value)) {
          errors.push(`configuration.serviceEnv.${key} must not contain line breaks`);
        } else {
          serviceEnv[key] = value;
        }
      }
    }
    if (serviceEnv.CODEX_COMPAT_BASE_URL && !isValidHttpUrl(serviceEnv.CODEX_COMPAT_BASE_URL)) {
      errors.push('configuration.serviceEnv.CODEX_COMPAT_BASE_URL must be an http(s) URL');
    }

    const rawRuntime = body.runtime === undefined ? {} : body.runtime;
    if (!isRecord(rawRuntime)) {
      errors.push('runtime must be an object');
    }
    const runtime = isRecord(rawRuntime) ? rawRuntime : {};
    const providerProfileRecords = validateImportRecordArray(runtime.providerProfiles, 'runtime.providerProfiles', errors);
    const bridgeSessionRecords = validateImportRecordArray(runtime.bridgeSessions, 'runtime.bridgeSessions', errors);
    const platformBindingRecords = validateImportRecordArray(runtime.platformBindings, 'runtime.platformBindings', errors);
    const sessionSettingsRecords = validateImportRecordArray(runtime.sessionSettings, 'runtime.sessionSettings', errors);
    const threadMetadataRecords = validateImportRecordArray(runtime.threadMetadata, 'runtime.threadMetadata', errors);

    validateImportRequiredStrings(providerProfileRecords, 'runtime.providerProfiles', ['id', 'providerKind'], errors);
    validateImportRequiredStrings(bridgeSessionRecords, 'runtime.bridgeSessions', ['id', 'providerProfileId', 'codexThreadId'], errors);
    validateImportRequiredStrings(platformBindingRecords, 'runtime.platformBindings', ['platform', 'externalScopeId', 'bridgeSessionId'], errors);
    validateImportRequiredStrings(sessionSettingsRecords, 'runtime.sessionSettings', ['bridgeSessionId'], errors);
    validateImportRequiredStrings(threadMetadataRecords, 'runtime.threadMetadata', ['providerProfileId', 'threadId'], errors);
    const providerProfileDisplayNames = validateProviderProfiles(providerProfileRecords, errors);
    validateBridgeSessions(bridgeSessionRecords, errors);
    validatePlatformBindings(platformBindingRecords, errors);
    validateSessionSettings(sessionSettingsRecords, errors);
    validateThreadMetadata(threadMetadataRecords, errors);
    validateUniqueImportRecords(providerProfileRecords, 'runtime.providerProfiles', errors, (record) => String(record.id ?? ''));
    validateUniqueImportRecords(bridgeSessionRecords, 'runtime.bridgeSessions', errors, (record) => String(record.id ?? ''));
    validateUniqueImportRecords(platformBindingRecords, 'runtime.platformBindings', errors, (record) => `${record.platform}:${record.externalScopeId}`);
    validateUniqueImportRecords(sessionSettingsRecords, 'runtime.sessionSettings', errors, (record) => String(record.bridgeSessionId ?? ''));
    validateUniqueImportRecords(threadMetadataRecords, 'runtime.threadMetadata', errors, (record) => `${record.providerProfileId}:${record.threadId}`);

    const providerProfiles = providerProfileRecords.map((record, index) => (
      normalizeProviderProfile(record, providerProfileDisplayNames[index] ?? null)
    ));
    const bridgeSessions = bridgeSessionRecords.map(normalizeBridgeSession);
    const platformBindings = platformBindingRecords.map(normalizePlatformBinding);
    const sessionSettings = sessionSettingsRecords.map(normalizeSessionSettings);
    const threadMetadata = threadMetadataRecords.map(normalizeThreadMetadata);

    const payload = {
      accounts,
      serviceEnv,
      runtime: { providerProfiles, bridgeSessions, platformBindings, sessionSettings, threadMetadata },
    };
    this.validateEffectiveImportReferences(payload, errors);

    return {
      payload,
      errors,
    };
  }

  private validateEffectiveImportReferences(
    payload: ValidatedWeixinAdminBackupImport,
    errors: string[],
  ) {
    const providerProfileIds = new Set([
      ...(this.repositories?.providerProfiles?.list() ?? []).map((record) => record.id),
      ...payload.runtime.providerProfiles.map((record) => record.id),
    ]);
    const bridgeSessionIds = new Set([
      ...(this.repositories?.bridgeSessions?.list() ?? []).map((record) => record.id),
      ...payload.runtime.bridgeSessions.map((record) => record.id),
    ]);
    const accountIds = new Set([
      ...this.accountStore.listAccounts(),
      ...payload.accounts.map((account) => account.accountId),
    ]);

    for (const [index, session] of payload.runtime.bridgeSessions.entries()) {
      if (session.providerProfileId && !providerProfileIds.has(session.providerProfileId)) {
        errors.push(`runtime.bridgeSessions[${index}].providerProfileId does not reference an available provider profile: ${session.providerProfileId}`);
      }
    }
    for (const [index, binding] of payload.runtime.platformBindings.entries()) {
      if (binding.bridgeSessionId && !bridgeSessionIds.has(binding.bridgeSessionId)) {
        errors.push(`runtime.platformBindings[${index}].bridgeSessionId does not reference an available bridge session: ${binding.bridgeSessionId}`);
      }
    }
    for (const [index, settings] of payload.runtime.sessionSettings.entries()) {
      if (settings.bridgeSessionId && !bridgeSessionIds.has(settings.bridgeSessionId)) {
        errors.push(`runtime.sessionSettings[${index}].bridgeSessionId does not reference an available bridge session: ${settings.bridgeSessionId}`);
      }
    }
    for (const [index, metadata] of payload.runtime.threadMetadata.entries()) {
      if (metadata.providerProfileId && !providerProfileIds.has(metadata.providerProfileId)) {
        errors.push(`runtime.threadMetadata[${index}].providerProfileId does not reference an available provider profile: ${metadata.providerProfileId}`);
      }
    }
    for (const [index, account] of payload.accounts.entries()) {
      const providerProfileId = account.modelProvider?.provider_profile_id;
      if (providerProfileId && !providerProfileIds.has(providerProfileId)) {
        errors.push(`accounts[${index}].model_provider.provider_profile_id does not reference an available provider profile: ${providerProfileId}`);
      }
    }
    for (const key of ['WEIXIN_ACCOUNT_ID', 'WEIXIN_PRIMARY_ACCOUNT_ID'] as const) {
      if (!(key in payload.serviceEnv)) continue;
      for (const accountId of normalizeCsv(payload.serviceEnv[key])) {
        if (!isValidWeixinAccountId(accountId)) {
          errors.push(`configuration.serviceEnv.${key} contains an invalid account id: ${accountId}`);
        } else if (!accountIds.has(accountId)) {
          errors.push(`configuration.serviceEnv.${key} does not reference an available account: ${accountId}`);
        }
      }
    }
  }

  importBackup(body: Record<string, unknown>): WeixinAdminBackupImportResult {
    const validation = this.validateImport(body);
    if (validation.errors.length > 0) {
      return { status: 400, body: { error: 'invalid backup', errors: validation.errors } };
    }
    const unavailableRuntime = this.findUnavailableImportRuntime(validation.payload);
    if (unavailableRuntime) {
      return {
        status: 409,
        body: { error: 'backup import is unavailable', detail: `runtime repository is not recoverable: ${unavailableRuntime}` },
      };
    }

    const restorePoint = this.createPreImportRestorePoint();
    const snapshots = this.captureImportSnapshots(validation.payload);
    const runtimeSnapshot = this.captureRuntimeSnapshot();
    const envSnapshot = this.captureImportEnvSnapshot(validation.payload.serviceEnv);
    const imported: ImportCounts = {
      accounts: 0,
      providerProfiles: 0,
      bridgeSessions: 0,
      platformBindings: 0,
      sessionSettings: 0,
      threadMetadata: 0,
      configuration: 0,
    };
    try {
      for (const account of validation.payload.accounts) {
        const accountId = account.accountId;
        this.accountStore.saveAccount({
          accountId,
          token: account.token,
          baseUrl: account.baseUrl,
          userId: account.userId,
        });
        const patch: Parameters<WeixinAccountStore['updateAccount']>[1] = {};
        if (account.displayName !== undefined) patch.display_name = account.displayName;
        if (account.disabled !== undefined) patch.disabled = account.disabled;
        if (account.group !== undefined) patch.group = account.group;
        if (account.role !== undefined) patch.role = account.role;
        if (account.permissions !== undefined) patch.permissions = account.permissions;
        if (account.modelProvider !== undefined) patch.model_provider = account.modelProvider;
        if (Object.keys(patch).length > 0) this.accountStore.updateAccount(accountId, patch);
        if (account.contextTokens !== undefined) {
          replaceContextTokensForAccount(this.accountStore.rootDir, accountId, account.contextTokens);
        }
        if (account.syncCursor !== undefined) this.accountStore.saveSyncCursor(accountId, account.syncCursor);
        imported.accounts += 1;
      }
      const runtime = validation.payload.runtime;
      const repos = this.repositories;
      const failures: string[] = [];
      imported.providerProfiles = this.importRecords(runtime.providerProfiles, asRuntimeRepository(repos?.providerProfiles), failures);
      imported.bridgeSessions = this.importRecords(runtime.bridgeSessions, asRuntimeRepository(repos?.bridgeSessions), failures);
      imported.platformBindings = this.importRecords(runtime.platformBindings, asRuntimeRepository(repos?.platformBindings), failures);
      imported.sessionSettings = this.importRecords(runtime.sessionSettings, asRuntimeRepository(repos?.sessionSettings), failures);
      imported.threadMetadata = this.importRecords(runtime.threadMetadata, asRuntimeRepository(repos?.threadMetadata), failures);
      if (failures.length > 0) throw new Error('runtime record import failed');
      if (Object.keys(validation.payload.serviceEnv).length > 0) {
        for (const [key, value] of Object.entries(validation.payload.serviceEnv)) setEnvValue(this.env, key, value);
        persistEnvValues(resolveServiceEnvFile(this.env), validation.payload.serviceEnv);
        imported.configuration = 1;
      }
      return { status: 200, body: { ok: true, imported, errors: [], restorePoint, state: this.getState() } };
    } catch {
      const rollbackErrors = this.restoreImportSnapshots(snapshots);
      rollbackErrors.push(...this.restoreRuntimeSnapshot(runtimeSnapshot));
      for (const account of validation.payload.accounts) {
        try {
          reloadContextTokensForAccount(this.accountStore.rootDir, account.accountId);
        } catch {
          rollbackErrors.push('context token rollback failed');
        }
      }
      try {
        this.restoreImportEnvSnapshot(envSnapshot);
      } catch {
        rollbackErrors.push('environment rollback failed');
      }
      return {
        status: 409,
        body: {
          error: rollbackErrors.length > 0
            ? 'backup import failed and rollback was incomplete'
            : 'backup import failed and was rolled back',
          detail: 'backup import failed',
          rollbackErrors,
          restorePoint,
        },
      };
    }
  }

  private createPreImportRestorePoint() {
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
    const filePath = path.join(this.stateDir, 'backups', `pre-import-${stamp}.json`);
    writeJsonFileAtomically(filePath, this.exportBackup());
    return filePath;
  }

  private captureImportSnapshots(payload: ValidatedWeixinAdminBackupImport): ImportFileSnapshot[] {
    const paths = uniqueStrings([
      ...payload.accounts.flatMap((account) => {
        const accountId = account.accountId;
        return [this.accountStore.accountFile(accountId), this.accountStore.contextTokensFile(accountId), this.accountStore.syncFile(accountId)];
      }),
      ...(Object.keys(payload.serviceEnv).length > 0 ? [resolveServiceEnvFile(this.env)] : []),
    ]);
    return paths.map((filePath) => ({
      filePath,
      existed: fs.existsSync(filePath),
      content: fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '',
    }));
  }

  private restoreImportSnapshots(snapshots: ImportFileSnapshot[]) {
    const errors: string[] = [];
    for (const snapshot of snapshots) {
      try {
        if (snapshot.existed) writeTextFileAtomically(snapshot.filePath, snapshot.content);
        else fs.rmSync(snapshot.filePath, { force: true });
      } catch {
        errors.push('file rollback failed');
      }
    }
    return errors;
  }

  private captureImportEnvSnapshot(serviceEnv: Record<string, string>): ImportEnvSnapshot[] {
    return Object.keys(serviceEnv).map((key) => ({
      key,
      existed: Object.prototype.hasOwnProperty.call(this.env, key),
      value: this.env[key],
    }));
  }

  private restoreImportEnvSnapshot(snapshots: ImportEnvSnapshot[]) {
    for (const snapshot of snapshots) {
      if (snapshot.existed) this.env[snapshot.key] = snapshot.value;
      else delete this.env[snapshot.key];
    }
  }

  private captureRuntimeSnapshot(): RuntimeSnapshot {
    const runtime = this.repositories;
    return {
      providerProfiles: runtime?.providerProfiles?.list() ?? [],
      bridgeSessions: runtime?.bridgeSessions?.list() ?? [],
      platformBindings: runtime?.platformBindings?.list() ?? [],
      sessionSettings: runtime?.sessionSettings?.list() ?? [],
      threadMetadata: runtime?.threadMetadata?.list() ?? [],
    };
  }

  private restoreRuntimeSnapshot(snapshot: RuntimeSnapshot): string[] {
    const errors: string[] = [];
    const restore = <T>(repository: WeixinAdminBackupReadRepository<T> | null | undefined, records: T[]) => {
      const runtimeRepository = asRuntimeRepository(repository);
      if (!runtimeRepository) return;
      try {
        runtimeRepository.replaceAll(records);
      } catch {
        errors.push('runtime rollback failed');
      }
    };
    restore(this.repositories?.providerProfiles, snapshot.providerProfiles);
    restore(this.repositories?.bridgeSessions, snapshot.bridgeSessions);
    restore(this.repositories?.platformBindings, snapshot.platformBindings);
    restore(this.repositories?.sessionSettings, snapshot.sessionSettings);
    restore(this.repositories?.threadMetadata, snapshot.threadMetadata);
    return errors;
  }

  private importRecords<T>(records: T[], repository: WeixinAdminBackupRuntimeRepository<T> | null | undefined, failures: string[]): number {
    if (records.length === 0) return 0;
    if (!repository) throw new Error('runtime repository is not recoverable');
    let count = 0;
    for (const record of records) {
      try {
        repository.save(record);
        count += 1;
      } catch {
        failures.push('runtime record import failed');
      }
    }
    return count;
  }

  private findUnavailableImportRuntime(payload: ValidatedWeixinAdminBackupImport): string | null {
    const runtime = this.repositories;
    if (payload.runtime.providerProfiles.length > 0 && !asRuntimeRepository(runtime?.providerProfiles)) return 'providerProfiles';
    if (payload.runtime.bridgeSessions.length > 0 && !asRuntimeRepository(runtime?.bridgeSessions)) return 'bridgeSessions';
    if (payload.runtime.platformBindings.length > 0 && !asRuntimeRepository(runtime?.platformBindings)) return 'platformBindings';
    if (payload.runtime.sessionSettings.length > 0 && !asRuntimeRepository(runtime?.sessionSettings)) return 'sessionSettings';
    if (payload.runtime.threadMetadata.length > 0 && !asRuntimeRepository(runtime?.threadMetadata)) return 'threadMetadata';
    return null;
  }
}

function asRuntimeRepository<T>(
  repository: WeixinAdminBackupReadRepository<T> | null | undefined,
): WeixinAdminBackupRuntimeRepository<T> | null {
  if (!repository || typeof repository.save !== 'function' || typeof repository.replaceAll !== 'function') return null;
  const save = repository.save;
  const replaceAll = repository.replaceAll;
  return {
    list: () => repository.list(),
    save: (record) => save.call(repository, record),
    replaceAll: (records) => replaceAll.call(repository, records),
  };
}

export function setEnvValue(env: NodeJS.ProcessEnv | Record<string, unknown>, key: string, value: string) {
  env[key] = value;
}

export function resolveServiceEnvFile(env: NodeJS.ProcessEnv | Record<string, unknown>) {
  const explicit = normalizeEnvString(env.CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE)
    ?? normalizeEnvString(env.CODEXBRIDGE_SERVICE_ENV_FILE);
  if (explicit) return explicit;
  if (process.platform === 'win32') {
    const appData = normalizeEnvString(env.APPDATA) ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'codexbridge', 'weixin.service.env');
  }
  const configHome = normalizeEnvString(env.XDG_CONFIG_HOME) ?? path.join(os.homedir(), '.config');
  return path.join(configHome, 'codexbridge', 'weixin.service.env');
}

export function persistEnvValues(filePath: string, values: Record<string, string>) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const keys = new Set(Object.keys(values));
  const seen = new Set<string>();
  const nextLines = (existing ? existing.split(/\r?\n/u) : []).map((line) => {
    const key = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/u)?.[1] ?? '';
    if (!key || !keys.has(key)) return line;
    seen.add(key);
    return `${key}=${values[key] ?? ''}`;
  });
  for (const key of keys) {
    if (!seen.has(key)) nextLines.push(`${key}=${values[key] ?? ''}`);
  }
  writeTextFileAtomically(filePath, `${nextLines.join('\n').replace(/\n+$/u, '')}\n`);
}

function exportFullBackupServiceEnv(env: NodeJS.ProcessEnv | Record<string, unknown>) {
  const values: Record<string, string> = {};
  for (const key of FULL_BACKUP_SERVICE_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined && value !== null) values[key] = String(value);
  }
  return values;
}

function validateImportRecordArray(value: unknown, label: string, errors: string[]): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  const records: Record<string, unknown>[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) errors.push(`${label}[${index}] must be an object`);
    else records.push(entry);
  }
  return records;
}

function validateImportRequiredStrings(records: Record<string, unknown>[], label: string, keys: string[], errors: string[]) {
  for (const [index, record] of records.entries()) {
    for (const key of keys) {
      if (!normalizeEnvString(record[key])) errors.push(`${label}[${index}].${key} is required`);
    }
  }
}

function validateRequiredString(record: Record<string, unknown>, key: string, label: string, errors: string[]) {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) errors.push(`${label}.${key} is required`);
}

function validateOptionalString(
  record: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
  { nullable = false }: { nullable?: boolean } = {},
) {
  const value = record[key];
  if (value !== undefined && !(nullable && value === null) && typeof value !== 'string') {
    errors.push(`${label}.${key} must be ${nullable ? 'a string or null' : 'a string'}`);
  }
}

function validateOptionalBoolean(record: Record<string, unknown>, key: string, label: string, errors: string[]) {
  const value = record[key];
  if (value !== undefined && typeof value !== 'boolean') errors.push(`${label}.${key} must be a boolean`);
}

function validateOptionalRecord(record: Record<string, unknown>, key: string, label: string, errors: string[]) {
  const value = record[key];
  if (value !== undefined && !isRecord(value)) errors.push(`${label}.${key} must be an object`);
}

function validateOptionalFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
  { nullable = false }: { nullable?: boolean } = {},
) {
  const value = record[key];
  if (value !== undefined && !(nullable && value === null) && (typeof value !== 'number' || !Number.isFinite(value))) {
    errors.push(`${label}.${key} must be ${nullable ? 'a finite number or null' : 'a finite number'}`);
  }
}

function validateOptionalChoice<T extends string>(
  record: Record<string, unknown>,
  key: string,
  choices: readonly T[],
  label: string,
  errors: string[],
) {
  const value = record[key];
  if (value !== undefined && value !== null && (typeof value !== 'string' || !choices.includes(value as T))) {
    errors.push(`${label}.${key} must be one of: ${choices.join(', ')}`);
  }
}

function validateAccountPermissions(value: unknown, label: string, errors: string[]) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  validateOptionalBoolean(value, 'can_chat', label, errors);
  validateOptionalBoolean(value, 'can_upload', label, errors);
  validateOptionalBoolean(value, 'can_execute_commands', label, errors);
}

function resolveStringAliases(
  record: Record<string, unknown>,
  keys: readonly [string, string],
  label: string,
  errors: string[],
): string | null {
  const values = keys.map((key) => {
    const value = record[key];
    if (value === undefined) return null;
    if (typeof value !== 'string') {
      errors.push(`${label}.${key} must be a string`);
      return null;
    }
    return normalizeOptionalString(value);
  });
  const meaningful = [...new Set(values.filter((value): value is string => value !== null))];
  if (meaningful.length > 1) errors.push(`${label}.${keys[0]} conflicts with ${label}.${keys[1]}`);
  return meaningful[0] ?? null;
}

function resolveAccountModelProvider(
  value: unknown,
  label: string,
  errors: string[],
): SavedWeixinAccount['model_provider'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return undefined;
  }
  const providerProfileId = resolveStringAliases(
    value,
    ['provider_profile_id', 'providerProfileId'],
    label,
    errors,
  );
  validateOptionalString(value, 'model', label, errors);
  const model = normalizeOptionalString(value.model);
  const reasoningEffort = resolveStringAliases(
    value,
    ['reasoning_effort', 'reasoningEffort'],
    label,
    errors,
  );
  if (!providerProfileId && !model && !reasoningEffort) return undefined;
  return {
    ...(providerProfileId ? { provider_profile_id: providerProfileId } : {}),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  };
}

function resolveAccountModelProviderAliases(
  record: Record<string, unknown>,
  label: string,
  errors: string[],
): SavedWeixinAccount['model_provider'] | undefined {
  const preferred = resolveAccountModelProvider(record.model_provider, `${label}.model_provider`, errors);
  const fallback = resolveAccountModelProvider(record.modelProvider, `${label}.modelProvider`, errors);
  if (preferred && fallback && !modelProvidersEqual(preferred, fallback)) {
    errors.push(`${label}.model_provider conflicts with ${label}.modelProvider`);
  }
  return preferred ?? fallback;
}

function modelProvidersEqual(
  left: NonNullable<SavedWeixinAccount['model_provider']>,
  right: NonNullable<SavedWeixinAccount['model_provider']>,
) {
  return left.provider_profile_id === right.provider_profile_id
    && left.model === right.model
    && left.reasoning_effort === right.reasoning_effort;
}

function validateProviderProfiles(records: Record<string, unknown>[], errors: string[]): Array<string | null> {
  return records.map((record, index) => {
    const label = `runtime.providerProfiles[${index}]`;
    const displayName = resolveStringAliases(record, ['displayName', 'name'], label, errors);
    validateOptionalRecord(record, 'config', label, errors);
    validateOptionalFiniteNumber(record, 'createdAt', label, errors);
    validateOptionalFiniteNumber(record, 'updatedAt', label, errors);
    return displayName;
  });
}

function validateBridgeSessions(records: Record<string, unknown>[], errors: string[]) {
  for (const [index, record] of records.entries()) {
    const label = `runtime.bridgeSessions[${index}]`;
    validateOptionalString(record, 'cwd', label, errors, { nullable: true });
    validateOptionalString(record, 'title', label, errors, { nullable: true });
    validateOptionalFiniteNumber(record, 'createdAt', label, errors);
    validateOptionalFiniteNumber(record, 'updatedAt', label, errors);
  }
}

function validatePlatformBindings(records: Record<string, unknown>[], errors: string[]) {
  for (const [index, record] of records.entries()) {
    validateOptionalFiniteNumber(record, 'updatedAt', `runtime.platformBindings[${index}]`, errors);
  }
}

function validateSessionSettings(records: Record<string, unknown>[], errors: string[]) {
  for (const [index, record] of records.entries()) {
    const label = `runtime.sessionSettings[${index}]`;
    for (const key of ['model', 'reasoningEffort', 'serviceTier', 'approvalPolicy', 'sandboxMode', 'locale']) {
      validateOptionalString(record, key, label, errors, { nullable: true });
    }
    validateOptionalChoice(record, 'collaborationMode', ['plan', 'default'], label, errors);
    validateOptionalChoice(record, 'personality', ['friendly', 'pragmatic', 'none'], label, errors);
    validateOptionalChoice(record, 'permissionsMode', ['default-permissions', 'auto-review', 'full-access', 'custom'], label, errors);
    validateOptionalChoice(record, 'accessPreset', ['read-only', 'default', 'full-access'], label, errors);
    validateOptionalChoice(record, 'approvalsReviewer', ['user', 'auto_review'], label, errors);
    validateOptionalRecord(record, 'metadata', label, errors);
    validateOptionalFiniteNumber(record, 'updatedAt', label, errors);
  }
}

function validateThreadMetadata(records: Record<string, unknown>[], errors: string[]) {
  for (const [index, record] of records.entries()) {
    const label = `runtime.threadMetadata[${index}]`;
    validateOptionalString(record, 'alias', label, errors, { nullable: true });
    validateOptionalFiniteNumber(record, 'archivedAt', label, errors, { nullable: true });
    validateOptionalFiniteNumber(record, 'pinnedAt', label, errors, { nullable: true });
    validateOptionalFiniteNumber(record, 'updatedAt', label, errors);
  }
}

function validateUniqueImportRecords(records: Record<string, unknown>[], label: string, errors: string[], identity: (record: Record<string, unknown>) => string) {
  const seen = new Set<string>();
  for (const [index, record] of records.entries()) {
    const key = identity(record).trim();
    if (!key) continue;
    if (seen.has(key)) errors.push(`${label}[${index}] duplicates ${key}`);
    seen.add(key);
  }
}

function normalizeImportAccount(
  record: Record<string, unknown>,
  aliases: {
    baseUrl: string;
    userId: string;
    modelProvider: SavedWeixinAccount['model_provider'] | undefined;
  },
): WeixinAdminBackupAccount {
  const contextTokens = isRecord(record.context_tokens)
    ? Object.fromEntries(Object.entries(record.context_tokens).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : undefined;
  const permissions = normalizePermissions(record.permissions);
  return {
    accountId: normalizeAccountId(String(record.accountId ?? '')),
    token: String(record.token ?? '').trim(),
    baseUrl: aliases.baseUrl,
    userId: aliases.userId,
    ...(typeof record.display_name === 'string' ? { displayName: record.display_name } : {}),
    ...(typeof record.disabled === 'boolean' ? { disabled: record.disabled } : {}),
    ...(typeof record.group === 'string' ? { group: record.group } : {}),
    ...(typeof record.role === 'string' ? { role: record.role } : {}),
    ...(permissions ? { permissions } : {}),
    ...(aliases.modelProvider ? { modelProvider: aliases.modelProvider } : {}),
    ...(contextTokens ? { contextTokens } : {}),
    ...(typeof record.sync_cursor === 'string' ? { syncCursor: record.sync_cursor } : {}),
  };
}

function normalizeProviderProfile(record: Record<string, unknown>, displayName: string | null): ProviderProfile {
  const id = normalizeRequiredString(record.id);
  return {
    id,
    providerKind: normalizeRequiredString(record.providerKind),
    displayName: displayName ?? id,
    config: isRecord(record.config) ? record.config : {},
    createdAt: normalizeNumber(record.createdAt),
    updatedAt: normalizeNumber(record.updatedAt),
  };
}

function normalizeBridgeSession(record: Record<string, unknown>): BridgeSession {
  return {
    id: normalizeRequiredString(record.id),
    providerProfileId: normalizeRequiredString(record.providerProfileId),
    codexThreadId: normalizeRequiredString(record.codexThreadId),
    cwd: normalizeNullableString(record.cwd),
    title: normalizeNullableString(record.title),
    createdAt: normalizeNumber(record.createdAt),
    updatedAt: normalizeNumber(record.updatedAt),
  };
}

function normalizePlatformBinding(record: Record<string, unknown>): PlatformBinding {
  return {
    platform: normalizeRequiredString(record.platform),
    externalScopeId: normalizeRequiredString(record.externalScopeId),
    bridgeSessionId: normalizeRequiredString(record.bridgeSessionId),
    updatedAt: normalizeNumber(record.updatedAt),
  };
}

function normalizeSessionSettings(record: Record<string, unknown>): SessionSettings {
  return {
    bridgeSessionId: normalizeRequiredString(record.bridgeSessionId),
    model: normalizeNullableString(record.model),
    reasoningEffort: normalizeNullableString(record.reasoningEffort),
    serviceTier: normalizeNullableString(record.serviceTier),
    collaborationMode: normalizeChoice(record.collaborationMode, ['plan', 'default'] as const),
    personality: normalizeChoice(record.personality, ['friendly', 'pragmatic', 'none'] as const),
    permissionsMode: normalizeChoice(record.permissionsMode, ['default-permissions', 'auto-review', 'full-access', 'custom'] as const),
    accessPreset: normalizeChoice(record.accessPreset, ['read-only', 'default', 'full-access'] as const),
    approvalPolicy: normalizeNullableString(record.approvalPolicy),
    sandboxMode: normalizeNullableString(record.sandboxMode),
    approvalsReviewer: normalizeChoice(record.approvalsReviewer, ['user', 'auto_review'] as const),
    locale: normalizeNullableString(record.locale),
    metadata: isRecord(record.metadata) ? record.metadata : {},
    updatedAt: normalizeNumber(record.updatedAt),
  };
}

function normalizeThreadMetadata(record: Record<string, unknown>): ThreadMetadata {
  return {
    providerProfileId: normalizeRequiredString(record.providerProfileId),
    threadId: normalizeRequiredString(record.threadId),
    alias: normalizeNullableString(record.alias),
    ...(record.archivedAt === undefined ? {} : { archivedAt: normalizeNullableNumber(record.archivedAt) }),
    ...(record.pinnedAt === undefined ? {} : { pinnedAt: normalizeNullableNumber(record.pinnedAt) }),
    updatedAt: normalizeNumber(record.updatedAt),
  };
}

function normalizeRequiredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = normalizeRequiredString(value);
  return normalized || null;
}

function normalizeNullableString(value: unknown): string | null {
  return normalizeOptionalString(value);
}

function normalizeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeNullableNumber(value: unknown): number | null {
  return value === null ? null : normalizeNumber(value);
}

function normalizeChoice<T extends string>(value: unknown, choices: readonly T[]): T | null {
  return typeof value === 'string' ? choices.find((choice) => choice === value) ?? null : null;
}

function normalizePermissions(value: unknown): SavedWeixinAccount['permissions'] | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...(value.can_chat !== undefined ? { can_chat: Boolean(value.can_chat) } : {}),
    ...(value.can_upload !== undefined ? { can_upload: Boolean(value.can_upload) } : {}),
    ...(value.can_execute_commands !== undefined ? { can_execute_commands: Boolean(value.can_execute_commands) } : {}),
  };
}

function normalizeAccountId(raw: string) {
  return String(raw ?? '').trim();
}

function normalizeCsv(value: unknown) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeEnvString(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
