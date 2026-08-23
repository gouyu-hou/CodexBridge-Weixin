import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WeixinAccountStore } from '../../../src/platforms/weixin/account_store.js';
import { WeixinAdminBackupService } from '../../../src/platforms/weixin/admin_backup_service.js';
import {
  _resetContextTokenStoreForTest,
  getContextToken as getOfficialContextToken,
  setContextToken as setOfficialContextToken,
} from '../../../src/platforms/weixin/official/context_tokens.js';
import { createFileJsonRepositories } from '../../../src/store/file_json/create_file_json_repositories.js';

function makeTempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-weixin-backup-service-'));
}

function makeService({
  stateDir = makeTempStateDir(),
  accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') }),
  repositories = createFileJsonRepositories(path.join(stateDir, 'runtime')),
  env = {},
}: {
  stateDir?: string;
  accountStore?: WeixinAccountStore;
  repositories?: ReturnType<typeof createFileJsonRepositories>;
  env?: Record<string, string>;
} = {}) {
  return {
    stateDir,
    accountStore,
    repositories,
    env,
    service: new WeixinAdminBackupService({
      accountStore,
      stateDir,
      repositories,
      env,
      getState: () => ({ bridge: { running: false, deliveryOutbox: { pending: 1 } } }),
      getSessionSummaries: () => [{ id: 'summary-1', updatedAt: 1 }],
      getLogs: () => ({ text: 'backup log', files: [] }),
      getAdminUrl: () => 'http://127.0.0.1:43183',
    }),
  };
}

function validBackup(overrides: Record<string, unknown> = {}) {
  return {
    accounts: [],
    runtime: {},
    ...overrides,
  };
}

test('WeixinAdminBackupService validates the complete backup before creating a restore point or mutating accounts', () => {
  const { service, accountStore, stateDir } = makeService();
  accountStore.saveAccount({ accountId: 'original', token: 'original-token', baseUrl: 'https://original.example', userId: 'u1' });

  const result = service.importBackup(validBackup({
    accounts: [
      { accountId: 'valid', token: 'valid-token', base_url: 'https://valid.example' },
      { accountId: '../../outside', token: 'bad-token', base_url: 'https://bad.example' },
    ],
  }));

  assert.equal(result.status, 400);
  assert.equal(accountStore.loadAccount('valid'), null);
  assert.equal(accountStore.loadAccount('original')?.token, 'original-token');
  assert.equal(fs.existsSync(path.join(stateDir, 'backups')), false);
});

test('WeixinAdminBackupService rejects duplicate account ids without regard to case', () => {
  const { service } = makeService();

  const validation = service.validateImport(validBackup({
    accounts: [
      { accountId: 'Bot-Duplicate', token: 'one', base_url: 'https://one.example' },
      { accountId: 'bot-duplicate', token: 'two', base_url: 'https://two.example' },
    ],
  }));

  assert.equal(validation.errors.length, 1);
  assert.match(validation.errors[0] ?? '', /duplicates bot-duplicate/u);
});

test('WeixinAdminBackupService rejects non-http account and provider URLs', () => {
  const { service } = makeService();

  const validation = service.validateImport(validBackup({
    accounts: [{ accountId: 'bot-file', token: 'token', base_url: 'file:///etc/passwd' }],
    configuration: { serviceEnv: { CODEX_COMPAT_BASE_URL: 'ssh://provider.example' } },
  }));

  assert.deepEqual(validation.errors, [
    'accounts[0].base_url must be an http(s) URL',
    'configuration.serviceEnv.CODEX_COMPAT_BASE_URL must be an http(s) URL',
  ]);
});

test('WeixinAdminBackupService creates a pre-import restore point from the current backup', () => {
  const { service, accountStore, stateDir } = makeService();
  accountStore.saveAccount({ accountId: 'original', token: 'original-token', baseUrl: 'https://original.example', userId: 'u1' });

  const result = service.importBackup(validBackup());

  assert.equal(result.status, 200);
  const restorePoint = (result.body as { restorePoint: string }).restorePoint;
  assert.match(path.basename(restorePoint), /^pre-import-.+\.json$/u);
  assert.equal(JSON.parse(fs.readFileSync(restorePoint, 'utf8')).accounts[0].token, 'original-token');
  assert.equal(fs.existsSync(path.join(stateDir, 'backups')), true);
});

