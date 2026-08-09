import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

type AppCommandModule = typeof import('../../src/core/app_command.js');

async function loadAppCommand(): Promise<AppCommandModule | null> {
  try {
    return await import('../../src/core/app_command.js');
  } catch {
    return null;
  }
}

test('app command resolves default and state-preserving list routes', async () => {
  const module = await loadAppCommand();
  assert.ok(module, 'app_command module must exist');

  assert.deepEqual(module.resolveAppsCommand([]), { kind: 'list', mode: 'default', pageToken: '' });
  assert.deepEqual(module.resolveAppsCommand([' default ']), { kind: 'list', mode: 'default', pageToken: '' });
  assert.deepEqual(module.resolveAppsCommand(['list', ' 2 ']), { kind: 'list', mode: null, pageToken: '2' });
  assert.deepEqual(module.resolveAppsCommand(['3']), { kind: 'list', mode: null, pageToken: '3' });
  assert.deepEqual(module.resolveAppsCommand(['0']), { kind: 'help' });
});

test('app command resolves all and search views', async () => {
  const module = await loadAppCommand();
  assert.ok(module, 'app_command module must exist');

  assert.deepEqual(module.resolveAppsCommand(['ALL', ' 4 ']), { kind: 'list', mode: 'all', pageToken: '4' });
  assert.deepEqual(module.resolveAppsCommand(['search', ' google ', '', 'calendar']), {
    kind: 'search',
    searchTerm: 'google calendar',
  });
});

test('app command resolves details, toggles, and auth aliases', async () => {
  const module = await loadAppCommand();
  assert.ok(module, 'app_command module must exist');

  assert.deepEqual(module.resolveAppsCommand(['show', 'google', 'drive']), {
    kind: 'show',
    token: 'google drive',
  });
  for (const alias of ['on', 'enable']) {
    assert.deepEqual(module.resolveAppsCommand([alias, 'calendar']), {
      kind: 'toggle',
      token: 'calendar',
      enabled: true,
    });
  }
  for (const alias of ['off', 'disable']) {
    assert.deepEqual(module.resolveAppsCommand([alias, 'calendar']), {
      kind: 'toggle',
      token: 'calendar',
      enabled: false,
    });
  }
  assert.deepEqual(module.resolveAppsCommand(['auth', 'calendar']), {
    kind: 'auth',
    token: 'calendar',
  });
});

test('app command preserves existing fallback behavior for invalid input', async () => {
  const module = await loadAppCommand();
  assert.ok(module, 'app_command module must exist');

  assert.deepEqual(module.resolveAppsCommand(['unknown']), { kind: 'help' });
  assert.deepEqual(module.resolveAppsCommand('all'), { kind: 'list', mode: 'default', pageToken: '' });
});

test('BridgeCoordinator delegates app command routing to the focused module', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'core', 'bridge_coordinator.ts'),
    'utf8',
  );
  const handlerStart = source.indexOf('  async handleAppsCommand');
  const handlerEnd = source.indexOf('  async handleAppsListCommand', handlerStart);
  const handlerSource = source.slice(handlerStart, handlerEnd);

  assert.match(source, /from '\.\/app_command\.js'/u);
  assert.match(handlerSource, /resolveAppsCommand\(args\)/u);
  assert.doesNotMatch(handlerSource, /const subcommand = String\(normalizedArgs\[0\]/u);
  assert.ok(handlerSource.indexOf('resolveAppsCommand(args)') < handlerSource.indexOf('const session'));
});
