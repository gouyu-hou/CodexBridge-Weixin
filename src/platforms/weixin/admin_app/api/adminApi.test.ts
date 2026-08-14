import { describe, expect, it, vi } from 'vitest';
import { AdminApiError, createAdminApi } from './adminApi';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
    ...init,
  });
}

describe('createAdminApi', () => {
  it('injects the admin token and preserves GET state semantics', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ bridge: { running: true } }));
    const api = createAdminApi(fetchFn, 'admin-token');

    await api.getState();

    expect(fetchFn).toHaveBeenCalledWith('/api/state', expect.objectContaining({
      cache: 'no-store',
      headers: expect.objectContaining({
        'content-type': 'application/json',
        'x-codexbridge-admin-token': 'admin-token',
      }),
    }));
  });

  it('maps bridge and account mutations without changing payload fields', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true }));
    const api = createAdminApi(fetchFn, 'token');

    await api.restartBridge();
    await api.updateAccount('wx/id', { allowChat: true, providerProfileId: 'openai' });

    expect(fetchFn).toHaveBeenNthCalledWith(1, '/api/bridge/restart', expect.objectContaining({ method: 'POST' }));
    expect(fetchFn).toHaveBeenNthCalledWith(2, '/api/accounts/wx%2Fid', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ allowChat: true, providerProfileId: 'openai' }),
    }));
  });

  it('uses the existing provider model refresh route and method', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ models: [] }));
    const api = createAdminApi(fetchFn, 'token');

    await api.getProviderModels('custom/profile', true);

    expect(fetchFn).toHaveBeenCalledWith(
      '/api/provider-profiles/custom%2Fprofile/models/refresh',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws a bounded error and redacts credential-like values', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(
      { error: 'Bearer secret-token api_key=also-secret failed' },
      { status: 500 },
    ));
    const api = createAdminApi(fetchFn, 'token');

    await expect(api.getState()).rejects.toMatchObject({
      message: 'Bearer [redacted] api_key=[redacted] failed',
      status: 500,
    });
  });

  it('turns non-JSON failures into a stable HTTP error', async () => {
    const fetchFn = vi.fn(async () => new Response('proxy failure', { status: 502 }));
    const api = createAdminApi(fetchFn, 'token');

    await expect(api.getMetrics()).rejects.toThrow('HTTP 502');
  });
});
