import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { renderAdminHtml } from '../../../src/platforms/weixin/admin_page.js';

const adminCssPath = path.join(process.cwd(), 'assets', 'weixin-admin', 'admin.css');
const adminScriptPath = path.join(process.cwd(), 'assets', 'weixin-admin', 'admin.js');
const adminScript = fs.readFileSync(adminScriptPath, 'utf8');

test('renderAdminHtml preserves token, CSP nonce, icons, and a valid external script', () => {
  const html = renderAdminHtml('admin-token-123', 'nonce-456');

  assert.match(html, /name="codexbridge-admin-token" content="admin-token-123"/u);
  assert.match(html, /<link rel="stylesheet" href="\/admin\/admin\.css\?v=\d+" \/>/u);
  assert.match(html, /<script nonce="nonce-456" src="\/admin\/admin\.js\?v=\d+"><\/script>/u);
  assert.match(html, /href="\/favicon\.ico\?v=\d+"/u);
  assert.match(html, /href="\/favicon\.png\?v=\d+"/u);
  assert.match(html, /id="provider-usage-profile"/u);
  assert.match(html, /id="provider-usage-refresh"/u);
  assert.match(adminScript, /function loadProviderUsage/u);
  assert.match(adminScript, /\/usage\/refresh/u);
  assert.match(html, /id="metric-recovery"/u);
  assert.match(adminScript, /turnRecovery/u);
  assert.match(adminScript, /暂不支持用量查询/u);

  assert.doesNotThrow(() => new Function(adminScript));
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

test('renderAdminHtml loads the extracted nonce-authorized admin script', () => {
  const html = renderAdminHtml('admin-token-123', 'nonce-456');

  assert.match(
    html,
    /<script nonce="nonce-456" src="\/admin\/admin\.js\?v=\d+"><\/script>/u,
  );
  assert.doesNotMatch(html, /<script nonce="nonce-456">/u);

  assert.doesNotThrow(() => new Function(adminScript));
  assert.match(adminScript, /function loadProviderUsage/u);
  assert.match(adminScript, /function sendShutdownRequest/u);
  assert.match(adminScript, /\/api\/delivery-outbox\/retry/u);
  assert.doesNotMatch(adminScript, /admin-token-123|nonce-456/u);
});
