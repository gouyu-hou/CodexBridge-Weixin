import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

type AutomationCommandModule = typeof import('../../src/core/automation_command.js');

async function loadAutomationCommand(): Promise<AutomationCommandModule | null> {
  try {
    return await import('../../src/core/automation_command.js');
  } catch {
    return null;
  }
}

test('automation command resolves default and direct lifecycle routes', async () => {
  const module = await loadAutomationCommand();
  assert.ok(module, 'automation_command module must exist');

  assert.deepEqual(module.resolveAutomationCommand([]), { kind: 'default' });
  assert.deepEqual(module.resolveAutomationCommand([' CONFIRM ']), { kind: 'confirm' });
  assert.deepEqual(module.resolveAutomationCommand(['edit']), { kind: 'edit' });
  assert.deepEqual(module.resolveAutomationCommand(['cancel']), { kind: 'cancel' });
  assert.deepEqual(module.resolveAutomationCommand(['list']), { kind: 'list' });
  assert.deepEqual(module.resolveAutomationCommand(['add']), { kind: 'add' });
});

test('automation command preserves the single target token used by job actions', async () => {
  const module = await loadAutomationCommand();
  assert.ok(module, 'automation_command module must exist');

  assert.deepEqual(module.resolveAutomationCommand(['show', ' 2 ', 'ignored']), { kind: 'show', token: '2' });
  assert.deepEqual(module.resolveAutomationCommand(['pause', 'daily-report']), { kind: 'pause', token: 'daily-report' });
  assert.deepEqual(module.resolveAutomationCommand(['resume']), { kind: 'resume', token: '' });
  assert.deepEqual(module.resolveAutomationCommand(['rename', ' 3 ']), { kind: 'rename', token: '3' });
});

test('automation command canonicalizes delete and falls back to natural language', async () => {
  const module = await loadAutomationCommand();
  assert.ok(module, 'automation_command module must exist');

  assert.deepEqual(module.resolveAutomationCommand(['delete', '1']), { kind: 'delete', token: '1' });
  assert.deepEqual(module.resolveAutomationCommand(['del', '1']), { kind: 'delete', token: '1' });
  assert.deepEqual(module.resolveAutomationCommand(['明天提醒我']), { kind: 'natural' });
  assert.deepEqual(module.resolveAutomationCommand('list'), { kind: 'default' });
});

test('BridgeCoordinator delegates automation command routing to the focused module', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'core', 'bridge_coordinator.ts'),
    'utf8',
  );
  const handlerStart = source.indexOf('  async handleAutomationCommand');
  const handlerEnd = source.indexOf('  async handleWeiboCommand', handlerStart);
  const handlerSource = source.slice(handlerStart, handlerEnd);

  assert.match(source, /from '\.\/automation_command\.js'/u);
  assert.match(handlerSource, /resolveAutomationCommand\(args\)/u);
  assert.doesNotMatch(handlerSource, /const subcommand = String\(normalizedArgs\[0\]/u);
});
