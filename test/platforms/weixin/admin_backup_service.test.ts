import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WeixinAccountStore } from '../../../src/platforms/weixin/account_store.js';
import {
  WeixinAdminBackupService,
  type WeixinAdminBackupRepositories,
} from '../../../src/platforms/weixin/admin_backup_service.js';
import { WeixinAdminServer } from '../../../src/platforms/weixin/admin_server.js';
import {
  _resetContextTokenStoreForTest,
  getContextToken as getOfficialContextToken,
  setContextToken as setOfficialContextToken,
} from '../../../src/platforms/weixin/official/context_tokens.js';
import { createFileJsonRepositories } from '../../../src/store/file_json/create_file_json_repositories.js';
import type { BridgeSession, SessionSettings, ThreadMetadata } from '../../../src/types/core.js';
import type { ProviderProfile } from '../../../src/types/provider.js';
import type { PlatformBinding } from '../../../src/types/repository.js';

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
      repositories: makeRecoverableRepositories(repositories),
      env,
      getState: () => ({ bridge: { running: false, deliveryOutbox: { pending: 1 } } }),
      getSessionSummaries: () => [{ id: 'summary-1', updatedAt: 1 }],
      getLogs: () => ({ text: 'backup log', files: [] }),
      getAdminUrl: () => 'http://127.0.0.1:43183',
    }),
  };
}

function makeRecoverableRepositories(repositories: ReturnType<typeof createFileJsonRepositories>): WeixinAdminBackupRepositories {
  return {
    providerProfiles: {
      list: () => repositories.providerProfiles.list(),
      save: (record) => repositories.providerProfiles.save(record),
      replaceAll: (records) => repositories.providerProfiles.replaceAll(records),
    },
    bridgeSessions: {
      list: () => repositories.bridgeSessions.list(),
      save: (record) => repositories.bridgeSessions.save(record),
      replaceAll: (records) => repositories.bridgeSessions.replaceAll(records),
    },
    platformBindings: {
      list: () => repositories.platformBindings.list(),
      save: (record) => repositories.platformBindings.save(record),
      replaceAll: (records) => repositories.platformBindings.replaceAll(records),
    },
    sessionSettings: {
      list: () => repositories.sessionSettings.listAll(),
      save: (record) => repositories.sessionSettings.save(record),
      replaceAll: (records) => repositories.sessionSettings.replaceAll(records),
    },
    threadMetadata: {
      list: () => repositories.threadMetadata.listAll(),
      save: (record) => repositories.threadMetadata.save(record),
      replaceAll: (records) => repositories.threadMetadata.replaceAll(records),
    },
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

test('WeixinAdminBackupService normalizes validated backup records into typed domain DTOs', () => {
  const { service } = makeService();
  const validation = service.validateImport(validBackup({
    accounts: [{ accountId: 'typed-account', token: 'token', baseUrl: 'https://typed.example' }],
    runtime: {
      providerProfiles: [{ id: 'profile-1', providerKind: 'openai-compatible', name: 'Imported profile' }],
      bridgeSessions: [{ id: 'session-1', providerProfileId: 'profile-1', codexThreadId: 'thread-1' }],
      platformBindings: [{ platform: 'weixin', externalScopeId: 'scope-1', bridgeSessionId: 'session-1' }],
      sessionSettings: [{ bridgeSessionId: 'session-1' }],
      threadMetadata: [{ providerProfileId: 'profile-1', threadId: 'thread-1' }],
    },
  }));

  assert.deepEqual(validation.errors, []);
  const account = validation.payload.accounts[0];
  const providerProfile: ProviderProfile = validation.payload.runtime.providerProfiles[0];
  const bridgeSession: BridgeSession = validation.payload.runtime.bridgeSessions[0];
  const platformBinding: PlatformBinding = validation.payload.runtime.platformBindings[0];
  const sessionSettings: SessionSettings = validation.payload.runtime.sessionSettings[0];
  const threadMetadata: ThreadMetadata = validation.payload.runtime.threadMetadata[0];
  assert.equal(account?.baseUrl, 'https://typed.example');
  assert.equal(providerProfile?.displayName, 'Imported profile');
  assert.equal(bridgeSession?.cwd, null);
  assert.equal(platformBinding?.updatedAt, 0);
  assert.deepEqual(sessionSettings?.metadata, {});
  assert.equal(threadMetadata?.alias, null);
});

test('WeixinAdminServer exports records from a list-only runtime repository', async () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const server = new WeixinAdminServer({
    accountStore,
    stateDir,
    port: 0,
    repositories: {
      providerProfiles: {
        list: () => [{ id: 'list-only', providerKind: 'native', displayName: 'List only', config: {}, createdAt: 1, updatedAt: 1 }],
      },
    },
  });
  const binding = await server.start();
  try {
    const response = await fetch(`${binding.url}/api/export`);
    const body = await response.json() as { runtime: { providerProfiles: ProviderProfile[] } };
    assert.equal(response.status, 200);
    assert.deepEqual(body.runtime.providerProfiles.map((profile) => profile.id), ['list-only']);
  } finally {
    await server.stop();
  }
});

test('WeixinAdminBackupService rejects imports needing an unrecoverable repository before any mutation', () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const providerProfiles: ProviderProfile[] = [];
  const service = new WeixinAdminBackupService({
    accountStore,
    stateDir,
    repositories: {
      providerProfiles: {
        list: () => [...providerProfiles],
        save: (profile) => {
          providerProfiles.push(profile);
          return profile;
        },
      },
    },
    env: {},
    getState: () => ({ bridge: {} }),
    getSessionSummaries: () => [],
    getLogs: () => ({}),
    getAdminUrl: () => null,
  });

  const result = service.importBackup(validBackup({
    accounts: [{ accountId: 'must-not-save', token: 'token', base_url: 'https://example.test' }],
    runtime: { providerProfiles: [{ id: 'profile-1', providerKind: 'native' }] },
  }));

  assert.equal(result.status, 409);
  assert.equal(accountStore.loadAccount('must-not-save'), null);
  assert.deepEqual(providerProfiles, []);
  assert.equal(fs.existsSync(path.join(stateDir, 'backups')), false);
});

