import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const TEST_IDLE_TIMEOUT_MS = 2_000;

async function loadReplyRunManagerClass() {
  const modulePath = '../../apps/web/server/reply-run-manager.js';
  const module = await import(modulePath);
  const Manager = (module as any).ReplyRunManager;
  assert.equal(typeof Manager, 'function', 'ReplyRunManager must be exported for isolated process tests');
  return Manager;
}

function writeWorker(t: test.TestContext, source: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-web-reply-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const scriptPath = path.join(directory, 'worker.mjs');
  fs.writeFileSync(scriptPath, source, 'utf8');
  return scriptPath;
}

async function waitForTerminalSnapshot(manager: any, runId: string, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = manager.getSnapshot(runId);
    if (snapshot?.status === 'completed' || snapshot?.status === 'failed') {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`reply run did not settle within ${timeoutMs}ms`);
}

async function waitForProcessExit(pid: number, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`process ${pid} did not exit within ${timeoutMs}ms`);
}

function createManager(Manager: any, scriptPath: string, overrides: Record<string, unknown> = {}) {
  return new Manager({
    cwd: process.cwd(),
    getPaths: () => ({ repoRoot: 'D:/repo', stateDir: 'D:/state' }),
    idleTimeoutMs: TEST_IDLE_TIMEOUT_MS,
    maxPendingStdoutBytes: 1_024,
    maxStderrBytes: 64,
    runTtlMs: 20,
    scriptPath,
    ...overrides,
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function forceKillProcess(pid: number) {
  if (!isProcessAlive(pid)) {
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // process already exited
  }
}

test('ReplyRunManager terminates a child that stays completely idle', async (t) => {
  const Manager = await loadReplyRunManagerClass();
  const scriptPath = writeWorker(t, `
    process.stdin.resume();
    setInterval(() => {}, 1_000);
  `);
  const manager = createManager(Manager, scriptPath);

  const run = manager.createRun({ text: 'hello', threadId: 'thread-idle' });
  const terminal = await waitForTerminalSnapshot(manager, run.runId);

  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.error, `reply_idle_timeout:${TEST_IDLE_TIMEOUT_MS}`);
});

test('ReplyRunManager terminates descendants of an idle reply child', async (t) => {
  const Manager = await loadReplyRunManagerClass();
  const scriptPath = writeWorker(t, `
    import { spawn } from 'node:child_process';
    const descendant = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1_000)',
    ], { detached: true, stdio: 'ignore' });
    descendant.unref();
    process.stdin.resume();
    process.stdout.write(JSON.stringify({
      type: 'commentary',
      text: 'descendant:' + descendant.pid,
    }) + '\\n');
    setInterval(() => {}, 1_000);
  `);
  const manager = createManager(Manager, scriptPath);

  const run = manager.createRun({ text: 'hello', threadId: 'thread-tree' });
  const terminal = await waitForTerminalSnapshot(manager, run.runId);
  const descendantPid = Number.parseInt(terminal.commentaryText.split(':')[1] ?? '', 10);
  assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
  t.after(() => forceKillProcess(descendantPid));
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(terminal.status, 'failed');
  assert.equal(isProcessAlive(descendantPid), false);
});

test('ReplyRunManager refreshes the idle deadline on stdout or stderr activity', async (t) => {
  const Manager = await loadReplyRunManagerClass();
  const scriptPath = writeWorker(t, `
    process.stdin.resume();
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      process.stderr.write('tick');
      if (ticks === 4) {
        clearInterval(timer);
        process.stdout.write(JSON.stringify({
          type: 'done',
          bridgeSessionId: 'bridge-1',
          outputText: 'finished',
          threadId: 'thread-active',
          items: [],
          hasMore: false,
        }) + '\\n');
      }
    }, 100);
  `);
  const manager = createManager(Manager, scriptPath);

  const run = manager.createRun({ text: 'hello', threadId: 'thread-active' });
  const terminal = await waitForTerminalSnapshot(manager, run.runId);

  assert.equal(terminal.status, 'completed');
  assert.equal(terminal.assistantText, 'finished');
  assert.equal(terminal.error, null);
});

test('ReplyRunManager terminates a child with an oversized pending stdout line', async (t) => {
  const Manager = await loadReplyRunManagerClass();
  const scriptPath = writeWorker(t, `
    process.stdin.resume();
    process.stdout.write('x'.repeat(1_025));
    setInterval(() => {}, 1_000);
  `);
  const manager = createManager(Manager, scriptPath);

  const run = manager.createRun({ text: 'hello', threadId: 'thread-output' });
  const terminal = await waitForTerminalSnapshot(manager, run.runId);

  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.error, 'reply_stdout_line_limit_exceeded:1024');
});

test('ReplyRunManager applies the stdout limit per pending line instead of per chunk', async (t) => {
  const Manager = await loadReplyRunManagerClass();
  const scriptPath = writeWorker(t, `
    process.stdin.resume();
    const events = Array.from({ length: 40 }, (_, index) => JSON.stringify({
      type: 'commentary',
      text: 'progress-' + index,
    }));
    events.push(JSON.stringify({
      type: 'done',
      outputText: 'finished',
      threadId: 'thread-lines',
      items: [],
      hasMore: false,
    }));
    process.stdout.write(events.join('\\n') + '\\n');
  `);
  const manager = createManager(Manager, scriptPath);

  const run = manager.createRun({ text: 'hello', threadId: 'thread-lines' });
  const terminal = await waitForTerminalSnapshot(manager, run.runId);

  assert.equal(terminal.status, 'completed');
  assert.equal(terminal.assistantText, 'finished');
});

test('ReplyRunManager preserves completion after cleaning up a child that hangs after done', async (t) => {
  const Manager = await loadReplyRunManagerClass();
  const scriptPath = writeWorker(t, `
    process.stdin.resume();
    process.stdout.write(JSON.stringify({
      type: 'commentary',
      text: 'worker:' + process.pid,
    }) + '\\n');
    process.stdout.write(JSON.stringify({
      type: 'done',
      outputText: 'finished before cleanup',
      threadId: 'thread-done-hang',
      items: [],
      hasMore: false,
    }) + '\\n');
    setInterval(() => {}, 1_000);
  `);
  const manager = createManager(Manager, scriptPath, {
    runTtlMs: TEST_IDLE_TIMEOUT_MS + 2_000,
  });

  const run = manager.createRun({ text: 'hello', threadId: 'thread-done-hang' });
  const terminal = await waitForTerminalSnapshot(manager, run.runId);
  const workerPid = Number.parseInt(terminal.commentaryText.split(':')[1] ?? '', 10);
  assert.ok(Number.isSafeInteger(workerPid) && workerPid > 0);
  t.after(() => forceKillProcess(workerPid));
  await waitForProcessExit(workerPid);

  assert.equal(terminal.status, 'completed');
  assert.equal(manager.getSnapshot(run.runId)?.status, 'completed');
  assert.equal(manager.getSnapshot(run.runId)?.error, null);
  assert.equal(isProcessAlive(workerPid), false);
});

test('ReplyRunManager keeps done authoritative when the child later exits nonzero', async (t) => {
  const Manager = await loadReplyRunManagerClass();
  const scriptPath = writeWorker(t, `
    process.stdin.resume();
    process.stdout.write(JSON.stringify({
      type: 'done',
      outputText: 'finished before nonzero exit',
      threadId: 'thread-done-nonzero',
      items: [],
      hasMore: false,
    }) + '\\n');
    setTimeout(() => process.exit(1), 50);
  `);
  const manager = createManager(Manager, scriptPath, { runTtlMs: 4_000 });

  const run = manager.createRun({ text: 'hello', threadId: 'thread-done-nonzero' });
  const terminal = await waitForTerminalSnapshot(manager, run.runId);
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(terminal.status, 'completed');
  assert.equal(manager.getSnapshot(run.runId)?.status, 'completed');
  assert.equal(manager.getSnapshot(run.runId)?.error, null);
});

test('ReplyRunManager retains only the bounded tail of child stderr', async (t) => {
  const Manager = await loadReplyRunManagerClass();
  const scriptPath = writeWorker(t, `
    process.stdin.resume();
    process.stderr.write('discard-me-'.repeat(100) + 'TAIL_MARKER');
    process.exitCode = 1;
  `);
  const manager = createManager(Manager, scriptPath);

  const run = manager.createRun({ text: 'hello', threadId: 'thread-stderr' });
  const terminal = await waitForTerminalSnapshot(manager, run.runId);

  assert.equal(terminal.status, 'failed');
  assert.match(terminal.error, /TAIL_MARKER/u);
  assert.ok(Buffer.byteLength(terminal.error, 'utf8') <= 64);
  assert.doesNotMatch(terminal.error, /^discard-me-/u);
});
