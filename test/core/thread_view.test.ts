import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildThreadBrowserKey,
  buildThreadCommandSkillPrompt,
  buildThreadOperationKey,
  buildPendingThreadOperationLines,
  classifyPreviewTurnStatus,
  collectTurnItemTexts,
  extractRecentThreadTurns,
  formatCurrentBindingTitle,
  formatThreadOperationAction,
  formatThreadOperationKind,
  formatThreadOperationOutcome,
  formatThreadOperationUsage,
  formatThreadTitle,
  isProviderTurnTerminal,
  normalizeThreadPreview,
  renderThreadCommandClarifyLines,
  renderThreadPeek,
  renderThreadsPageMessage,
} from '../../src/core/thread_view.js';
import { THREAD_COMMAND_SKILL_ACTIONS } from '../../src/core/thread_command.js';
import { createI18n } from '../../src/i18n/index.js';

const i18n = createI18n('zh-CN');

test('buildThreadBrowserKey and buildThreadOperationKey share the platform scope key', () => {
  const key = buildThreadBrowserKey({ platform: 'weixin', externalScopeId: 'scope-1' });
  assert.equal(key, buildThreadOperationKey({ platform: 'weixin', externalScopeId: 'scope-1' }));
  assert.notEqual(key, buildThreadBrowserKey({ platform: 'weixin', externalScopeId: 'scope-2' }));
});

test('formatThreadOperationKind resolves localized operation labels', () => {
  for (const kind of ['archive', 'restore', 'pin', 'unpin'] as const) {
    const label = formatThreadOperationKind(kind, i18n);
    assert.ok(label);
    assert.ok(!label.includes('coordinator.threads.operation'), label);
  }
});

test('thread operation presentation helpers render pending actions and outcomes', () => {
  const operation = {
    kind: 'archive' as const,
    createdAt: 1,
    rawInput: 'archive old threads',
    providerProfileId: 'default',
    summary: 'Archive completed work',
    reason: 'Keep the active list focused',
    threads: [{
      threadId: 'thread-1',
      title: 'Completed work',
      alias: 'Release notes',
      preview: 'Version 0.1.7 is ready',
      updatedAt: 1,
      archivedAt: null,
      pinnedAt: null,
      isCurrent: false,
    }],
  };
  const lines = buildPendingThreadOperationLines(operation, i18n);
  assert.ok(lines.includes(i18n.t('coordinator.threads.pendingTitle')));
  assert.ok(lines.includes('1. Release notes'));
  assert.ok(lines.includes('   thread-1'));
  assert.ok(lines.includes(i18n.t('coordinator.threads.confirmHint')));

  assert.equal(
    formatThreadOperationOutcome({ status: 'resolution_error', message: 'missing thread' }, i18n),
    'missing thread',
  );
  assert.equal(
    formatThreadOperationOutcome({
      status: 'archive_failed',
      providerProfileId: 'default',
      threadId: 'thread-1',
      error: 'denied',
    }, i18n),
    i18n.t('coordinator.thread.archiveFailed', { threadId: 'thread-1', error: 'denied' }),
  );
  assert.equal(
    formatThreadOperationOutcome({
      status: 'applied',
      operation: 'pin',
      providerProfileId: 'default',
      threadId: 'thread-1',
    }, i18n),
    i18n.t('coordinator.thread.pinned', { threadId: 'thread-1' }),
  );
  assert.equal(formatThreadOperationUsage('archive', i18n), i18n.t('coordinator.threads.delUsage'));
  assert.equal(formatThreadOperationUsage('restore', i18n), i18n.t('coordinator.threads.restoreUsage'));
  assert.equal(formatThreadOperationAction('unpin', i18n), i18n.t('coordinator.thread.unpinActions'));
});

test('renderThreadCommandClarifyLines resolves inventory labels and limits candidates', () => {
  const inventory = [{
    threadId: 'thread-1',
    title: 'Original title',
    alias: 'Friendly alias',
    preview: null,
    updatedAt: null,
    archivedAt: null,
    pinnedAt: null,
    isCurrent: false,
  }];
  const candidates = [
    { threadId: 'thread-1' },
    ...Array.from({ length: 8 }, (_, index) => ({
      threadId: `thread-${index + 2}`,
      label: `Candidate ${index + 2}`,
    })),
  ];
  const lines = renderThreadCommandClarifyLines(inventory, '', candidates, i18n);
  assert.equal(lines[0], i18n.t('coordinator.threadList.noMatch'));
  assert.equal(lines[1], '1. Friendly alias');
  assert.equal(lines[2], '   thread-1');
  assert.equal(lines.filter((line) => /^\d+\. /u.test(line)).length, 6);
  assert.ok(!lines.some((line) => line.includes('Candidate 7')));
});

test('buildThreadCommandSkillPrompt embeds inventory and skill contract', () => {
  const prompt = buildThreadCommandSkillPrompt({
    event: {
      platform: 'weixin',
      externalScopeId: 'scope-1',
      text: '/threads 删除上周的会话',
    } as any,
    command: 'threads',
    subcommand: 'archive',
    userInput: '删除上周的会话',
    locale: 'zh-CN',
    now: 1_750_000_000_000,
    cwd: 'D:/work/repo',
    inventory: [{
      threadId: 'thread-1',
      title: '打包调研',
      alias: null,
      preview: 'ASAR 布局讨论',
      updatedAt: 1_749_000_000_000,
      archivedAt: null,
      pinnedAt: null,
      isCurrent: true,
    }],
  });
  assert.match(prompt, /command skill file/u);
  assert.match(prompt, /docs[\\/]command-skills[\\/]threads\.md/u);
  const payload = JSON.parse(prompt.slice(prompt.indexOf('{')));
  assert.equal(payload.command, 'threads');
  assert.equal(payload.subcommand, 'archive');
  assert.equal(payload.threads.length, 1);
  assert.equal(payload.threads[0].threadId, 'thread-1');
  assert.equal(payload.threads[0].isCurrent, true);
  assert.deepEqual(payload.capabilities.supportedActions, [...THREAD_COMMAND_SKILL_ACTIONS]);
});

