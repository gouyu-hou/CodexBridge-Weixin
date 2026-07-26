import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INSTRUCTIONS_COMMAND_SKILL_ACTIONS,
  buildInstructionsCommandSkillPrompt,
  buildInstructionsEditKey,
  buildInstructionsOperation,
  buildInstructionsOperationKey,
  buildPendingInstructionsOperationFromSkillResult,
  defaultInstructionsSummary,
  extractInstructionsEditBody,
  extractInstructionsInlineContent,
  formatInstructionsContentPreview,
  formatInstructionsProposalKind,
  formatInstructionsStatus,
  normalizeInstructionsDocumentContent,
  parseInstructionsCommandSkillResult,
  type PendingInstructionsOperation,
} from '../../src/core/instructions_command.js';
import { createI18n } from '../../src/i18n/index.js';

const i18n = createI18n('zh-CN');

test('buildInstructionsOperationKey and buildInstructionsEditKey share the platform scope key', () => {
  const scopeKey = buildInstructionsOperationKey({ platform: 'weixin', externalScopeId: 'scope-1' });
  assert.equal(scopeKey, buildInstructionsEditKey({ platform: 'weixin', externalScopeId: 'scope-1' }));
  assert.notEqual(scopeKey, buildInstructionsOperationKey({ platform: 'weixin', externalScopeId: 'scope-2' }));
});

test('formatInstructionsStatus and proposal kind labels resolve localized text', () => {
  assert.ok(formatInstructionsStatus(true, i18n));
  assert.ok(formatInstructionsStatus(false, i18n));
  assert.notEqual(formatInstructionsStatus(true, i18n), formatInstructionsStatus(false, i18n));
  for (const kind of ['patch', 'replace', 'clear'] as const) {
    const label = formatInstructionsProposalKind(kind, i18n);
    assert.ok(label);
    assert.ok(!label.includes('coordinator.instructions.kind'), label);
    const summary = defaultInstructionsSummary(kind, i18n);
    assert.ok(summary);
    assert.ok(!summary.includes('coordinator.instructions.defaultSummary'), summary);
  }
});

test('extractInstructionsInlineContent and extractInstructionsEditBody parse command bodies', () => {
  assert.equal(extractInstructionsInlineContent('/instructions set 保持中文回复'), '保持中文回复');
  assert.equal(extractInstructionsInlineContent('/ins set line1\nline2'), 'line1\nline2');
  assert.equal(extractInstructionsInlineContent('/instructions set'), '');
  assert.equal(extractInstructionsInlineContent('/instructions edit 内容'), '');

  assert.equal(extractInstructionsEditBody('/instructions edit  去掉  第二条  '), '去掉 第二条');
  assert.equal(extractInstructionsEditBody('/ins edit 补充部署说明'), '补充部署说明');
  assert.equal(extractInstructionsEditBody('/instructions edit'), '');
  assert.equal(extractInstructionsEditBody('/instructions set 内容'), '');
});

test('normalizeInstructionsDocumentContent normalizes CRLF and trims', () => {
  assert.equal(normalizeInstructionsDocumentContent('a\r\nb\r\n'), 'a\nb');
  assert.equal(normalizeInstructionsDocumentContent('  \n  '), '');
  assert.equal(normalizeInstructionsDocumentContent(null), '');
});