test('WeixinAdminBackupService imports accounts without runtime repositories when the backup has no runtime records', () => {
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const service = new WeixinAdminBackupService({
    accountStore,
    stateDir,
    repositories: null,
    env: {},
    getState: () => ({ bridge: {} }),
    getSessionSummaries: () => [],
    getLogs: () => ({}),
    getAdminUrl: () => null,
  });

  const result = service.importBackup(validBackup({
    accounts: [{ accountId: 'account-only', token: 'token', base_url: 'https://account.example' }],
  }));

  assert.equal(result.status, 200);
  assert.equal(accountStore.loadAccount('account-only')?.token, 'token');
});

test('WeixinAdminBackupService imports environment values with list-only repositories when the backup has no runtime records', () => {
  const stateDir = makeTempStateDir();
  const serviceEnvFile = path.join(stateDir, 'service.env');
  const env: Record<string, string> = { CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE: serviceEnvFile };
  const service = new WeixinAdminBackupService({
    accountStore: new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') }),
    stateDir,
    repositories: { providerProfiles: { list: () => [] } },
    env,
    getState: () => ({ bridge: {} }),
    getSessionSummaries: () => [],
    getLogs: () => ({}),
    getAdminUrl: () => null,
  });

  const result = service.importBackup(validBackup({
    configuration: { serviceEnv: { CODEX_COMPAT_API_KEY: 'env-only-key' } },
  }));

  assert.equal(result.status, 200);
  assert.equal(env.CODEX_COMPAT_API_KEY, 'env-only-key');
  assert.match(fs.readFileSync(serviceEnvFile, 'utf8'), /CODEX_COMPAT_API_KEY=env-only-key/u);
});

test('WeixinAdminBackupService restores a failed runtime write through atomic replaceAll', () => {
  const original: ProviderProfile[] = [{ id: 'original-profile', providerKind: 'native', displayName: 'Original', config: {}, createdAt: 1, updatedAt: 1 }];
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  let replaceCalls = 0;
  const service = new WeixinAdminBackupService({
    accountStore,
    stateDir,
    repositories: {
      providerProfiles: {
        list: () => [...original],
        save: () => { throw new Error('persistent write failure'); },
        replaceAll: (records) => {
          replaceCalls += 1;
          original.splice(0, original.length, ...records);
        },
      },
    },
    env: {},
    getState: () => ({ bridge: {} }),
    getSessionSummaries: () => [],
    getLogs: () => ({}),
    getAdminUrl: () => null,
  });

  const result = service.importBackup(validBackup({
    runtime: { providerProfiles: [{ id: 'new-profile', providerKind: 'native' }] },
  }));

  assert.equal(result.status, 409);
  assert.equal(replaceCalls, 1);
  assert.deepEqual(original.map((profile) => profile.id), ['original-profile']);
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
  repositories.providerProfiles.save({ id: 'original-profile', providerKind: 'openai-compatible', displayName: 'Original', config: {}, createdAt: 1, updatedAt: 1 });
  repositories.bridgeSessions.save = () => { throw new Error('repository failed with secret-token'); };

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
    assert.deepEqual(repositories.providerProfiles.list().map((profile) => profile.id), ['original-profile']);
  } finally {
    _resetContextTokenStoreForTest();
  }
});

