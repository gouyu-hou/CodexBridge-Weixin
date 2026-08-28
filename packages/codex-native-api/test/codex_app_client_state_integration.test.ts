import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CodexAppClient } from '../src/codex_app_client.js';

function emitCommandApproval(client: CodexAppClient, id: string | number): void {
  client.handleMessage(JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'item/commandExecution/requestApproval',
    params: {
      threadId: 'thread-approval',
      turnId: 'turn-approval',
      itemId: `item-${id}`,
      reason: 'run the verification command',
      command: 'npm test',
      cwd: '/workspace',
      availableDecisions: ['accept', 'acceptForSession', 'decline'],
      proposedExecpolicyAmendment: [],
      additionalPermissions: {
        network: { enabled: false },
        fileSystem: { read: [], write: [] },
      },
    },
  }));
}

function setNativeTurnRead(
  client: CodexAppClient,
  turn: Record<string, unknown>,
  sessionPath: string | null = null,
): void {
  client.readThread = async () => ({
    title: 'Native lifecycle test',
    path: sessionPath,
    turns: [turn],
  } as any);
}

function seedApprovedExecution(client: CodexAppClient, threadId: string, turnId: string): void {
  client.approvedExecutions.set('approved-execution', {
    requestId: 'approved-execution',
    kind: 'command',
    threadId,
    turnId,
    itemId: 'item-approved-execution',
    command: 'npm test',
    approvedAt: 0,
    lastSignalAt: 0,
    lastSignalKind: 'approval_response_sent',
    signalCount: 0,
    completedAt: null,
    lastObservedTurnSnapshotKey: null,
  });
}

async function waitForNativeTurn(client: CodexAppClient, timeoutMs = 2_500) {
  return client.waitForTurnResult({
    threadId: 'thread-lifecycle',
    turnId: 'turn-lifecycle',
    timeoutMs,
  });
}

test('both AppClient implementations delegate approval storage to the shared registry', () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const appClients = [
    path.join(repositoryRoot, 'src', 'providers', 'codex', 'app_client.ts'),
    path.join(repositoryRoot, 'packages', 'codex-native-api', 'src', 'codex_app_client.ts'),
  ];

  for (const appClient of appClients) {
    const source = fs.readFileSync(appClient, 'utf8');
    assert.match(source, /import \{ CodexAppApprovalState \} from ['"][^'"]*codex_app_approval_state\.js['"];/u);
    assert.match(source, /approvalState: CodexAppApprovalState;/u);
    assert.match(source, /this\.approvalState = new CodexAppApprovalState\(\{ now: this\.turnPollNow \}\);/u);
    assert.match(source, /this\.approvalState\.set\(pendingApproval\);/u);
    assert.match(source, /return this\.approvalState\.list\(\{ threadId, turnId \}\);/u);
    assert.match(source, /this\.approvalState\.prepare\(requestId, option\);/u);
    assert.match(source, /this\.approvalState\.remove\(requestId\);/u);
    assert.match(source, /this\.approvalState\.clear\(\);/u);
    assert.doesNotMatch(source, /pendingApprovals/u);

    const sendIndex = source.indexOf('this.send({', source.indexOf('async respondToApproval'));
    const removeIndex = source.indexOf('this.approvalState.remove(requestId);', sendIndex);
    assert.notEqual(sendIndex, -1);
    assert.notEqual(removeIndex, -1);
    assert.ok(sendIndex < removeIndex, `${appClient} must send an approval response before removing it`);
  }
});

test('both AppClient implementations delegate terminal lifecycle decisions to the shared helper', () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const appClients = [
    path.join(repositoryRoot, 'src', 'providers', 'codex', 'app_client.ts'),
    path.join(repositoryRoot, 'packages', 'codex-native-api', 'src', 'codex_app_client.ts'),
  ];

  for (const appClient of appClients) {
    const source = fs.readFileSync(appClient, 'utf8');
    assert.match(source, /import \{ decideCodexTurnLifecycle \} from ['"][^'"]*codex_app_turn_lifecycle\.js['"];/u);
    assert.match(source, /decideCodexTurnLifecycle\(\{/u);
  }
});

test('Native CodexAppClient preserves numeric JSON-RPC approval response ids', async () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  const sent: any[] = [];
  client.send = (payload: any) => {
    sent.push(payload);
  };

  emitCommandApproval(client, 0);
  await client.respondToApproval({ requestId: '0', option: 1 });

  assert.deepEqual(sent, [{
    jsonrpc: '2.0',
    id: 0,
    result: { decision: 'accept' },
  }]);
});