test('buildInstructionsCommandSkillPrompt embeds current content, draft, and skill contract', () => {
  const prompt = buildInstructionsCommandSkillPrompt({
    event: {
      platform: 'weixin',
      externalScopeId: 'scope-1',
      text: '/instructions 把回复语言改成中文',
    } as any,
    subcommand: 'natural',
    userInput: '把回复语言改成中文',
    locale: 'zh-CN',
    now: 1_750_000_000_000,
    cwd: 'D:/work/repo',
    currentInstructions: {
      path: 'D:/work/repo/AGENTS.md',
      exists: true,
      content: '# AGENTS\n用英文回复',
    } as any,
    pendingDraft: {
      kind: 'patch',
      createdAt: 1_749_000_000_000,
      rawInput: '早先的修改请求',
      summary: '调整回复语言',
      changes: ['语言改为英文'],
      proposedContent: '# AGENTS\n用英文回复',
      baseContent: '# AGENTS',
      normalizedBy: 'codex',
    },
  });
  assert.match(prompt, /command skill file/u);
  assert.match(prompt, /docs[\\/]command-skills[\\/]instructions\.md/u);
  const payload = JSON.parse(prompt.slice(prompt.indexOf('{')));
  assert.equal(payload.command, 'instructions');
  assert.equal(payload.subcommand, 'natural');
  assert.equal(payload.currentInstructions.exists, true);
  assert.equal(payload.pendingDraft.kind, 'patch');
  assert.deepEqual(payload.capabilities.supportedActions, [...INSTRUCTIONS_COMMAND_SKILL_ACTIONS]);
  assert.deepEqual(payload.capabilities.supportedProposalKinds, ['patch', 'replace', 'clear']);
});

test('parseInstructionsCommandSkillResult normalizes supported result shapes', () => {
  assert.deepEqual(parseInstructionsCommandSkillResult({
    action: 'propose_patch',
    confidence: 0.9,
    summary: '  合并  语言要求 ',
    changes: ['语言改成中文', ''],
    proposedContent: '# AGENTS\r\n用中文回复\r\n',
  }), {
    action: 'propose_patch',
    confidence: 0.9,
    summary: '合并 语言要求',
    changes: ['语言改成中文'],
    proposedContent: '# AGENTS\n用中文回复',
  });

  assert.deepEqual(parseInstructionsCommandSkillResult(JSON.stringify({
    action: 'propose_clear',
    confidence: 2,
    summary: '清空指令',
  })), {
    action: 'propose_clear',
    confidence: 1,
    summary: '清空指令',
    changes: [],
    proposedContent: '',
  });

  assert.deepEqual(parseInstructionsCommandSkillResult({
    action: 'update_pending_draft',
    proposalKind: 'replace',
    summary: '重写为部署说明',
    proposedContent: '# 部署说明',
  }), {
    action: 'update_pending_draft',
    confidence: 0.8,
    proposalKind: 'replace',
    summary: '重写为部署说明',
    changes: [],
    proposedContent: '# 部署说明',
  });

  assert.deepEqual(parseInstructionsCommandSkillResult({
    action: 'clarify',
    question: '  你想保留 哪一段? ',
    candidates: [{ index: 1 }, 'bad', null],
  }), {
    action: 'clarify',
    confidence: 0.8,
    question: '你想保留 哪一段?',
    candidates: [{ index: 1 }],
  });

  assert.deepEqual(parseInstructionsCommandSkillResult({
    action: 'reject',
    reason: ' 与指令无关 ',
  }), {
    action: 'reject',
    confidence: 0.8,
    reason: '与指令无关',
  });
});

test('parseInstructionsCommandSkillResult rejects incomplete or unsupported results', () => {
  assert.equal(parseInstructionsCommandSkillResult(null), null);
  assert.equal(parseInstructionsCommandSkillResult('not json'), null);
  assert.equal(parseInstructionsCommandSkillResult({ action: 'unknown_action' }), null);
  // propose_patch without summary
  assert.equal(parseInstructionsCommandSkillResult({
    action: 'propose_patch',
    proposedContent: '内容',
  }), null);
  // propose_replace without content
  assert.equal(parseInstructionsCommandSkillResult({
    action: 'propose_replace',
    summary: '重写',
  }), null);
  // update_pending_draft without proposalKind
  assert.equal(parseInstructionsCommandSkillResult({
    action: 'update_pending_draft',
    summary: '更新草稿',
    proposedContent: '内容',
  }), null);
  // update_pending_draft patch without content
  assert.equal(parseInstructionsCommandSkillResult({
    action: 'update_pending_draft',
    proposalKind: 'patch',
    summary: '更新草稿',
  }), null);
});

