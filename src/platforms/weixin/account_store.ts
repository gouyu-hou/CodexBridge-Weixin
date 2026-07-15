import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getSyncBufFilePath,
  loadGetUpdatesBuf,
  saveGetUpdatesBuf,
} from './official/sync_buf.js';
import { readJsonFileSafely, writeJsonFileAtomically } from '../../store/file_json/json_file_io.js';

export interface SavedWeixinAccount {
  token: string;
  base_url: string;
  user_id: string;
  saved_at: string;
  display_name?: string;
  disabled?: boolean;
  group?: string;
  role?: string;
  permissions?: {
    can_chat?: boolean;
    can_upload?: boolean;
    can_execute_commands?: boolean;
  };
  model_provider?: {
    provider_profile_id?: string;
    model?: string;
    reasoning_effort?: string;
  };
}

type ContextTokenMap = Record<string, string>;
const WEIXIN_ACCOUNT_ID_PATTERN = /^[A-Za-z0-9@._-]{1,160}$/u;

export class WeixinAccountStore {
  constructor({ rootDir = defaultWeixinAccountsDir() } = {}) {
    this.rootDir = rootDir;
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  rootDir: string;

  listAccounts() {
    const entries = fs.readdirSync(this.rootDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .filter((entry) => !entry.name.endsWith('.context-tokens.json'))
      .filter((entry) => !entry.name.endsWith('.sync.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length))
      .filter((accountId) => isValidWeixinAccountId(accountId))
      .sort();
  }

  saveAccount({ accountId, token, baseUrl, userId = '' }: { accountId: string; token: string; baseUrl: string; userId?: string }) {
    const normalizedAccountId = assertValidWeixinAccountId(accountId);
    const conflictingAccountId = this.listAccounts().find((existingAccountId) => (
      existingAccountId !== normalizedAccountId
      && existingAccountId.toLowerCase() === normalizedAccountId.toLowerCase()
    ));
    if (conflictingAccountId) {
      throw new Error(
        `Weixin account id ${normalizedAccountId} conflicts with existing Weixin account id ${conflictingAccountId}`,
      );
    }
    const existing = this.loadAccount(normalizedAccountId) ?? {};
    const payload: SavedWeixinAccount = {
      ...existing,
      token,
      base_url: baseUrl,
      user_id: userId,
      saved_at: new Date().toISOString(),
    };
    this.writeJson(this.accountFile(normalizedAccountId), payload);
    return payload;
  }

  loadAccount(accountId: string) {
    return this.readJson<SavedWeixinAccount>(this.accountFile(accountId));
  }

  updateAccount(accountId: string, patch: Partial<Pick<SavedWeixinAccount, 'display_name' | 'disabled' | 'group' | 'role' | 'permissions' | 'model_provider'>>) {
    const current = this.loadAccount(accountId);
    if (!current) {
      return null;
    }
    const next: SavedWeixinAccount = { ...current };
    if ('display_name' in patch) {
      const displayName = String(patch.display_name ?? '').trim();
      if (displayName) {
        next.display_name = displayName;
      } else {
        delete next.display_name;
      }
    }
    if ('disabled' in patch) {
      next.disabled = Boolean(patch.disabled);
    }
    if ('group' in patch) {
      const group = String(patch.group ?? '').trim();
      if (group) {
        next.group = group.slice(0, 80);
      } else {
        delete next.group;
      }
    }
    if ('role' in patch) {
      const role = normalizeAccountRole(patch.role);
      if (role) {
        next.role = role;
      } else {
        delete next.role;
      }
    }
    if ('permissions' in patch) {
      next.permissions = normalizeAccountPermissions(patch.permissions);
    }
    if ('model_provider' in patch) {
      const modelProvider = normalizeAccountModelProvider(patch.model_provider);
      if (modelProvider) {
        next.model_provider = modelProvider;
      } else {
        delete next.model_provider;
      }
    }
    this.writeJson(this.accountFile(accountId), next);
    return next;
  }

  deleteAccount(accountId: string) {
    for (const filePath of [
      this.accountFile(accountId),
      this.contextTokensFile(accountId),
      this.syncFile(accountId),
    ]) {
      try {
        fs.rmSync(filePath, { force: true });
      } catch {}
    }
  }

  isAccountDisabled(accountId: string) {
    return Boolean(this.loadAccount(accountId)?.disabled);
  }

  getContextToken(accountId: string, peerId: string) {
    const tokens = this.readJson<ContextTokenMap>(this.contextTokensFile(accountId)) ?? {};
    const token = tokens?.[peerId];
    return typeof token === 'string' && token ? token : null;
  }

  setContextToken(accountId: string, peerId: string, contextToken: string) {
    const tokens = this.readJson<ContextTokenMap>(this.contextTokensFile(accountId)) ?? {};
    tokens[peerId] = contextToken;
    this.writeJson(this.contextTokensFile(accountId), tokens);
  }

  loadSyncCursor(accountId: string) {
    return loadGetUpdatesBuf(this.syncFile(accountId)) ?? '';
  }

  saveSyncCursor(accountId: string, syncCursor: string) {
    saveGetUpdatesBuf(this.syncFile(accountId), syncCursor);
  }

  accountFile(accountId: string) {
    return this.resolveAccountPath(accountId, '.json');
  }

  contextTokensFile(accountId: string) {
    return this.resolveAccountPath(accountId, '.context-tokens.json');
  }

  syncFile(accountId: string) {
    const normalizedAccountId = assertValidWeixinAccountId(accountId);
    return getSyncBufFilePath(this.rootDir, normalizedAccountId);
  }

  private resolveAccountPath(accountId: string, suffix: string) {
    const normalizedAccountId = assertValidWeixinAccountId(accountId);
    const rootDir = path.resolve(this.rootDir);
    const filePath = path.resolve(rootDir, `${normalizedAccountId}${suffix}`);
    if (path.dirname(filePath) !== rootDir) {
      throw new Error(`invalid Weixin account id: ${accountId}`);
    }
    return filePath;
  }

  readJson<T>(filePath: string): T | null {
    return readJsonFileSafely<T | null>(filePath, { fallback: null });
  }

  writeJson(filePath: string, value: unknown) {
    writeJsonFileAtomically(filePath, value);
  }
}

export function isValidWeixinAccountId(value: unknown): boolean {
  const accountId = String(value ?? '').trim();
  return WEIXIN_ACCOUNT_ID_PATTERN.test(accountId)
    && accountId !== '.'
    && accountId !== '..';
}

export function assertValidWeixinAccountId(value: unknown): string {
  const accountId = String(value ?? '').trim();
  if (!isValidWeixinAccountId(accountId)) {
    throw new Error(`invalid Weixin account id: ${accountId || '<empty>'}`);
  }
  return accountId;
}

function normalizeAccountRole(value: unknown): string {
  const role = String(value ?? '').trim().toLowerCase();
  if (['owner', 'admin', 'member', 'viewer'].includes(role)) {
    return role;
  }
  return '';
}

function normalizeAccountPermissions(value: unknown): NonNullable<SavedWeixinAccount['permissions']> {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    can_chat: source.can_chat !== undefined
      ? Boolean(source.can_chat)
      : source.canChat !== undefined
        ? Boolean(source.canChat)
        : true,
    can_upload: source.can_upload !== undefined
      ? Boolean(source.can_upload)
      : source.canUpload !== undefined
        ? Boolean(source.canUpload)
        : true,
    can_execute_commands: source.can_execute_commands !== undefined
      ? Boolean(source.can_execute_commands)
      : source.canExecuteCommands !== undefined
        ? Boolean(source.canExecuteCommands)
        : false,
  };
}

function normalizeAccountModelProvider(value: unknown): NonNullable<SavedWeixinAccount['model_provider']> | null {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const providerProfileId = String(source.provider_profile_id ?? source.providerProfileId ?? '').trim();
  const model = String(source.model ?? '').trim();
  const reasoningEffort = String(source.reasoning_effort ?? source.reasoningEffort ?? '').trim();
  if (!providerProfileId && !model && !reasoningEffort) {
    return null;
  }
  return {
    ...(providerProfileId ? { provider_profile_id: providerProfileId.slice(0, 120) } : {}),
    ...(model ? { model: model.slice(0, 160) } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort.slice(0, 40) } : {}),
  };
}

export function defaultWeixinAccountsDir() {
  return path.join(os.homedir(), '.codexbridge', 'weixin', 'accounts');
}
