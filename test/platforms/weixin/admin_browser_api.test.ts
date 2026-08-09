import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const browserSourceDir = path.join(
  process.cwd(),
  'src',
  'platforms',
  'weixin',
  'admin_browser',
);

test('Weixin admin browser has a dedicated DOM-aware checkJs boundary', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.['weixin:admin:typecheck'],
    'tsc -p tsconfig.admin-browser.json',
  );

  const configPath = path.join(process.cwd(), 'tsconfig.admin-browser.json');
  assert.equal(fs.existsSync(configPath), true);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
    compilerOptions?: {
      checkJs?: boolean;
      lib?: string[];
      module?: string;
      noEmit?: boolean;
      types?: string[];
    };
    files?: string[];
  };
  assert.equal(config.compilerOptions?.checkJs, true);
  assert.equal(config.compilerOptions?.module, 'None');
  assert.equal(config.compilerOptions?.noEmit, true);
  assert.deepEqual(config.compilerOptions?.types, []);
  assert.ok(config.compilerOptions?.lib?.includes('DOM'));
  for (const entry of fs.readdirSync(browserSourceDir)) {
    if (!entry.endsWith('.js')) continue;
    const relativePath = `src/platforms/weixin/admin_browser/${entry}`;
    assert.ok(config.files?.includes(relativePath), relativePath);
    assert.doesNotMatch(
      fs.readFileSync(path.join(browserSourceDir, entry), 'utf8'),
      /@ts-nocheck|@ts-ignore/u,
    );
  }
});

test('Weixin admin API client and required DOM lookup expose checked contracts', () => {
  const bootstrap = fs.readFileSync(path.join(browserSourceDir, '00_bootstrap.js'), 'utf8');
  const apiClient = fs.readFileSync(path.join(browserSourceDir, '10_api_client.js'), 'utf8');

  assert.match(bootstrap, /@returns \{AdminElement\}/u);
  assert.match(bootstrap, /throw new Error\('Missing Weixin admin element: ' \+ id\)/u);
  assert.match(apiClient, /@template \{AdminJson\} T/u);
  assert.match(apiClient, /@returns \{Promise<T>\}/u);
  assert.match(apiClient, /const data = \/\*\* @type \{T & \{ error\?: string \}\} \*\//u);
});
