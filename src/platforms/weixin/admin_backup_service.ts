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
  providerProfiles?: { list(): ProviderProfile[]; save?(profile: ProviderProfile): ProviderProfile } | null;
  bridgeSessions?: { list(): BridgeSession[]; save?(session: BridgeSession): BridgeSession } | null;
  platformBindings?: { list(): PlatformBinding[]; save?(binding: PlatformBinding): PlatformBinding } | null;
  sessionSettings?: { listAll?(): SessionSettings[]; save?(settings: SessionSettings): SessionSettings } | null;
  threadMetadata?: { listAll?(): ThreadMetadata[]; save?(metadata: ThreadMetadata): ThreadMetadata } | null;
}

export interface ValidatedWeixinAdminBackupImport {
  accounts: Record<string, unknown>[];
  serviceEnv: Record<string, string>;
  runtime: {
    providerProfiles: Record<string, unknown>[];
    bridgeSessions: Record<string, unknown>[];
    platformBindings: Record<string, unknown>[];
    sessionSettings: Record<string, unknown>[];
    threadMetadata: Record<string, unknown>[];
  };
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
        sessionSettings: runtime?.sessionSettings?.listAll?.() ?? [],
        threadMetadata: runtime?.threadMetadata?.listAll?.() ?? [],
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

    const accounts = validateImportRecordArray(body.accounts, 'accounts', errors);
    validateUniqueImportRecords(
      accounts,
      'accounts',
      errors,
      (record) => normalizeAccountId(String(record.accountId ?? '')).toLowerCase(),
    );
    for (const [index, account] of accounts.entries()) {
      const accountId = normalizeAccountId(String(account.accountId ?? ''));
      if (!isValidWeixinAccountId(accountId)) {
        errors.push(`accounts[${index}].accountId is invalid`);
      }
      if (!normalizeEnvString(account.token)) {
        errors.push(`accounts[${index}].token is required`);
      }
      const baseUrl = normalizeEnvString(account.base_url) ?? normalizeEnvString(account.baseUrl);
      if (!baseUrl) {
        errors.push(`accounts[${index}].base_url is required`);
      } else if (!isValidHttpUrl(baseUrl)) {
        errors.push(`accounts[${index}].base_url must be an http(s) URL`);
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
    }

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
    const providerProfiles = validateImportRecordArray(runtime.providerProfiles, 'runtime.providerProfiles', errors);
    const bridgeSessions = validateImportRecordArray(runtime.bridgeSessions, 'runtime.bridgeSessions', errors);
    const platformBindings = validateImportRecordArray(runtime.platformBindings, 'runtime.platformBindings', errors);
    const sessionSettings = validateImportRecordArray(runtime.sessionSettings, 'runtime.sessionSettings', errors);
    const threadMetadata = validateImportRecordArray(runtime.threadMetadata, 'runtime.threadMetadata', errors);

    validateImportRequiredStrings(providerProfiles, 'runtime.providerProfiles', ['id', 'providerKind'], errors);
    validateImportRequiredStrings(bridgeSessions, 'runtime.bridgeSessions', ['id', 'providerProfileId', 'codexThreadId'], errors);
    validateImportRequiredStrings(platformBindings, 'runtime.platformBindings', ['platform', 'externalScopeId', 'bridgeSessionId'], errors);
    validateImportRequiredStrings(sessionSettings, 'runtime.sessionSettings', ['bridgeSessionId'], errors);
    validateImportRequiredStrings(threadMetadata, 'runtime.threadMetadata', ['providerProfileId', 'threadId'], errors);
    validateUniqueImportRecords(providerProfiles, 'runtime.providerProfiles', errors, (record) => String(record.id ?? ''));
    validateUniqueImportRecords(bridgeSessions, 'runtime.bridgeSessions', errors, (record) => String(record.id ?? ''));
    validateUniqueImportRecords(platformBindings, 'runtime.platformBindings', errors, (record) => `${record.platform}:${record.externalScopeId}`);
    validateUniqueImportRecords(sessionSettings, 'runtime.sessionSettings', errors, (record) => String(record.bridgeSessionId ?? ''));
    validateUniqueImportRecords(threadMetadata, 'runtime.threadMetadata', errors, (record) => `${record.providerProfileId}:${record.threadId}`);

    return {
      payload: { accounts, serviceEnv, runtime: { providerProfiles, bridgeSessions, platformBindings, sessionSettings, threadMetadata } },
      errors,
    };
  }

