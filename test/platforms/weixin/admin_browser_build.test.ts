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

const expectedSources = [
  '00_bootstrap.js',
  '10_api_client.js',
  '20_updates.js',
  '30_runtime_metrics.js',
  '40_sessions.js',
  '50_setup_runtime.js',
  '60_accounts.js',
  '70_provider.js',
  '80_logs_backup.js',
  '90_pairing_setup.js',
  '99_events.js',
] as const;

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
  assert.deepEqual(builder.ADMIN_BROWSER_SOURCES, expectedSources);

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

test('Weixin admin browser source modules own stable page responsibilities', async () => {
  const builder = await loadBuilder();
  assert.deepEqual(builder.ADMIN_BROWSER_SOURCES, expectedSources);
  const sourceDir = path.join(
    process.cwd(),
    'src',
    'platforms',
    'weixin',
    'admin_browser',
  );
  const anchors: Record<(typeof expectedSources)[number], RegExp> = {
    '00_bootstrap.js': /function initThemeMode/u,
    '10_api_client.js': /async function requestJson/u,
    '20_updates.js': /async function checkForUpdate/u,
    '30_runtime_metrics.js': /async function loadMetrics/u,
    '40_sessions.js': /async function loadSessions/u,
    '50_setup_runtime.js': /function renderSetup/u,
    '60_accounts.js': /function renderAccounts/u,
    '70_provider.js': /async function saveProviderSettings/u,
    '80_logs_backup.js': /async function importBackup/u,
    '90_pairing_setup.js': /async function startPairing/u,
    '99_events.js': /initThemeMode\(\);[\s\S]*loadState\(\)/u,
  };
  for (const filename of expectedSources) {
    const source = fs.readFileSync(path.join(sourceDir, filename), 'utf8');
    assert.match(source, anchors[filename], filename);
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
