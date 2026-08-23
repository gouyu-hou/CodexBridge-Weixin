export type WeixinAdminRoute =
  | { kind: 'provider-models'; providerProfileId: string; forceRefresh: boolean }
  | { kind: 'provider-usage'; providerProfileId: string; forceRefresh: boolean }
  | { kind: 'admin-page' }
  | { kind: 'admin-css' }
  | { kind: 'admin-js' }
  | { kind: 'favicon-ico' }
  | { kind: 'favicon-png' }
  | { kind: 'donate-qr' }
  | { kind: 'state' }
  | { kind: 'metrics' }
  | { kind: 'reset-metrics' }
  | { kind: 'run-diagnostics' }
  | { kind: 'setup-test' }
  | { kind: 'alert-test' }
  | { kind: 'page-heartbeat' }
  | { kind: 'page-close' }
  | { kind: 'service-shutdown' }
  | { kind: 'accounts' }
  | { kind: 'sessions' }
  | { kind: 'session-history'; sessionId: string }
  | { kind: 'patch-session'; sessionId: string }
  | { kind: 'delete-session'; sessionId: string }
  | { kind: 'logs' }
  | { kind: 'cleanup-logs' }
  | { kind: 'update-settings' }
  | { kind: 'sync-ccswitch-provider' }
  | { kind: 'complete-setup' }
  | { kind: 'export-diagnostic' }
  | { kind: 'export' }
  | { kind: 'import' }
  | { kind: 'patch-account'; accountId: string }
  | { kind: 'delete-account'; accountId: string }
  | { kind: 'set-primary' }
  | { kind: 'retry-delivery-outbox' }
  | { kind: 'bridge-start' }
  | { kind: 'bridge-stop' }
  | { kind: 'bridge-restart' }
  | { kind: 'start-pairing' }
  | { kind: 'current-pairing' }
  | { kind: 'cancel-pairing' }
  | { kind: 'not-found' };

export function resolveWeixinAdminRoute(method: string, pathname: string): WeixinAdminRoute {
  const modelRoute = pathname.match(/^\/api\/provider-profiles\/([^/]+)\/models(\/refresh)?$/u);
  if (modelRoute && method === 'GET' && !modelRoute[2]) {
    return { kind: 'provider-models', providerProfileId: modelRoute[1] ?? '', forceRefresh: false };
  }

  const usageRoute = pathname.match(/^\/api\/provider-profiles\/([^/]+)\/usage(\/refresh)?$/u);
  if (usageRoute && method === 'GET' && !usageRoute[2]) {
    return { kind: 'provider-usage', providerProfileId: usageRoute[1] ?? '', forceRefresh: false };
  }
  if (usageRoute && method === 'POST' && usageRoute[2] === '/refresh') {
    return { kind: 'provider-usage', providerProfileId: usageRoute[1] ?? '', forceRefresh: true };
  }
  if (modelRoute && method === 'POST' && modelRoute[2] === '/refresh') {
    return { kind: 'provider-models', providerProfileId: modelRoute[1] ?? '', forceRefresh: true };
  }

  if (method === 'GET' && pathname === '/') return { kind: 'admin-page' };
  if (method === 'GET' && pathname === '/admin/admin.css') return { kind: 'admin-css' };
  if (method === 'GET' && pathname === '/admin/admin.js') return { kind: 'admin-js' };
  if (method === 'GET' && pathname === '/favicon.ico') return { kind: 'favicon-ico' };
  if (method === 'GET' && pathname === '/favicon.png') return { kind: 'favicon-png' };
  if (method === 'GET' && pathname === '/donate/wechat-reward.png') return { kind: 'donate-qr' };
  if (method === 'GET' && pathname === '/api/state') return { kind: 'state' };
  if (method === 'GET' && pathname === '/api/metrics') return { kind: 'metrics' };
  if (method === 'POST' && pathname === '/api/metrics/reset') return { kind: 'reset-metrics' };
  if (method === 'POST' && pathname === '/api/diagnostics/run') return { kind: 'run-diagnostics' };
  if (method === 'POST' && pathname === '/api/setup/test') return { kind: 'setup-test' };
  if (method === 'POST' && pathname === '/api/alert/test') return { kind: 'alert-test' };
  if (method === 'POST' && pathname === '/api/page/heartbeat') return { kind: 'page-heartbeat' };
  if ((method === 'POST' || method === 'GET') && pathname === '/api/page/close') return { kind: 'page-close' };
  if (method === 'POST' && pathname === '/api/service/shutdown') return { kind: 'service-shutdown' };
  if (method === 'GET' && pathname === '/api/accounts') return { kind: 'accounts' };
  if (method === 'GET' && pathname === '/api/sessions') return { kind: 'sessions' };
  if (method === 'GET' && pathname.startsWith('/api/sessions/') && pathname.endsWith('/history')) {
    return { kind: 'session-history', sessionId: pathname.slice('/api/sessions/'.length, -'/history'.length) };
  }
  if (method === 'PATCH' && pathname.startsWith('/api/sessions/')) {
    return { kind: 'patch-session', sessionId: pathname.slice('/api/sessions/'.length) };
  }
  if (method === 'DELETE' && pathname.startsWith('/api/sessions/')) {
    return { kind: 'delete-session', sessionId: pathname.slice('/api/sessions/'.length) };
  }
  if (method === 'GET' && pathname === '/api/logs') return { kind: 'logs' };
  if (method === 'POST' && pathname === '/api/logs/cleanup') return { kind: 'cleanup-logs' };
  if (method === 'POST' && pathname === '/api/settings') return { kind: 'update-settings' };
  if (method === 'POST' && pathname === '/api/model-provider/sync-ccswitch') return { kind: 'sync-ccswitch-provider' };
  if (method === 'POST' && pathname === '/api/setup/complete') return { kind: 'complete-setup' };
  if (method === 'GET' && pathname === '/api/export/diagnostic') return { kind: 'export-diagnostic' };
  if (method === 'GET' && pathname === '/api/export') return { kind: 'export' };
  if (method === 'POST' && pathname === '/api/import') return { kind: 'import' };
  if (method === 'PATCH' && pathname.startsWith('/api/accounts/')) {
    return { kind: 'patch-account', accountId: pathname.slice('/api/accounts/'.length) };
  }
  if (method === 'DELETE' && pathname.startsWith('/api/accounts/')) {
    return { kind: 'delete-account', accountId: pathname.slice('/api/accounts/'.length) };
  }
  if (method === 'POST' && pathname === '/api/primary') return { kind: 'set-primary' };
  if (method === 'POST' && pathname === '/api/delivery-outbox/retry') return { kind: 'retry-delivery-outbox' };
  if (method === 'POST' && pathname === '/api/bridge/start') return { kind: 'bridge-start' };
  if (method === 'POST' && pathname === '/api/bridge/stop') return { kind: 'bridge-stop' };
  if (method === 'POST' && pathname === '/api/bridge/restart') return { kind: 'bridge-restart' };
  if (method === 'POST' && pathname === '/api/pairing/start') return { kind: 'start-pairing' };
  if (method === 'GET' && pathname === '/api/pairing/current') return { kind: 'current-pairing' };
  if (method === 'POST' && pathname === '/api/pairing/cancel') return { kind: 'cancel-pairing' };
  return { kind: 'not-found' };
}
