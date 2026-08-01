import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

type AdminBrowserBuilder = {
  ADMIN_BROWSER_SOURCES: readonly string[];
  buildAdminBrowser(options?: { outputPath?: string }): Promise<string>;
};

async function loadBuilder(): Promise<AdminBrowserBuilder> {
  const modulePath = path.join(
    process.cwd(),
    'scripts',
    'weixin',
    'build-admin-browser.mjs',
  );
  let loaded: AdminBrowserBuilder | null = null;
  try {
    loaded = await import(pathToFileURL(modulePath).href) as AdminBrowserBuilder;
  } catch {}
  assert.ok(loaded, 'Weixin admin browser builder should exist');
  return loaded;
}

test('Weixin admin browser build deterministically reproduces the committed asset', async () => {
  const builder = await loadBuilder();
  assert.deepEqual(builder.ADMIN_BROWSER_SOURCES, ['00_bootstrap.js']);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-admin-browser-'));
  try {
    const outputPath = path.join(tempDir, 'admin.js');
    const generated = await builder.buildAdminBrowser({ outputPath });
    const committed = fs.readFileSync(
      path.join(process.cwd(), 'assets', 'weixin-admin', 'admin.js'),
      'utf8',
    );
    assert.equal(generated, committed);
    assert.equal(fs.readFileSync(outputPath, 'utf8'), committed);
    assert.doesNotThrow(() => new Function(generated));
    assert.match(generated, /function loadProviderUsage/u);
    assert.doesNotMatch(generated, /admin-token-123|nonce-456/u);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('package exposes the Weixin admin browser build command', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.['weixin:admin:build'],
    'node scripts/weixin/build-admin-browser.mjs',
  );
});
