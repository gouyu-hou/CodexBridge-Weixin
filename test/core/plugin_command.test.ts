import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

type PluginCommandModule = typeof import('../../src/core/plugin_command.js');

async function loadPluginCommand(): Promise<PluginCommandModule | null> {
  try {
    return await import('../../src/core/plugin_command.js');
  } catch {
    return null;
  }
}

test('plugin command resolves featured and reload routes', async () => {
  const module = await loadPluginCommand();
  assert.ok(module, 'plugin_command module must exist');

  assert.deepEqual(module.resolvePluginsCommand([]), { kind: 'featured' });
  assert.deepEqual(module.resolvePluginsCommand([' default ']), { kind: 'featured' });
  assert.deepEqual(module.resolvePluginsCommand(['FEATURED']), { kind: 'featured' });
  assert.deepEqual(module.resolvePluginsCommand(['reload']), { kind: 'reload' });
});

test('plugin command preserves normalized arguments for alias and search routes', async () => {
  const module = await loadPluginCommand();
  assert.ok(module, 'plugin_command module must exist');

  assert.deepEqual(module.resolvePluginsCommand(['aliases', ' clear ', '', 'calendar']), {
    kind: 'alias',
    args: ['clear', 'calendar'],
  });
  assert.deepEqual(module.resolvePluginsCommand(['find', ' google ', null, 'drive']), {
    kind: 'search',
    args: ['google', 'drive'],
  });
});

test('plugin command distinguishes category summary and item routes', async () => {
  const module = await loadPluginCommand();
  assert.ok(module, 'plugin_command module must exist');

  assert.deepEqual(module.resolvePluginsCommand(['list']), { kind: 'category_summary' });
  assert.deepEqual(module.resolvePluginsCommand(['list', ' productivity ', ' 2 ']), {
    kind: 'category_items',
    categoryToken: 'productivity',
    pageToken: '2',
  });
});

test('plugin command canonicalizes item action aliases and joins their target', async () => {
  const module = await loadPluginCommand();
  assert.ok(module, 'plugin_command module must exist');

  assert.deepEqual(module.resolvePluginsCommand(['show', 'google', 'drive']), {
    kind: 'show',
    token: 'google drive',
  });
  for (const alias of ['add', 'install']) {
    assert.deepEqual(module.resolvePluginsCommand([alias, 'calendar']), {
      kind: 'install',
      token: 'calendar',
    });
  }
  for (const alias of ['del', 'uninstall', 'remove', 'rm']) {
    assert.deepEqual(module.resolvePluginsCommand([alias, 'calendar']), {
      kind: 'uninstall',
      token: 'calendar',
    });
  }
});

test('plugin command sends unknown and non-array input to existing fallback routes', async () => {
  const module = await loadPluginCommand();
  assert.ok(module, 'plugin_command module must exist');

  assert.deepEqual(module.resolvePluginsCommand(['unknown']), { kind: 'help' });
  assert.deepEqual(module.resolvePluginsCommand('reload'), { kind: 'featured' });
});

test('BridgeCoordinator delegates plugin command routing to the focused module', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'core', 'bridge_coordinator.ts'),
    'utf8',
  );
  const handlerStart = source.indexOf('  async handlePluginsCommand');
  const handlerEnd = source.indexOf('  async handlePluginsAliasCommand', handlerStart);
  const handlerSource = source.slice(handlerStart, handlerEnd);

  assert.match(source, /from '\.\/plugin_command\.js'/u);
  assert.match(handlerSource, /resolvePluginsCommand\(args\)/u);
  assert.doesNotMatch(handlerSource, /const subcommand = String\(normalizedArgs\[0\]/u);
  assert.ok(handlerSource.indexOf('resolvePluginsCommand(args)') < handlerSource.indexOf('const session'));
});
