export type AppListMode = 'default' | 'all' | null;

export type AppCommandDecision =
  | { kind: 'list'; mode: AppListMode; pageToken: string }
  | { kind: 'search'; searchTerm: string }
  | { kind: 'show'; token: string }
  | { kind: 'toggle'; token: string; enabled: boolean }
  | { kind: 'auth'; token: string }
  | { kind: 'help' };

export function resolveAppsCommand(args: unknown): AppCommandDecision {
  const normalizedArgs = Array.isArray(args)
    ? args.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  const subcommand = String(normalizedArgs[0] ?? '').toLowerCase();

  if (!subcommand || subcommand === 'default') {
    return { kind: 'list', mode: 'default', pageToken: '' };
  }
  if (subcommand === 'list') {
    return { kind: 'list', mode: null, pageToken: normalizedArgs[1] ?? '' };
  }
  if (isPositiveIntegerToken(subcommand)) {
    return { kind: 'list', mode: null, pageToken: subcommand };
  }
  if (subcommand === 'all') {
    return { kind: 'list', mode: 'all', pageToken: normalizedArgs[1] ?? '' };
  }
  const token = normalizedArgs.slice(1).join(' ');
  if (subcommand === 'search') {
    return { kind: 'search', searchTerm: token };
  }
  if (subcommand === 'show') {
    return { kind: 'show', token };
  }
  if (subcommand === 'on' || subcommand === 'enable') {
    return { kind: 'toggle', token, enabled: true };
  }
  if (subcommand === 'off' || subcommand === 'disable') {
    return { kind: 'toggle', token, enabled: false };
  }
  if (subcommand === 'auth') {
    return { kind: 'auth', token };
  }
  return { kind: 'help' };
}

function isPositiveIntegerToken(value: string): boolean {
  if (!/^\d+$/u.test(value)) {
    return false;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1;
}