  importBackup(body: Record<string, unknown>): WeixinAdminBackupImportResult {
    const validation = this.validateImport(body);
    if (validation.errors.length > 0) {
      return { status: 400, body: { error: 'invalid backup', errors: validation.errors } };
    }

    const restorePoint = this.createPreImportRestorePoint();
    const snapshots = this.captureImportSnapshots(validation.payload);
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
      for (const raw of validation.payload.accounts) {
        const accountId = normalizeAccountId(String(raw.accountId ?? ''));
        this.accountStore.saveAccount({
          accountId,
          token: String(raw.token ?? '').trim(),
          baseUrl: String(raw.base_url ?? raw.baseUrl ?? '').trim(),
          userId: String(raw.user_id ?? raw.userId ?? ''),
        });
        const patch: Parameters<WeixinAccountStore['updateAccount']>[1] = {};
        if (typeof raw.display_name === 'string') patch.display_name = raw.display_name;
        if (typeof raw.disabled === 'boolean') patch.disabled = raw.disabled;
        if (typeof raw.group === 'string') patch.group = raw.group;
        if (typeof raw.role === 'string') patch.role = raw.role;
        if (isRecord(raw.permissions)) patch.permissions = raw.permissions;
        if (isRecord(raw.model_provider) || isRecord(raw.modelProvider)) {
          patch.model_provider = isRecord(raw.model_provider) ? raw.model_provider : raw.modelProvider as Record<string, unknown>;
        }
        if (Object.keys(patch).length > 0) this.accountStore.updateAccount(accountId, patch);
        if (isRecord(raw.context_tokens)) {
          replaceContextTokensForAccount(this.accountStore.rootDir, accountId, raw.context_tokens);
        }
        if (typeof raw.sync_cursor === 'string') this.accountStore.saveSyncCursor(accountId, raw.sync_cursor);
        imported.accounts += 1;
      }
      const runtime = validation.payload.runtime;
      const repos = this.repositories;
      const failures: string[] = [];
      imported.providerProfiles = this.importRecords(runtime.providerProfiles, repos?.providerProfiles?.save?.bind(repos.providerProfiles), failures);
      imported.bridgeSessions = this.importRecords(runtime.bridgeSessions, repos?.bridgeSessions?.save?.bind(repos.bridgeSessions), failures);
      imported.platformBindings = this.importRecords(runtime.platformBindings, repos?.platformBindings?.save?.bind(repos.platformBindings), failures);
      imported.sessionSettings = this.importRecords(runtime.sessionSettings, repos?.sessionSettings?.save?.bind(repos.sessionSettings), failures);
      imported.threadMetadata = this.importRecords(runtime.threadMetadata, repos?.threadMetadata?.save?.bind(repos.threadMetadata), failures);
      if (failures.length > 0) throw new Error('runtime record import failed');
      if (Object.keys(validation.payload.serviceEnv).length > 0) {
        for (const [key, value] of Object.entries(validation.payload.serviceEnv)) setEnvValue(this.env, key, value);
        persistEnvValues(resolveServiceEnvFile(this.env), validation.payload.serviceEnv);
        imported.configuration = 1;
      }
      return { status: 200, body: { ok: true, imported, errors: [], restorePoint, state: this.getState() } };
    } catch {
      const rollbackErrors = this.restoreImportSnapshots(snapshots);
      for (const raw of validation.payload.accounts) {
        try {
          reloadContextTokensForAccount(this.accountStore.rootDir, normalizeAccountId(String(raw.accountId ?? '')));
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
    const runtimeDir = path.join(this.stateDir, 'runtime');
    const paths = uniqueStrings([
      ...payload.accounts.flatMap((account) => {
        const accountId = String(account.accountId);
        return [this.accountStore.accountFile(accountId), this.accountStore.contextTokensFile(accountId), this.accountStore.syncFile(accountId)];
      }),
      path.join(runtimeDir, 'provider_profiles.json'),
      path.join(runtimeDir, 'bridge_sessions.json'),
      path.join(runtimeDir, 'platform_bindings.json'),
      path.join(runtimeDir, 'session_settings.json'),
      path.join(runtimeDir, 'thread_metadata.json'),
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

  private importRecords(value: unknown, save: ((record: any) => unknown) | undefined, failures: string[]): number {
    if (!Array.isArray(value) || typeof save !== 'function') return 0;
    let count = 0;
    for (const record of value) {
      if (!isRecord(record)) continue;
      try {
        save(record);
        count += 1;
      } catch {
        failures.push('runtime record import failed');
      }
    }
    return count;
  }
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

function validateUniqueImportRecords(records: Record<string, unknown>[], label: string, errors: string[], identity: (record: Record<string, unknown>) => string) {
  const seen = new Set<string>();
  for (const [index, record] of records.entries()) {
    const key = identity(record).trim();
    if (!key) continue;
    if (seen.has(key)) errors.push(`${label}[${index}] duplicates ${key}`);
    seen.add(key);
  }
}

function normalizeAccountId(raw: string) {
  return String(raw ?? '').trim();
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
