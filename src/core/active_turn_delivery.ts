import { createHash } from 'node:crypto';

const MAX_ACTIVE_TURN_DELIVERY_KEY_LENGTH = 160;

export function normalizeActiveTurnDeliveryKey(value: unknown): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= MAX_ACTIVE_TURN_DELIVERY_KEY_LENGTH) {
    return normalized;
  }
  return `active-turn:${createHash('sha256').update(normalized, 'utf8').digest('hex')}`;
}

export function buildActiveTurnDeliveryKey(
  providerProfileId: string | null | undefined,
  threadId: string | null | undefined,
  turnId: string,
): string {
  return normalizeActiveTurnDeliveryKey(
    `${String(providerProfileId ?? '').trim() || 'provider'}:${String(threadId ?? '').trim() || 'thread'}:${turnId}:final`,
  );
}
