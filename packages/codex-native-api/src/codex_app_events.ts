import { isAgentDeltaNotificationMethod } from './codex_app_protocol.js';

export type CodexAppOutputKind = 'commentary' | 'final_answer';

export interface CodexAppProgressState {
  commentaryText: string;
  finalAnswerText: string;
  sawAssistantActivity: boolean;
  lastAssistantActivityAt: number;
}

export interface CodexAppProgressUpdate {
  text: string;
  delta: string;
  outputKind: CodexAppOutputKind;
}

type ProtocolRecord = Record<string, unknown>;

const INTERRUPTED_PATTERN = /interrupt|interrupted|cancel(?:led)?|aborted?|stopped by user|用户中断|已中断/i;

export function buildTurnSnapshotKey(turn: unknown): string {
  const record = asRecord(turn);
  const items = Array.isArray(record?.items) ? record.items : [];
  return JSON.stringify({
    status: record?.status ?? '',
    error: record?.error ?? '',
    items: items.map((item) => {
      const itemRecord = asRecord(item);
      return {
        type: itemRecord?.type ?? '',
        role: itemRecord?.role ?? '',
        phase: itemRecord?.phase ?? '',
        text: itemRecord?.text ?? '',
      };
    }),
  });
}

export function extractProgressUpdate(
  notification: unknown,
  turnId: string,
  itemOutputKinds: Map<string, CodexAppOutputKind>,
  progressState: Pick<CodexAppProgressState, 'commentaryText' | 'finalAnswerText'>,
): CodexAppProgressUpdate | null {
  const notificationRecord = asRecord(notification);
  if (!notificationRecord || typeof notificationRecord.method !== 'string') {
    return null;
  }
  const params = asRecord(notificationRecord.params) ?? {};
  const notificationTurnId = extractNotificationTurnId(params);
  if (!notificationTurnId || notificationTurnId !== turnId) {
    return null;
  }
  const method = notificationRecord.method;
  if (method === 'item/started' || method === 'item/completed') {
    const item = asRecord(params.item) ?? params;
    if (!isAssistantVisibleItem(item)) {
      return null;
    }
    const itemId = extractItemId(item);
    const outputKind = classifyAgentOutput(extractAgentPhase(item), method === 'item/completed');
    if (itemId) {
      itemOutputKinds.set(itemId, outputKind);
    }
    if (method === 'item/completed' && outputKind === 'final_answer') {
      const nextText = extractCompletedAgentText(params) ?? item.text ?? null;
      return buildProgressUpdate(progressState.finalAnswerText, nextText, outputKind);
    }
    return null;
  }
  if (method !== 'item/agentMessage/delta' && !isAgentDeltaNotificationMethod(method)) {
    return null;
  }
  const delta = extractNotificationDelta(params);
  if (!delta) {
    return null;
  }
  const itemId = extractItemId(params);
  const outputKind = resolveNotificationOutputKind(params, itemId, itemOutputKinds);
  const currentText = outputKind === 'final_answer'
    ? progressState.finalAnswerText
    : progressState.commentaryText;
  return buildProgressUpdate(currentText, `${currentText}${delta}`, outputKind);
}

export function extractNotificationTurnId(params: unknown): string | null {
  const record = asRecord(params);
  const direct = readNonEmptyString(record?.turnId);
  if (direct) {
    return direct;
  }
  const nested = readNonEmptyString(asRecord(record?.item)?.turnId);
  if (nested) {
    return nested;
  }
  return readNonEmptyString(asRecord(record?.event)?.turnId);
}

export function classifyAgentOutput(
  phase: string | null | undefined,
  completed: boolean,
): CodexAppOutputKind {
  if (!phase) {
    return completed ? 'final_answer' : 'commentary';
  }
  const normalized = phase.replace(/[^a-z]/gi, '').toLowerCase();
  if (
    normalized === 'final'
    || normalized === 'answer'
    || normalized === 'response'
    || normalized === 'finalanswer'
    || normalized === 'finalresponse'
  ) {
    return 'final_answer';
  }
  return 'commentary';
}

export function isAssistantVisibleItem(item: unknown): boolean {
  const itemType = normalizeEventItemType(item);
  if (itemType === 'agentmessage' || itemType === 'assistantmessage') {
    return true;
  }
  return itemType === 'message' && normalizeEventItemRole(item) === 'assistant';
}

export function isUserVisibleItem(item: unknown): boolean {
  const itemType = normalizeEventItemType(item);
  if (itemType.includes('user')) {
    return true;
  }
  return itemType === 'message' && normalizeEventItemRole(item) === 'user';
}

export function extractAgentPhase(value: unknown): string | null {
  const record = asRecord(value);
  const candidates = [record?.phase, asRecord(record?.item)?.phase];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }
  return null;
}

export function classifyTurnCompletionState(turn: unknown): 'unknown' | 'interrupted' | 'other' {
  const record = asRecord(turn);
  const haystack = `${String(record?.status ?? '')}\n${String(record?.error ?? '')}`.trim();
  if (!haystack) {
    return 'unknown';
  }
  if (INTERRUPTED_PATTERN.test(haystack)) {
    return 'interrupted';
  }
  return 'other';
}

