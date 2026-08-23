import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  AssistantRecordCommandService,
  assistantCommandNameForType,
  resolveAssistantRecordLocalQueryIntent,
  type AssistantRecordCommandDependencies,
  type PendingAssistantRecordUpdateDraft,
} from '../../src/core/assistant_record_command_service.js';
import { createI18n } from '../../src/i18n/index.js';
import type { AssistantRecord, AssistantRecordType } from '../../src/types/core.js';
import type { InboundTextEvent } from '../../src/types/platform.js';

type CommandCall = {
  name: string;
  args: unknown[];
};

function createCommandHarness({ supported = true } = {}) {
  const calls: CommandCall[] = [];
  const event: InboundTextEvent = {
    platform: 'weixin',
    externalScopeId: 'assistant-command-scope',
    text: '',
  };
  const respond = (name: string, ...args: unknown[]) => {
    calls.push({ name, args });
    return `response:${name}`;
  };
  const dependencies: AssistantRecordCommandDependencies<string> = {
    isSupported: () => supported,
    getTranslator: () => createI18n('en'),
    buildSessionMeta: (currentEvent) => ({ scope: currentEvent.externalScopeId }),
    messageResponse: (lines, session) => respond('messageResponse', lines, session),
    renderList: (currentEvent, typeFilter, query) => respond(
      'renderList',
      currentEvent,
      typeFilter,
      query,
    ),
    show: async (currentEvent, args, typeFilter) => respond('show', currentEvent, args, typeFilter),
    complete: async (currentEvent, args, typeFilter) => respond(
      'complete',
      currentEvent,
      args,
      typeFilter,
    ),
    archive: async (currentEvent, args, typeFilter) => respond(
      'archive',
      currentEvent,
      args,
      typeFilter,
    ),
    cancelRecord: async (currentEvent, args, typeFilter) => respond(
      'cancelRecord',
      currentEvent,
      args,
      typeFilter,
    ),
    rejectMutation: async () => null,
    applyUpdateDraft: () => null,
    renderUpdateDraft: () => ['update-draft'],
    renderUpdateApplied: () => ['update-applied'],
    renderNoPending: async (currentEvent, typeFilter, action) => respond(
      'renderNoPending',
      currentEvent,
      typeFilter,
      action,
    ),
    editPending: async (currentEvent, args, forcedType) => respond(
      'editPending',
      currentEvent,
      args,
      forcedType,
    ),
    natural: async (currentEvent, rawInput, forcedType) => respond(
      'natural',
      currentEvent,
      rawInput,
      forcedType,
    ),
  };
  return {
    calls,
    event,
    service: new AssistantRecordCommandService(dependencies),
  };
}

function createTerminalHarness({
  rejection = null as string | null,
  appliedRecord = { id: 'record-1', type: 'todo', title: 'Updated record' } as AssistantRecord | null,
} = {}) {
  const calls: string[] = [];
  const event: InboundTextEvent = {
    platform: 'weixin',
    externalScopeId: 'assistant-terminal-scope',
    text: '',
  };
  const confirmedResponse = 'response:confirmed';
  const draftResponse = 'response:draft';
  const cancelledResponse = 'response:cancelled';
  const noPendingResponse = 'response:no-pending';
  const activeResponse = 'response:active';
  const draft: PendingAssistantRecordUpdateDraft = {
    createdAt: 1,
    rawInput: 'change it',
    instructions: ['change it'],
    targetRecordId: 'record-1',
    matchedRecord: { id: 'record-1', type: 'todo', title: 'Original record' } as AssistantRecord,
    action: 'update',
    updatedRecord: appliedRecord ?? { id: 'record-1', type: 'todo', title: 'Updated record' } as AssistantRecord,
    matchedScore: 100,
    normalizedBy: 'local',
    changeSummary: null,
  };
  const dependencies: AssistantRecordCommandDependencies<string> = {
    isSupported: () => true,
    getTranslator: () => createI18n('en'),
    buildSessionMeta: () => ({}),
    messageResponse: (lines: string[]) => {
      if (lines[0] === 'applied') {
        return confirmedResponse;
      }
      if (lines[0] === 'draft') {
        return draftResponse;
      }
      return cancelledResponse;
    },
    renderList: () => 'response:list',
    show: async () => 'response:show',
    complete: async () => 'response:complete',
    archive: async () => 'response:archive',
    cancelRecord: async () => 'response:cancel-record',
    editPending: async () => 'response:edit',
    natural: async () => 'response:natural',
    rejectMutation: async () => {
      calls.push('reject-active');
      return rejection === null ? null : activeResponse;
    },
    applyUpdateDraft: () => {
      calls.push('apply-update');
      return appliedRecord;
    },
    renderUpdateDraft: () => {
      calls.push('render-draft');
      return ['draft'];
    },
    renderUpdateApplied: () => {
      calls.push('render-applied');
      return ['applied'];
    },
    renderNoPending: async () => {
      calls.push('render-no-pending');
      return noPendingResponse;
    },
  };
  return {
    activeResponse,
    calls,
    cancelledResponse,
    confirmedResponse,
    draft,
    draftResponse,
    event,
    noPendingResponse,
    service: new AssistantRecordCommandService(dependencies),
  };
}

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

