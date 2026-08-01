import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { renderAdminHtml } from '../../../src/platforms/weixin/admin_page.js';

const adminCssPath = path.join(process.cwd(), 'assets', 'weixin-admin', 'admin.css');

test('renderAdminHtml preserves token, CSP nonce, icons, and valid inline scripts', () => {
  const html = renderAdminHtml('admin-token-123', 'nonce-456');

  assert.match(html, /name="codexbridge-admin-token" content="admin-token-123"/u);
  assert.match(html, /<link rel="stylesheet" href="\/admin\/admin\.css\?v=\d+" \/>/u);
  assert.match(html, /<script nonce="nonce-456">/u);
  assert.match(html, /href="\/favicon\.ico\?v=\d+"/u);
  assert.match(html, /href="\/favicon\.png\?v=\d+"/u);
  assert.match(html, /id="provider-usage-profile"/u);
  assert.match(html, /id="provider-usage-refresh"/u);
  assert.match(html, /function loadProviderUsage/u);
  assert.match(html, /\/usage\/refresh/u);
  assert.match(html, /id="metric-recovery"/u);
  assert.match(html, /turnRecovery/u);
  assert.match(html, /暂不支持用量查询/u);

  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gu)]
    .map((match) => match[1] ?? '');
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script));
  }
});

test('renderAdminHtml lets the stacked mobile header scroll away from page controls', () => {
  const css = fs.readFileSync(adminCssPath, 'utf8');

  assert.match(
    css,
    /@media \(max-width: 860px\) \{[\s\S]*?header \{\s*position: static;\s*\}/u,
  );
});

test('renderAdminHtml stacks provider usage controls on narrow mobile screens', () => {
  const css = fs.readFileSync(adminCssPath, 'utf8');

  assert.match(
    css,
    /@media \(max-width: 560px\) \{[\s\S]*?\.provider-usage-toolbar \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}/u,
  );
  assert.match(
    css,
    /@media \(max-width: 560px\) \{[\s\S]*?\.provider-usage-toolbar button \{\s*width: 100%;\s*\}/u,
  );
});

test('renderAdminHtml loads the extracted admin stylesheet', () => {
  const html = renderAdminHtml('admin-token-123', 'nonce-456');

  assert.match(html, /<link rel="stylesheet" href="\/admin\/admin\.css\?v=\d+" \/>/u);
  assert.doesNotMatch(html, /<style nonce=/u);

  const css = fs.readFileSync(adminCssPath, 'utf8');
  assert.match(css, /@media \(max-width: 860px\)/u);
  assert.match(css, /\.provider-usage-toolbar/u);
});
