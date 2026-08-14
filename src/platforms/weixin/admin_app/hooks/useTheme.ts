import { useCallback, useEffect, useState } from 'react';

export type AdminTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'codexbridge-admin-theme';

function isTheme(value: string | null): value is AdminTheme {
  return value === 'light' || value === 'dark';
}

export function getInitialTheme(
  storage: Pick<Storage, 'getItem'>,
  prefersDark: () => boolean,
): AdminTheme {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
  return prefersDark() ? 'dark' : 'light';
}

function resolveBrowserTheme(): AdminTheme {
  const existing = document.documentElement.dataset.theme ?? null;
  if (isTheme(existing)) return existing;
  return getInitialTheme(
    window.localStorage,
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );
}

export function useTheme() {
  const [theme, setTheme] = useState<AdminTheme>(resolveBrowserTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setExplicitTheme = useCallback((nextTheme: AdminTheme) => {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Keep the active in-memory theme when persistence is unavailable.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => {
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = nextTheme;
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      } catch {
        // Keep the active in-memory theme when persistence is unavailable.
      }
      return nextTheme;
    });
  }, []);

  return { setTheme: setExplicitTheme, theme, toggleTheme };
}