test('Native CodexAppClient stores a pending approval before emitting its event', () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  let pendingRequestIdsAtEvent: string[] | null = null;
  client.on('approval_request', () => {
    pendingRequestIdsAtEvent = client.getPendingApprovals().map((request) => request.requestId);
  });

  emitCommandApproval(client, 'approval-event-order');

  assert.deepEqual(pendingRequestIdsAtEvent, ['approval-event-order']);
});

test('Native CodexAppClient retains failed approvals and records successful retries', async () => {
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => 42,
  });
  client.send = () => {
    throw new Error('transport unavailable');
  };
  emitCommandApproval(client, 'approval-retry');

  await assert.rejects(
    client.respondToApproval({ requestId: 'approval-retry', option: 1 }),
    /transport unavailable/u,
  );
  assert.deepEqual(
    client.getPendingApprovals().map((request) => request.requestId),
    ['approval-retry'],
  );
  assert.equal(client.approvedExecutions.size, 0);

  client.send = () => {};
  await client.respondToApproval({ requestId: 'approval-retry', option: 1 });

  assert.deepEqual(client.getPendingApprovals(), []);
  assert.deepEqual(client.approvedExecutions.get('approval-retry'), {
    requestId: 'approval-retry',
    kind: 'command',
    threadId: 'thread-approval',
    turnId: 'turn-approval',
    itemId: 'item-approval-retry',
    command: 'npm test',
    approvedAt: 42,
    lastSignalAt: 42,
    lastSignalKind: 'approval_response_sent',
    signalCount: 0,
    completedAt: null,
    lastObservedTurnSnapshotKey: null,
  });
});

test('Native CodexAppClient stop clears pending approvals and approved executions', async () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  client.send = () => {};
  emitCommandApproval(client, 'approval-accepted');
  await client.respondToApproval({ requestId: 'approval-accepted', option: 1 });
  emitCommandApproval(client, 'approval-pending');

  assert.equal(client.getPendingApprovals().length, 1);
  assert.equal(client.approvedExecutions.size, 1);

  await client.stop();

  assert.deepEqual(client.getPendingApprovals(), []);
  assert.equal(client.approvedExecutions.size, 0);
});

test('Native CodexAppClient selects terminal text before media and clears turn listeners', async (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-native-lifecycle-output-'));
  const imagePath = path.join(outputDir, 'result.png');
  fs.writeFileSync(imagePath, 'png', 'utf8');
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  const textClient = new CodexAppClient({ codexCliBin: 'codex' });
  setNativeTurnRead(textClient, {
    id: 'turn-lifecycle',
    status: 'completed',
    items: [{
      type: 'message',
      role: 'assistant',
      phase: 'final_answer',
      text: 'native final text',
    }, {
      type: 'imageGeneration',
      savedPath: imagePath,
    }],
  });
  const textResult = await waitForNativeTurn(textClient);
  assert.equal(textResult.outputText, 'native final text');
  assert.equal(textResult.outputState, 'complete');
  assert.equal(textResult.finalSource, 'thread_items');

  const mediaClient = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => 0,
  });
  const notificationListeners = mediaClient.listenerCount('notification');
  const approvalListeners = mediaClient.listenerCount('approval_request');
  seedApprovedExecution(mediaClient, 'thread-lifecycle', 'turn-lifecycle');
  setNativeTurnRead(mediaClient, {
    id: 'turn-lifecycle',
    status: 'completed',
    items: [{
      type: 'imageGeneration',
      savedPath: imagePath,
    }],
  });
  const mediaResult = await waitForNativeTurn(mediaClient);
  assert.equal(mediaResult.outputText, '');
  assert.equal(mediaResult.outputState, 'complete');
  assert.equal(mediaResult.finalSource, 'thread_items_media');
  assert.deepEqual(mediaResult.outputMedia?.map((artifact) => artifact.path), [imagePath]);
  assert.equal(mediaClient.listenerCount('notification'), notificationListeners);
  assert.equal(mediaClient.listenerCount('approval_request'), approvalListeners);
  assert.equal(mediaClient.approvedExecutions.size, 0);
});

