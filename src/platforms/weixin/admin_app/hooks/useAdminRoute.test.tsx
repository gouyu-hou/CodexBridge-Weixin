import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAdminRoute } from './useAdminRoute';

afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition');
});

describe('useAdminRoute', () => {
  it('reads and follows existing hash navigation', () => {
    window.location.hash = '#logs';
    const { result } = renderHook(() => useAdminRoute());
    expect(result.current.route).toBe('logs');

    act(() => {
      window.location.hash = '#sessions';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current.route).toBe('sessions');
  });

  it('uses the View Transitions API and commits only the latest rapid navigation', () => {
    const callbacks: Array<() => void> = [];
    const startViewTransition = vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
        skipTransition: vi.fn(),
        updateCallbackDone: Promise.resolve(),
      };
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    });
    const { result } = renderHook(() => useAdminRoute());

    act(() => {
      result.current.navigate('logs');
      result.current.navigate('provider');
    });
    expect(result.current.route).toBe('provider');
    expect(startViewTransition).toHaveBeenCalledTimes(2);

    act(() => callbacks[0]?.());
    expect(window.location.hash).not.toBe('#logs');

    act(() => callbacks[1]?.());
    expect(window.location.hash).toBe('#provider');
  });
});
