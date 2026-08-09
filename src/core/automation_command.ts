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

export type ParsedAutomationAddSpec = {
  mode: AutomationMode;
  prompt: string;
  title: string;
  schedule: AutomationSchedule;
};

export function parseAutomationAddSpec(text: string): ParsedAutomationAddSpec | null {
  const input = String(text ?? '').trim();
  const match = input.match(/^\/\S+\s+add\s+(.+)$/iu);
  if (!match) {
    return null;
  }
  const rawBody = String(match[1] ?? '').trim();
  const separatorIndex = rawBody.indexOf('|');
  if (separatorIndex < 0) {
    return null;
  }
  const left = rawBody.slice(0, separatorIndex).trim();
  const prompt = rawBody.slice(separatorIndex + 1).trim();
  if (!left || !prompt) {
    return null;
  }

  let mode: AutomationMode = 'standalone';
  let scheduleSpec = left;
  const modeMatch = left.match(/^(standalone|thread)\b\s*(.*)$/iu);
  if (modeMatch) {
    mode = modeMatch[1].toLowerCase() === 'thread' ? 'thread' : 'standalone';
    scheduleSpec = String(modeMatch[2] ?? '').trim();
  }
  if (!scheduleSpec) {
    return null;
  }

  const intervalMatch = scheduleSpec.match(/^every\s+(.+)$/iu);
  if (intervalMatch) {
    const everySeconds = parseAutomationIntervalSeconds(intervalMatch[1]);
    if (!everySeconds) {
      return null;
    }
    return {
      mode,
      prompt,
      title: deriveAutomationTitle(prompt),
      schedule: {
        kind: 'interval',
        everySeconds,
        label: `every ${formatAutomationIntervalLabel(everySeconds)}`,
      },
    };
  }

  const dailyMatch = scheduleSpec.match(/^daily\s+(\d{1,2}):(\d{2})$/iu);
  if (dailyMatch) {
    const hour = Number(dailyMatch[1]);
    const minute = Number(dailyMatch[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }
    return {
      mode,
      prompt,
      title: deriveAutomationTitle(prompt),
      schedule: {
        kind: 'daily',
        hour,
        minute,
        timeZone: 'UTC',
        label: `daily ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} UTC`,
      },
    };
  }

  const cronMatch = scheduleSpec.match(/^cron\s+(.+)$/iu);
  if (cronMatch) {
    const expression = String(cronMatch[1] ?? '').trim();
    if (expression.split(/\s+/u).length !== 5) {
      return null;
    }
    return {
      mode,
      prompt,
      title: deriveAutomationTitle(prompt),
      schedule: {
        kind: 'cron',
        expression,
        timeZone: 'UTC',
        label: `cron ${expression} UTC`,
      },
    };
  }

  return null;
}

export function extractAutomationAddBody(text: string): string {
  const normalized = String(text ?? '').trim();
  const match = normalized.match(/^\/\S+\s+add\s+([\s\S]+)$/iu);
  return compactWhitespace(match?.[1] ?? '');
}

export function extractAutomationNaturalBody(text: string): string {
  const normalized = String(text ?? '').trim();
  return compactWhitespace(normalized.replace(/^\/\S+\s*/u, ''));
}

export function extractAutomationRenameTitle(text: string): string {
  const normalized = String(text ?? '').trim();
  const match = normalized.match(/^\/\S+\s+rename\s+\S+\s+([\s\S]+)$/iu);
  return compactWhitespace(match?.[1] ?? '');
}

export function extractAutomationEditBody(text: string): string {
  const normalized = String(text ?? '').trim();
  const match = normalized.match(/^\/\S+\s+edit\s+([\s\S]+)$/iu);
  return compactWhitespace(match?.[1] ?? '');
}

export function parseAutomationIntervalSeconds(value: string): number | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/u);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }
  const unit = match[2];
  if (['s', 'sec', 'secs', 'second', 'seconds'].includes(unit)) {
    return amount;
  }
  if (['m', 'min', 'mins', 'minute', 'minutes'].includes(unit)) {
    return amount * 60;
  }
  if (['h', 'hr', 'hrs', 'hour', 'hours'].includes(unit)) {
    return amount * 3_600;
  }
  return amount * 86_400;
}

export function formatAutomationIntervalLabel(seconds: number): string {
  const normalized = Math.max(60, Math.floor(Number(seconds ?? 0)));
  if (normalized % 86_400 === 0) {
    return `${normalized / 86_400}d`;
  }
  if (normalized % 3_600 === 0) {
    return `${normalized / 3_600}h`;
  }
  if (normalized % 60 === 0) {
    return `${normalized / 60}m`;
  }
  return `${normalized}s`;
}

export function deriveAutomationTitle(prompt: string): string {
  const normalized = compactWhitespace(prompt);
  if (!normalized) {
    return 'Automation';
  }
  return normalized.length <= 28 ? normalized : `${normalized.slice(0, 28)}...`;
}

function compactWhitespace(value: unknown): string {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}
import type { AutomationMode, AutomationSchedule } from '../types/core.js';
