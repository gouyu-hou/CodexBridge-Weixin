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
}: {
  stateDir?: string;
  env?: Record<string, string>;
  now?: number;
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
