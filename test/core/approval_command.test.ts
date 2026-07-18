import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { Translator } from '../../src/i18n/index.js';
import type { ProviderApprovalRequest } from '../../src/types/provider.js';

type ApprovalCommandModule = typeof import('../../src/core/approval_command.js');

async function loadApprovalCommand(): Promise<ApprovalCommandModule | null> {
  try {
    return await import('../../src/core/approval_command.js');
  } catch {
    return null;
  }
}

function approval(overrides: Partial<ProviderApprovalRequest> = {}): ProviderApprovalRequest {
  return {
    requestId: 'approval-1',
    kind: 'command',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    reason: 'Run the requested command',
    command: 'npm test',
    cwd: 'D:/repo',
    ...overrides,
  };
}

const translator: Translator = {
  locale: 'en',
  t(key, params = {}) {
    return `${key}:${JSON.stringify(params)}`;
  },
};

test('approval command parses aliases and positive request indexes', async () => {
  const module = await loadApprovalCommand();
  assert.ok(module, 'approval_command module must exist');

  assert.deepEqual(module.parseAllowCommandArgs(['once']), { option: 1, requestIndex: 1 });
  assert.deepEqual(module.parseAllowCommandArgs(['session', '3']), { option: 2, requestIndex: 3 });
  assert.deepEqual(module.parseAllowCommandArgs(['deny', '0']), { option: 3, requestIndex: 1 });
  assert.deepEqual(module.parseAllowCommandArgs(['unknown']), { option: null, requestIndex: 1 });
});

test('approval command detects when session-wide approval is supported', async () => {
  const module = await loadApprovalCommand();
  assert.ok(module, 'approval_command module must exist');

  assert.equal(module.supportsSessionWideApproval(approval()), false);
  assert.equal(module.supportsSessionWideApproval(approval({ kind: 'file_change' })), true);
  assert.equal(module.supportsSessionWideApproval(approval({
    availableDecisionKeys: ['acceptForSession'],
  })), true);
});

test('approval command renders at most three detailed requests and preserves decisions', async () => {
  const module = await loadApprovalCommand();
  assert.ok(module, 'approval_command module must exist');
  const requests = Array.from({ length: 5 }, (_, index) => approval({
    requestId: `approval-${index + 1}`,
    command: `command-${index + 1}`,
  }));

  const lines = module.renderAllowLines(requests, translator);

  assert.equal(lines.filter((line) => line.includes('coordinator.allow.requestHeader')).length, 3);
  assert.ok(lines.some((line) => line.includes('coordinator.allow.moreRequests')));
  assert.ok(lines.some((line) => line.includes('coordinator.allow.option2Unavailable')));
});

test('BridgeCoordinator delegates approval presentation to the focused module', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'core', 'bridge_coordinator.ts'),
    'utf8',
  );

  assert.match(source, /from '\.\/approval_command\.js'/u);
  assert.doesNotMatch(source, /function parseAllowCommandArgs\(/u);
  assert.doesNotMatch(source, /function renderAllowLines\(/u);
  assert.doesNotMatch(source, /function supportsSessionWideApproval\(/u);
});
