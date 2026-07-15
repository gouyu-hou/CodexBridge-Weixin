import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WeixinAccountStore } from '../../../src/platforms/weixin/account_store.js';
import {
  _resetContextTokenStoreForTest,
  clearContextTokensForAccount,
  getContextToken as getOfficialContextToken,
} from '../../../src/platforms/weixin/official/context_tokens.js';

test('WeixinAccountStore rejects account ids that can escape the accounts directory', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-account-store-'));
  const store = new WeixinAccountStore({ rootDir });

  for (const accountId of ['../outside', '..\\outside', 'nested/account', 'nested\\account', '.', '..']) {
    assert.throws(
      () => store.saveAccount({ accountId, token: 'token', baseUrl: 'https://example.test' }),
      /invalid Weixin account id/u,
    );
  }

  assert.deepEqual(store.listAccounts(), []);
});

test('WeixinAccountStore accepts official account id characters', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-account-store-'));
  const store = new WeixinAccountStore({ rootDir });

  store.saveAccount({
    accountId: '0472f8b03441@im.bot',
    token: 'token',
    baseUrl: 'https://example.test',
  });

  assert.equal(store.loadAccount('0472f8b03441@im.bot')?.token, 'token');
});

test('WeixinAccountStore rejects account ids that differ only by case', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-account-store-'));
  const store = new WeixinAccountStore({ rootDir });
  store.saveAccount({ accountId: 'Bot-Primary', token: 'original', baseUrl: 'https://example.test' });

  assert.throws(
    () => store.saveAccount({ accountId: 'bot-primary', token: 'replacement', baseUrl: 'https://example.test' }),
    /conflicts with existing Weixin account id/u,
  );
  assert.equal(store.loadAccount('Bot-Primary')?.token, 'original');
});

test('WeixinAccountStore quarantines corrupt account and context-token JSON files', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-account-store-'));
  const store = new WeixinAccountStore({ rootDir });
  const accountId = 'bot-primary';
  const accountPath = path.join(rootDir, `${accountId}.json`);
  const contextPath = path.join(rootDir, `${accountId}.context-tokens.json`);
  fs.writeFileSync(accountPath, '{ broken account', 'utf8');
  fs.writeFileSync(contextPath, '{ broken context', 'utf8');

  assert.equal(store.loadAccount(accountId), null);
  assert.equal(store.getContextToken(accountId, 'peer-1'), null);

  const files = fs.readdirSync(rootDir);
  assert.equal(files.some((file) => file.startsWith(`${accountId}.json.corrupt-`)), true);
  assert.equal(files.some((file) => file.startsWith(`${accountId}.context-tokens.json.corrupt-`)), true);

  store.saveAccount({ accountId, token: 'token', baseUrl: 'https://example.test' });
  store.setContextToken(accountId, 'peer-1', 'context-token');
  assert.equal(store.loadAccount(accountId)?.token, 'token');
  assert.equal(store.getContextToken(accountId, 'peer-1'), 'context-token');
});

test('WeixinAccountStore does not mask non-missing JSON read errors', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-account-store-'));
  const store = new WeixinAccountStore({ rootDir });
  fs.mkdirSync(path.join(rootDir, 'blocked.json'));

  assert.throws(() => store.loadAccount('blocked'), /EISDIR|illegal operation on a directory/u);
});

test('official context-token cleanup rejects account ids outside the accounts directory', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-account-store-'));
  const outsideName = `${path.basename(rootDir)}-outside`;
  const outsidePath = path.join(rootDir, '..', `${outsideName}.context-tokens.json`);
  fs.writeFileSync(outsidePath, '{"peer":"secret"}', 'utf8');

  try {
    assert.throws(
      () => clearContextTokensForAccount(rootDir, `../${outsideName}`),
      /invalid Weixin account id/u,
    );
    assert.equal(fs.existsSync(outsidePath), true);
  } finally {
    fs.rmSync(outsidePath, { force: true });
  }
});

test('official context-token reads do not mask non-missing file errors', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-account-store-'));
  fs.mkdirSync(path.join(rootDir, 'blocked.context-tokens.json'));
  _resetContextTokenStoreForTest();

  try {
    assert.throws(
      () => getOfficialContextToken(rootDir, 'blocked', 'peer'),
      /EISDIR|illegal operation on a directory/u,
    );
  } finally {
    _resetContextTokenStoreForTest();
  }
});
