import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWeixinAdminRoute } from '../../../src/platforms/weixin/admin_route.js';

test('resolveWeixinAdminRoute preserves every existing admin route', () => {
  const cases = [
    ['GET', '/api/provider-profiles/profile%20one/models', { kind: 'provider-models', providerProfileId: 'profile one', forceRefresh: false }],
    ['POST', '/api/provider-profiles/profile%20one/models/refresh', { kind: 'provider-models', providerProfileId: 'profile one', forceRefresh: true }],
    ['GET', '/api/provider-profiles/profile%20one/usage', { kind: 'provider-usage', providerProfileId: 'profile one', forceRefresh: false }],
    ['POST', '/api/provider-profiles/profile%20one/usage/refresh', { kind: 'provider-usage', providerProfileId: 'profile one', forceRefresh: true }],
    ['GET', '/', { kind: 'admin-page' }],
    ['GET', '/admin/admin.css', { kind: 'admin-css' }],
    ['GET', '/admin/admin.js', { kind: 'admin-js' }],
    ['GET', '/favicon.ico', { kind: 'favicon-ico' }],
    ['GET', '/favicon.png', { kind: 'favicon-png' }],
    ['GET', '/donate/wechat-reward.png', { kind: 'donate-qr' }],
    ['GET', '/api/state', { kind: 'state' }],
    ['GET', '/api/metrics', { kind: 'metrics' }],
    ['POST', '/api/metrics/reset', { kind: 'reset-metrics' }],
    ['POST', '/api/diagnostics/run', { kind: 'run-diagnostics' }],
    ['POST', '/api/setup/test', { kind: 'setup-test' }],
    ['POST', '/api/alert/test', { kind: 'alert-test' }],
    ['POST', '/api/page/heartbeat', { kind: 'page-heartbeat' }],
    ['POST', '/api/page/close', { kind: 'page-close' }],
    ['GET', '/api/page/close', { kind: 'page-close' }],
    ['POST', '/api/service/shutdown', { kind: 'service-shutdown' }],
    ['GET', '/api/accounts', { kind: 'accounts' }],
    ['GET', '/api/sessions', { kind: 'sessions' }],
    ['GET', '/api/sessions/session%2Fone/history', { kind: 'session-history', sessionId: 'session/one' }],
    ['PATCH', '/api/sessions/session%2Fone', { kind: 'patch-session', sessionId: 'session/one' }],
    ['DELETE', '/api/sessions/session%2Fone', { kind: 'delete-session', sessionId: 'session/one' }],
    ['GET', '/api/logs', { kind: 'logs' }],
    ['POST', '/api/logs/cleanup', { kind: 'cleanup-logs' }],
    ['POST', '/api/settings', { kind: 'update-settings' }],
    ['POST', '/api/model-provider/sync-ccswitch', { kind: 'sync-ccswitch-provider' }],
    ['POST', '/api/setup/complete', { kind: 'complete-setup' }],
    ['GET', '/api/export/diagnostic', { kind: 'export-diagnostic' }],
    ['GET', '/api/export', { kind: 'export' }],
    ['POST', '/api/import', { kind: 'import' }],
    ['PATCH', '/api/accounts/account%2Fone', { kind: 'patch-account', accountId: 'account/one' }],
    ['DELETE', '/api/accounts/account%2Fone', { kind: 'delete-account', accountId: 'account/one' }],
    ['POST', '/api/primary', { kind: 'set-primary' }],
    ['POST', '/api/delivery-outbox/retry', { kind: 'retry-delivery-outbox' }],
    ['POST', '/api/bridge/start', { kind: 'bridge-start' }],
    ['POST', '/api/bridge/stop', { kind: 'bridge-stop' }],
    ['POST', '/api/bridge/restart', { kind: 'bridge-restart' }],
    ['POST', '/api/pairing/start', { kind: 'start-pairing' }],
    ['GET', '/api/pairing/current', { kind: 'current-pairing' }],
    ['POST', '/api/pairing/cancel', { kind: 'cancel-pairing' }],
  ] as const;

  for (const [method, encodedPathname, expected] of cases) {
    assert.deepEqual(
      resolveWeixinAdminRoute(method, decodeURIComponent(encodedPathname)),
      expected,
      `${method} ${encodedPathname}`,
    );
  }
});

test('resolveWeixinAdminRoute preserves prefix precedence and not-found responses', () => {
  const cases = [
    ['GET', '/api/sessions/session/history', { kind: 'session-history', sessionId: 'session' }],
    ['PATCH', '/api/sessions/session/history', { kind: 'patch-session', sessionId: 'session/history' }],
    ['GET', '/api/export/diagnostic', { kind: 'export-diagnostic' }],
    ['GET', '/api/unknown', { kind: 'not-found' }],
    ['GET', '/api/provider-profiles/profile/models/refresh', { kind: 'not-found' }],
    ['PUT', '/api/state', { kind: 'not-found' }],
  ] as const;

  for (const [method, pathname, expected] of cases) {
    assert.deepEqual(resolveWeixinAdminRoute(method, pathname), expected, `${method} ${pathname}`);
  }
});
