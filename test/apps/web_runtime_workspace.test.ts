import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  buildPermissionsSettingsUpdate,
  resolvePermissionsState,
  resolveWebPaths,
} from '../../apps/web/packages/runtime/src/index.js';
import { resolveWorkerRepoRoot } from '../../apps/web/server/worker-runtime.js';

test('Web runtime paths stay scoped to state storage and do not expose the repository root', () => {
  const paths = resolveWebPaths({
    CODEXBRIDGE_WEB_STATE_DIR: 'D:/state',
  }, path.join('C:', 'Users', 'tester'));

  assert.equal(paths.stateDir, path.resolve('D:/state'));
  assert.equal(paths.runtimeDir, path.join(paths.stateDir, 'runtime'));
  assert.equal(Object.prototype.hasOwnProperty.call(paths, 'repoRoot'), false);
});

test('Web permission projection preserves default, full, and legacy read-only states', () => {
  assert.deepEqual(buildPermissionsSettingsUpdate('default-permissions'), {
    permissionsMode: 'default-permissions',
    accessPreset: 'default',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    approvalsReviewer: 'user',
  });
  assert.deepEqual(resolvePermissionsState({
    permissionsMode: 'full-access',
    approvalPolicy: null,
    sandboxMode: null,
    accessPreset: null,
    approvalsReviewer: null,
  }), {
    permissionsMode: 'full-access',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    approvalsReviewer: null,
    usesProfileDefaults: false,
  });
  assert.equal(resolvePermissionsState({
    permissionsMode: null,
    accessPreset: 'read-only',
    approvalPolicy: null,
    sandboxMode: null,
    approvalsReviewer: null,
  }).permissionsMode, 'custom');
});

test('worker root resolution accepts legacy input and derives the source repository by default', () => {
  assert.equal(resolveWorkerRepoRoot('  D:/legacy-repo  '), path.resolve('D:/legacy-repo'));
  assert.equal(resolveWorkerRepoRoot(), path.resolve('apps/web/server', '..', '..', '..'));
});
