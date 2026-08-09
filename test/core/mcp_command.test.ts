import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

type McpCommandModule = typeof import('../../src/core/mcp_command.js');

async function loadMcpCommand(): Promise<McpCommandModule | null> {
  try {
    return await import('../../src/core/mcp_command.js');
  } catch {
    return null;
  }
}

test('MCP command resolves every list alias', async () => {
  const module = await loadMcpCommand();
  assert.ok(module, 'mcp_command module must exist');

  assert.deepEqual(module.resolveMcpCommand([]), { kind: 'list' });
  assert.deepEqual(module.resolveMcpCommand([' default ']), { kind: 'list' });
  assert.deepEqual(module.resolveMcpCommand(['LIST']), { kind: 'list' });
});

test('MCP command resolves enablement and joins server names', async () => {
  const module = await loadMcpCommand();
  assert.ok(module, 'mcp_command module must exist');

  assert.deepEqual(module.resolveMcpCommand(['on', 'google', '', 'workspace']), {
    kind: 'toggle',
    token: 'google workspace',
    enabled: true,
  });
  assert.deepEqual(module.resolveMcpCommand(['off', 'browsermcp']), {
    kind: 'toggle',
    token: 'browsermcp',
    enabled: false,
  });
});

test('MCP command resolves auth, reload, and fallback routes', async () => {
  const module = await loadMcpCommand();
  assert.ok(module, 'mcp_command module must exist');

  assert.deepEqual(module.resolveMcpCommand(['auth', 'google_workspace']), {
    kind: 'auth',
    token: 'google_workspace',
  });
  assert.deepEqual(module.resolveMcpCommand(['reload']), { kind: 'reload' });
  assert.deepEqual(module.resolveMcpCommand(['unknown']), { kind: 'help' });
  assert.deepEqual(module.resolveMcpCommand('reload'), { kind: 'list' });
});

test('BridgeCoordinator delegates MCP command routing to the focused module', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'core', 'bridge_coordinator.ts'),
    'utf8',
  );
  const handlerStart = source.indexOf('  async handleMcpCommand');
  const handlerEnd = source.indexOf('  async handleMcpListCommand', handlerStart);
  const handlerSource = source.slice(handlerStart, handlerEnd);

  assert.match(source, /from '\.\/mcp_command\.js'/u);
  assert.match(handlerSource, /resolveMcpCommand\(args\)/u);
  assert.doesNotMatch(handlerSource, /const subcommand = String\(normalizedArgs\[0\]/u);
});
