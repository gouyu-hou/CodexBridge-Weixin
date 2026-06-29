import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getSyncBufFilePath,
  loadGetUpdatesBuf,
  saveGetUpdatesBuf,
} from './official/sync_buf.js';

export interface SavedWeixinAccount {
  token: string;
  base_url: string;
  user_id: string;
  saved_at: string;
  display_name?: string;
  disabled?: boolean;
}

type ContextTokenMap = Record<string, string>;
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
      .sort();
  }

  saveAccount({ accountId, token, baseUrl, userId = '' }: { accountId: string; token: string; baseUrl: string; userId?: string }) {
    const existing = this.loadAccount(accountId) ?? {};
    const payload: SavedWeixinAccount = {
      ...existing,
      token,
      base_url: baseUrl,
      user_id: userId,
      saved_at: new Date().toISOString(),
    };
    this.writeJson(this.accountFile(accountId), payload);
    return payload;
  }

  loadAccount(accountId: string) {
    return this.readJson<SavedWeixinAccount>(this.accountFile(accountId));
  }

  updateAccount(accountId: string, patch: Partial<Pick<SavedWeixinAccount, 'display_name' | 'disabled'>>) {
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
    return path.join(this.rootDir, `${accountId}.json`);
  }

  contextTokensFile(accountId: string) {
    return path.join(this.rootDir, `${accountId}.context-tokens.json`);
  }

  syncFile(accountId: string) {
    return getSyncBufFilePath(this.rootDir, accountId);
  }

  readJson<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  writeJson(filePath: string, value: unknown) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}

export function defaultWeixinAccountsDir() {
  return path.join(os.homedir(), '.codexbridge', 'weixin', 'accounts');
}
