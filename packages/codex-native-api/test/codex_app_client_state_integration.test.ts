import assert from 'node:assert/strict';
import fs from 'node:fs';
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
