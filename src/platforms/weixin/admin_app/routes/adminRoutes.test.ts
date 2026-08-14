import { describe, expect, it } from 'vitest';
import {
  ADMIN_ROUTES,
  getAdminRoute,
  parseAdminRoute,
} from './adminRoutes';

describe('adminRoutes', () => {
  it('keeps every existing hash route stable', () => {
    expect(ADMIN_ROUTES.map((route) => route.id)).toEqual([
      'overview',
      'users',
      'sessions',
      'provider',
      'settings',
      'metrics',
      'runtime',
      'diagnostics',
      'logs',
      'updates',
      'backup',
      'phone-guide',
    ]);
    expect(parseAdminRoute('#provider')).toBe('provider');
    expect(parseAdminRoute('sessions')).toBe('sessions');
  });

  it('falls back to overview for empty and unknown hashes', () => {
    expect(parseAdminRoute('')).toBe('overview');
    expect(parseAdminRoute('#unknown')).toBe('overview');
    expect(getAdminRoute('unknown')).toEqual(getAdminRoute('overview'));
  });
});
