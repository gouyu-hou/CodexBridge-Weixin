import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  getInitialTheme,
  useTheme,
} from './useTheme';

afterEach(() => {
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe('getInitialTheme', () => {
  it('uses a valid explicit preference before the system preference', () => {
    const storage = { getItem: () => 'light' } as Pick<Storage, 'getItem'>;
    expect(getInitialTheme(storage, () => true)).toBe('light');
  });

  it('falls back to the system preference for invalid stored values', () => {
    const storage = { getItem: () => 'sepia' } as Pick<Storage, 'getItem'>;
    expect(getInitialTheme(storage, () => true)).toBe('dark');
    expect(getInitialTheme(storage, () => false)).toBe('light');
  });
});

describe('useTheme', () => {
  it('applies and persists an explicit toggle', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
});