test('WeixinAdminBackupService imports records and permitted service environment values', () => {
  const stateDir = makeTempStateDir();
  const serviceEnvFile = path.join(stateDir, 'service.env');
  const env = { CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE: serviceEnvFile, CODEX_COMPAT_API_KEY: 'old-key' };
  const { service, accountStore, repositories } = makeService({ stateDir, env });

  const result = service.importBackup(validBackup({
    accounts: [{
      accountId: 'imported',
      token: 'imported-token',
      base_url: 'https://imported.example',
      context_tokens: { peer: 'context-token' },
      sync_cursor: 'cursor',
    }],
    configuration: { serviceEnv: { CODEX_COMPAT_API_KEY: 'new-key' } },
    runtime: {
      providerProfiles: [{ id: 'profile-1', providerKind: 'openai-compatible', name: 'Imported profile' }],
      bridgeSessions: [{ id: 'session-1', providerProfileId: 'profile-1', codexThreadId: 'thread-1', cwd: 'C:/tmp', createdAt: 1, updatedAt: 2 }],
    },
  }));

  assert.equal(result.status, 200);
  assert.equal(accountStore.loadAccount('imported')?.token, 'imported-token');
  assert.equal(accountStore.getContextToken('imported', 'peer'), 'context-token');
  assert.equal(accountStore.loadSyncCursor('imported'), 'cursor');
  assert.equal(repositories.providerProfiles.list()[0]?.id, 'profile-1');
  assert.equal(repositories.bridgeSessions.list()[0]?.id, 'session-1');
  assert.equal(env.CODEX_COMPAT_API_KEY, 'new-key');
  assert.match(fs.readFileSync(serviceEnvFile, 'utf8'), /CODEX_COMPAT_API_KEY=new-key/u);
});

test('WeixinAdminBackupService rolls back account and repository mutations after a mid-transaction failure', () => {
  const stateDir = makeTempStateDir();
  const { service, accountStore, repositories } = makeService({ stateDir });
  _resetContextTokenStoreForTest();
  accountStore.saveAccount({ accountId: 'original', token: 'original-token', baseUrl: 'https://original.example', userId: 'u1' });
  setOfficialContextToken(accountStore.rootDir, 'original', 'peer', 'old-context');
  repositories.providerProfiles.save({ id: 'original-profile', providerKind: 'openai-compatible' } as any);
  (repositories.bridgeSessions as any).save = () => {
    throw new Error('repository failed with secret-token');
  };

  try {
    const result = service.importBackup(validBackup({
      accounts: [
        { accountId: 'original', token: 'changed-token', base_url: 'https://changed.example', context_tokens: { peer: 'new-context' } },
        { accountId: 'new-account', token: 'new-token', base_url: 'https://new.example' },
      ],
      runtime: {
        providerProfiles: [{ id: 'new-profile', providerKind: 'openai-compatible' }],
        bridgeSessions: [{ id: 'failing-session', providerProfileId: 'new-profile', codexThreadId: 'thread-1', cwd: 'C:/tmp', createdAt: 1, updatedAt: 2 }],
      },
    }));

    assert.equal(result.status, 409);
    assert.equal(accountStore.loadAccount('new-account'), null);
    assert.equal(accountStore.loadAccount('original')?.token, 'original-token');
    assert.equal(getOfficialContextToken(accountStore.rootDir, 'original', 'peer'), 'old-context');
    assert.deepEqual(repositories.providerProfiles.list().map((profile: any) => profile.id), ['original-profile']);
  } finally {
    _resetContextTokenStoreForTest();
  }
});

test('WeixinAdminBackupService sanitizes failed transaction errors', () => {
  const { service, repositories } = makeService();
  (repositories.bridgeSessions as any).save = () => {
    throw new Error('repository failed with secret-token and C:/private/path');
  };

  const result = service.importBackup(validBackup({
    runtime: {
      bridgeSessions: [{ id: 'failing-session', providerProfileId: 'profile-1', codexThreadId: 'thread-1', cwd: 'C:/tmp', createdAt: 1, updatedAt: 2 }],
    },
  }));
  const body = JSON.stringify(result.body);

  assert.equal(result.status, 409);
  assert.doesNotMatch(body, /secret-token|private\/path|repository failed/u);
  assert.equal((result.body as { detail: string }).detail, 'backup import failed');
});