test('assistant record command router preserves explicit action aliases', async () => {
  const cases: Array<{
    action: string;
    args: unknown[];
    forcedType: AssistantRecordType | null;
    expectedName: string;
    expectedTail: unknown[];
  }> = [
    ...['list', 'ls', 'status'].map((action) => ({
      action,
      args: [action],
      forcedType: null,
      expectedName: 'renderList',
      expectedTail: ['todo', undefined],
    })),
    {
      action: 'search',
      args: ['search', 'alpha', 'beta'],
      forcedType: 'note',
      expectedName: 'renderList',
      expectedTail: ['note', 'alpha beta'],
    },
    {
      action: 'show',
      args: ['show', '2'],
      forcedType: 'note',
      expectedName: 'show',
      expectedTail: [['2'], 'note'],
    },
    ...['done', 'complete'].map((action) => ({
      action,
      args: [action, '3'],
      forcedType: 'todo' as const,
      expectedName: 'complete',
      expectedTail: [['3'], 'todo'],
    })),
    ...['del', 'delete', 'archive'].map((action) => ({
      action,
      args: [action, '4'],
      forcedType: 'log' as const,
      expectedName: 'archive',
      expectedTail: [['4'], 'log'],
    })),
    ...['ok', 'confirm'].map((action) => ({
      action,
      args: [action],
      forcedType: null,
      expectedName: 'renderNoPending',
      expectedTail: [null, 'confirm'],
    })),
    {
      action: 'cancel record',
      args: ['cancel', '5'],
      forcedType: 'reminder',
      expectedName: 'cancelRecord',
      expectedTail: [['5'], 'reminder'],
    },
    {
      action: 'cancel pending',
      args: ['cancel'],
      forcedType: 'reminder',
      expectedName: 'renderNoPending',
      expectedTail: ['reminder', 'cancel'],
    },
    {
      action: 'edit',
      args: ['edit', 'move', 'it'],
      forcedType: 'note',
      expectedName: 'editPending',
      expectedTail: [['move', 'it'], 'note'],
    },
  ];

  for (const current of cases) {
    const { calls, event, service } = createCommandHarness();
    const response = await service.handle(event, current.args, current.forcedType);

    assert.equal(response, `response:${current.expectedName}`, current.action);
    assert.equal(calls.length, 1, current.action);
    assert.equal(calls[0].name, current.expectedName, current.action);
    assert.equal(calls[0].args[0], event, current.action);
    assert.deepEqual(calls[0].args.slice(1), current.expectedTail, current.action);
  }
});