test('buildInstructionsOperation normalizes summary, changes, and clear content', () => {
  const operation = buildInstructionsOperation({
    kind: 'clear',
    createdAt: 1_750_000_000_000,
    rawInput: '清空',
    summary: ' 清空  全部指令 ',
    changes: Array.from({ length: 20 }, (_, index) => `change-${index + 1}`),
    proposedContent: '应被忽略',
    baseContent: 'line1\r\nline2',
    normalizedBy: 'local',
  });
  assert.equal(operation.summary, '清空 全部指令');
  assert.equal(operation.changes.length, 12);
  assert.equal(operation.proposedContent, '');
  assert.equal(operation.baseContent, 'line1\nline2');
});

test('buildPendingInstructionsOperationFromSkillResult maps skill actions onto drafts', () => {
  const pendingDraft: PendingInstructionsOperation = {
    kind: 'patch',
    createdAt: 1_749_000_000_000,
    rawInput: '原始请求',
    summary: '原始摘要',
    changes: [],
    proposedContent: '# 草稿',
    baseContent: '# 基线',
    normalizedBy: 'codex',
  };

  const patch = buildPendingInstructionsOperationFromSkillResult({
    now: 1_750_000_000_000,
    rawInput: '合并语言要求',
    result: {
      action: 'propose_patch',
      confidence: 0.9,
      summary: '合并语言要求',
      changes: [],
      proposedContent: '# 新内容',
    },
    currentContent: '# 当前',
    pendingDraft,
  });
  assert.equal(patch?.kind, 'patch');
  assert.equal(patch?.baseContent, '# 基线');

  const replace = buildPendingInstructionsOperationFromSkillResult({
    now: 1_750_000_000_000,
    rawInput: '整体重写',
    result: {
      action: 'propose_replace',
      confidence: 0.9,
      summary: '整体重写',
      changes: [],
      proposedContent: '# 新文档',
    },
    currentContent: '# 当前',
    pendingDraft,
  });
  assert.equal(replace?.kind, 'replace');
  assert.equal(replace?.baseContent, '# 当前');

  const updated = buildPendingInstructionsOperationFromSkillResult({
    now: 1_750_000_000_000,
    rawInput: '再补充一条',
    result: {
      action: 'update_pending_draft',
      confidence: 0.9,
      proposalKind: 'patch',
      summary: '补充后的摘要',
      changes: [],
      proposedContent: '# 草稿 v2',
    },
    currentContent: '# 当前',
    pendingDraft,
  });
  assert.equal(updated?.rawInput, '原始请求\n再补充一条');
  assert.equal(updated?.baseContent, '# 基线');
  assert.equal(updated?.proposedContent, '# 草稿 v2');

  assert.equal(buildPendingInstructionsOperationFromSkillResult({
    now: 1_750_000_000_000,
    rawInput: '更新草稿',
    result: {
      action: 'update_pending_draft',
      confidence: 0.9,
      proposalKind: 'patch',
      summary: '没有草稿可更新',
      changes: [],
      proposedContent: '# 内容',
    },
    currentContent: '# 当前',
    pendingDraft: null,
  }), null);

  assert.equal(buildPendingInstructionsOperationFromSkillResult({
    now: 1_750_000_000_000,
    rawInput: '澄清',
    result: {
      action: 'clarify',
      confidence: 0.9,
      question: '要改哪里?',
      candidates: [],
    },
    currentContent: '# 当前',
    pendingDraft,
  }), null);
});

test('formatInstructionsContentPreview truncates long documents to 24 lines', () => {
  assert.deepEqual(
    formatInstructionsContentPreview('', i18n),
    [i18n.t('coordinator.instructions.draftEmptyContent')],
  );
  const preview = formatInstructionsContentPreview(
    Array.from({ length: 30 }, (_, index) => `line-${index + 1}`).join('\n'),
    i18n,
  );
  assert.equal(preview.length, 25);
  assert.equal(preview.at(-1), '...');
  assert.equal(preview[0], 'line-1');
});
