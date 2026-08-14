import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAsyncResource } from './useAsyncResource';

describe('useAsyncResource', () => {
  it('loads initially and retains existing data during local refresh', async () => {
    let resolveRefresh: ((value: string) => void) | undefined;
    const loader = vi.fn()
      .mockResolvedValueOnce('first')
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveRefresh = resolve;
      }));
    const { result } = renderHook(() => useAsyncResource(loader));

    await waitFor(() => expect(result.current.data).toBe('first'));
    act(() => { void result.current.refresh(); });

    expect(result.current.data).toBe('first');
    expect(result.current.refreshing).toBe(true);

    act(() => resolveRefresh?.('second'));
    await waitFor(() => expect(result.current.data).toBe('second'));
    expect(result.current.refreshing).toBe(false);
  });

  it('surfaces a recoverable error without discarding previous data', async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useAsyncResource(loader));

    await waitFor(() => expect(result.current.data).toEqual({ count: 1 }));
    await act(async () => { await result.current.refresh(); });

    expect(result.current.data).toEqual({ count: 1 });
    expect(result.current.error?.message).toBe('offline');
  });
});
