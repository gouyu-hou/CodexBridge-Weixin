import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

type AdminBrowserBuildResult = {
  css: string;
  js: string;
};

type AdminBrowserBuilder = {
  ADMIN_BROWSER_ENTRY: string;
  buildAdminBrowser(options?: { outputDir?: string }): Promise<AdminBrowserBuildResult>;
};

async function loadBuilder(): Promise<AdminBrowserBuilder> {
  const modulePath = path.join(
    process.cwd(),
    'scripts',
    'weixin',
    'build-admin-browser.mjs',
  );
  const loaded = await import(pathToFileURL(modulePath).href) as AdminBrowserBuilder;
  return loaded;
}

test('Weixin admin React build deterministically reproduces both committed assets', async () => {
  const builder = await loadBuilder();
  assert.equal(
    builder.ADMIN_BROWSER_ENTRY,
    'src/platforms/weixin/admin_app/main.tsx',
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-admin-react-'));
  try {
    const generated = await builder.buildAdminBrowser({ outputDir: tempDir });
    const committedJs = fs.readFileSync(
      path.join(process.cwd(), 'assets', 'weixin-admin', 'admin.js'),
      'utf8',
    );
    const committedCss = fs.readFileSync(
      path.join(process.cwd(), 'assets', 'weixin-admin', 'admin.css'),
      'utf8',
    );

    assert.equal(generated.js, committedJs);
    assert.equal(generated.css, committedCss);
    assert.equal(fs.readFileSync(path.join(tempDir, 'admin.js'), 'utf8'), committedJs);
    assert.equal(fs.readFileSync(path.join(tempDir, 'admin.css'), 'utf8'), committedCss);
    assert.match(generated.js, /createRoot/u);
    assert.ok(
      Buffer.byteLength(generated.js, 'utf8') < 500 * 1024,
      'admin.js should stay below 500 KiB for fast Electron startup',
    );
    assert.doesNotMatch(generated.js, /admin-token-123|nonce-456/u);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('package exposes strict React admin build, test, and typecheck commands', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };

  assert.equal(
    packageJson.scripts?.['weixin:admin:build'],
    'node scripts/weixin/build-admin-browser.mjs',
  );
  assert.equal(
    packageJson.scripts?.['weixin:admin:test'],
    'vitest run --config vitest.admin.config.ts',
  );
  assert.equal(
    packageJson.scripts?.['weixin:admin:typecheck'],
    'tsc -p tsconfig.admin-app.json --noEmit',
  );
});
