import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function packagedExecutablePath(rootDir) {
  return path.join(
    path.resolve(rootDir),
    'release',
    'win-unpacked',
    'CodexBridge Weixin Admin.exe',
  );
}

export function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function isLoopbackHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:'
      && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  } catch {
    return false;
  }
}

export async function waitForCondition(check, {
  timeoutMs,
  intervalMs = 100,
  now = Date.now,
  sleep = defaultSleep,
  description = 'condition',
}) {
  const deadline = now() + timeoutMs;
  while (true) {
    const result = await check();
    if (result) {
      return result;
    }
    if (now() >= deadline) {
      throw new Error(`${description} timed out after ${timeoutMs}ms`);
    }
    await sleep(intervalMs);
  }
}

export async function runPackagedSmoke({
  rootDir = process.cwd(),
  timeoutMs = 60_000,
  fetchFn = fetch,
  spawnFn = spawn,
} = {}) {
  if (process.platform !== 'win32') {
    throw new Error('packaged smoke currently requires Windows');
  }
  const executable = packagedExecutablePath(rootDir);
  if (!fs.existsSync(executable)) {
    throw new Error('packaged Electron executable is missing; run the distribution build first');
  }

  const tempRoot = path.resolve(os.tmpdir());
  const stateDir = await fsp.mkdtemp(path.join(tempRoot, 'codexbridge-release-smoke-'));
  if (!isPathInside(tempRoot, stateDir)) {
    throw new Error('refusing to use a packaged smoke directory outside the system temp root');
  }

  const adminPort = await findAvailableLoopbackPort();
  const baseUrl = `http://127.0.0.1:${adminPort}`;
  if (!isLoopbackHttpUrl(baseUrl)) {
    throw new Error('packaged smoke admin URL must use loopback HTTP');
  }

  const child = spawnFn(executable, [
    '--smoke-test',
    '--state-dir',
    stateDir,
    '--env-file',
    path.join(stateDir, 'missing.service.env'),
  ], {
    cwd: path.dirname(executable),
    env: {
      ...process.env,
      CODEXBRIDGE_STATE_DIR: stateDir,
      CODEX_COMPAT_API_KEY: 'smoke-test-placeholder',
      CODEX_COMPAT_BASE_URL: 'http://127.0.0.1:9/v1',
      CODEX_COMPAT_DEFAULT_MODEL: 'gpt-5.6-sol',
      CODEX_COMPAT_MODEL_IDS: 'gpt-5.6-sol',
      CODEX_COMPAT_PROVIDER_ID: 'openai-compatible',
      CODEX_COMPAT_PROVIDER_NAME: 'Release Smoke Test',
      CODEX_COMPAT_RESTRICT_MODELS: '1',
      CODEX_DEFAULT_PROVIDER_PROFILE_ID: 'openai-default',
      CODEX_NATIVE_API_ENABLE: '0',
      WEIXIN_ADMIN_HOST: '127.0.0.1',
      WEIXIN_ADMIN_PORT: String(adminPort),
      WEIXIN_PROGRESS_PREVIEWS: '0',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  let childError = null;
  child.once('error', (error) => {
    childError = error;
  });

  let success = false;
  try {
    const stateResponse = await waitForCondition(async () => {
      if (childError) {
        throw new Error(`packaged smoke process failed to start: ${childError.message}`);
      }
      return tryFetch(fetchFn, `${baseUrl}/api/state`, 'json');
    }, {
      timeoutMs,
      intervalMs: 50,
      description: 'packaged admin state',
    });

    const pageResponse = await waitForCondition(
      () => tryFetch(fetchFn, baseUrl, 'html'),
      {
        timeoutMs: Math.min(timeoutMs, 10_000),
        intervalMs: 25,
        description: 'packaged admin page',
      },
    );

    await waitForCondition(async () => {
      const response = await tryFetch(fetchFn, `${baseUrl}/api/state`, 'status');
      return response ? null : true;
    }, {
      timeoutMs,
      intervalMs: 100,
      description: 'packaged app self-shutdown',
    });

    if (child.exitCode === null) {
      await waitForCondition(
        () => child.exitCode === null ? null : { exitCode: child.exitCode },
        {
          timeoutMs: 5_000,
          intervalMs: 50,
          description: 'packaged Electron process exit',
        },
      );
    }
    if (typeof child.exitCode === 'number' && child.exitCode !== 0) {
      throw new Error(`packaged Electron exited with code ${child.exitCode}`);
    }

    success = true;
    return {
      endpointStopped: true,
      pageStatus: pageResponse.status,
      selfStopped: true,
      stateStatus: stateResponse.status,
    };
  } finally {
    if (!success) {
      await requestServiceShutdown(fetchFn, baseUrl);
      terminateProcessTree(child);
    }
    await defaultSleep(300);
    if (!isPathInside(tempRoot, stateDir)) {
      throw new Error('refusing to remove a packaged smoke directory outside the system temp root');
    }
    await fsp.rm(stateDir, { recursive: true, force: true });
  }
}

async function tryFetch(fetchFn, url, kind) {
  try {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) {
      return null;
    }
    if (kind === 'json') {
      await response.json();
    } else if (kind === 'html') {
      const content = await response.text();
      if (!/<!doctype html>/iu.test(content)) {
        return null;
      }
    }
    return { status: response.status };
  } catch {
    return null;
  }
}

async function requestServiceShutdown(fetchFn, baseUrl) {
  if (!isLoopbackHttpUrl(baseUrl)) {
    return;
  }
  await fetchFn(`${baseUrl}/api/service/shutdown`, {
    body: JSON.stringify({ reason: 'release-smoke-timeout' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(1_000),
  }).catch(() => {});
}

function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) {
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  child.kill('SIGTERM');
}

function findAvailableLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error('failed to reserve a loopback port for packaged smoke'));
          return;
        }
        resolve(port);
      });
    });
  });
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCliArgs(argv) {
  let timeoutMs = 60_000;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--timeout-ms') {
      timeoutMs = Number.parseInt(argv[index + 1] ?? '', 10);
      index += 1;
      continue;
    }
    throw new Error(`unknown packaged smoke option: ${arg}`);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
    throw new Error('--timeout-ms must be at least 1000');
  }
  return { timeoutMs };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runPackagedSmoke(parseCliArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`Packaged smoke failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
