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
  extractTurnOutputText,
  isAssistantVisibleItem,
  isUserVisibleItem,
  resolveTurnPreviewText,
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
    'extractTurnCommentaryText',
    'extractTurnOutputText',
    'isAssistantVisibleItem',
    'isUserVisibleItem',
    'resolveTurnPreviewText',
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