test('WeixinAdminBackupService restores injected in-memory runtime repositories after a later save fails', () => {
  const providerProfiles: ProviderProfile[] = [{ id: 'original-profile', providerKind: 'native', displayName: 'Original', config: {}, createdAt: 1, updatedAt: 1 }];
  const bridgeSessions: BridgeSession[] = [];
  const repositories = {
    providerProfiles: {
      list: () => [...providerProfiles],
      save: (profile: ProviderProfile) => {
        providerProfiles.splice(0, providerProfiles.length, ...providerProfiles.filter((current) => current.id !== profile.id), profile);
        return profile;
      },
      replaceAll: (profiles: ProviderProfile[]) => {
        providerProfiles.splice(0, providerProfiles.length, ...profiles);
      },
    },
    bridgeSessions: {
      list: () => [...bridgeSessions],
      save: (_session: BridgeSession) => { throw new Error('in-memory failure'); },
      replaceAll: (sessions: BridgeSession[]) => {
        bridgeSessions.splice(0, bridgeSessions.length, ...sessions);
      },
    },
  };
  const stateDir = makeTempStateDir();
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  const service = new WeixinAdminBackupService({
    accountStore,
    stateDir,
    repositories,
    env: {},
    getState: () => ({ bridge: {} }),
    getSessionSummaries: () => [],
    getLogs: () => ({}),
    getAdminUrl: () => null,
  });

  const result = service.importBackup(validBackup({
    runtime: {
      providerProfiles: [{ id: 'new-profile', providerKind: 'native' }],
      bridgeSessions: [{ id: 'failing-session', providerProfileId: 'new-profile', codexThreadId: 'thread-1' }],
    },
  }));

  assert.equal(result.status, 409);
  assert.deepEqual(providerProfiles.map((profile) => profile.id), ['original-profile']);
});

test('WeixinAdminBackupService restores every state surface when getState fails after environment persistence', () => {
  const stateDir = makeTempStateDir();
  const serviceEnvFile = path.join(stateDir, 'service.env');
  fs.writeFileSync(serviceEnvFile, 'CODEX_COMPAT_API_KEY=old-key\n', 'utf8');
  const env = { CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE: serviceEnvFile, CODEX_COMPAT_API_KEY: 'old-key' };
  const { accountStore, repositories } = makeService({ stateDir, env });
  accountStore.saveAccount({ accountId: 'original', token: 'old-token', baseUrl: 'https://old.example', userId: 'old-user' });
  accountStore.saveSyncCursor('original', 'old-cursor');
  repositories.providerProfiles.save({ id: 'old-profile', providerKind: 'native', displayName: 'Old', config: {}, createdAt: 1, updatedAt: 1 });
  repositories.bridgeSessions.save({ id: 'old-session', providerProfileId: 'old-profile', codexThreadId: 'old-thread', cwd: null, title: null, createdAt: 1, updatedAt: 1 });
  repositories.platformBindings.save({ platform: 'weixin', externalScopeId: 'old-scope', bridgeSessionId: 'old-session', updatedAt: 1 });
  repositories.sessionSettings.save({ bridgeSessionId: 'old-session', model: null, reasoningEffort: null, serviceTier: null, locale: null, metadata: {}, updatedAt: 1 });
  repositories.threadMetadata.save({ providerProfileId: 'old-profile', threadId: 'old-thread', alias: null, updatedAt: 1 });
  let stateCalls = 0;
  const service = new WeixinAdminBackupService({
    accountStore,
    stateDir,
    repositories: makeRecoverableRepositories(repositories),
    env,
    getState: () => {
      stateCalls += 1;
      if (stateCalls > 1) throw new Error('state failure after persistence');
      return { bridge: {} };
    },
    getSessionSummaries: () => [],
    getLogs: () => ({}),
    getAdminUrl: () => null,
  });

  const result = service.importBackup(validBackup({
    accounts: [{ accountId: 'original', token: 'new-token', base_url: 'https://new.example', sync_cursor: 'new-cursor' }],
    configuration: { serviceEnv: { CODEX_COMPAT_API_KEY: 'new-key' } },
    runtime: {
      providerProfiles: [{ id: 'new-profile', providerKind: 'native' }],
      bridgeSessions: [{ id: 'new-session', providerProfileId: 'new-profile', codexThreadId: 'new-thread' }],
      platformBindings: [{ platform: 'weixin', externalScopeId: 'new-scope', bridgeSessionId: 'new-session' }],
      sessionSettings: [{ bridgeSessionId: 'new-session' }],
      threadMetadata: [{ providerProfileId: 'new-profile', threadId: 'new-thread' }],
    },
  }));

  assert.equal(result.status, 409);
  assert.equal(accountStore.loadAccount('original')?.token, 'old-token');
  assert.equal(accountStore.loadSyncCursor('original'), 'old-cursor');
  assert.deepEqual(repositories.providerProfiles.list().map((record) => record.id), ['old-profile']);
  assert.deepEqual(repositories.bridgeSessions.list().map((record) => record.id), ['old-session']);
  assert.deepEqual(repositories.platformBindings.list().map((record) => record.externalScopeId), ['old-scope']);
  assert.ok(repositories.sessionSettings.getByBridgeSessionId('old-session'));
  assert.equal(repositories.sessionSettings.getByBridgeSessionId('new-session'), null);
  assert.ok(repositories.threadMetadata.getByThread('old-profile', 'old-thread'));
  assert.equal(repositories.threadMetadata.getByThread('new-profile', 'new-thread'), null);
  assert.equal(env.CODEX_COMPAT_API_KEY, 'old-key');
  assert.equal(fs.readFileSync(serviceEnvFile, 'utf8'), 'CODEX_COMPAT_API_KEY=old-key\n');
});

test('WeixinAdminBackupService sanitizes failed transaction errors', () => {
  const { service, repositories } = makeService();
  repositories.bridgeSessions.save = () => { throw new Error('repository failed with secret-token and C:/private/path'); };

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
