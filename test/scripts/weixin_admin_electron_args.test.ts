import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveElectronUserArgs } = require('../../scripts/electron/weixin-admin-args.cjs') as {
  resolveElectronUserArgs: (argv: string[], isPackaged: boolean) => string[];
};

test('packaged Electron keeps the first user argument', () => {
  assert.deepEqual(
    resolveElectronUserArgs([
      'CodexBridge Weixin Admin.exe',
      '--smoke-test',
      '--state-dir',
      'C:\\temp\\smoke',
    ], true),
    ['--smoke-test', '--state-dir', 'C:\\temp\\smoke'],
  );
});

test('development Electron skips the executable and main script', () => {
  assert.deepEqual(
    resolveElectronUserArgs([
      'electron.exe',
      'scripts/electron/weixin-admin-main.cjs',
      '--smoke-test',
    ], false),
    ['--smoke-test'],
  );
});
