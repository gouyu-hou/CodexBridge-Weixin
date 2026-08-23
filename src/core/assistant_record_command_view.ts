import type { Translator } from '../i18n/index.js';
import type { AssistantRecord, AssistantRecordType } from '../types/core.js';
import type { PendingAssistantRecordUpdateDraft } from './assistant_record_command_service.js';

export function renderAssistantRecordList(
  records: AssistantRecord[],
  typeFilter: AssistantRecordType | null,
  query: string,
  i18n: Translator,
): string[] {
  const title = query
    ? i18n.t('coordinator.assistant.searchTitle', { query })
    : i18n.t('coordinator.assistant.listTitle', { type: i18n.t(`coordinator.assistant.type.${typeFilter ?? 'all'}`) });
  if (records.length === 0) {
    return [title, i18n.t('coordinator.assistant.empty'), i18n.t('coordinator.assistant.addHint')];
  }
  return [
    title,
    ...records.slice(0, 10).flatMap((record, index) => renderAssistantRecordListItem(record, index + 1, i18n)),
    i18n.t('coordinator.assistant.listActions'),
  ];
}

export function renderAssistantRecordListItem(record: AssistantRecord, index: number, i18n: Translator): string[] {
  const lines = [
    `${index}. [${i18n.t(`coordinator.assistant.type.${record.type}`)}] ${record.title}`,
    i18n.t('coordinator.assistant.listMeta', {
      status: i18n.t(`coordinator.assistant.status.${record.status}`),
      priority: i18n.t(`coordinator.assistant.priority.${record.priority}`),
    }),
  ];
  pushAssistantRecordTimeLine(lines, record, i18n);
  if (record.attachments.length > 0) {
    lines.push(i18n.t('coordinator.assistant.attachmentCount', { count: record.attachments.length }));
  }
  if (record.tags.length > 0) {
    lines.push(i18n.t('coordinator.assistant.tagsLine', { value: record.tags.join(', ') }));
  }
  return lines;
}

export function renderAssistantPendingRecord(record: AssistantRecord, commandName: string, i18n: Translator): string[] {
  const lines = [
    i18n.t('coordinator.assistant.pendingTitle'),
    i18n.t('coordinator.assistant.detectedType', { type: i18n.t(`coordinator.assistant.type.${record.type}`) }),
    i18n.t('coordinator.assistant.recordTitle', { title: record.title }),
  ];
  pushAssistantRecordContent(lines, record, i18n);
  pushAssistantRecordTimeLine(lines, record, i18n);
  if (record.attachments.length > 0) {
    lines.push(i18n.t('coordinator.assistant.attachmentCount', { count: record.attachments.length }));
  }
  lines.push(i18n.t('coordinator.assistant.confirmHint', { command: commandName }));
  lines.push(i18n.t('coordinator.assistant.editHint', { command: commandName }));
  lines.push(i18n.t('coordinator.assistant.cancelHint', { command: commandName }));
  return lines;
}

export function renderAssistantSavedRecord(record: AssistantRecord, commandName: string, i18n: Translator): string[] {
  const lines = [
    i18n.t('coordinator.assistant.saved'),
    i18n.t('coordinator.assistant.detectedType', { type: i18n.t(`coordinator.assistant.type.${record.type}`) }),
    i18n.t('coordinator.assistant.recordTitle', { title: record.title }),
  ];
  pushAssistantRecordContent(lines, record, i18n);
  pushAssistantRecordTimeLine(lines, record, i18n);
  if (record.attachments.length > 0) {
    lines.push(i18n.t('coordinator.assistant.attachmentCount', { count: record.attachments.length }));
  }
  lines.push(i18n.t('coordinator.assistant.showHint', { command: commandName }));
  return lines;
}

export function renderAssistantUpdateDraft(
  draft: PendingAssistantRecordUpdateDraft,
  commandName: string,
  i18n: Translator,
): string[] {
  const record = draft.updatedRecord;
  const lines = [
    i18n.t('coordinator.assistant.updateDraftTitle'),
    i18n.t('coordinator.assistant.updateDraftTarget', { title: draft.matchedRecord.title }),
    i18n.t('coordinator.assistant.updateDraftAction', { action: i18n.t(`coordinator.assistant.updateAction.${draft.action}`) }),
    i18n.t('coordinator.assistant.detectedType', { type: i18n.t(`coordinator.assistant.type.${record.type}`) }),
    i18n.t('coordinator.assistant.statusLine', { value: i18n.t(`coordinator.assistant.status.${record.status}`) }),
  ];
  if (draft.action === 'update') {
    if (draft.changeSummary) {
      lines.push(i18n.t('coordinator.assistant.changeSummary', { value: draft.changeSummary }));
    }
    pushAssistantRecordContent(lines, record, i18n);
    pushAssistantRecordTimeLine(lines, record, i18n);
  }
  lines.push(i18n.t('coordinator.assistant.confirmHint', { command: commandName }));
  lines.push(i18n.t('coordinator.assistant.editHint', { command: commandName }));
  lines.push(i18n.t('coordinator.assistant.cancelHint', { command: commandName }));
  return lines;
}

