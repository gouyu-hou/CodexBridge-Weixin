import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('release verification covers the root project and every packaged workspace', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  const command = packageJson.scripts?.['verify:release'] ?? '';
  const requiredScripts = [
    'typecheck',
    'typecheck:js',
    'test',
    'build',
    'codex-gateway:check-boundary',
    'codex-gateway:typecheck',
    'codex-gateway:test',
    'codex-gateway:build',
    'codex-provider-relay:check-boundary',
    'codex-provider-relay:typecheck',
    'codex-provider-relay:test',
    'codex-provider-relay:build',
    'codex-native-api:check-boundary',
    'codex-native-api:typecheck',
    'codex-native-api:test',
    'codex-native-api:build',
    'mission-control:check-boundary',
    'mission-control:typecheck',
    'mission-control:test',
    'mission-control:build',
  ];

  assert.ok(command, 'verify:release script must exist');
  for (const script of requiredScripts) {
    assert.match(command, new RegExp(`npm run ${escapeRegExp(script)}(?:\\s|$)`, 'u'));
  }
  assert.match(command, /git diff --check/u);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
