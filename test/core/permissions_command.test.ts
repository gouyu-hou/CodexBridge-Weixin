import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { Translator } from '../../src/i18n/index.js';
import { resolvePermissionsState } from '../../src/core/permissions_mode.js';

type PermissionsCommandModule = typeof import('../../src/core/permissions_command.js');

async function loadPermissionsCommand(): Promise<PermissionsCommandModule | null> {
  try {
    return await import('../../src/core/permissions_command.js');
  } catch {
    return null;
  }
}

const translator: Translator = {
  locale: 'en',
  t(key, params = {}) {
    return `${key}:${JSON.stringify(params)}`;
  },
};

test('permissions command normalizes supported command aliases', async () => {
  const module = await loadPermissionsCommand();
  assert.ok(module, 'permissions_command module must exist');

  assert.equal(module.normalizePermissionsCommandArg('default'), 'default-permissions');
  assert.equal(module.normalizePermissionsCommandArg('AUTO-REVIEW'), 'auto-review');
  assert.equal(module.normalizePermissionsCommandArg('full-access'), 'full-access');
  assert.equal(module.normalizePermissionsCommandArg('read-only'), null);
  assert.equal(module.normalizePermissionsCommandArg('unknown'), null);
});

test('permissions command renders resolved values and every supported mode', async () => {
  const module = await loadPermissionsCommand();
  assert.ok(module, 'permissions_command module must exist');

  const lines = module.renderPermissionsLines({
    permissionsMode: 'auto-review',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    approvalsReviewer: 'auto_review',
  }, translator);

  assert.ok(lines.some((line) => line.includes('coordinator.permissions.mode.autoReview')));
  assert.ok(lines.includes('- /permissions default-permissions'));
  assert.ok(lines.includes('- /permissions auto-review'));
  assert.ok(lines.includes('- /permissions full-access'));
  assert.ok(lines.includes('- /permissions custom'));
});

test('permissions command formats profile defaults and full-access reviewer state', async () => {
  const module = await loadPermissionsCommand();
  assert.ok(module, 'permissions_command module must exist');

  const profileDefaults = resolvePermissionsState(null);
  assert.match(module.formatApprovalPolicyValue(profileDefaults, translator), /configuredInProfile/u);
  assert.match(module.formatSandboxModeValue(profileDefaults, translator), /configuredInProfile/u);

  const fullAccess = resolvePermissionsState({ permissionsMode: 'full-access' });
  assert.match(module.formatApprovalsReviewerValue(fullAccess, translator), /notApplicable/u);
});

test('BridgeCoordinator delegates permissions presentation to the focused module', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'core', 'bridge_coordinator.ts'),
    'utf8',
  );

  assert.match(source, /from '\.\/permissions_command\.js'/u);
  assert.doesNotMatch(source, /function normalizePermissionsCommandArg\(/u);
  assert.doesNotMatch(source, /function formatPermissionsMode\(/u);
  assert.doesNotMatch(source, /function renderPermissionsLines\(/u);
});