export function renderAssistantUpdateApplied(
  draft: PendingAssistantRecordUpdateDraft,
  record: AssistantRecord,
  commandName: string,
  i18n: Translator,
): string[] {
  const lines = [
    i18n.t('coordinator.assistant.updateApplied'),
    i18n.t('coordinator.assistant.updateDraftTarget', { title: draft.matchedRecord.title }),
    i18n.t('coordinator.assistant.updateDraftAction', { action: i18n.t(`coordinator.assistant.updateAction.${draft.action}`) }),
    i18n.t('coordinator.assistant.statusLine', { value: i18n.t(`coordinator.assistant.status.${record.status}`) }),
  ];
  if (draft.action === 'update') {
    if (draft.changeSummary) {
      lines.push(i18n.t('coordinator.assistant.changeSummary', { value: draft.changeSummary }));
    }
    pushAssistantRecordContent(lines, record, i18n);
    pushAssistantRecordTimeLine(lines, record, i18n);
  }
  lines.push(i18n.t('coordinator.assistant.showHint', { command: commandName }));
  return lines;
}

export function renderAssistantRecordDetail(record: AssistantRecord, i18n: Translator): string[] {
  const lines = [
    i18n.t('coordinator.assistant.detailTitle', { title: record.title }),
    i18n.t('coordinator.assistant.detectedType', { type: i18n.t(`coordinator.assistant.type.${record.type}`) }),
    i18n.t('coordinator.assistant.statusLine', { value: i18n.t(`coordinator.assistant.status.${record.status}`) }),
    i18n.t('coordinator.assistant.priorityLine', { value: i18n.t(`coordinator.assistant.priority.${record.priority}`) }),
  ];
  if (record.content) {
    pushAssistantRecordContent(lines, record, i18n);
  }
  pushAssistantRecordTimeLine(lines, record, i18n);
  if (record.tags.length > 0) {
    lines.push(i18n.t('coordinator.assistant.tagsLine', { value: record.tags.join(', ') }));
  }
  if (record.attachments.length > 0) {
    lines.push(i18n.t('coordinator.assistant.attachmentsTitle', { count: record.attachments.length }));
    for (const attachment of record.attachments) {
      lines.push(attachment.filename, attachment.storagePath);
    }
  }
  lines.push(i18n.t('coordinator.assistant.detailActions'));
  return lines;
}

function pushAssistantRecordContent(lines: string[], record: AssistantRecord, i18n: Translator): void {
  const content = String(record.content ?? '').trim();
  if (content) {
    lines.push(i18n.t('coordinator.assistant.contentLabel'), content);
  }
}

function pushAssistantRecordTimeLine(lines: string[], record: AssistantRecord, i18n: Translator): void {
  const timeLine = renderAssistantRecordTimeLine(record, i18n);
  if (timeLine) {
    lines.push(timeLine);
  }
}

function renderAssistantRecordTimeLine(record: AssistantRecord, i18n: Translator): string {
  if (record.type === 'reminder' && record.remindAt) {
    return i18n.t('coordinator.assistant.remindAtLine', { value: formatDateTime(record.remindAt, record.timezone) });
  }
  if (record.type === 'todo' && record.dueAt) {
    return i18n.t('coordinator.assistant.dueAtLine', { value: formatDateTime(record.dueAt, record.timezone) });
  }
  return record.recurrence
    ? i18n.t('coordinator.assistant.recurrenceLine', { value: record.recurrence })
    : '';
}

function formatDateTime(timestamp: number, timezone: string | null): string {
  if (!Number.isFinite(timestamp)) {
    return '';
  }
  const resolvedTimezone = String(timezone ?? '').trim() || 'Etc/UTC';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolvedTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${formatter.format(new Date(timestamp))} ${resolvedTimezone === 'Etc/UTC' ? 'UTC' : resolvedTimezone}`;
}
