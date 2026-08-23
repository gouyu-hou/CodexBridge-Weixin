import assert from 'node:assert/strict';
import test from 'node:test';
import {
  renderAssistantPendingRecord,
  renderAssistantRecordDetail,
  renderAssistantRecordList,
  renderAssistantRecordListItem,
  renderAssistantSavedRecord,
  renderAssistantUpdateApplied,
  renderAssistantUpdateDraft,
} from '../../src/core/assistant_record_command_view.js';
import type { PendingAssistantRecordUpdateDraft } from '../../src/core/assistant_record_command_service.js';
import { createI18n } from '../../src/i18n/index.js';
import type { AssistantRecord } from '../../src/types/core.js';

function makeRecord(overrides: Partial<AssistantRecord> = {}): AssistantRecord {
  return {
    id: 'record-1',
    type: 'todo',
    status: 'active',
    title: 'Prepare estimate',
    content: 'Include the client breakdown.',
    originalText: 'Prepare estimate',
    priority: 'high',
    project: null,
    tags: ['client', 'urgent'],
    dueAt: null,
    remindAt: null,
    recurrence: null,
    timezone: 'Etc/UTC',
    source: 'weixin',
    platform: 'weixin',
    scopeId: 'scope-1',
    contextThreadId: null,
    attachments: [{
      id: 'attachment-1',
      recordId: 'record-1',
      originalPath: '/tmp/source.pdf',
      storagePath: '/tmp/stored.pdf',
      filename: 'estimate.pdf',
      originalFilename: 'estimate.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      sha256: null,
      kind: 'document',
      createdAt: 1,
    }],
    parseStatus: 'auto',
    confidence: 0.9,
    parsedJson: null,
    lastRemindedAt: null,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    cancelledAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function makeUpdateDraft(record = makeRecord()): PendingAssistantRecordUpdateDraft {
  return {
    createdAt: 1,
    rawInput: 'Make it ready today',
    instructions: ['Make it ready today'],
    targetRecordId: record.id,
    matchedRecord: record,
    action: 'update',
    updatedRecord: { ...record, title: 'Prepare final estimate' },
    matchedScore: 90,
    normalizedBy: 'provider',
    changeSummary: 'Updated the estimate scope.',
  };
}

test('assistant record view preserves list and local list outcomes in both locales', () => {
  const record = makeRecord({ attachments: [] });
  for (const locale of ['zh-CN', 'en'] as const) {
    const i18n = createI18n(locale);
    const listItem = [
      `1. [${i18n.t('coordinator.assistant.type.todo')}] ${record.title}`,
      i18n.t('coordinator.assistant.listMeta', {
        status: i18n.t('coordinator.assistant.status.active'),
        priority: i18n.t('coordinator.assistant.priority.high'),
      }),
      i18n.t('coordinator.assistant.tagsLine', { value: 'client, urgent' }),
    ];
    assert.deepEqual(renderAssistantRecordListItem(record, 1, i18n), listItem, locale);
    assert.deepEqual(renderAssistantRecordList([record], 'todo', '', i18n), [
      i18n.t('coordinator.assistant.listTitle', { type: i18n.t('coordinator.assistant.type.todo') }),
      ...listItem,
      i18n.t('coordinator.assistant.listActions'),
    ], locale);
    assert.deepEqual(renderAssistantRecordList([], 'todo', '', i18n), [
      i18n.t('coordinator.assistant.listTitle', { type: i18n.t('coordinator.assistant.type.todo') }),
      i18n.t('coordinator.assistant.empty'),
      i18n.t('coordinator.assistant.addHint'),
    ], locale);
  }
});

test('assistant record view renders pending, saved, update, and detail records in both locales', () => {
  const record = makeRecord();
  const draft = makeUpdateDraft(record);
  for (const locale of ['zh-CN', 'en'] as const) {
    const i18n = createI18n(locale);
    const content = [i18n.t('coordinator.assistant.contentLabel'), record.content];
    const attachment = [
      i18n.t('coordinator.assistant.attachmentsTitle', { count: 1 }),
      'estimate.pdf',
      '/tmp/stored.pdf',
    ];
    assert.deepEqual(renderAssistantPendingRecord(record, '/todo', i18n), [
      i18n.t('coordinator.assistant.pendingTitle'),
      i18n.t('coordinator.assistant.detectedType', { type: i18n.t('coordinator.assistant.type.todo') }),
      i18n.t('coordinator.assistant.recordTitle', { title: record.title }),
      ...content,
      i18n.t('coordinator.assistant.attachmentCount', { count: 1 }),
      i18n.t('coordinator.assistant.confirmHint', { command: '/todo' }),
      i18n.t('coordinator.assistant.editHint', { command: '/todo' }),
      i18n.t('coordinator.assistant.cancelHint', { command: '/todo' }),
    ], locale);
    assert.deepEqual(renderAssistantSavedRecord(record, '/todo', i18n), [
      i18n.t('coordinator.assistant.saved'),
      i18n.t('coordinator.assistant.detectedType', { type: i18n.t('coordinator.assistant.type.todo') }),
      i18n.t('coordinator.assistant.recordTitle', { title: record.title }),
      ...content,
      i18n.t('coordinator.assistant.attachmentCount', { count: 1 }),
      i18n.t('coordinator.assistant.showHint', { command: '/todo' }),
    ], locale);
    assert.deepEqual(renderAssistantUpdateDraft(draft, '/todo', i18n), [
      i18n.t('coordinator.assistant.updateDraftTitle'),
      i18n.t('coordinator.assistant.updateDraftTarget', { title: record.title }),
      i18n.t('coordinator.assistant.updateDraftAction', { action: i18n.t('coordinator.assistant.updateAction.update') }),
      i18n.t('coordinator.assistant.detectedType', { type: i18n.t('coordinator.assistant.type.todo') }),
      i18n.t('coordinator.assistant.statusLine', { value: i18n.t('coordinator.assistant.status.active') }),
      i18n.t('coordinator.assistant.changeSummary', { value: draft.changeSummary }),
      i18n.t('coordinator.assistant.contentLabel'),
      draft.updatedRecord.content,
      i18n.t('coordinator.assistant.confirmHint', { command: '/todo' }),
      i18n.t('coordinator.assistant.editHint', { command: '/todo' }),
      i18n.t('coordinator.assistant.cancelHint', { command: '/todo' }),
    ], locale);
    assert.deepEqual(renderAssistantUpdateApplied(draft, draft.updatedRecord, '/todo', i18n), [
      i18n.t('coordinator.assistant.updateApplied'),
      i18n.t('coordinator.assistant.updateDraftTarget', { title: record.title }),
      i18n.t('coordinator.assistant.updateDraftAction', { action: i18n.t('coordinator.assistant.updateAction.update') }),
      i18n.t('coordinator.assistant.statusLine', { value: i18n.t('coordinator.assistant.status.active') }),
      i18n.t('coordinator.assistant.changeSummary', { value: draft.changeSummary }),
      i18n.t('coordinator.assistant.contentLabel'),
      draft.updatedRecord.content,
      i18n.t('coordinator.assistant.showHint', { command: '/todo' }),
    ], locale);
    assert.deepEqual(renderAssistantRecordDetail(record, i18n), [
      i18n.t('coordinator.assistant.detailTitle', { title: record.title }),
      i18n.t('coordinator.assistant.detectedType', { type: i18n.t('coordinator.assistant.type.todo') }),
      i18n.t('coordinator.assistant.statusLine', { value: i18n.t('coordinator.assistant.status.active') }),
      i18n.t('coordinator.assistant.priorityLine', { value: i18n.t('coordinator.assistant.priority.high') }),
      ...content,
      i18n.t('coordinator.assistant.tagsLine', { value: 'client, urgent' }),
      ...attachment,
      i18n.t('coordinator.assistant.detailActions'),
    ], locale);
  }
});

test('assistant record view keeps localized time lines and UTC fallbacks stable', () => {
  const timestamp = Date.UTC(2026, 0, 2, 3, 4);
  const expected = {
    'zh-CN': {
      due: '到期：2026-01-02, 03:04 UTC',
      reminder: '提醒：2026-01-02, 03:04 UTC',
      recurrence: '重复：每周一',
      recurrenceValue: '每周一',
    },
    en: {
      due: 'Due: 2026-01-02, 03:04 UTC',
      reminder: 'Remind: 2026-01-02, 03:04 UTC',
      recurrence: 'Recurrence: every Monday',
      recurrenceValue: 'every Monday',
    },
  } as const;
  for (const locale of ['zh-CN', 'en'] as const) {
    const i18n = createI18n(locale);
    assert.ok(renderAssistantRecordListItem(makeRecord({
      dueAt: timestamp,
      timezone: ' ',
    }), 1, i18n).includes(expected[locale].due));
    assert.ok(renderAssistantRecordListItem(makeRecord({
      type: 'reminder',
      dueAt: null,
      remindAt: timestamp,
      timezone: '',
    }), 1, i18n).includes(expected[locale].reminder));
    assert.ok(renderAssistantRecordListItem(makeRecord({
      dueAt: null,
      recurrence: expected[locale].recurrenceValue,
    }), 1, i18n).includes(expected[locale].recurrence));
    const nonFinite = renderAssistantRecordListItem(makeRecord({
      dueAt: Number.NaN,
      recurrence: null,
    }), 1, i18n);
    assert.equal(nonFinite.some((line) => line.startsWith(locale === 'en' ? 'Due:' : '到期：')), false);
  }
});
