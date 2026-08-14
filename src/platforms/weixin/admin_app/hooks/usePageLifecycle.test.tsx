import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminApi } from '../api/adminApi';
import { usePageLifecycle } from './usePageLifecycle';

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('usePageLifecycle', () => {
  it('heartbeats every five seconds and closes the desktop service once', () => {
    vi.useFakeTimers();
    const api = {
      heartbeat: vi.fn(async () => ({ ok: true })),
      closePage: vi.fn(async () => ({ ok: true })),
      shutdownService: vi.fn(async () => ({ ok: true })),
    } as unknown as AdminApi;

    renderHook(() => usePageLifecycle(api));
    expect(api.heartbeat).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5_000);
    expect(api.heartbeat).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    window.dispatchEvent(new Event('beforeunload'));
    expect(api.closePage).toHaveBeenCalledOnce();
    expect(api.shutdownService).toHaveBeenCalledOnce();
  });

  it('does not register lifecycle requests when shutdownOnClose is disabled', () => {
    window.history.replaceState(null, '', '/?shutdownOnClose=0');
    const api = {
      heartbeat: vi.fn(async () => ({ ok: true })),
      closePage: vi.fn(async () => ({ ok: true })),
      shutdownService: vi.fn(async () => ({ ok: true })),
    } as unknown as AdminApi;

    renderHook(() => usePageLifecycle(api));
    expect(api.heartbeat).not.toHaveBeenCalled();
  });
});
