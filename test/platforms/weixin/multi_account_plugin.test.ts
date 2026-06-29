import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WeixinAccountStore } from '../../../src/platforms/weixin/account_store.js';
import { MultiAccountWeixinPlatformPlugin } from '../../../src/platforms/weixin/multi_account_plugin.js';
import { _resetContextTokenStoreForTest } from '../../../src/platforms/weixin/official/context_tokens.js';
import { _resetSessionGuardForTest } from '../../../src/platforms/weixin/official/session_guard.js';

function makeTempAccountsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-weixin-multi-'));
}

function makeFetch(responses: Array<Record<string, unknown>>) {
  const calls: string[] = [];
  return {
    calls,
    fetchImpl: async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push(`${init?.method ?? 'GET'} ${url} ${JSON.stringify(init?.headers ?? {})} ${String(init?.body ?? '')}`);
      const body = responses.shift() ?? { ret: 0, get_updates_buf: '', msgs: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
}

test.beforeEach(() => {
  _resetContextTokenStoreForTest();
  _resetSessionGuardForTest();
});

test('MultiAccountWeixinPlatformPlugin polls saved accounts and scopes non-primary bot sessions by account', async () => {
  const rootDir = makeTempAccountsDir();
  const accountStore = new WeixinAccountStore({ rootDir });
  accountStore.saveAccount({
    accountId: 'bot-primary',
    token: 'token-primary',
    baseUrl: 'https://ilink.example.com',
    userId: 'user-primary',
  });
  accountStore.saveAccount({
    accountId: 'bot-friend',
    token: 'token-friend',
    baseUrl: 'https://ilink.example.com',
    userId: 'user-friend',
  });
  const fetch = makeFetch([
    {
      ret: 0,
      get_updates_buf: 'cursor-primary',
      msgs: [{
        from_user_id: 'wxid_same',
        to_user_id: 'bot-primary',
        msg_type: 0,
        message_id: 'msg-primary',
        context_token: 'ctx-primary',
        item_list: [{ type: 1, text_item: { text: 'from primary' } }],
      }],
    },
    {
      ret: 0,
      get_updates_buf: 'cursor-friend',
      msgs: [{
        from_user_id: 'wxid_same',
        to_user_id: 'bot-friend',
        msg_type: 0,
        message_id: 'msg-friend',
        context_token: 'ctx-friend',
        item_list: [{ type: 1, text_item: { text: 'from friend bot' } }],
      }],
    },
    { typing_ticket: 'typing-primary' },
    { typing_ticket: 'typing-friend' },
    { ret: 0 },
  ]);
  const plugin = new MultiAccountWeixinPlatformPlugin({
    accountStore,
    stateDir: path.dirname(path.dirname(rootDir)),
    env: {
      WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-primary',
      WEIXIN_DM_POLICY: 'open',
      WEIXIN_GROUP_POLICY: 'disabled',
    },
  });
  globalThis.fetch = fetch.fetchImpl as unknown as typeof globalThis.fetch;

  await plugin.start();
  const result = await plugin.pollOnce({});

  assert.equal((result.events?.[0] as any)?.externalScopeId, 'wxid_same');
  assert.equal((result.events?.[1] as any)?.externalScopeId, 'bot-friend:wxid_same');

  const sent = await plugin.sendText({
    externalScopeId: 'bot-friend:wxid_same',
    content: 'hello friend',
  });

  assert.equal(sent?.success, true);
  assert.ok(fetch.calls.some((call) => call.includes('"to_user_id":"wxid_same"') && call.includes('"hello friend"')));
  assert.equal(accountStore.loadSyncCursor('bot-primary'), '');
  await plugin.commitSyncCursor(result.syncCursor);
  assert.equal(accountStore.loadSyncCursor('bot-primary'), 'cursor-primary');
  assert.equal(accountStore.loadSyncCursor('bot-friend'), 'cursor-friend');

  await plugin.stop();
});

test('MultiAccountWeixinPlatformPlugin keeps env-only single account mode pollable', async () => {
  const rootDir = makeTempAccountsDir();
  const accountStore = new WeixinAccountStore({ rootDir });
  const fetch = makeFetch([
    {
      ret: 0,
      get_updates_buf: 'cursor-env',
      msgs: [{
        from_user_id: 'wxid_env',
        to_user_id: 'bot-env',
        msg_type: 0,
        message_id: 'msg-env',
        context_token: 'ctx-env',
        item_list: [{ type: 1, text_item: { text: 'from env account' } }],
      }],
    },
    { typing_ticket: 'typing-env' },
  ]);
  const plugin = new MultiAccountWeixinPlatformPlugin({
    accountStore,
    stateDir: path.dirname(path.dirname(rootDir)),
    env: {
      WEIXIN_ACCOUNT_ID: 'bot-env',
      WEIXIN_TOKEN: 'token-env',
      WEIXIN_BASE_URL: 'https://ilink.example.com',
      WEIXIN_DM_POLICY: 'open',
      WEIXIN_GROUP_POLICY: 'disabled',
    },
  });
  globalThis.fetch = fetch.fetchImpl as unknown as typeof globalThis.fetch;

  await plugin.start();
  const result = await plugin.pollOnce({});

  assert.equal((result.events?.[0] as any)?.externalScopeId, 'wxid_env');
  assert.match(String(result.syncCursor ?? ''), /bot-env/);

  await plugin.stop();
});

test('MultiAccountWeixinPlatformPlugin refreshes default delivery account after primary switches', async () => {
  const rootDir = makeTempAccountsDir();
  const accountStore = new WeixinAccountStore({ rootDir });
  accountStore.saveAccount({
    accountId: 'bot-primary',
    token: 'token-primary',
    baseUrl: 'https://ilink.example.com',
    userId: 'user-primary',
  });
  accountStore.saveAccount({
    accountId: 'bot-friend',
    token: 'token-friend',
    baseUrl: 'https://ilink.example.com',
    userId: 'user-friend',
  });
  const fetch = makeFetch([
    { ret: 0, get_updates_buf: 'cursor-primary', msgs: [] },
    { ret: 0, get_updates_buf: 'cursor-friend', msgs: [] },
  ]);
  const env = {
    WEIXIN_PRIMARY_ACCOUNT_ID: 'bot-primary',
    WEIXIN_DM_POLICY: 'open',
    WEIXIN_GROUP_POLICY: 'disabled',
  };
  const plugin = new MultiAccountWeixinPlatformPlugin({
    accountStore,
    stateDir: path.dirname(path.dirname(rootDir)),
    env,
  });
  globalThis.fetch = fetch.fetchImpl as unknown as typeof globalThis.fetch;

  await plugin.start();
  env.WEIXIN_PRIMARY_ACCOUNT_ID = 'bot-friend';
  await plugin.sendText({
    externalScopeId: 'wxid_same',
    content: 'hello new primary',
  });

  assert.ok(fetch.calls.some((call) => (
    call.includes('"Authorization":"Bearer token-friend"')
    && call.includes('"to_user_id":"wxid_same"')
    && call.includes('"hello new primary"')
  )));

  await plugin.stop();
});
