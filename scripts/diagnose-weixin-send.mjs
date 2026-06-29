import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createWeixinOfficialTransport } from '../src/platforms/weixin/official/transport.ts';

const accountId = process.argv[2] || process.env.WEIXIN_ACCOUNT_ID;
const peerId = process.argv[3] || process.env.WEIXIN_TEST_PEER_ID;
const text = process.argv.slice(4).join(' ').trim()
  || `CodexBridge direct send test ${new Date().toLocaleString('zh-CN', { hour12: false })}`;

if (!accountId || !peerId) {
  console.error('usage: node --import tsx scripts/diagnose-weixin-send.mjs <accountId> <peerId> [text]');
  process.exit(2);
}

const accountsDir = path.join(os.homedir(), '.codexbridge', 'weixin', 'accounts');
const accountPath = path.join(accountsDir, `${accountId}.json`);
const tokenPath = path.join(accountsDir, `${accountId}.context-tokens.json`);

const account = JSON.parse(fs.readFileSync(accountPath, 'utf8').replace(/^\uFEFF/u, ''));
let contextToken = null;
try {
  const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8').replace(/^\uFEFF/u, ''));
  contextToken = typeof tokens?.[peerId] === 'string' ? tokens[peerId] : null;
} catch {
  contextToken = null;
}

const client = createWeixinOfficialTransport({
  baseUrl: account.base_url,
  token: account.token,
  locale: 'zh-CN',
});

const clientId = `codexbridge-diagnostic-${crypto.randomUUID()}`;
console.log(JSON.stringify({
  accountId,
  peerId,
  baseUrl: account.base_url,
  contextTokenPresent: Boolean(contextToken),
  clientId,
  text,
}, null, 2));

const result = await client.sendMessage({
  toUserId: peerId,
  text,
  contextToken,
  clientId,
  timeoutMs: 30_000,
});

console.log(JSON.stringify({ result }, null, 2));
