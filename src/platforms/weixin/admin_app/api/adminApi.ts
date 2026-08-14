import type {
  AdminLogs,
  AdminMetrics,
  AdminState,
  BasicMutationResponse,
  DiagnosticsResult,
  JsonObject,
  PairingState,
  ProviderModelCatalog,
  ProviderUsage,
  SessionHistoryResponse,
  SessionsResponse,
} from '../types/admin';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class AdminApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

export function readAdminToken(documentObject: Document = document): string {
  return documentObject.querySelector<HTMLMetaElement>('meta[name="codexbridge-admin-token"]')?.content ?? '';
}

export function sanitizeAdminError(value: unknown): string {
  return String(value || '请求失败')
    .replace(/\bBearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/\b(api[_-]?key|token|secret)(\s*[=:]\s*)\S+/giu, '$1$2[redacted]')
    .slice(0, 500);
}

function appendQuery(path: string, values: Record<string, string | number | boolean | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '') continue;
    query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `${path}?${serialized}` : path;
}

export function createAdminApi(fetchFn: FetchLike = window.fetch.bind(window), adminToken = readAdminToken()) {
  async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetchFn(path, {
      ...options,
      headers: {
        'content-type': 'application/json',
        'x-codexbridge-admin-token': adminToken,
        ...(options.headers ?? {}),
      },
    });
    let body: unknown = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (!response.ok) {
      const error = body && typeof body === 'object' && 'error' in body
        ? (body as { error?: unknown }).error
        : undefined;
      throw new AdminApiError(sanitizeAdminError(error || `HTTP ${response.status}`), response.status);
    }
    return body as T;
  }

  const mutation = (path: string, payload?: JsonObject, method = 'POST') => requestJson<BasicMutationResponse>(path, {
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  return {
    getState: (signal?: AbortSignal) => requestJson<AdminState>('/api/state', { cache: 'no-store', signal }),
    getMetrics: (signal?: AbortSignal) => requestJson<AdminMetrics>('/api/metrics', { cache: 'no-store', signal }),
    getAccounts: (signal?: AbortSignal) => requestJson<{ accounts?: AdminState['accounts'] }>('/api/accounts', { cache: 'no-store', signal }),
    getSessions: (filters: { accountId?: string; query?: string; sort?: string } = {}, signal?: AbortSignal) => requestJson<SessionsResponse>(appendQuery('/api/sessions', filters), { cache: 'no-store', signal }),
    getSessionHistory: (id: string, query = '', signal?: AbortSignal) => requestJson<SessionHistoryResponse>(appendQuery(`/api/sessions/${encodeURIComponent(id)}/history`, { q: query }), { cache: 'no-store', signal }),
    getLogs: (limit = 300, signal?: AbortSignal) => requestJson<AdminLogs>(appendQuery('/api/logs', { limit }), { cache: 'no-store', signal }),
    getPairing: (signal?: AbortSignal) => requestJson<{ pairing?: PairingState | null }>('/api/pairing/current', { cache: 'no-store', signal }),
    getProviderModels: (id: string, refresh = false, signal?: AbortSignal) => requestJson<ProviderModelCatalog>(
      `/api/provider-profiles/${encodeURIComponent(id)}/models${refresh ? '/refresh' : ''}`,
      { cache: 'no-store', method: refresh ? 'POST' : 'GET', signal },
    ),
    getProviderUsage: (id: string, refresh = false, signal?: AbortSignal) => requestJson<ProviderUsage>(
      `/api/provider-profiles/${encodeURIComponent(id)}/usage${refresh ? '/refresh' : ''}`,
      { cache: 'no-store', method: refresh ? 'POST' : 'GET', signal },
    ),
    startBridge: () => mutation('/api/bridge/start'),
    restartBridge: () => mutation('/api/bridge/restart'),
    stopBridge: () => mutation('/api/bridge/stop'),
    runDiagnostics: () => requestJson<DiagnosticsResult>('/api/diagnostics/run', { method: 'POST' }),
    resetMetrics: () => mutation('/api/metrics/reset'),
    retryDeliveryOutbox: () => mutation('/api/delivery-outbox/retry'),
    updateSettings: (payload: JsonObject) => mutation('/api/settings', payload),
    setPrimaryAccount: (accountId: string) => mutation('/api/primary', { accountId }),
    updateAccount: (accountId: string, payload: JsonObject) => mutation(`/api/accounts/${encodeURIComponent(accountId)}`, payload, 'PATCH'),
    deleteAccount: (accountId: string) => mutation(`/api/accounts/${encodeURIComponent(accountId)}`, undefined, 'DELETE'),
    updateSession: (id: string, payload: JsonObject) => mutation(`/api/sessions/${encodeURIComponent(id)}`, payload, 'PATCH'),
    deleteSession: (id: string) => mutation(`/api/sessions/${encodeURIComponent(id)}`, undefined, 'DELETE'),
    startPairing: (displayName: string) => requestJson<{ pairing?: PairingState | null }>('/api/pairing/start', { method: 'POST', body: JSON.stringify({ displayName }) }),
    cancelPairing: () => requestJson<{ pairing?: PairingState | null }>('/api/pairing/cancel', { method: 'POST' }),
    testSetup: (payload: JsonObject) => mutation('/api/setup/test', payload),
    completeSetup: (payload: JsonObject) => mutation('/api/setup/complete', payload),
    syncCcswitch: (payload: JsonObject = {}) => mutation('/api/model-provider/sync-ccswitch', payload),
    testAlert: (payload: JsonObject = {}) => mutation('/api/alert/test', payload),
    importBackup: (payload: JsonObject) => mutation('/api/import', payload),
    cleanupLogs: () => mutation('/api/logs/cleanup'),
    heartbeat: (pageId: string) => requestJson<BasicMutationResponse>('/api/page/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ pageId, shutdownOnClose: true }),
      keepalive: true,
    }),
    closePage: (pageId: string, reason: string) => requestJson<BasicMutationResponse>('/api/page/close', {
      method: 'POST',
      body: JSON.stringify({ closedAt: Date.now(), pageId, reason, shutdownOnClose: true }),
      keepalive: true,
    }),
    shutdownService: (reason: string) => requestJson<BasicMutationResponse>('/api/service/shutdown', {
      method: 'POST',
      body: JSON.stringify({ reason }),
      keepalive: true,
    }),
  } as const;
}

export type AdminApi = ReturnType<typeof createAdminApi>;
