import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertRecoveryState,
  createRecoveryState,
  readRecoveryState,
  updateRecoveryState,
  writeRecoveryStateAtomically,
} from '../../scripts/release/release_recovery.mjs';

test('creates and validates a versioned push-pending recovery state', () => {
  const state = createRecoveryState(validStateInput('push-pending'), {
    now: () => new Date('2026-07-16T00:00:00.000Z'),
  });

  assert.equal(state.schemaVersion, 1);
  assert.equal(state.phase, 'push-pending');
  assert.equal(state.version, '0.1.7');
  assert.equal(state.notesFile, 'docs/releases/v0.1.7.md');
  assert.equal(assertRecoveryState(state, '0.1.7').tag, 'v0.1.7');
});

test('rejects malformed recovery state before resume actions', () => {
  assert.throws(
    () => assertRecoveryState({ ...validStateInput('refs-pushed'), commit: 'short' }, '0.1.7'),
    /commit/u,
  );
  assert.throws(
    () => assertRecoveryState({ ...validStateInput('refs-pushed'), phase: 'published' }, '0.1.7'),
    /phase/u,
  );
  assert.throws(
    () => assertRecoveryState({ ...validStateInput('refs-pushed'), notesFile: 'C:\\secret.md' }, '0.1.7'),
    /repository-relative/u,
  );
  assert.throws(
    () => assertRecoveryState({ ...validStateInput('refs-pushed'), artifacts: [] }, '0.1.7'),
    /three release assets/u,
  );
  assert.throws(
    () => assertRecoveryState({
      ...validStateInput('refs-pushed'),
      createdAt: 'July 16, 2026',
    }, '0.1.7'),
    /createdAt/u,
  );
});

test('writes, reads, and updates recovery state atomically', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-release-recovery-'));
  const filePath = path.join(stateDir, 'codexbridge-release-recovery.json');
  try {
    const state = createRecoveryState(validStateInput('refs-pushed'), {
      now: () => new Date('2026-07-16T00:00:00.000Z'),
    });
    writeRecoveryStateAtomically(filePath, state);
    assert.deepEqual(readRecoveryState(filePath, '0.1.7'), state);

    const updated = updateRecoveryState(filePath, state, {
      phase: 'draft-created',
      now: () => new Date('2026-07-16T00:01:00.000Z'),
    });
    assert.equal(updated.phase, 'draft-created');
    assert.equal(readRecoveryState(filePath, '0.1.7').updatedAt, '2026-07-16T00:01:00.000Z');
    assert.equal(fs.readdirSync(stateDir).filter((name) => name.endsWith('.tmp')).length, 0);
  } finally {
    fs.rmSync(stateDir, { force: true, recursive: true });
  }
});

function validStateInput(phase: string) {
  return {
    schemaVersion: 1,
    version: '0.1.7',
    tag: 'v0.1.7',
    branch: 'main',
    remote: 'gouyu',
    commit: '0123456789abcdef0123456789abcdef01234567',
    notesFile: 'docs/releases/v0.1.7.md',
    phase,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    artifacts: [
      {
        name: 'CodexBridge-Weixin-Admin-Setup-0.1.7.exe',
        size: 123456,
        sha256: '0'.repeat(64),
      },
      {
        name: 'CodexBridge-Weixin-Admin-Setup-0.1.7.exe.blockmap',
        size: 1234,
        sha256: '1'.repeat(64),
      },
      {
        name: 'latest.yml',
        size: 321,
        sha256: '2'.repeat(64),
      },
    ],
    latestYmlSha256: '2'.repeat(64),
  };
}
