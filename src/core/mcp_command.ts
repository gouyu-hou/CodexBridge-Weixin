export type McpCommandDecision =
  | { kind: 'list' }
  | { kind: 'toggle'; token: string; enabled: boolean }
  | { kind: 'auth'; token: string }
  | { kind: 'reload' }
  | { kind: 'help' };

export function resolveMcpCommand(args: unknown): McpCommandDecision {
  const normalizedArgs = Array.isArray(args)
    ? args.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  const subcommand = String(normalizedArgs[0] ?? '').toLowerCase();

  if (!subcommand || subcommand === 'default' || subcommand === 'list') {
    return { kind: 'list' };
  }
  const token = normalizedArgs.slice(1).join(' ');
  if (subcommand === 'on') {
    return { kind: 'toggle', token, enabled: true };
  }
  if (subcommand === 'off') {
    return { kind: 'toggle', token, enabled: false };
  }
  if (subcommand === 'auth') {
    return { kind: 'auth', token };
  }
  if (subcommand === 'reload') {
    return { kind: 'reload' };
  }
  return { kind: 'help' };
}
