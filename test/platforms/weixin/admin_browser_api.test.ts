import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('Weixin admin no longer carries the legacy browser implementation', () => {
  assert.equal(
    fs.existsSync(path.join(process.cwd(), 'src', 'platforms', 'weixin', 'admin_browser')),
    false,
  );
  assert.equal(fs.existsSync(path.join(process.cwd(), 'tsconfig.admin-browser.json')), false);
});

test('Weixin admin uses the strict React TypeScript boundary', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.['weixin:admin:typecheck'],
    'tsc -p tsconfig.admin-app.json --noEmit',
  );

  const config = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'tsconfig.admin-app.json'), 'utf8'),
  ) as { compilerOptions?: { allowJs?: boolean; strict?: boolean }; include?: string[] };
  assert.equal(config.compilerOptions?.allowJs, false);
  assert.equal(config.compilerOptions?.strict, true);
  assert.ok(config.include?.includes('src/platforms/weixin/admin_app/**/*.tsx'));

  const rootConfig = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'tsconfig.json'), 'utf8'),
  ) as { exclude?: string[] };
  assert.ok(rootConfig.exclude?.includes('src/platforms/weixin/admin_app'));
});
