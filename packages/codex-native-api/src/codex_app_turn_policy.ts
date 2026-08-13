import {
  truncateDebugText,
  type ApprovedExecution,
} from './codex_app_protocol.js';

export function computeTerminalSettleMs(timeoutMs: unknown): number {
  const numericTimeout = Number(timeoutMs || 0);
  if (!Number.isFinite(numericTimeout) || numericTimeout <= 0) {
    return 60_000;
  }
  return Math.min(60_000, Math.max(10_000, Math.floor(numericTimeout / 2)));
}

export function computeApprovedExecutionIdleLimitMs(timeoutMs: unknown): number {
  const numericTimeout = Number(timeoutMs || 0);
  if (!Number.isFinite(numericTimeout) || numericTimeout <= 0) {
    return 300_000;
  }
  return Math.min(Math.max(180_000, Math.floor(numericTimeout / 3)), 300_000);
}

export function buildApprovedExecutionStallError({
  entry,
  idleMs,
}: {
  entry: ApprovedExecution;
  idleMs: number;
}): string {
  const idleSeconds = Math.max(1, Math.round(idleMs / 1000));
  const kindLabel = entry.kind === 'command'
    ? 'command'
    : entry.kind === 'file_change'
      ? 'file change'
      : 'permission grant';
  const commandSuffix = entry.command
    ? ` (${truncateDebugText(entry.command, 120)})`
    : '';
  if (entry.signalCount === 0) {
    return `Approval was accepted, but the approved ${kindLabel}${commandSuffix} produced no follow-up signal for ${idleSeconds} seconds. The provider may be stuck; use /retry to try again.`;
  }
  return `Approval was accepted, but the approved ${kindLabel}${commandSuffix} stopped making progress after ${entry.lastSignalKind} and stayed idle for ${idleSeconds} seconds. The provider may be stuck; use /retry to try again.`;
}
