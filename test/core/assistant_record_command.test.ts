import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  AssistantRecordCommandService,
  assistantCommandNameForType,
  resolveAssistantRecordLocalQueryIntent,
  type PendingAssistantRecordUpdateDraft,
} from '../../src/core/assistant_record_command_service.js';

test('BridgeCoordinator delegates assistant record command orchestration to the focused service', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'core', 'bridge_coordinator.ts'),
    'utf8',
  );
  assert.match(source, /from '\.\/assistant_record_command_service\.js'/u);
  assert.match(source, /new AssistantRecordCommandService\(/u);
  assert.match(source, /return this\.assistantRecordCommands\.handle\(event, args, forcedType\)/u);
  assert.doesNotMatch(source, /pendingAssistantUpdateDraftsByScope/u);
});

test('assistant record command names preserve typed aliases and the unified default', () => {
  assert.equal(assistantCommandNameForType(null), '/as');
  assert.equal(assistantCommandNameForType('log'), '/log');
  assert.equal(assistantCommandNameForType('todo'), '/todo');
  assert.equal(assistantCommandNameForType('reminder'), '/remind');
  assert.equal(assistantCommandNameForType('note'), '/note');
});

test('local assistant list intent keeps default and forced type behavior', () => {
  assert.deepEqual(resolveAssistantRecordLocalQueryIntent('我还有哪些待办', null), {
    kind: 'list',
    typeFilter: 'todo',
  });
  assert.deepEqual(resolveAssistantRecordLocalQueryIntent('查看一下', 'note'), {
    kind: 'list',
    typeFilter: 'note',
  });
  assert.equal(resolveAssistantRecordLocalQueryIntent('新增待办 检查服务器', null), null);
  assert.equal(resolveAssistantRecordLocalQueryIntent('把发票事项改成明天完成', null), null);
});

test('pending assistant update drafts are isolated by scope and record type', () => {
  const service = new AssistantRecordCommandService({} as any);
  const scope = { platform: 'weixin', externalScopeId: 'assistant-scope-1' };
  const matchedRecord = { id: 'record-1', type: 'todo' } as any;
  const draft: PendingAssistantRecordUpdateDraft = {
    createdAt: 1,
    rawInput: 'change it',
    instructions: ['change it'],
    targetRecordId: 'record-1',
    matchedRecord,
    action: 'update',
    updatedRecord: { ...matchedRecord, type: 'reminder' },
    matchedScore: 100,
    normalizedBy: 'local',
    changeSummary: null,
  };

  service.setPendingUpdateDraft(scope, draft);
  assert.equal(service.getPendingUpdateDraft(scope), draft);
  assert.equal(service.getPendingUpdateDraftForType(scope, 'todo'), draft);
  assert.equal(service.getPendingUpdateDraftForType(scope, 'reminder'), draft);
  assert.equal(service.getPendingUpdateDraftForType(scope, 'note'), null);
  assert.equal(service.getPendingUpdateDraft({ ...scope, externalScopeId: 'other' }), null);
  service.clearPendingUpdateDraft(scope);
  assert.equal(service.getPendingUpdateDraft(scope), null);
});
