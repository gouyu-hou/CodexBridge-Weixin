import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { connectCdp } from './chromium-cdp-client.mjs';

export function packagedExecutablePath(rootDir) {
  return path.join(
    path.resolve(rootDir),
    'release',
    'win-unpacked',
    'CodexBridge Weixin Admin.exe',
  );
}

export function assertPackagedRuntimeBoundary(rootDir) {
  const resourcesDir = path.join(
    path.resolve(rootDir),
    'release',
    'win-unpacked',
    'resources',
  );
  const requiredFiles = [
    'app.asar',
    path.join('runtime', 'node', 'node.exe'),
    path.join('runtime-app', 'scripts', 'service', 'run-weixin-service.mjs'),
    path.join('runtime-app', 'src', 'cli.ts'),
    path.join('runtime-app', 'node_modules', 'tsx', 'dist', 'loader.mjs'),
    path.join('runtime-app', 'assets', 'weixin-admin', 'admin.css'),
    path.join('runtime-app', 'assets', 'weixin-admin', 'admin.js'),
  ];
  for (const relativePath of requiredFiles) {
    const candidate = path.join(resourcesDir, relativePath);
    if (!fs.existsSync(candidate)) {
      throw new Error(`packaged runtime boundary is incomplete: ${candidate}`);
    }
  }
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

export async function fetchPackagedAdminAssets(fetchFn, baseUrl) {
  const styleResponse = await tryFetch(
    fetchFn,
    `${baseUrl}/admin/admin.css`,
    'admin-css',
  );
  const scriptResponse = await tryFetch(
    fetchFn,
    `${baseUrl}/admin/admin.js`,
    'admin-script',
  );
  if (!styleResponse || !scriptResponse) {
    return null;
  }
  return {
    scriptStatus: scriptResponse.status,
    styleStatus: styleResponse.status,
  };
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
  assertPackagedRuntimeBoundary(rootDir);

  const tempRoot = path.resolve(os.tmpdir());
  const stateDir = await fsp.mkdtemp(path.join(tempRoot, 'codexbridge-release-smoke-'));
  let baseUrl = null;
  let child = null;
  let success = false;
  try {
    if (!isPathInside(tempRoot, stateDir)) {
      throw new Error('refusing to use a packaged smoke directory outside the system temp root');
    }

    const adminPort = await findAvailableLoopbackPort();
    const debugPort = await findAvailableLoopbackPort();
    baseUrl = `http://127.0.0.1:${adminPort}`;
    if (!isLoopbackHttpUrl(baseUrl)) {
      throw new Error('packaged smoke admin URL must use loopback HTTP');
    }

  // Electron-hosted shells (VS Code tasks, agent sandboxes) may leak Node-mode
  // overrides that make the packaged app parse argv as Node CLI flags and exit
  // before the main process runs. The smoke must launch Electron in app mode.
  const {
    ELECTRON_RUN_AS_NODE: _electronRunAsNode,
    NODE_OPTIONS: _nodeOptions,
    ...inheritedEnv
  } = process.env;
  const smokeEnv = {
    ...inheritedEnv,
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
  };

  child = spawnFn(executable, [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debugPort}`,
    '--smoke-test',
    '--smoke-test-ui',
    '--state-dir',
    stateDir,
    '--env-file',
    path.join(stateDir, 'missing.service.env'),
  ], {
    cwd: path.dirname(executable),
    env: smokeEnv,
    stdio: 'ignore',
    windowsHide: true,
  });
  let childError = null;
  child.once('error', (error) => {
    childError = error;
  });

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

    const adminAssets = await waitForCondition(
      () => fetchPackagedAdminAssets(fetchFn, baseUrl),
      {
        timeoutMs: Math.min(timeoutMs, 10_000),
        intervalMs: 25,
        description: 'packaged Weixin admin assets',
      },
    );

    let cdpTargetDiagnostics = null;
    let adminTarget;
    try {
      adminTarget = await waitForCondition(
        () => findAdminCdpTarget(
          fetchFn,
          debugPort,
          `${baseUrl}/?shutdownOnClose=0`,
          (diagnostics) => { cdpTargetDiagnostics = diagnostics; },
        ),
        {
          timeoutMs: Math.min(timeoutMs, 15_000),
          intervalMs: 50,
          description: 'packaged admin Chromium target',
        },
      );
    } catch (error) {
      throw new Error(`${error.message}; CDP diagnostics: ${JSON.stringify(cdpTargetDiagnostics)}`);
    }
    const cdp = await connectCdp({
      endpointUrl: adminTarget.webSocketDebuggerUrl,
      timeoutMs: Math.min(timeoutMs, 10_000),
    });
    try {
      await verifyPackagedAdminDom(cdp);
      await cdp.evaluate('window.close()');
    } finally {
      await cdp.close();
    }

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
      domStatus: 'ok',
      pageStatus: pageResponse.status,
      scriptStatus: adminAssets.scriptStatus,
      selfStopped: true,
      stateStatus: stateResponse.status,
      styleStatus: adminAssets.styleStatus,
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

async function findAdminCdpTarget(fetchFn, debugPort, expectedUrl, onDiagnostics) {
  try {
    const response = await fetchFn(`http://127.0.0.1:${debugPort}/json/list`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) {
      onDiagnostics?.({ status: response.status });
      return null;
    }
    const targets = await response.json();
    if (!Array.isArray(targets)) {
      onDiagnostics?.({ targetsType: typeof targets });
      return null;
    }
    onDiagnostics?.({
      targets: targets.map((entry) => ({ type: entry?.type, url: entry?.url })),
    });
    const expected = new URL(expectedUrl);
    expected.hash = '';
    const target = targets.find((entry) => {
      if (entry?.type !== 'page' || typeof entry.webSocketDebuggerUrl !== 'string') {
        return false;
      }
      try {
        const candidate = new URL(entry.url);
        candidate.hash = '';
        return candidate.toString() === expected.toString();
      } catch {
        return false;
      }
    });
    return target || null;
  } catch (error) {
    onDiagnostics?.({ error: error?.message || String(error) });
    return null;
  }
}

export async function verifyPackagedAdminDom(cdp) {
  await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      window.__codexbridgeSmokeBootstrapReady = true;
      window.__codexbridgeSmokeErrors = [];
      window.__codexbridgeSmokeRequests = [];
      window.addEventListener('error', (event) => {
        const target = event.target;
        if (target && target !== window) {
          const resource = target.src || target.href || target.tagName || 'unknown resource';
          window.__codexbridgeSmokeErrors.push('resource failed: ' + String(resource));
          return;
        }
        window.__codexbridgeSmokeErrors.push(
          String(event.error && event.error.message || event.message || 'page error'),
        );
      }, true);
      window.addEventListener('unhandledrejection', (event) => {
        window.__codexbridgeSmokeErrors.push(
          String(event.reason && event.reason.message || event.reason || 'unhandled rejection'),
        );
      });
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const input = args[0];
        const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
        let pathname = '';
        try {
          pathname = new URL(rawUrl, window.location.href).pathname;
        } catch {}
        const request = { ok: null, pathname, status: null };
        window.__codexbridgeSmokeRequests.push(request);
        try {
          const response = await originalFetch(...args);
          request.ok = response.ok;
          request.status = response.status;
          return response;
        } catch (error) {
          request.ok = false;
          request.status = 0;
          throw error;
        }
      };
    })();`,
  });
  await cdp.send('Page.reload', { ignoreCache: false });

  const deadline = Date.now() + 10_000;
  let status;
  while (true) {
    try {
      status = await cdp.evaluate(`(async () => {
    const requiredSelectors = [
      '#admin-root',
      '.admin-shell',
      '.admin-sidebar',
      '.admin-content',
      '#refresh-btn',
      '#service-state',
      'nav[aria-label="管理页面"]',
      'a[href="#runtime"]'
    ];
    const missingSelectors = requiredSelectors.filter((selector) => !document.querySelector(selector));
    const resourcePath = (value) => {
      try {
        return new URL(String(value || ''), window.location.href).pathname;
      } catch {
        return '';
      }
    };
    const styleLoaded = Array.from(document.styleSheets).some((sheet) =>
      resourcePath(sheet.href) === '/admin/admin.css');
    const scriptLoaded = Array.from(document.scripts).some((script) =>
      resourcePath(script.src) === '/admin/admin.js');
    const styleHrefs = Array.from(document.styleSheets).map((sheet) => String(sheet.href || ''));
    const scriptSrcs = Array.from(document.scripts).map((script) => String(script.src || ''));
    const adminReady = document.documentElement.dataset.adminReady === 'true';
    const smokeBootstrapReady = window.__codexbridgeSmokeBootstrapReady === true;
    const serviceState = String(document.getElementById('service-state')?.textContent || '').trim();
    const loading = !smokeBootstrapReady || !styleLoaded || !scriptLoaded || !adminReady
      || !serviceState || serviceState === '状态未知';
    if (loading || missingSelectors.length > 0) {
      return {
        adminReady,
        loading,
        missingSelectors,
        scriptLoaded,
        scriptSrcs,
        serviceState,
        smokeBootstrapReady,
        styleHrefs,
        styleLoaded,
      };
    }
    const runtimeLink = document.querySelector('a[href="#runtime"]');
    const refreshButton = document.getElementById('refresh-btn');
    const requestStart = Array.isArray(window.__codexbridgeSmokeRequests)
      ? window.__codexbridgeSmokeRequests.length
      : 0;
    if (runtimeLink) runtimeLink.click();
    if (refreshButton) refreshButton.click();
    const refreshRequestStartedImmediately = (window.__codexbridgeSmokeRequests || [])
      .slice(requestStart)
      .some((request) => request.pathname === '/api/state');
    const deadline = Date.now() + 5000;
    let refreshRequests = [];
    while (Date.now() < deadline) {
      refreshRequests = (window.__codexbridgeSmokeRequests || [])
        .slice(requestStart)
        .filter((request) => request.pathname === '/api/state');
      const navigationSettled = window.location.hash === '#runtime'
        && String(document.querySelector('.page-heading h1')?.textContent || '').trim() === '运行状态';
      if (refreshRequests.some((request) => request.ok !== null) && navigationSettled) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const pageTitle = String(document.querySelector('.page-heading h1')?.textContent || '').trim();
    return {
      activeRuntime: pageTitle === '运行状态',
      adminReady,
      hash: window.location.hash,
      missingSelectors,
      pageErrors: window.__codexbridgeSmokeErrors,
      refreshRequestStartedImmediately,
      refreshRequestObserved: refreshRequests.length > 0,
      refreshSucceeded: refreshRequests.some((request) => request.ok),
      scriptLoaded,
      serviceState,
      smokeBootstrapReady,
      styleLoaded,
    };
  })()`);
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      await defaultSleep(50);
      continue;
    }
    if (!status?.loading) {
      break;
    }
    if (Date.now() >= deadline) {
      throw new Error(`packaged admin DOM did not finish loading; state: ${JSON.stringify(status)}`);
    }
    await defaultSleep(50);
  }
  const problems = [];
  if (!status?.styleLoaded) problems.push('admin stylesheet is not loaded');
  if (!status?.scriptLoaded || !status?.adminReady) problems.push('React admin is not ready');
  if (status?.missingSelectors?.length) problems.push(`missing controls: ${status.missingSelectors.join(', ')}`);
  if (!status?.activeRuntime || status?.hash !== '#runtime') problems.push('runtime navigation failed');
  if (!status?.refreshRequestStartedImmediately) problems.push('refresh did not start a state request');
  if (!status?.refreshRequestObserved) problems.push('refresh did not request current state');
  if (!status?.refreshSucceeded) problems.push('refresh request failed');
  if (!status?.serviceState || status.serviceState === '状态未知') {
    problems.push('service state is still loading');
  }
  if (status?.pageErrors?.length) problems.push(`page errors: ${status.pageErrors.join('; ')}`);
  if (problems.length > 0) {
    throw new Error(
      `packaged admin DOM smoke failed: ${problems.join('; ')}; state: ${JSON.stringify(status)}`,
    );
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
    } else if (kind === 'admin-css') {
      const contentType = response.headers.get('content-type') ?? '';
      const content = await response.text();
      if (!/^text\/css(?:;|$)/iu.test(contentType) || !/\.admin-shell/u.test(content)) {
        return null;
      }
    } else if (kind === 'admin-script') {
      const contentType = response.headers.get('content-type') ?? '';
      const content = await response.text();
      if (!/^(?:application|text)\/javascript(?:;|$)/iu.test(contentType)
        || !/adminReady/u.test(content)) {
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
