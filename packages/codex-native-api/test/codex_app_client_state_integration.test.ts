import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

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