export function extractTurnOutputText(turn: { items: unknown[] }): string {
  return turn.items
    .filter((item) =>
      isAssistantVisibleItem(item)
      && classifyAgentOutput(extractAgentPhase(item), true) === 'final_answer')
    .map((item) => asRecord(item)?.text)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export function extractTurnCommentaryText(turn: { items: unknown[] }): string {
  return turn.items
    .filter((item) =>
      isAssistantVisibleItem(item)
      && classifyAgentOutput(extractAgentPhase(item), true) !== 'final_answer')
    .map((item) => asRecord(item)?.text)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export function resolveTurnPreviewText(
  turn: { items: unknown[] },
  progressState: Partial<Pick<CodexAppProgressState, 'finalAnswerText' | 'commentaryText'>> = {},
): string {
  return progressState.finalAnswerText
    || progressState.commentaryText
    || extractTurnCommentaryText(turn);
}

export function shouldWaitForSessionTaskMaterialization(
  sessionState: {
    hasTaskComplete: boolean;
    lastAgentMessage: unknown;
    outputArtifacts: unknown[];
  },
  hasAssistantVisibleItems: boolean,
): boolean {
  return sessionState.hasTaskComplete
    && !hasAssistantVisibleItems
    && !sessionState.lastAgentMessage
    && sessionState.outputArtifacts.length === 0;
}

export function shouldWaitForTaskCompleteBeforeMissing(
  sessionPath: unknown,
  sessionState: { hasTaskComplete: boolean },
): boolean {
  return Boolean(String(sessionPath ?? '').trim()) && !sessionState.hasTaskComplete;
}

export function shouldWaitForSettledOutputAfterTerminalTurn(
  turn: { items: unknown[] },
  progressState: Partial<CodexAppProgressState> = {},
): boolean {
  const visibleItems = turn.items.filter((item) => asRecord(item)?.text);
  if (visibleItems.length === 0) {
    return true;
  }
  if (progressState.finalAnswerText) {
    return true;
  }
  return visibleItems.every((item) => {
    if (isUserVisibleItem(item)) {
      return true;
    }
    if (!isAssistantVisibleItem(item)) {
      return false;
    }
    return classifyAgentOutput(extractAgentPhase(item), true) !== 'final_answer';
  });
}

export function hasUnsettledAssistantActivity(
  turn: { items: unknown[] },
  progressState: Partial<CodexAppProgressState> = {},
): boolean {
  if (progressState.finalAnswerText) {
    return true;
  }
  if (progressState.commentaryText || progressState.sawAssistantActivity) {
    return true;
  }
  return turn.items.some((item) => {
    if (!isAssistantVisibleItem(item)) {
      return false;
    }
    return classifyAgentOutput(extractAgentPhase(item), true) !== 'final_answer'
      && Boolean(asRecord(item)?.text);
  });
}

function extractNotificationDelta(params: ProtocolRecord): string | null {
  const directDelta = readNonEmptyString(params.delta);
  if (directDelta) {
    return directDelta;
  }
  const directText = readNonEmptyString(params.text);
  if (directText) {
    return directText;
  }
  return readNonEmptyString(asRecord(params.item)?.delta);
}

function extractNotificationPhase(params: ProtocolRecord): string | null {
  if (typeof params.phase === 'string') {
    return params.phase;
  }
  const itemPhase = asRecord(params.item)?.phase;
  return typeof itemPhase === 'string' ? itemPhase : null;
}

function resolveNotificationOutputKind(
  params: ProtocolRecord,
  itemId: string | null,
  itemOutputKinds: Map<string, CodexAppOutputKind>,
): CodexAppOutputKind {
  const explicit = classifyAgentOutput(extractNotificationPhase(params), false);
  if (explicit === 'final_answer') {
    return explicit;
  }
  if (itemId && itemOutputKinds.has(itemId)) {
    return itemOutputKinds.get(itemId) ?? explicit;
  }
  return explicit;
}

function buildProgressUpdate(
  currentText: unknown,
  nextText: unknown,
  outputKind: CodexAppOutputKind,
): CodexAppProgressUpdate | null {
  const normalizedNextText = String(nextText ?? '');
  if (!normalizedNextText) {
    return null;
  }
  const previous = String(currentText ?? '');
  const delta = normalizedNextText.startsWith(previous)
    ? normalizedNextText.slice(previous.length)
    : normalizedNextText;
  if (!delta) {
    return null;
  }
  return {
    text: normalizedNextText,
    delta,
    outputKind,
  };
}

function normalizeEventItemType(item: unknown): string {
  return String(asRecord(item)?.type ?? '').replace(/[^a-z]/gi, '').toLowerCase();
}

function normalizeEventItemRole(item: unknown): string {
  return String(asRecord(item)?.role ?? '').replace(/[^a-z]/gi, '').toLowerCase();
}

export function extractItemId(value: unknown): string | null {
  const record = asRecord(value);
  const candidates = [
    record?.itemId,
    record?.item_id,
    record?.id,
    asRecord(record?.item)?.id,
  ];
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
      return String(candidate);
    }
  }
  return null;
}

function extractCompletedAgentText(params: ProtocolRecord): string | null {
  return readNonEmptyString(params.text) ?? readNonEmptyString(asRecord(params.item)?.text);
}

function asRecord(value: unknown): ProtocolRecord | null {
  return value !== null && typeof value === 'object'
    ? value as ProtocolRecord
    : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}
