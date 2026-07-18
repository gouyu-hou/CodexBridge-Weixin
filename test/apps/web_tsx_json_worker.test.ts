import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

type WorkerRunner = <T>(options: {
  cwd: string;
  input: unknown;
  maxOutputBytes?: number;
  scriptPath: string;
  timeoutMs?: number;
}) => Promise<T>;

async function loadWorkerRunner(): Promise<WorkerRunner | null> {
  try {
    const module = await import('../../apps/web/server/tsx-json-worker.js');
    return typeof module.runTsxJsonWorker === 'function'
      ? module.runTsxJsonWorker as WorkerRunner
      : null;
  } catch {
    return null;
  }
}

function createWorkerScript(source: string): { dir: string; scriptPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-web-worker-'));
  const scriptPath = path.join(dir, 'worker.mjs');
  fs.writeFileSync(scriptPath, source, 'utf8');
  return { dir, scriptPath };
}

test('runTsxJsonWorker returns parsed JSON from a bounded child process', async (t) => {
  const runWorker = await loadWorkerRunner();
  assert.ok(runWorker, 'runTsxJsonWorker must be implemented');
  const fixture = createWorkerScript(`
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) input += chunk;
    process.stdout.write(JSON.stringify({ received: JSON.parse(input) }));
  `);
  t.after(() => fs.rmSync(fixture.dir, { force: true, recursive: true }));

  const result = await runWorker<{ received: { value: number } }>({
    cwd: process.cwd(),
    input: { value: 42 },
    scriptPath: fixture.scriptPath,
  });

  assert.deepEqual(result, { received: { value: 42 } });
});

test('runTsxJsonWorker terminates workers that exceed the deadline', async (t) => {
  const runWorker = await loadWorkerRunner();
  assert.ok(runWorker, 'runTsxJsonWorker must be implemented');
  const fixture = createWorkerScript('setInterval(() => {}, 1000);');
  t.after(() => fs.rmSync(fixture.dir, { force: true, recursive: true }));

  await assert.rejects(
    runWorker({
      cwd: process.cwd(),
      input: {},
      scriptPath: fixture.scriptPath,
      timeoutMs: 100,
    }),
    /worker_timeout/u,
  );
});

test('runTsxJsonWorker terminates workers that exceed the output limit', async (t) => {
  const runWorker = await loadWorkerRunner();
  assert.ok(runWorker, 'runTsxJsonWorker must be implemented');
  const fixture = createWorkerScript("process.stdout.write('x'.repeat(2048));");
  t.after(() => fs.rmSync(fixture.dir, { force: true, recursive: true }));

  await assert.rejects(
    runWorker({
      cwd: process.cwd(),
      input: {},
      maxOutputBytes: 128,
      scriptPath: fixture.scriptPath,
    }),
    /worker_output_limit_exceeded/u,
  );
});

test('one-shot Web API routes use the bounded JSON worker', () => {
  const routePaths = [
    'apps/web/app/api/codex-folders/new/route.ts',
    'apps/web/app/api/codex-launch/model-options/route.ts',
    'apps/web/app/api/codex-threads/[threadId]/model-options/route.ts',
    'apps/web/app/api/codex-threads/[threadId]/settings/route.ts',
  ];

  for (const routePath of routePaths) {
    const source = fs.readFileSync(path.join(process.cwd(), routePath), 'utf8');
    assert.match(source, /runTsxJsonWorker/u, routePath);
    assert.doesNotMatch(source, /\bspawn\(/u, routePath);
  }
});
