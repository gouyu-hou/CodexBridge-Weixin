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

test('automation command parses explicit interval, daily, and cron schedules', async () => {
  const module = await loadAutomationCommand();
  assert.ok(module, 'automation_command module must exist');

  assert.deepEqual(module.parseAutomationAddSpec('/auto add every 15m | send report'), {
    mode: 'standalone',
    prompt: 'send report',
    title: 'send report',
    schedule: {
      kind: 'interval',
      everySeconds: 900,
      label: 'every 15m',
    },
  });
  assert.deepEqual(module.parseAutomationAddSpec('/automation add thread daily 08:05 | check inbox'), {
    mode: 'thread',
    prompt: 'check inbox',
    title: 'check inbox',
    schedule: {
      kind: 'daily',
      hour: 8,
      minute: 5,
      timeZone: 'UTC',
      label: 'daily 08:05 UTC',
    },
  });
  assert.deepEqual(module.parseAutomationAddSpec('/auto add cron 0 9 * * 1 | weekly review'), {
    mode: 'standalone',
    prompt: 'weekly review',
    title: 'weekly review',
    schedule: {
      kind: 'cron',
      expression: '0 9 * * 1',
      timeZone: 'UTC',
      label: 'cron 0 9 * * 1 UTC',
    },
  });
});

test('automation command rejects malformed explicit schedules', async () => {
  const module = await loadAutomationCommand();
  assert.ok(module, 'automation_command module must exist');

  assert.equal(module.parseAutomationAddSpec('/auto add every 5 | task'), null);
  assert.equal(module.parseAutomationAddSpec('/auto add daily 24:00 | task'), null);
  assert.equal(module.parseAutomationAddSpec('/auto add cron * * * | task'), null);
  assert.equal(module.parseAutomationAddSpec('/auto add every 5m task'), null);
  assert.equal(module.parseAutomationAddSpec('/auto list'), null);
});

test('automation command extracts normalized command bodies and titles', async () => {
  const module = await loadAutomationCommand();
  assert.ok(module, 'automation_command module must exist');

  assert.equal(module.extractAutomationAddBody('/auto add   every 5m |  send   report '), 'every 5m | send report');
  assert.equal(module.extractAutomationNaturalBody('/auto   明天   提醒我'), '明天 提醒我');
  assert.equal(module.extractAutomationRenameTitle('/auto rename 2  Morning   report '), 'Morning report');
  assert.equal(module.extractAutomationEditBody('/auto edit  改成   每周一'), '改成 每周一');
  assert.equal(module.deriveAutomationTitle(''), 'Automation');
  assert.equal(module.deriveAutomationTitle('a'.repeat(29)), `${'a'.repeat(28)}...`);
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
  assert.doesNotMatch(source, /^function parseAutomationAddSpec\(/mu);
  assert.doesNotMatch(source, /^function extractAutomationAddBody\(/mu);
  assert.doesNotMatch(source, /^function extractAutomationRenameTitle\(/mu);
});
