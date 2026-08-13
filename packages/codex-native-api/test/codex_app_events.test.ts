import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  buildTurnSnapshotKey,
  classifyTurnCompletionState,
  classifyAgentOutput,
  extractTurnCommentaryText,
  extractItemId,
  extractNotificationTurnId,
  extractProgressUpdate,
  extractSessionErrorMessage,
  extractTurnOutputText,
  describeSessionRateLimitError,
  findSessionRuntimeErrorForTurn,
  hasUnsettledAssistantActivity,
  isAssistantVisibleItem,
  isUserVisibleItem,
  resolveTurnPreviewText,
  shouldWaitForSessionTaskMaterialization,
  shouldWaitForSettledOutputAfterTerminalTurn,
  shouldWaitForTaskCompleteBeforeMissing,
} from '../src/codex_app_events.js';

test('event helpers normalize turn ids, phases, and visible message roles', () => {
  assert.equal(extractNotificationTurnId({ turnId: 'direct' }), 'direct');
  assert.equal(extractNotificationTurnId({ item: { turnId: 'nested' } }), 'nested');
  assert.equal(extractNotificationTurnId({ event: { turnId: 'event' } }), 'event');
  assert.equal(extractNotificationTurnId({}), null);
  assert.equal(extractItemId({ item_id: 'snake' }), 'snake');
  assert.equal(extractItemId({ item: { id: 42 } }), '42');

  assert.equal(classifyAgentOutput(null, false), 'commentary');
  assert.equal(classifyAgentOutput(null, true), 'final_answer');
  assert.equal(classifyAgentOutput('final-answer', false), 'final_answer');
  assert.equal(classifyAgentOutput('analysis', true), 'commentary');

  assert.equal(isAssistantVisibleItem({ type: 'agentMessage' }), true);
  assert.equal(isAssistantVisibleItem({ type: 'message', role: 'assistant' }), true);
  assert.equal(isAssistantVisibleItem({ type: 'message', role: 'user' }), false);
  assert.equal(isUserVisibleItem({ type: 'userMessage' }), true);
  assert.equal(isUserVisibleItem({ type: 'message', role: 'user' }), true);
});

test('extractProgressUpdate tracks item output kinds and appends deltas', () => {
  const itemOutputKinds = new Map();
  const progressState = {
    commentaryText: '',
    finalAnswerText: '',
    sawAssistantActivity: false,
    lastAssistantActivityAt: 0,
  };

  assert.equal(extractProgressUpdate({
    method: 'item/started',
    params: {
      turnId: 'turn-1',
      item: { id: 'commentary-1', phase: 'analysis', type: 'agentMessage' },
    },
  }, 'turn-1', itemOutputKinds, progressState), null);
  assert.equal(itemOutputKinds.get('commentary-1'), 'commentary');

  assert.deepEqual(extractProgressUpdate({
    method: 'item/agentMessage/delta',
    params: { turnId: 'turn-1', itemId: 'commentary-1', delta: 'working' },
  }, 'turn-1', itemOutputKinds, progressState), {
    text: 'working',
    delta: 'working',
    outputKind: 'commentary',
  });

  assert.deepEqual(extractProgressUpdate({
    method: 'item/completed',
    params: {
      turnId: 'turn-1',
      item: { id: 'answer-1', phase: 'final_answer', text: 'done', type: 'agentMessage' },
    },
  }, 'turn-1', itemOutputKinds, progressState), {
    text: 'done',
    delta: 'done',
    outputKind: 'final_answer',
  });

  assert.deepEqual(extractProgressUpdate({
    method: 'item/completed',
    params: {
      turnId: 'turn-1',
      item: { id: 'answer-2', phase: 'final_answer', text: 42, type: 'agentMessage' },
    },
  }, 'turn-1', itemOutputKinds, progressState), {
    text: '42',
    delta: '42',
    outputKind: 'final_answer',
  });

  assert.equal(extractProgressUpdate({
    method: 'item/agentMessage/delta',
    params: { turnId: 'other-turn', delta: 'ignored' },
  }, 'turn-1', itemOutputKinds, progressState), null);
});

test('buildTurnSnapshotKey captures only state used for settle detection', () => {
  assert.equal(buildTurnSnapshotKey({
    id: 'ignored',
    status: 'running',
    error: null,
    items: [{ id: 'ignored-item', type: 'agentMessage', role: 'assistant', phase: 'analysis', text: 'x' }],
  }), JSON.stringify({
    status: 'running',
    error: '',
    items: [{ type: 'agentMessage', role: 'assistant', phase: 'analysis', text: 'x' }],
  }));
});

