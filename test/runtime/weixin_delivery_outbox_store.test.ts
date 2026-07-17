import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  WeixinDeliveryOutboxStore,
  type WeixinPendingTextDelivery,
} from '../../src/runtime/weixin_delivery_outbox_store.js';

const RETENTION_MS = 24 * 60 * 60 * 1000;

function makeStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-weixin-outbox-'));
}

function makeEntry(
  overrides: Partial<WeixinPendingTextDelivery> = {},
): WeixinPendingTextDelivery {
  const now = Date.now();
  return {
    id: 'delivery-1',
    externalScopeId: 'wxid-1',
    content: 'pending final text',
    source: 'final',
    createdAt: now,
    nextAttemptAt: now + 15_000,
    attemptCount: 0,
    lastError: 'temporary failure',
    lastErrorCode: null,
    ...overrides,
  };
}

test('WeixinDeliveryOutboxStore initializes an empty versioned outbox', () => {
  const stateDir = makeStateDir();
  const store = new WeixinDeliveryOutboxStore(stateDir);

  assert.deepEqual(store.read(), []);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(stateDir, 'weixin', 'delivery-outbox.json'), 'utf8')),
    { version: 1, entries: [] },
  );
});

test('WeixinDeliveryOutboxStore normalizes values and returns deep clones', () => {
  const stateDir = makeStateDir();
  const store = new WeixinDeliveryOutboxStore(stateDir);
  const input = makeEntry({
    id: `  ${'i'.repeat(200)}  `,
    externalScopeId: `  ${'s'.repeat(240)}  `,
    content: '  pending final text  ',
    source: `  ${'x'.repeat(100)}  `,
    attemptCount: 3.9,
    lastError: `  ${'e'.repeat(600)}  `,
    lastErrorCode: -2,
  });

  store.write([input]);
  input.content = 'mutated input';
  const firstRead = store.read();

  assert.equal(firstRead.length, 1);
  assert.equal(firstRead[0]?.id.length, 160);
  assert.equal(firstRead[0]?.externalScopeId.length, 200);
  assert.equal(firstRead[0]?.content, 'pending final text');
  assert.equal(firstRead[0]?.source.length, 80);
  assert.equal(firstRead[0]?.attemptCount, 3);
  assert.equal(firstRead[0]?.lastError.length, 500);
  assert.equal(firstRead[0]?.lastErrorCode, -2);

  firstRead[0]!.content = 'mutated read';
  assert.equal(store.read()[0]?.content, 'pending final text');
});

test('WeixinDeliveryOutboxStore drops malformed entries independently', () => {
  const stateDir = makeStateDir();
  const store = new WeixinDeliveryOutboxStore(stateDir);
  const filePath = path.join(stateDir, 'weixin', 'delivery-outbox.json');
  const valid = makeEntry({ id: 'valid' });
  fs.writeFileSync(filePath, `${JSON.stringify({
    version: 99,
    entries: [
      null,
      { ...valid, id: '' },
      { ...valid, externalScopeId: '' },
      { ...valid, content: '' },
      { ...valid, createdAt: 0 },
      { ...valid, nextAttemptAt: Number.NaN },
      { ...valid, id: 'invalid-code', content: 'invalid code entry', lastErrorCode: 'rate-limited' },
      valid,
    ],
  })}\n`, 'utf8');

  assert.deepEqual(store.read().map((entry) => entry.id), ['invalid-code', 'valid']);
  assert.equal(store.read()[0]?.lastErrorCode, null);
});

test('WeixinDeliveryOutboxStore collapses duplicates to the later retry state', () => {
  const stateDir = makeStateDir();
  const store = new WeixinDeliveryOutboxStore(stateDir);
  const first = makeEntry({ id: 'first', attemptCount: 1, nextAttemptAt: Date.now() + 10_000 });
  const later = makeEntry({ id: 'later', attemptCount: 4, nextAttemptAt: Date.now() + 80_000 });

  store.write([first, later]);

  const entries = store.read();
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.id, 'later');
  assert.equal(entries[0]?.attemptCount, 4);
});

test('WeixinDeliveryOutboxStore deduplicates stable ids even when retry content changes', () => {
  const stateDir = makeStateDir();
  const store = new WeixinDeliveryOutboxStore(stateDir);

  store.write([
    makeEntry({ id: 'stable-final', content: 'full final answer', attemptCount: 1 }),
    makeEntry({ id: 'stable-final', content: 'remaining final answer', attemptCount: 2 }),
  ]);

  assert.deepEqual(store.read().map((entry) => ({
    id: entry.id,
    content: entry.content,
    attemptCount: entry.attemptCount,
  })), [{
    id: 'stable-final',
    content: 'remaining final answer',
    attemptCount: 2,
  }]);
});

test('WeixinDeliveryOutboxStore expires entries after 24 hours', () => {
  const stateDir = makeStateDir();
  const store = new WeixinDeliveryOutboxStore(stateDir);
  const now = Date.now();

  store.write([
    makeEntry({ id: 'expired', content: 'expired', createdAt: now - RETENTION_MS - 1 }),
    makeEntry({ id: 'retained', content: 'retained', createdAt: now - RETENTION_MS + 5_000 }),
  ]);

  assert.deepEqual(store.read().map((entry) => entry.id), ['retained']);
});

test('WeixinDeliveryOutboxStore keeps the newest 50 entries in retry order', () => {
  const stateDir = makeStateDir();
  const store = new WeixinDeliveryOutboxStore(stateDir);
  const now = Date.now();
  const entries = Array.from({ length: 55 }, (_, index) => makeEntry({
    id: `delivery-${index}`,
    content: `content-${index}`,
    createdAt: now - index,
  })).reverse();

  store.write(entries);

  assert.deepEqual(
    store.read().map((entry) => entry.id),
    Array.from({ length: 50 }, (_, index) => `delivery-${49 - index}`),
  );
});

test('WeixinDeliveryOutboxStore truncates content at a surrogate-safe 32 KiB boundary', () => {
  const stateDir = makeStateDir();
  const store = new WeixinDeliveryOutboxStore(stateDir);

  store.write([makeEntry({ content: `${'a'.repeat(32 * 1024 - 1)}😀tail` })]);

  const content = store.read()[0]?.content ?? '';
  assert.ok(Buffer.byteLength(content, 'utf8') <= 32 * 1024);
  assert.equal(content.endsWith('\uD83D'), false);
  assert.equal(content, 'a'.repeat(32 * 1024 - 1));
});

test('WeixinDeliveryOutboxStore quarantines corrupt JSON and starts empty', () => {
  const stateDir = makeStateDir();
  const directory = path.join(stateDir, 'weixin');
  const filePath = path.join(directory, 'delivery-outbox.json');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filePath, '{ broken json', 'utf8');

  const store = new WeixinDeliveryOutboxStore(stateDir);

  assert.deepEqual(store.read(), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { version: 1, entries: [] });
  const quarantined = fs.readdirSync(directory)
    .filter((entry) => entry.startsWith('delivery-outbox.json.corrupt-'));
  assert.equal(quarantined.length, 1);
  assert.equal(fs.readFileSync(path.join(directory, quarantined[0]!), 'utf8'), '{ broken json');
});