test('renderThreadsPageMessage marks the current binding and archived/pinned tags', () => {
  const message = renderThreadsPageMessage({
    i18n,
    providerProfile: { id: 'openai-default' },
    currentSession: {
      providerProfileId: 'openai-default',
      codexThreadId: 'thread-1',
      title: '当前会话',
    },
    items: [
      {
        threadId: 'thread-1',
        title: '当前会话',
        preview: '正在讨论打包',
        updatedAt: Date.now(),
        archivedAt: null,
        pinnedAt: Date.now(),
      },
      {
        threadId: 'thread-2',
        title: null,
        preview: '归档的旧会话',
        updatedAt: Date.now() - 86_400_000,
        archivedAt: Date.now() - 3_600_000,
        pinnedAt: null,
      },
    ],
    pageNumber: 1,
    searchTerm: null,
    includeArchived: true,
    onlyPinned: false,
    hasPreviousPage: false,
    hasNextPage: false,
  });
  assert.match(message, /👉 1\. 当前会话/u);
  assert.match(message, /2\. 归档的旧会话/u);
  assert.match(message, /\/threads/u);
});

test('formatCurrentBindingTitle falls back to thread id then untitled', () => {
  assert.equal(formatCurrentBindingTitle('已命名', 'thread-1', i18n), '已命名');
  assert.match(formatCurrentBindingTitle('', 'thread-1', i18n), /thread-1/u);
  assert.ok(formatCurrentBindingTitle('', '', i18n));
});

test('renderThreadPeek renders recent turns with per-status lines', () => {
  const peek = renderThreadPeek({
    threadId: 'thread-1',
    title: '打包调研',
    preview: 'ASAR 布局讨论',
    turns: [
      {
        status: 'completed',
        items: [
          { role: 'user', text: '第一轮问题' },
          { role: 'assistant', text: '第一轮回答' },
        ],
      },
      {
        status: 'failed',
        items: [
          { type: 'userMessage', text: '第二轮问题' },
          { type: 'agentMessage', text: '第二轮部分回答' },
        ],
      },
    ],
  }, i18n);
  assert.match(peek, /打包调研/u);
  assert.match(peek, /第一轮问题/u);
  assert.match(peek, /第二轮部分回答/u);

  const empty = renderThreadPeek({ threadId: 'thread-2', title: null, preview: null, turns: [] }, i18n);
  assert.ok(empty.includes(i18n.t('coordinator.threadPeek.noTurns')));
});

test('extractRecentThreadTurns keeps at most three most recent non-empty turns', () => {
  const turns = Array.from({ length: 5 }, (_, index) => ({
    status: 'completed',
    items: [
      { role: 'user', text: `问题 ${index + 1}` },
      { role: 'assistant', text: `回答 ${index + 1}` },
    ],
  }));
  turns.push({ status: 'completed', items: [] });
  const recent = extractRecentThreadTurns(turns);
  assert.equal(recent.length, 3);
  assert.equal(recent[0].userText, '问题 3');
  assert.equal(recent.at(-1)?.userText, '问题 5');
});

test('collectTurnItemTexts prefers final answers for assistants', () => {
  const items = [
    { role: 'assistant', text: '中间推理', phase: 'thinking' },
    { role: 'assistant', text: '最终回答', phase: 'final_answer' },
  ];
  assert.deepEqual(collectTurnItemTexts(items, 'assistant', { preferFinalAnswer: true }), ['最终回答']);
  assert.deepEqual(collectTurnItemTexts(items, 'assistant'), ['中间推理', '最终回答']);
  assert.deepEqual(collectTurnItemTexts(items, 'user'), []);
});

test('classifyPreviewTurnStatus and isProviderTurnTerminal normalize status labels', () => {
  assert.equal(classifyPreviewTurnStatus('completed', '有回答'), 'complete');
  assert.equal(classifyPreviewTurnStatus('completed', ''), 'missing');
  assert.equal(classifyPreviewTurnStatus('cancelled', '部分'), 'interrupted');
  assert.equal(classifyPreviewTurnStatus('error', '部分'), 'failed');
  assert.equal(classifyPreviewTurnStatus('running', '部分'), 'partial');

  assert.equal(isProviderTurnTerminal('Completed'), true);
  assert.equal(isProviderTurnTerminal('timed_out'), true);
  assert.equal(isProviderTurnTerminal('running'), false);
  assert.equal(isProviderTurnTerminal(null), false);
});

test('formatThreadTitle and normalizeThreadPreview truncate long values', () => {
  assert.equal(formatThreadTitle('标题', '预览', i18n), '标题');
  assert.equal(formatThreadTitle('', '预览兜底', i18n), '预览兜底');
  assert.ok(formatThreadTitle('', '', i18n));
  assert.ok(formatThreadTitle('长'.repeat(80), '', i18n).length <= 48);
  assert.ok(normalizeThreadPreview('长'.repeat(120), i18n).length <= 72);
  assert.ok(normalizeThreadPreview('', i18n));
});
