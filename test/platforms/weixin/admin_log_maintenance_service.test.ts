import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WeixinAdminLogMaintenanceService } from '../../../src/platforms/weixin/admin_log_maintenance_service.js';

function makeTempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-weixin-admin-log-maintenance-'));
}

function makeService({
  stateDir = makeTempStateDir(),
  env = {},
  now = 1_700_000_000_000,
  fs: fsModule = fs,
  path: pathModule = path,
}: {
  stateDir?: string;
  env?: Record<string, string>;
  now?: number;
  fs?: typeof fs;
  path?: typeof path;
} = {}) {
  let clock = now;
  let nextTimerId = 1;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const clearedTimerIds: number[] = [];
  const service = new WeixinAdminLogMaintenanceService({
    stateDir,
    env,
    now: () => clock,
    setInterval: (callback, delay) => {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearInterval: (id) => {
      clearedTimerIds.push(id as number);
      timers.delete(id as number);
    },
    fs: fsModule,
    path: pathModule,
    buildActiveLogResetSummary: ({ reason, startedAt }) => `summary ${reason} ${startedAt}\n`,
  });
  return {
    stateDir,
    service,
    timers,
    clearedTimerIds,
    setNow(value: number) { clock = value; },
  };
}

type FilesystemOverride = (...args: any[]) => unknown;

function makeFilesystemDouble(overrides: ReadonlyMap<PropertyKey, FilesystemOverride>): typeof fs {
  return new Proxy(fs, {
    get(target, property, receiver) {
      const override = overrides.get(property);
      if (override) {
        return override;
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as typeof fs;
}

function makeFilesystemError(code: string) {
  return Object.assign(new Error(`${code} simulated filesystem failure`), { code });
}

function makeTrackedReadFilesystem(failure: 'open' | 'read' | 'close') {
  const openFileDescriptors = new Set<number>();
  const fileSystem = makeFilesystemDouble(new Map<PropertyKey, FilesystemOverride>([
    ['openSync', (filePath: string, ...args: any[]) => {
      if (failure === 'open') {
        throw makeFilesystemError('EACCES');
      }
      const fd = (fs.openSync as (...arguments_: any[]) => number)(filePath, ...args);
      openFileDescriptors.add(fd);
      return fd;
    }],
    ['readSync', (...args: any[]) => {
      if (failure === 'read') {
        throw makeFilesystemError('EIO');
      }
      return (fs.readSync as (...arguments_: any[]) => number)(...args);
    }],
    ['closeSync', (fd: number, ...args: any[]) => {
      (fs.closeSync as (...arguments_: any[]) => void)(fd, ...args);
      openFileDescriptors.delete(fd);
      if (failure === 'close') {
        throw makeFilesystemError('EIO');
      }
    }],
  ]));
  return { fileSystem, openFileDescriptors };
}

test('WeixinAdminLogMaintenanceService starts with immediate cleanup and schedules interval cleanup', async () => {
  const { stateDir, service, timers } = makeService({
    env: {
      WEIXIN_LOG_CLEANUP_ENABLE: '1',
      WEIXIN_LOG_MAX_BYTES: '80',
      WEIXIN_LOG_CLEANUP_INTERVAL_MINUTES: '3',
    },
  });
  const outLog = path.join(stateDir, 'logs', 'weixin-bridge.out.log');
  fs.mkdirSync(path.dirname(outLog), { recursive: true });
  fs.writeFileSync(outLog, `${'old '.repeat(40)}latest line\n`, 'utf8');

  service.start();

  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0]?.delay, 3 * 60 * 1000);
  assert.match(fs.readFileSync(outLog, 'utf8'), /reason=startup/u);
  fs.writeFileSync(outLog, `${'old '.repeat(40)}interval line\n`, 'utf8');
  [...timers.values()][0]?.callback();
  assert.match(fs.readFileSync(outLog, 'utf8'), /reason=interval/u);
  service.stop();
});

test('WeixinAdminLogMaintenanceService restart cancels the prior timer and reschedules without immediate cleanup', () => {
  const { stateDir, service, timers, clearedTimerIds } = makeService({
    env: { WEIXIN_LOG_CLEANUP_ENABLE: '1', WEIXIN_LOG_CLEANUP_INTERVAL_MINUTES: '2' },
  });
  const outLog = path.join(stateDir, 'logs', 'weixin-bridge.out.log');
  fs.mkdirSync(path.dirname(outLog), { recursive: true });
  fs.writeFileSync(outLog, 'initial\n', 'utf8');
  service.start();
  const firstTimerId = [...timers.keys()][0] as number;
  fs.writeFileSync(outLog, 'untouched by restart\n', 'utf8');

  service.restart();

  assert.deepEqual(clearedTimerIds, [firstTimerId]);
  assert.equal(timers.size, 1);
  assert.equal([...timers.keys()][0], firstTimerId + 1);
  assert.equal(fs.readFileSync(outLog, 'utf8'), 'untouched by restart\n');
  service.stop();
});

test('WeixinAdminLogMaintenanceService stop cancels a timer once and is idempotent', () => {
  const { service, timers, clearedTimerIds } = makeService({
    env: { WEIXIN_LOG_CLEANUP_ENABLE: '1' },
  });
  service.start();
  const timerId = [...timers.keys()][0] as number;

  service.stop();
  service.stop();

  assert.deepEqual(clearedTimerIds, [timerId]);
  assert.equal(timers.size, 0);
});

test('WeixinAdminLogMaintenanceService does not clean or schedule when cleanup is disabled at start', () => {
  const { stateDir, service, timers } = makeService({
    env: { WEIXIN_LOG_CLEANUP_ENABLE: '0', WEIXIN_LOG_MAX_BYTES: '80' },
  });
  const outLog = path.join(stateDir, 'logs', 'weixin-bridge.out.log');
  fs.mkdirSync(path.dirname(outLog), { recursive: true });
  const original = `${'old '.repeat(40)}disabled start sentinel\n`;
  fs.writeFileSync(outLog, original, 'utf8');

  service.start();

  assert.equal(timers.size, 0);
  assert.equal(fs.readFileSync(outLog, 'utf8'), original);
});

test('WeixinAdminLogMaintenanceService disables an active scheduler without cleaning when restarted', () => {
  const env = { WEIXIN_LOG_CLEANUP_ENABLE: '1', WEIXIN_LOG_MAX_BYTES: '80' };
  const { stateDir, service, timers, clearedTimerIds } = makeService({ env });
  const outLog = path.join(stateDir, 'logs', 'weixin-bridge.out.log');
  fs.mkdirSync(path.dirname(outLog), { recursive: true });
  fs.writeFileSync(outLog, `${'old '.repeat(40)}startup line\n`, 'utf8');
  service.start();
  const timerId = [...timers.keys()][0] as number;
  const restartSentinel = `${'old '.repeat(40)}disabled restart sentinel\n`;
  fs.writeFileSync(outLog, restartSentinel, 'utf8');
  env.WEIXIN_LOG_CLEANUP_ENABLE = '0';

  service.restart();

  assert.deepEqual(clearedTimerIds, [timerId]);
  assert.equal(timers.size, 0);
  assert.equal(fs.readFileSync(outLog, 'utf8'), restartSentinel);
});

test('WeixinAdminLogMaintenanceService treats missing log paths as empty without throwing', async () => {
  const missingFilesystem = makeFilesystemDouble(new Map([
    ['statSync', () => { throw makeFilesystemError('ENOENT'); }],
    ['readdirSync', () => { throw makeFilesystemError('ENOENT'); }],
  ]));
  const { service } = makeService({ fs: missingFilesystem });

  const logs = service.readLogs({ lineLimit: 1 });
  const cleanup = await service.cleanup('missing-paths');

  assert.equal(logs.files.every((file) => file.exists === false && file.text === ''), true);
  assert.match(logs.text, /\(missing\)/u);
  assert.deepEqual(cleanup.actions, []);
});

test('WeixinAdminLogMaintenanceService records an EPERM active-log write as a failed cleanup action', async () => {
  const now = 1_700_000_000_000;
  const stateDir = makeTempStateDir();
  const outLog = path.join(stateDir, 'logs', 'weixin-bridge.out.log');
  fs.mkdirSync(path.dirname(outLog), { recursive: true });
  fs.writeFileSync(outLog, 'locked active log\n', 'utf8');
  const beforeBytes = fs.statSync(outLog).size;
  const expiredAt = new Date(now - 2 * 24 * 60 * 60 * 1000);
  fs.utimesSync(outLog, expiredAt, expiredAt);
  const lockedFilesystem = makeFilesystemDouble(new Map([
    ['writeFileSync', (filePath: string, ...args: any[]) => {
      if (filePath === outLog) {
        throw makeFilesystemError('EPERM');
      }
      return (fs.writeFileSync as (...arguments_: any[]) => void)(filePath, ...args);
    }],
  ]));
  const { service } = makeService({
    stateDir,
    now,
    fs: lockedFilesystem,
    env: { WEIXIN_LOG_CLEANUP_ENABLE: '1', WEIXIN_LOG_RETENTION_DAYS: '1' },
  });

  const cleanup = await service.cleanup('locked-write');

  assert.deepEqual(cleanup.actions, [{
    path: outLog,
    action: 'failed',
    beforeBytes,
    afterBytes: beforeBytes,
    error: 'EPERM simulated filesystem failure',
  }]);
  assert.equal(fs.readFileSync(outLog, 'utf8'), 'locked active log\n');
});

test('WeixinAdminLogMaintenanceService records an EBUSY rotated-log delete as a failed cleanup action', async () => {
  const now = 1_700_000_000_000;
  const stateDir = makeTempStateDir();
  const rotatedLog = path.join(stateDir, 'logs', 'weixin-bridge.archive.log.1');
  fs.mkdirSync(path.dirname(rotatedLog), { recursive: true });
  fs.writeFileSync(rotatedLog, 'locked rotated log\n', 'utf8');
  const beforeBytes = fs.statSync(rotatedLog).size;
  const expiredAt = new Date(now - 2 * 24 * 60 * 60 * 1000);
  fs.utimesSync(rotatedLog, expiredAt, expiredAt);
  const lockedFilesystem = makeFilesystemDouble(new Map([
    ['unlinkSync', (filePath: string, ...args: any[]) => {
      if (filePath === rotatedLog) {
        throw makeFilesystemError('EBUSY');
      }
      return (fs.unlinkSync as (...arguments_: any[]) => void)(filePath, ...args);
    }],
  ]));
  const { service } = makeService({
    stateDir,
    now,
    fs: lockedFilesystem,
    env: { WEIXIN_LOG_CLEANUP_ENABLE: '1', WEIXIN_LOG_RETENTION_DAYS: '1' },
  });

  const cleanup = await service.cleanup('locked-delete');

  assert.deepEqual(cleanup.actions, [{
    path: rotatedLog,
    action: 'failed',
    beforeBytes,
    afterBytes: beforeBytes,
    error: 'EBUSY simulated filesystem failure',
  }]);
  assert.equal(fs.readFileSync(rotatedLog, 'utf8'), 'locked rotated log\n');
});

test('WeixinAdminLogMaintenanceService returns log output safely when tail reads fail without leaking descriptors', () => {
  for (const failure of ['open', 'read', 'close'] as const) {
    const stateDir = makeTempStateDir();
    const outLog = path.join(stateDir, 'logs', 'weixin-bridge.out.log');
    fs.mkdirSync(path.dirname(outLog), { recursive: true });
    fs.writeFileSync(outLog, 'latest readable line\n', 'utf8');
    const { fileSystem, openFileDescriptors } = makeTrackedReadFilesystem(failure);
    const { service } = makeService({ stateDir, fs: fileSystem });

    const logs = service.readLogs({ lineLimit: 1 });

    assert.equal(logs.files[0]?.exists, true, `${failure} failure keeps file metadata available`);
    assert.doesNotMatch(logs.text, /simulated filesystem failure/u);
    if (failure === 'close') {
      assert.match(logs.text, /latest readable line/u);
    } else {
      assert.match(logs.text, /\(empty\)/u);
    }
    assert.equal(openFileDescriptors.size, 0, `${failure} failure closes every opened descriptor`);
  }
});

test('WeixinAdminLogMaintenanceService bounds reads for logs larger than 256 KiB and keeps summaries metadata-only', () => {
  const stateDir = makeTempStateDir();
  const outLog = path.join(stateDir, 'logs', 'weixin-bridge.out.log');
  fs.mkdirSync(path.dirname(outLog), { recursive: true });
  fs.writeFileSync(outLog, Buffer.concat([
    Buffer.alloc(300 * 1024, 'x'.charCodeAt(0)),
    Buffer.from('\nfirst retained tail line\nlatest retained tail line\n', 'utf8'),
  ]));
  const requestedReadLengths: number[] = [];
  const measuringFilesystem = makeFilesystemDouble(new Map([
    ['readSync', (fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
      requestedReadLengths.push(length);
      return fs.readSync(fd, buffer, offset, length, position);
    }],
  ]));
  const { service } = makeService({ stateDir, fs: measuringFilesystem });

  const logs = service.readLogs({ lineLimit: 2 });
  const readCountBeforeSummary = requestedReadLengths.length;
  const summary = service.buildSummary();

  assert.equal(requestedReadLengths.every((length) => length <= 256 * 1024), true);
  assert.equal(requestedReadLengths.length, 1);
  assert.equal(logs.files[0]?.text, 'first retained tail line\nlatest retained tail line');
  assert.doesNotMatch(logs.files[0]?.text ?? '', /x/u);
  assert.equal(requestedReadLengths.length, readCountBeforeSummary);
  assert.equal(summary.totalSizeBytes, fs.statSync(outLog).size);
  assert.equal(summary.files.every((file) => !('text' in file)), true);
});

test('WeixinAdminLogMaintenanceService compacts oversized logs and expires rotated logs', async () => {
  const now = 1_700_000_000_000;
  const { stateDir, service } = makeService({
    now,
    env: {
      WEIXIN_LOG_CLEANUP_ENABLE: '1',
      WEIXIN_LOG_RETENTION_DAYS: '1',
      WEIXIN_LOG_MAX_BYTES: '200',
    },
  });
  const logDir = path.join(stateDir, 'logs');
  const outLog = path.join(logDir, 'weixin-bridge.out.log');
  const rotatedLog = path.join(logDir, 'weixin-bridge.archive.log.1');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(outLog, `${'early\n'.repeat(50)}latest important line\n`, 'utf8');
  fs.writeFileSync(rotatedLog, 'expired\n', 'utf8');
  const expiredAt = new Date(now - 2 * 24 * 60 * 60 * 1000);
  fs.utimesSync(rotatedLog, expiredAt, expiredAt);

  const cleanup = await service.cleanup('manual');

  assert.equal(cleanup.actions.some((action) => action.action === 'compacted_large_log'), true);
  assert.equal(cleanup.actions.some((action) => action.action === 'deleted_old_log'), true);
  assert.match(fs.readFileSync(outLog, 'utf8'), /latest important line/u);
  assert.equal(fs.existsSync(rotatedLog), false);
});

test('WeixinAdminLogMaintenanceService resets expired active logs and deletes expired rotated logs', async () => {
  const now = 1_700_000_000_000;
  const { stateDir, service } = makeService({
    now,
    env: {
      WEIXIN_LOG_CLEANUP_ENABLE: '1',
      WEIXIN_LOG_RETENTION_DAYS: '1',
    },
  });
  const logDir = path.join(stateDir, 'logs');
  const outLog = path.join(logDir, 'weixin-bridge.out.log');
  const errLog = path.join(logDir, 'weixin-bridge.err.log');
  const rotatedLog = path.join(logDir, 'weixin-bridge.archive.log.1');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(outLog, 'old stdout\n', 'utf8');
  fs.writeFileSync(errLog, 'old stderr\n', 'utf8');
  fs.writeFileSync(rotatedLog, 'old rotated\n', 'utf8');
  const expiredAt = new Date(now - 2 * 24 * 60 * 60 * 1000);
  fs.utimesSync(outLog, expiredAt, expiredAt);
  fs.utimesSync(errLog, expiredAt, expiredAt);
  fs.utimesSync(rotatedLog, expiredAt, expiredAt);

  const cleanup = await service.cleanup('retention-test');

  assert.equal(cleanup.actions.length, 3);
  assert.equal(cleanup.actions.filter((action) => action.action === 'cleared_old_active_log').length, 2);
  assert.equal(cleanup.actions.filter((action) => action.action === 'deleted_old_log').length, 1);
  for (const activeLog of [outLog, errLog]) {
    assert.equal(fs.existsSync(activeLog), true);
    assert.match(fs.readFileSync(activeLog, 'utf8'), /reason=retention-test/u);
    assert.match(fs.readFileSync(activeLog, 'utf8'), /2023-11-14T22:13:20\.000Z/u);
  }
  assert.equal(fs.existsSync(rotatedLog), false);
});

test('WeixinAdminLogMaintenanceService keeps compacted logs within a maxBytes budget smaller than the marker', async () => {
  const { stateDir, service } = makeService({
    env: {
      WEIXIN_LOG_CLEANUP_ENABLE: '1',
      WEIXIN_LOG_MAX_BYTES: '80',
    },
  });
  const outLog = path.join(stateDir, 'logs', 'weixin-bridge.out.log');
  fs.mkdirSync(path.dirname(outLog), { recursive: true });
  fs.writeFileSync(outLog, `${'old '.repeat(40)}latest line\n`, 'utf8');

  await service.cleanup('startup');

  const compactedSize = fs.statSync(outLog).size;
  assert.ok(compactedSize <= 80, `compacted size ${compactedSize} exceeds maxBytes 80`);
});

test('WeixinAdminLogMaintenanceService clears active logs with the injected reset summary', async () => {
  const { stateDir, service } = makeService();
  const logDir = path.join(stateDir, 'logs');
  const outLog = path.join(logDir, 'weixin-bridge.out.log');
  const errLog = path.join(logDir, 'weixin-bridge.err.log');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(outLog, 'old stdout\n', 'utf8');
  fs.writeFileSync(errLog, 'old stderr\n', 'utf8');

  const cleanup = await service.clearActive('manual');

  assert.equal(cleanup.actions.filter((action) => action.action === 'reset_active_log_with_summary').length, 1);
  assert.equal(cleanup.actions.filter((action) => action.action === 'cleared_active_log').length, 1);
  assert.match(fs.readFileSync(outLog, 'utf8'), /^summary manual /u);
  assert.equal(fs.readFileSync(errLog, 'utf8'), '');
});

test('WeixinAdminLogMaintenanceService bounds log tails and summary files', () => {
  const { stateDir, service } = makeService();
  const logDir = path.join(stateDir, 'logs');
  const outLog = path.join(logDir, 'weixin-bridge.out.log');
  const errLog = path.join(logDir, 'weixin-bridge.err.log');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(outLog, 'one\ntwo\nthree\n', 'utf8');
  fs.writeFileSync(errLog, 'four\nfive\n', 'utf8');

  const logs = service.readLogs({ lineLimit: 1 });
  const summary = service.buildSummary();

  assert.match(logs.text, /three/u);
  assert.match(logs.text, /five/u);
  assert.doesNotMatch(logs.text, /one|four/u);
  assert.equal(logs.files[0]?.text, 'three');
  assert.equal(summary.files.length, 2);
  assert.equal(summary.totalSizeBytes, fs.statSync(outLog).size + fs.statSync(errLog).size);
});
