import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { renderAdminHtml } from '../../../src/platforms/weixin/admin_page.js';

const adminCssPath = path.join(process.cwd(), 'assets', 'weixin-admin', 'admin.css');
const adminScriptPath = path.join(process.cwd(), 'assets', 'weixin-admin', 'admin.js');

test('renderAdminHtml returns a minimal nonce-authorized React host', () => {
  const html = renderAdminHtml('admin-token-123', 'nonce-456');

  assert.match(html, /name="codexbridge-admin-token" content="admin-token-123"/u);
  assert.match(html, /<div id="admin-root">/u);
  assert.match(html, /<link rel="stylesheet" href="\/admin\/admin\.css\?v=\d+" \/>/u);
  assert.match(html, /<script nonce="nonce-456" src="\/admin\/admin\.js\?v=\d+"><\/script>/u);
  assert.match(html, /document\.documentElement\.dataset\.theme/u);
  assert.ok(html.indexOf('dataset.theme') < html.indexOf('/admin/admin.css'));
  assert.doesNotMatch(html, /id="provider-usage-profile"|id="bridge-start"|data-page-panel/u);
});

test('renderAdminHtml escapes token and nonce attributes', () => {
  const html = renderAdminHtml('token"<&', 'nonce"<&');

  assert.match(html, /content="token&quot;&lt;&amp;"/u);
  assert.match(html, /nonce="nonce&quot;&lt;&amp;"/u);
  assert.doesNotMatch(html, /content="token"<&"/u);
});

test('committed React assets expose the shell, themes, and ready marker', () => {
  const css = fs.readFileSync(adminCssPath, 'utf8');
  const script = fs.readFileSync(adminScriptPath, 'utf8');

  assert.match(css, /\.admin-shell/u);
  assert.match(css, /\[data-theme=(?:['"])?dark(?:['"])?\]/u);
  assert.match(css, /@media\(max-width:940px\)/u);
  assert.match(script, /createRoot/u);
  assert.match(script, /adminReady/u);
  assert.doesNotThrow(() => new Function(script));
  assert.doesNotMatch(script, /admin-token-123|nonce-456/u);
});
