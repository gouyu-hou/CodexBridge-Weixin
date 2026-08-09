export type PluginCommandDecision =
  | { kind: 'featured' }
  | { kind: 'reload' }
  | { kind: 'alias'; args: string[] }
  | { kind: 'category_summary' }
  | { kind: 'category_items'; categoryToken: string; pageToken: string }
  | { kind: 'search'; args: string[] }
  | { kind: 'show'; token: string }
  | { kind: 'install'; token: string }
  | { kind: 'uninstall'; token: string }
  | { kind: 'help' };

export function resolvePluginsCommand(args: unknown): PluginCommandDecision {
  const normalizedArgs = Array.isArray(args)
    ? args.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  const subcommand = String(normalizedArgs[0] ?? '').toLowerCase();

  if (!subcommand || subcommand === 'default' || subcommand === 'featured') {
    return { kind: 'featured' };
  }
  if (subcommand === 'reload') {
    return { kind: 'reload' };
  }
  if (subcommand === 'alias' || subcommand === 'aliases') {
    return { kind: 'alias', args: normalizedArgs.slice(1) };
  }
  if (subcommand === 'list') {
    const categoryToken = normalizedArgs[1] ?? '';
    return categoryToken
      ? { kind: 'category_items', categoryToken, pageToken: normalizedArgs[2] ?? '' }
      : { kind: 'category_summary' };
  }
  if (subcommand === 'search' || subcommand === 'find') {
    return { kind: 'search', args: normalizedArgs.slice(1) };
  }
  if (subcommand === 'show') {
    return { kind: 'show', token: normalizedArgs.slice(1).join(' ') };
  }
  if (subcommand === 'add' || subcommand === 'install') {
    return { kind: 'install', token: normalizedArgs.slice(1).join(' ') };
  }
  if (subcommand === 'del' || subcommand === 'uninstall' || subcommand === 'remove' || subcommand === 'rm') {
    return { kind: 'uninstall', token: normalizedArgs.slice(1).join(' ') };
  }
  return { kind: 'help' };
}
