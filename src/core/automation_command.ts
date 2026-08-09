export type AutomationCommandDecision =
  | { kind: 'default' }
  | { kind: 'confirm' }
  | { kind: 'edit' }
  | { kind: 'cancel' }
  | { kind: 'list' }
  | { kind: 'show'; token: string }
  | { kind: 'pause'; token: string }
  | { kind: 'resume'; token: string }
  | { kind: 'delete'; token: string }
  | { kind: 'rename'; token: string }
  | { kind: 'add' }
  | { kind: 'natural' };

export function resolveAutomationCommand(args: unknown): AutomationCommandDecision {
  const normalizedArgs = Array.isArray(args)
    ? args.map((value) => String(value ?? '').trim())
    : [];
  const subcommand = String(normalizedArgs[0] ?? '').toLowerCase();
  const token = normalizedArgs[1] ?? '';

  switch (subcommand) {
    case '':
      return { kind: 'default' };
    case 'confirm':
      return { kind: 'confirm' };
    case 'edit':
      return { kind: 'edit' };
    case 'cancel':
      return { kind: 'cancel' };
    case 'list':
      return { kind: 'list' };
    case 'show':
      return { kind: 'show', token };
    case 'pause':
      return { kind: 'pause', token };
    case 'resume':
      return { kind: 'resume', token };
    case 'delete':
    case 'del':
      return { kind: 'delete', token };
    case 'rename':
      return { kind: 'rename', token };
    case 'add':
      return { kind: 'add' };
    default:
      return { kind: 'natural' };
  }
}
