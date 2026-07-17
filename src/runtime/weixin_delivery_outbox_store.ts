import path from 'node:path';
import { JsonFileStore } from '../store/file_json/json_file_store.js';

export interface WeixinPendingTextDelivery {
  id: string;
  externalScopeId: string;
  content: string;
  source: string;
  createdAt: number;
  nextAttemptAt: number;
  attemptCount: number;
  lastError: string;
  lastErrorCode: number | null;
}

export interface WeixinDeliveryOutboxData {
  version: 1;
  entries: WeixinPendingTextDelivery[];
}

const MAX_ENTRIES = 50;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_ID_LENGTH = 160;
const MAX_SCOPE_ID_LENGTH = 200;
const MAX_SOURCE_LENGTH = 80;
const MAX_CONTENT_BYTES = 32 * 1024;
const MAX_ERROR_LENGTH = 500;

/** Persists undelivered WeChat text continuations under the local state directory. */
export class WeixinDeliveryOutboxStore {
  constructor(stateDir: string) {
    this.store = new JsonFileStore<WeixinDeliveryOutboxData>(
      path.join(stateDir, 'weixin', 'delivery-outbox.json'),
      { version: 1, entries: [] },
    );
  }

  private readonly store: JsonFileStore<WeixinDeliveryOutboxData>;

  read(): WeixinPendingTextDelivery[] {
    return normalizeEntries(this.store.read()?.entries, Date.now());
  }

  write(entries: WeixinPendingTextDelivery[]): void {
    this.store.write({
      version: 1,
      entries: normalizeEntries(entries, Date.now()),
    });
  }
}

function normalizeEntries(value: unknown, now: number): WeixinPendingTextDelivery[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const deduplicated: Array<{ entry: WeixinPendingTextDelivery; order: number }> = [];
  for (const [order, candidate] of value.entries()) {
    const entry = normalizeEntry(candidate, now);
    if (!entry) {
      continue;
    }
    const duplicateIndex = deduplicated.findIndex(({ entry: current }) => (
      current.id === entry.id
      || (
        current.externalScopeId === entry.externalScopeId
        && current.content === entry.content
        && current.source === entry.source
      )
    ));
    if (duplicateIndex >= 0) {
      deduplicated.splice(duplicateIndex, 1);
    }
    deduplicated.push({ entry, order });
  }

  if (deduplicated.length <= MAX_ENTRIES) {
    return deduplicated
      .sort((left, right) => left.order - right.order)
      .map(({ entry }) => ({ ...entry }));
  }

  const retainedOrders = new Set(
    [...deduplicated]
      .sort((left, right) => (
        right.entry.createdAt - left.entry.createdAt
        || right.order - left.order
      ))
      .slice(0, MAX_ENTRIES)
      .map(({ order }) => order),
  );
  return deduplicated
    .filter(({ order }) => retainedOrders.has(order))
    .sort((left, right) => left.order - right.order)
    .map(({ entry }) => ({ ...entry }));
}

function normalizeEntry(value: unknown, now: number): WeixinPendingTextDelivery | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeString(value.id, MAX_ID_LENGTH);
  const externalScopeId = normalizeString(value.externalScopeId, MAX_SCOPE_ID_LENGTH);
  const content = truncateUtf8(normalizeString(value.content), MAX_CONTENT_BYTES);
  const createdAt = normalizePositiveTimestamp(value.createdAt);
  const nextAttemptAt = normalizePositiveTimestamp(value.nextAttemptAt);
  if (
    !id
    || !externalScopeId
    || !content
    || createdAt === null
    || nextAttemptAt === null
    || now - createdAt > RETENTION_MS
  ) {
    return null;
  }
  return {
    id,
    externalScopeId,
    content,
    source: normalizeString(value.source, MAX_SOURCE_LENGTH) || 'text',
    createdAt,
    nextAttemptAt,
    attemptCount: normalizeNonNegativeInteger(value.attemptCount),
    lastError: normalizeString(value.lastError, MAX_ERROR_LENGTH),
    lastErrorCode: normalizeErrorCode(value.lastErrorCode),
  };
}

function normalizeString(value: unknown, maxLength = Number.POSITIVE_INFINITY): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, maxLength);
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return value;
  }
  const characters: string[] = [];
  let byteLength = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (byteLength + characterBytes > maxBytes) {
      break;
    }
    characters.push(character);
    byteLength += characterBytes;
  }
  return characters.join('');
}

function normalizePositiveTimestamp(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function normalizeErrorCode(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
