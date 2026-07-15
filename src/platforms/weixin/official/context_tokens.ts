import fs from 'node:fs';
import path from 'node:path';
import { readJsonFileSafely, writeJsonFileAtomically } from '../../../store/file_json/json_file_io.js';
import { assertValidWeixinAccountId } from '../account_store.js';

const contextTokenStore = new Map<string, string>();

function contextTokenKey(accountId: string, userId: string): string {
  return `${accountId}:${userId}`;
}

function resolveContextTokenFilePath(accountsDir: string, accountId: string): string {
  const normalizedAccountId = assertValidWeixinAccountId(accountId);
  const rootDir = path.resolve(accountsDir);
  const filePath = path.resolve(rootDir, `${normalizedAccountId}.context-tokens.json`);
  if (path.dirname(filePath) !== rootDir) {
    throw new Error(`invalid Weixin account id: ${accountId}`);
  }
  return filePath;
}

function persistContextTokens(accountsDir: string, accountId: string): void {
  const normalizedAccountId = assertValidWeixinAccountId(accountId);
  const prefix = `${normalizedAccountId}:`;
  const tokens: Record<string, string> = {};
  for (const [key, value] of contextTokenStore) {
    if (key.startsWith(prefix)) {
      tokens[key.slice(prefix.length)] = value;
    }
  }
  const filePath = resolveContextTokenFilePath(accountsDir, normalizedAccountId);
  writeJsonFileAtomically(filePath, tokens);
}

export function restoreContextTokens(accountsDir: string, accountId: string): void {
  reloadContextTokensForAccount(accountsDir, accountId);
}

export function reloadContextTokensForAccount(
  accountsDir: string,
  accountId: string,
): Record<string, string> {
  const normalizedAccountId = assertValidWeixinAccountId(accountId);
  const filePath = resolveContextTokenFilePath(accountsDir, normalizedAccountId);
  const tokens = normalizeContextTokenMap(
    readJsonFileSafely<Record<string, unknown>>(filePath, { fallback: {} }),
  );
  replaceContextTokenCache(normalizedAccountId, tokens);
  return tokens;
}

export function replaceContextTokensForAccount(
  accountsDir: string,
  accountId: string,
  tokens: Record<string, unknown>,
): Record<string, string> {
  const normalizedAccountId = assertValidWeixinAccountId(accountId);
  const normalizedTokens = normalizeContextTokenMap(tokens);
  writeJsonFileAtomically(
    resolveContextTokenFilePath(accountsDir, normalizedAccountId),
    normalizedTokens,
  );
  replaceContextTokenCache(normalizedAccountId, normalizedTokens);
  return normalizedTokens;
}

export function clearContextTokensForAccount(accountsDir: string, accountId: string): void {
  const normalizedAccountId = assertValidWeixinAccountId(accountId);
  const prefix = `${normalizedAccountId}:`;
  for (const key of [...contextTokenStore.keys()]) {
    if (key.startsWith(prefix)) {
      contextTokenStore.delete(key);
    }
  }
  const filePath = resolveContextTokenFilePath(accountsDir, normalizedAccountId);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // best effort
  }
}

export function setContextToken(
  accountsDir: string,
  accountId: string,
  userId: string,
  token: string,
): void {
  const normalizedAccountId = assertValidWeixinAccountId(accountId);
  contextTokenStore.set(contextTokenKey(normalizedAccountId, userId), token);
  persistContextTokens(accountsDir, normalizedAccountId);
}

export function getContextToken(
  accountsDir: string,
  accountId: string,
  userId: string,
): string | null {
  const normalizedAccountId = assertValidWeixinAccountId(accountId);
  const key = contextTokenKey(normalizedAccountId, userId);
  const direct = contextTokenStore.get(key);
  if (typeof direct === 'string' && direct) {
    return direct;
  }

  restoreContextTokens(accountsDir, normalizedAccountId);
  const restored = contextTokenStore.get(key);
  return typeof restored === 'string' && restored ? restored : null;
}

export function findAccountIdsByContextToken(
  accountsDir: string,
  accountIds: string[],
  userId: string,
): string[] {
  return accountIds.filter((accountId) => Boolean(getContextToken(accountsDir, accountId, userId)));
}

export function _resetContextTokenStoreForTest(): void {
  contextTokenStore.clear();
}

function normalizeContextTokenMap(tokens: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tokens).filter((entry): entry is [string, string] => (
      Boolean(entry[0]) && typeof entry[1] === 'string' && Boolean(entry[1])
    )),
  );
}

function replaceContextTokenCache(accountId: string, tokens: Record<string, string>): void {
  const prefix = `${accountId}:`;
  for (const key of [...contextTokenStore.keys()]) {
    if (key.startsWith(prefix)) {
      contextTokenStore.delete(key);
    }
  }
  for (const [userId, token] of Object.entries(tokens)) {
    contextTokenStore.set(contextTokenKey(accountId, userId), token);
  }
}