test('assistant record command router preserves unsupported, usage, and fallback branches', async () => {
  {
    const { calls, event, service } = createCommandHarness({ supported: false });
    const response = await service.handle(event, ['list']);
    assert.equal(response, 'response:messageResponse');
    assert.deepEqual(calls, [{
      name: 'messageResponse',
      args: [
        [createI18n('en').t('coordinator.assistant.unsupported')],
        { scope: event.externalScopeId },
      ],
    }]);
  }

  {
    const { calls, event, service } = createCommandHarness();
    const response = await service.handle(event, ['search'], 'note');
    assert.equal(response, 'response:messageResponse');
    assert.deepEqual(calls, [{
      name: 'messageResponse',
      args: [
        [createI18n('en').t('coordinator.assistant.searchUsage', { command: '/note' })],
        { scope: event.externalScopeId },
      ],
    }]);
  }

  const cases: Array<{
    name: string;
    args: unknown[];
    forcedType: AssistantRecordType | null;
    expectedName: string;
    expectedTail: unknown[];
  }> = [
    {
      name: 'empty unified command',
      args: [],
      forcedType: null,
      expectedName: 'renderList',
      expectedTail: ['todo', undefined],
    },
    {
      name: 'local typed list query',
      args: ['查看笔记'],
      forcedType: null,
      expectedName: 'renderList',
      expectedTail: ['note', undefined],
    },
    {
      name: 'create prefix',
      args: ['新增待办', '检查服务器'],
      forcedType: null,
      expectedName: 'natural',
      expectedTail: ['新增待办 检查服务器', null],
    },
    {
      name: 'natural fallback',
      args: ['把发票事项改成明天完成'],
      forcedType: 'todo',
      expectedName: 'natural',
      expectedTail: ['把发票事项改成明天完成', 'todo'],
    },
  ];

  for (const current of cases) {
    const { calls, event, service } = createCommandHarness();
    const response = await service.handle(event, current.args, current.forcedType);
    assert.equal(response, `response:${current.expectedName}`, current.name);
    assert.equal(calls.length, 1, current.name);
    assert.equal(calls[0].name, current.expectedName, current.name);
    assert.equal(calls[0].args[0], event, current.name);
    assert.deepEqual(calls[0].args.slice(1), current.expectedTail, current.name);
  }
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

test('assistant record terminal confirmation applies an update draft after the active-turn check', async () => {
  const { calls, confirmedResponse, draft, event, service } = createTerminalHarness();
  service.setPendingUpdateDraft(event, draft);

  assert.deepEqual(await service.handle(event, ['ok'], null), confirmedResponse);
  assert.deepEqual(calls, ['reject-active', 'apply-update', 'render-applied']);
  assert.equal(service.getPendingUpdateDraft(event), null);
});

test('assistant record terminal confirmation renders no pending response for absent or mismatched drafts', async () => {
  const noPending = createTerminalHarness();
  assert.equal(await noPending.service.handle(noPending.event, ['ok'], null), noPending.noPendingResponse);
  assert.deepEqual(noPending.calls, ['reject-active', 'render-no-pending']);

  const mismatched = createTerminalHarness();
  mismatched.service.setPendingUpdateDraft(mismatched.event, mismatched.draft);
  assert.equal(await mismatched.service.handle(mismatched.event, ['ok'], 'note'), mismatched.noPendingResponse);
  assert.deepEqual(mismatched.calls, ['reject-active', 'render-no-pending']);
  assert.equal(mismatched.service.getPendingUpdateDraft(mismatched.event), mismatched.draft);
});

test('assistant record terminal confirmation retains a draft when a mutation is rejected or cannot apply', async () => {
  const rejected = createTerminalHarness({ rejection: 'active turn' });
  rejected.service.setPendingUpdateDraft(rejected.event, rejected.draft);
  assert.equal(await rejected.service.handle(rejected.event, ['ok'], null), rejected.activeResponse);
  assert.deepEqual(rejected.calls, ['reject-active']);
  assert.equal(rejected.service.getPendingUpdateDraft(rejected.event), rejected.draft);

  const failed = createTerminalHarness({ appliedRecord: null });
  failed.service.setPendingUpdateDraft(failed.event, failed.draft);
  assert.equal(await failed.service.handle(failed.event, ['ok'], null), failed.draftResponse);
  assert.deepEqual(failed.calls, ['reject-active', 'apply-update', 'render-draft']);
  assert.equal(failed.service.getPendingUpdateDraft(failed.event), failed.draft);
});

test('assistant record terminal cancellation clears only the current scope after the active-turn check', async () => {
  const { calls, cancelledResponse, draft, event, service } = createTerminalHarness();
  const otherScope = { ...event, externalScopeId: 'assistant-terminal-other-scope' };
  service.setPendingUpdateDraft(event, draft);
  service.setPendingUpdateDraft(otherScope, { ...draft, targetRecordId: 'record-2' });

  assert.equal(await service.handle(event, ['cancel'], null), cancelledResponse);
  assert.deepEqual(calls, ['reject-active']);
  assert.equal(service.getPendingUpdateDraft(event), null);
  assert.equal(service.getPendingUpdateDraft(otherScope)?.targetRecordId, 'record-2');
});