test('turn output helpers separate final answers, commentary, and interruption state', () => {
  const turn = {
    status: 'completed',
    items: [
      { type: 'userMessage', text: 'question' },
      { type: 'agentMessage', phase: 'analysis', text: 'working' },
      { type: 'message', role: 'assistant', phase: 'final_answer', text: 'done' },
      { type: 'agentMessage', phase: 'final', text: 'more' },
      { type: 'agentMessage', phase: 'final', text: 42 },
    ],
  };

  assert.equal(extractTurnOutputText(turn), 'done\n\nmore\n\n42');
  assert.equal(extractTurnCommentaryText(turn), 'working');
  assert.equal(resolveTurnPreviewText(turn, {}), 'working');
  assert.equal(resolveTurnPreviewText(turn, { commentaryText: 'streaming' }), 'streaming');
  assert.equal(resolveTurnPreviewText(turn, {
    commentaryText: 'streaming',
    finalAnswerText: 'final stream',
  }), 'final stream');
  assert.equal(classifyTurnCompletionState({}), 'unknown');
  assert.equal(classifyTurnCompletionState({ status: 'cancelled' }), 'interrupted');
  assert.equal(classifyTurnCompletionState({ error: 'stopped by user' }), 'interrupted');
  assert.equal(classifyTurnCompletionState({ error: '用户中断' }), 'interrupted');
  assert.equal(classifyTurnCompletionState(turn), 'other');
});

test('turn settle helpers preserve session materialization and assistant activity decisions', () => {
  const emptyProgress = {};
  const userOnlyTurn = { items: [{ type: 'userMessage', text: 'question' }] };
  const commentaryTurn = {
    items: [{ type: 'agentMessage', phase: 'analysis', text: 'working' }],
  };
  const finalTurn = {
    items: [{ type: 'agentMessage', phase: 'final_answer', text: 'done' }],
  };
  const unrelatedVisibleTurn = {
    items: [{ type: 'toolResult', text: 'tool output' }],
  };

  assert.equal(shouldWaitForSettledOutputAfterTerminalTurn({ items: [] }, emptyProgress), true);
  assert.equal(shouldWaitForSettledOutputAfterTerminalTurn(userOnlyTurn, emptyProgress), true);
  assert.equal(shouldWaitForSettledOutputAfterTerminalTurn(commentaryTurn, emptyProgress), true);
  assert.equal(shouldWaitForSettledOutputAfterTerminalTurn(finalTurn, emptyProgress), false);
  assert.equal(shouldWaitForSettledOutputAfterTerminalTurn(unrelatedVisibleTurn, emptyProgress), false);
  assert.equal(shouldWaitForSettledOutputAfterTerminalTurn(finalTurn, {
    finalAnswerText: 'streamed final',
  }), true);

  assert.equal(hasUnsettledAssistantActivity(finalTurn, emptyProgress), false);
  assert.equal(hasUnsettledAssistantActivity(commentaryTurn, emptyProgress), true);
  assert.equal(hasUnsettledAssistantActivity({ items: [] }, { commentaryText: 'streaming' }), true);
  assert.equal(hasUnsettledAssistantActivity({ items: [] }, { sawAssistantActivity: true }), true);

  const completedWithoutMaterializedOutput = {
    hasTaskComplete: true,
    lastAgentMessage: null,
    outputArtifacts: [],
  };
  assert.equal(shouldWaitForSessionTaskMaterialization(
    completedWithoutMaterializedOutput,
    false,
  ), true);
  assert.equal(shouldWaitForSessionTaskMaterialization(
    { ...completedWithoutMaterializedOutput, lastAgentMessage: 'done' },
    false,
  ), false);
  assert.equal(shouldWaitForSessionTaskMaterialization(
    { ...completedWithoutMaterializedOutput, outputArtifacts: [{ path: 'result.md' }] },
    false,
  ), false);
  assert.equal(shouldWaitForSessionTaskMaterialization(
    completedWithoutMaterializedOutput,
    true,
  ), false);
  assert.equal(shouldWaitForTaskCompleteBeforeMissing(' C:\\session.jsonl ', {
    hasTaskComplete: false,
  }), true);
  assert.equal(shouldWaitForTaskCompleteBeforeMissing('', { hasTaskComplete: false }), false);
  assert.equal(shouldWaitForTaskCompleteBeforeMissing('session.jsonl', {
    hasTaskComplete: true,
  }), false);
});