test('Native CodexAppClient preserves interrupted terminal outcomes', async () => {
  const client = new CodexAppClient({ codexCliBin: 'codex' });
  setNativeTurnRead(client, {
    id: 'turn-lifecycle',
    status: 'interrupted',
    error: 'Conversation interrupted',
    items: [{
      type: 'message',
      role: 'assistant',
      phase: 'commentary',
      text: 'still working',
    }],
  });

  const result = await waitForNativeTurn(client);
  assert.equal(result.outputState, 'interrupted');
  assert.equal(result.previewText, '');
  assert.equal(result.finalSource, 'none');
});

test('Native CodexAppClient prefers terminal preview text to a session provider error', async (t) => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-native-lifecycle-preview-error-'));
  const sessionPath = path.join(sessionDir, 'rollout.jsonl');
  fs.writeFileSync(sessionPath, [
    JSON.stringify({
      type: 'turn_context',
      payload: { turn_id: 'turn-lifecycle' },
    }),
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: {
          limit_id: 'premium',
          credits: { has_credits: false, unlimited: false, balance: '0' },
          plan_type: 'plus',
          rate_limit_reached_type: null,
        },
      },
    }),
    JSON.stringify({
      type: 'event_msg',
      payload: { type: 'task_complete', turn_id: 'turn-lifecycle', last_agent_message: null },
    }),
  ].join('\n') + '\n', 'utf8');
  t.after(() => fs.rmSync(sessionDir, { recursive: true, force: true }));

  const client = new CodexAppClient({ codexCliBin: 'codex' });
  setNativeTurnRead(client, {
    id: 'turn-lifecycle',
    status: 'completed',
    items: [{
      type: 'message',
      role: 'assistant',
      phase: 'commentary',
      text: 'native preview survives',
    }],
  }, sessionPath);

  const result = await waitForNativeTurn(client);
  assert.equal(result.outputState, 'partial');
  assert.equal(result.previewText, 'native preview survives');
  assert.equal(result.finalSource, 'session_task_complete_empty');
});

test('Native CodexAppClient returns missing after task_complete and waits for missing task completion', async (t) => {
  const completeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-native-lifecycle-missing-'));
  const completePath = path.join(completeDir, 'rollout.jsonl');
  fs.writeFileSync(completePath, `${JSON.stringify({
    type: 'event_msg',
    payload: { type: 'task_complete', turn_id: 'turn-lifecycle', last_agent_message: null },
  })}\n`, 'utf8');
  const waitingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-native-lifecycle-wait-'));
  const waitingPath = path.join(waitingDir, 'rollout.jsonl');
  fs.writeFileSync(waitingPath, '', 'utf8');
  t.after(() => {
    fs.rmSync(completeDir, { recursive: true, force: true });
    fs.rmSync(waitingDir, { recursive: true, force: true });
  });

  const missingClient = new CodexAppClient({ codexCliBin: 'codex' });
  setNativeTurnRead(missingClient, {
    id: 'turn-lifecycle',
    status: 'completed',
    items: [{ type: 'userMessage', text: 'hello' }],
  }, completePath);
  const missingResult = await waitForNativeTurn(missingClient);
  assert.equal(missingResult.outputState, 'missing');
  assert.equal(missingResult.finalSource, 'session_task_complete_empty');

  let nowMs = 0;
  let sleepCount = 0;
  const waitingClient = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => nowMs,
    turnPollSleep: async (ms) => {
      nowMs += ms;
      sleepCount += 1;
    },
  });
  seedApprovedExecution(waitingClient, 'thread-lifecycle', 'turn-lifecycle');
  setNativeTurnRead(waitingClient, {
    id: 'turn-lifecycle',
    status: 'completed',
    items: [{ type: 'userMessage', text: 'hello' }],
  }, waitingPath);
  await assert.rejects(waitForNativeTurn(waitingClient), /Timed out waiting for Codex turn turn-lifecycle/u);
  assert.ok(sleepCount >= 2);
  assert.equal(waitingClient.listenerCount('notification'), 0);
  assert.equal(waitingClient.listenerCount('approval_request'), 0);
  assert.equal(waitingClient.approvedExecutions.size, 0);
});
