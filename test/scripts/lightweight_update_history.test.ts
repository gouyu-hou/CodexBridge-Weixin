import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LightweightUpdateHistoryStore } = require(
  '../../scripts/electron/lightweight-update-history.cjs',
) as {
  LightweightUpdateHistoryStore: new (
    filePath: string,
    options?: { maxEntries?: number },
  ) => {
    load(): Promise<unknown[]>;
    append(record: Record<string, unknown>): Promise<unknown>;
    list(): unknown[];
  };
};

test('lightweight update history persists bounded sanitized records atomically', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-update-history-'));
  try {
    const historyPath = path.join(stateDir, 'updates', 'history.json');
    const store = new LightweightUpdateHistoryStore(historyPath, { maxEntries: 3 });

    await store.load();
    await store.append({
      action: 'verify',
      result: 'success',
      stage: 'package',
      version: '0.1.7',
      keyId: 'a'.repeat(64),
      errorMessage: 'line one\nline two',
      privateKey: ['-----BEGIN ', 'PRIVATE KEY-----secret'].join(''),
    });
    await store.append({ action: 'install', result: 'success', version: '0.1.7' });
    await store.append({ action: 'rollback', result: 'success', version: '0.1.7' });

    const records = store.list() as Array<Record<string, unknown>>;
    assert.equal(records.length, 3);
    assert.equal(records[0]?.action, 'verify');
    assert.equal(records[1]?.action, 'install');
    assert.equal(records[2]?.action, 'rollback');
    assert.equal(records[0]?.privateKey, undefined);
    assert.doesNotMatch(String(records[0]?.errorMessage ?? ''), /PRIVATE KEY|\n/u);

    await store.append({ action: 'failure', result: 'failure', stage: 'verify', errorMessage: 'temporary failure' });
    const boundedRecords = store.list() as Array<Record<string, unknown>>;
    assert.equal(boundedRecords.length, 3);
    assert.equal(boundedRecords[0]?.action, 'install');
    assert.equal(boundedRecords[2]?.action, 'failure');
    assert.equal(fs.existsSync(`${historyPath}.tmp`), false);

    const reloaded = new LightweightUpdateHistoryStore(historyPath, { maxEntries: 3 });
    await reloaded.load();
    assert.deepEqual(reloaded.list(), boundedRecords);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('lightweight update history quarantines corrupt JSON and starts empty', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-update-history-corrupt-'));
  try {
    const historyPath = path.join(stateDir, 'updates', 'history.json');
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.writeFileSync(historyPath, '{not-json\n', 'utf8');

    const store = new LightweightUpdateHistoryStore(historyPath);
    await store.load();

    assert.deepEqual(store.list(), []);
    const quarantined = fs.readdirSync(path.dirname(historyPath))
      .filter((name) => name.startsWith('history.json.corrupt-'));
    assert.equal(quarantined.length, 1);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('lightweight update history recovers an interrupted replacement', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-update-history-recovery-'));
  try {
    const historyPath = path.join(stateDir, 'updates', 'history.json');
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.writeFileSync(
      `${historyPath}.123.previous`,
      JSON.stringify({
        schemaVersion: 1,
        records: [{ action: 'rollback', result: 'success', version: '0.1.7' }],
      }),
      'utf8',
    );

    const store = new LightweightUpdateHistoryStore(historyPath);
    await store.load();

    assert.equal((store.list() as Array<Record<string, unknown>>)[0]?.action, 'rollback');
    assert.equal(fs.existsSync(historyPath), true);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