test('session error helpers normalize runtime failures and rate limit shapes', () => {
  assert.equal(extractSessionErrorMessage({ type: 'task_complete', message: 'done' }), null);
  assert.equal(extractSessionErrorMessage({ type: 'runtime_failed', message: 'request failed' }), 'request failed');
  assert.equal(extractSessionErrorMessage({
    type: 'response_error',
    error: { message: 'nested failure' },
  }), 'nested failure');

  assert.equal(describeSessionRateLimitError({
    limit_id: 'codex-paid',
    credits: { has_credits: 'false', unlimited: false, balance: ' 0 ' },
  }), 'Codex subscription credits are exhausted (codex-paid balance 0).');
  assert.equal(describeSessionRateLimitError({
    limitId: 'codex-weekly',
    rateLimitReachedType: 'weekly',
  }), 'Codex usage limit reached (codex-weekly: weekly).');
  assert.equal(describeSessionRateLimitError({ primary: { usedPercent: '100.4' } }),
    'Codex usage limit reached (codex primary 100%).');
  assert.equal(describeSessionRateLimitError({ secondary: { used_percent: 101 } }),
    'Codex usage limit reached (codex weekly 101%).');
  assert.equal(describeSessionRateLimitError({ primary: { used_percent: 99.9 } }), null);
  assert.equal(describeSessionRateLimitError(null), null);
});

test('findSessionRuntimeErrorForTurn scans only the requested turn', () => {
  const lines = [
    JSON.stringify({
      type: 'event_msg',
      payload: { type: 'response_error', message: 'previous turn failure' },
    }),
    JSON.stringify({
      type: 'event_msg',
      payload: { type: 'task_started', turn_id: 'turn-1' },
    }),
    'not json',
    JSON.stringify({ type: 'response_item', payload: { type: 'message', text: 'ignored' } }),
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rateLimits: { secondary: { usedPercent: 100 } },
      },
    }),
    JSON.stringify({
      type: 'event_msg',
      payload: { type: 'task_complete', turn_id: 'turn-1' },
    }),
  ];
  assert.equal(
    findSessionRuntimeErrorForTurn(lines, 5, 'turn-1'),
    'Codex usage limit reached (codex weekly 100%).',
  );

  const cleanTurnLines = [
    JSON.stringify({
      type: 'event_msg',
      payload: { type: 'response_error', message: 'must stay in previous turn' },
    }),
    JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn-2' } }),
    JSON.stringify({
      type: 'event_msg',
      payload: { type: 'task_complete', turn_id: 'turn-2' },
    }),
  ];
  assert.equal(findSessionRuntimeErrorForTurn(cleanTurnLines, 2, 'turn-2'), null);
});

test('both AppClient implementations delegate event mapping to the shared module', () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const appClients = [
    path.join(repositoryRoot, 'src', 'providers', 'codex', 'app_client.ts'),
    path.join(repositoryRoot, 'packages', 'codex-native-api', 'src', 'codex_app_client.ts'),
  ];
  const sharedFunctions = [
    'buildTurnSnapshotKey',
    'classifyAgentOutput',
    'classifyTurnCompletionState',
    'extractAgentPhase',
    'extractItemId',
    'extractNotificationTurnId',
    'extractProgressUpdate',
    'extractSessionErrorMessage',
    'extractTurnCommentaryText',
    'extractTurnOutputText',
    'describeSessionRateLimitError',
    'findSessionRuntimeErrorForTurn',
    'hasUnsettledAssistantActivity',
    'isAssistantVisibleItem',
    'isUserVisibleItem',
    'resolveTurnPreviewText',
    'shouldWaitForSessionTaskMaterialization',
    'shouldWaitForSettledOutputAfterTerminalTurn',
    'shouldWaitForTaskCompleteBeforeMissing',
  ];

  for (const appClientPath of appClients) {
    const source = fs.readFileSync(appClientPath, 'utf8');
    assert.match(source, /from ['"][^'"]*codex_app_events\.js['"]/u, appClientPath);
    assert.doesNotMatch(source, /interface ProgressState\s*\{/u, appClientPath);
    for (const functionName of sharedFunctions) {
      assert.doesNotMatch(
        source,
        new RegExp(`function\\s+${functionName}\\s*\\(`, 'u'),
        `${appClientPath}: ${functionName}`,
      );
    }
  }
});
