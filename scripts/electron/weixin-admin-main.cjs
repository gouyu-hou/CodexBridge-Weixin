const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const PROJECT_PARENT = path.dirname(ROOT_DIR);
const args = parseArgs(process.argv.slice(2));
const stateDir = path.resolve(args.stateDir || process.env.CODEXBRIDGE_STATE_DIR || defaultStateDir());
const envFile = path.resolve(args.envFile || preferredServiceEnvFile(stateDir));
const defaultCwd = path.resolve(args.cwd || PROJECT_PARENT);
const serviceLogsDir = path.join(stateDir, 'logs');
const serviceStdoutLog = path.join(serviceLogsDir, 'weixin-bridge.out.log');
const serviceStderrLog = path.join(serviceLogsDir, 'weixin-bridge.err.log');
const smokeTest = Boolean(args.smokeTest);
const forceSetup = Boolean(args.forceSetup);
const stopOnClose = args.stopOnClose !== '0' && args.noStopOnClose !== true;

let mainWindow = null;
let serviceProcess = null;
let serviceExited = false;
let isQuitting = false;
let adminUrl = null;
let setupIpcInstalled = false;

app.setName('CodexBridge Weixin Admin');
Menu.setApplicationMenu(null);

app.whenReady()
  .then(run)
  .catch(async (error) => {
    await showFatalError(error);
    app.exit(1);
  });

app.on('window-all-closed', () => {
  void shutdownAndQuit('window-all-closed');
});

app.on('before-quit', (event) => {
  if (isQuitting) {
    return;
  }
  event.preventDefault();
  void shutdownAndQuit('before-quit');
});

async function run() {
  await fsp.mkdir(serviceLogsDir, { recursive: true });
  installSetupIpcHandlers();
  const serviceEnv = await buildServiceEnv();

  adminUrl = args.adminUrl || resolveAdminUrl(serviceEnv);

  if (!smokeTest && shouldShowFirstRunSetup(serviceEnv)) {
    mainWindow = createMainWindow();
    await loadSetupPage(serviceEnv);
    return;
  }

  await startBridgeFlow(serviceEnv);
}

async function startBridgeFlow(serviceEnv) {
  if (!smokeTest) {
    mainWindow ??= createMainWindow();
    await loadStatusPage('Starting CodexBridge', 'Checking the local service...');
  }

  const state = await startOrAttachService(serviceEnv);
  if (!state?.bridge?.running) {
    await loadStatusPage('Starting WeChat bridge', 'Preparing the bridge runtime...');
    await postJson(`${adminUrl}/api/bridge/start`, {});
  }

  if (smokeTest) {
    await shutdownAndQuit('smoke-test');
    return;
  }

  await loadStatusPage('Opening admin panel', 'Loading the local dashboard...');
  await mainWindow.loadURL(addQueryParam(adminUrl, 'shutdownOnClose', '0'));
}

async function buildServiceEnv() {
  const serviceEnv = {
    ...process.env,
    ...(await readEnvFile(path.join(ROOT_DIR, '.env'))),
    ...(await readEnvFile(path.join(ROOT_DIR, '.env.local'))),
    ...(await readEnvFile(envFile)),
  };
  serviceEnv.CODEXBRIDGE_STATE_DIR = stateDir;
  serviceEnv.CODEXBRIDGE_WEIXIN_SERVICE_ENV_FILE = envFile;
  serviceEnv.HOME = serviceEnv.HOME || os.homedir();
  serviceEnv.USERPROFILE = serviceEnv.USERPROFILE || os.homedir();
  serviceEnv.CODEX_HOME = serviceEnv.CODEX_HOME || path.join(os.homedir(), '.codex');
  serviceEnv.WEIXIN_ADMIN_ENABLE = serviceEnv.WEIXIN_ADMIN_ENABLE || '1';
  serviceEnv.WEIXIN_ADMIN_HOST = serviceEnv.WEIXIN_ADMIN_HOST || '127.0.0.1';
  serviceEnv.WEIXIN_ADMIN_PORT = serviceEnv.WEIXIN_ADMIN_PORT || '43183';
  serviceEnv.WEIXIN_PROGRESS_PREVIEWS = serviceEnv.WEIXIN_PROGRESS_PREVIEWS || '0';
  serviceEnv.CODEX_REAL_BIN = serviceEnv.CODEX_REAL_BIN || resolveBundledCodexBin() || '';
  return serviceEnv;
}

function shouldShowFirstRunSetup(serviceEnv) {
  if (forceSetup) {
    return true;
  }
  if (!app.isPackaged) {
    return false;
  }
  return !hasUsableOpenAICompatibleConfig(serviceEnv);
}

function hasUsableOpenAICompatibleConfig(serviceEnv) {
  return Boolean(
    normalizeString(serviceEnv.CODEX_COMPAT_API_KEY)
    && normalizeString(serviceEnv.CODEX_COMPAT_BASE_URL)
    && normalizeString(serviceEnv.CODEX_COMPAT_DEFAULT_MODEL || serviceEnv.CODEX_COMPAT_MODEL),
  );
}

function installSetupIpcHandlers() {
  if (setupIpcInstalled) {
    return;
  }
  setupIpcInstalled = true;
  ipcMain.handle('codexbridge:first-run:save', async (_event, payload) => {
    const setup = normalizeSetupPayload(payload);
    await writeFirstRunEnvFile(setup);
    const serviceEnv = await buildServiceEnv();
    adminUrl = args.adminUrl || resolveAdminUrl(serviceEnv);
    void startBridgeFlow(serviceEnv).catch((error) => {
      void showFatalError(error);
    });
    return { ok: true };
  });
}

async function startOrAttachService(serviceEnv) {
  const existingState = await tryGetAdminState(adminUrl, 1200);
  if (existingState) {
    return existingState;
  }

  if (process.platform === 'win32') {
    await loadStatusPage('Starting CodexBridge', 'Cleaning up stale service processes...');
    await stopExistingProjectNodeServices();
  }
  await removeStaleServeLock();

  await loadStatusPage('Starting CodexBridge', 'Launching the local service...');
  serviceProcess = startService(serviceEnv);
  return waitForAdminState(adminUrl, 90_000);
}

function createMainWindow() {
  const iconPath = path.join(ROOT_DIR, 'assets', 'windows', 'codexbridge-weixin.ico');
  const preloadPath = path.join(ROOT_DIR, 'scripts', 'electron', 'weixin-admin-preload.cjs');
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'CodexBridge Weixin Admin',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#f6f8fb',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: fs.existsSync(preloadPath) ? preloadPath : undefined,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => {
    if (!window.isDestroyed() && !isQuitting) {
      window.show();
    }
  });

  window.on('close', (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    window.setClosable(false);
    window.setTitle('CodexBridge Weixin Admin - Stopping service...');
    window.hide();
    void shutdownAndQuit('window-close');
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    void dialog.showMessageBox(window, {
      type: 'error',
      title: 'Admin panel load failed',
      message: `Could not load the admin panel: ${errorDescription || errorCode}`,
      detail: `URL: ${adminUrl}`,
    });
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//iu.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (adminUrl && url.startsWith(adminUrl)) {
      return;
    }
    if (url.startsWith('data:') || url.startsWith('about:')) {
      return;
    }
    if (/^https?:\/\//iu.test(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  return window;
}

function startService(env) {
  const runtime = resolveNodeRuntime(env);
  const runner = path.join(ROOT_DIR, 'scripts', 'service', 'run-weixin-service.mjs');
  if (!fs.existsSync(runner)) {
    throw new Error(`Service runner not found: ${runner}`);
  }
  const child = spawn(runtime.command, [
    runner,
    '--once',
    '--root-dir', ROOT_DIR,
    '--home-dir', os.homedir(),
    '--state-dir', stateDir,
    '--service-env-file', envFile,
    '--stdout-log', serviceStdoutLog,
    '--stderr-log', serviceStderrLog,
    '--cwd', defaultCwd,
  ], {
    cwd: ROOT_DIR,
    env: runtime.env,
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  });
  child.once('exit', () => {
    serviceExited = true;
  });
  child.once('error', (error) => {
    serviceExited = true;
    if (!isQuitting) {
      void showFatalError(error);
    }
  });
  return child;
}

async function shutdownAndQuit(reason) {
  if (isQuitting) {
    return;
  }
  isQuitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle('CodexBridge Weixin Admin - Stopping service...');
    mainWindow.hide();
  }
  try {
    if (stopOnClose) {
      await stopService(reason);
    }
  } finally {
    app.exit(0);
  }
}

async function stopService(reason) {
  let shutdownRequested = false;
  if (adminUrl) {
    await postJson(`${adminUrl}/api/service/shutdown`, { reason })
      .then(() => {
        shutdownRequested = true;
      })
      .catch(() => {});
  }
  if (shutdownRequested) {
    await waitForAdminStopped(adminUrl, serviceProcess ? 2500 : 5000).catch(() => {});
  }
  if (serviceProcess && !serviceExited) {
    await waitForExit(serviceProcess, 8000).catch(() => {});
  }
  if (serviceProcess && !serviceExited) {
    await killProcessTree(serviceProcess.pid);
  }
}

async function waitForAdminState(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await requestJson(`${baseUrl}/api/state`, { method: 'GET', timeoutMs: 3000 });
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }
  throw new Error(`Admin server did not become ready: ${lastError?.message || 'timeout'}`);
}

async function tryGetAdminState(baseUrl, timeoutMs) {
  return requestJson(`${baseUrl}/api/state`, { method: 'GET', timeoutMs }).catch(() => null);
}

async function waitForAdminStopped(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await tryGetAdminState(baseUrl, 800);
    if (!state) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

async function loadStatusPage(title, detail) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  await mainWindow.loadURL(createStatusPageUrl(title, detail));
}

async function loadSetupPage(serviceEnv) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  await mainWindow.loadURL(createSetupPageUrl({
    provider: serviceEnv.CODEX_COMPAT_PROVIDER_NAME || 'OpenAI Compatible',
    baseUrl: serviceEnv.CODEX_COMPAT_BASE_URL || 'https://ztoken.app/',
    model: serviceEnv.CODEX_COMPAT_DEFAULT_MODEL || serviceEnv.CODEX_COMPAT_MODEL || 'gpt-5.5',
    preset: serviceEnv.CODEX_COMPAT_CAPABILITIES || 'default',
  }));
}

function postJson(url, payload) {
  return requestJson(url, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
    headers: { 'content-type': 'application/json' },
    timeoutMs: 5000,
  });
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = options.body || null;
    const request = http.request({
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: `${parsed.pathname}${parsed.search}`,
      method: options.method || 'GET',
      headers: {
        ...(options.headers || {}),
        ...(body ? { 'content-length': Buffer.byteLength(body) } : {}),
      },
      timeout: options.timeoutMs || 5000,
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        text += chunk;
      });
      response.on('end', () => {
        const data = text ? safeJsonParse(text) : {};
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(data?.error || `HTTP ${response.statusCode}`));
          return;
        }
        resolve(data);
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error('request timed out'));
    });
    request.on('error', reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

function resolveNodeRuntime(env) {
  const explicit = env.CODEXBRIDGE_NODE_BIN || env.NODE_BIN;
  if (explicit && fs.existsSync(explicit)) {
    return { command: explicit, env };
  }
  const bundled = resolveBundledNodeBin();
  if (bundled) {
    return { command: bundled, env };
  }
  if (process.platform === 'win32') {
    const result = spawnSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true });
    const first = String(result.stdout || '').split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
    if (first && fs.existsSync(first)) {
      return { command: first, env };
    }
  } else {
    const result = spawnSync('which', ['node'], { encoding: 'utf8' });
    const first = String(result.stdout || '').split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
    if (first && fs.existsSync(first)) {
      return { command: first, env };
    }
  }
  return {
    command: process.execPath,
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  };
}

async function removeStaleServeLock() {
  const lockPath = path.join(stateDir, 'runtime', 'weixin-serve.lock');
  if (!fs.existsSync(lockPath)) {
    return;
  }
  let pid = null;
  try {
    const lock = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
    pid = Number(lock?.pid);
  } catch {
    pid = null;
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    await fsp.rm(lockPath, { force: true }).catch(() => {});
    return;
  }
  if (process.platform === 'win32') {
    const result = spawnSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (!String(result.stdout || '').includes(String(pid))) {
      await fsp.rm(lockPath, { force: true }).catch(() => {});
    }
    return;
  }
  try {
    process.kill(pid, 0);
  } catch {
    await fsp.rm(lockPath, { force: true }).catch(() => {});
  }
}

async function stopExistingProjectNodeServices() {
  const escapedRoot = ROOT_DIR.replace(/'/gu, "''");
  const command = [
    "$ErrorActionPreference='SilentlyContinue'",
    `$root='${escapedRoot}'`,
    "$targets=Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($root) -and ($_.CommandLine.Contains('run-weixin-service.mjs') -or $_.CommandLine.Contains('weixin serve')) }",
    'foreach($p in $targets){ Stop-Process -Id $p.ProcessId -Force }',
  ].join('; ');
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    windowsHide: true,
    encoding: 'utf8',
  });
  await sleep(1500);
}

async function killProcessTree(pid) {
  if (!pid) {
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  await sleep(1500);
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
}

function waitForExit(child, timeoutMs) {
  if (serviceExited) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function showFatalError(error) {
  const message = error?.stack || error?.message || String(error);
  if (app.isReady()) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'CodexBridge Weixin Admin failed to start',
      message: 'Could not start the admin app',
      detail: message,
    }).catch(() => {});
  } else {
    console.error(message);
  }
}

async function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const content = await fsp.readFile(filePath, 'utf8');
  const env = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const index = line.indexOf('=');
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      continue;
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function normalizeSetupPayload(payload) {
  const record = payload && typeof payload === 'object' ? payload : {};
  const provider = normalizeString(record.provider) || 'OpenAI Compatible';
  const apiKey = normalizeString(record.apiKey);
  const baseUrl = normalizeString(record.baseUrl);
  const model = normalizeString(record.model);
  const preset = normalizeProviderPreset(record.preset);
  if (!apiKey) {
    throw new Error('请填写 API key。');
  }
  if (!baseUrl || !/^https?:\/\//iu.test(baseUrl)) {
    throw new Error('接口地址必须以 http:// 或 https:// 开头。');
  }
  if (!model) {
    throw new Error('请填写模型名称。');
  }
  return {
    provider,
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/u, ''),
    model,
    preset,
  };
}

function normalizeProviderPreset(value) {
  const normalized = normalizeString(value).toLowerCase();
  const allowed = new Set(['default', 'deepseek', 'minimax', 'qwen', 'openrouter', 'kimi', 'gemini', 'iflow']);
  return allowed.has(normalized) ? normalized : 'default';
}

async function writeFirstRunEnvFile(setup) {
  await fsp.mkdir(path.dirname(envFile), { recursive: true });
  const bundledCodex = resolveBundledCodexBin();
  const lines = [
    '# CodexBridge Weixin Admin configuration',
    '# Generated by the desktop app first-run setup.',
    '',
    'WEIXIN_DM_POLICY=open',
    'WEIXIN_GROUP_POLICY=disabled',
    'WEIXIN_ADMIN_ENABLE=1',
    'WEIXIN_ADMIN_HOST=127.0.0.1',
    'WEIXIN_ADMIN_PORT=43183',
    'WEIXIN_PROGRESS_PREVIEWS=0',
    'WEIXIN_MAX_CONCURRENT_TURNS=3',
    'WEIXIN_EVENT_DISPATCH_CONCURRENCY=12',
    'WEIXIN_ATTACHMENT_CONCURRENCY=3',
    'WEIXIN_ACCOUNT_POLL_CONCURRENCY=4',
    '',
    'CODEX_DEFAULT_PROVIDER_PROFILE_ID=openai-compatible',
    'CODEX_COMPAT_PROVIDER_ID=openai-compatible',
    `CODEX_COMPAT_PROVIDER_NAME=${escapeEnvValue(setup.provider)}`,
    `CODEX_COMPAT_API_KEY=${escapeEnvValue(setup.apiKey)}`,
    `CODEX_COMPAT_BASE_URL=${escapeEnvValue(setup.baseUrl)}`,
    `CODEX_COMPAT_DEFAULT_MODEL=${escapeEnvValue(setup.model)}`,
    `CODEX_COMPAT_MODEL_IDS=${escapeEnvValue(setup.model)}`,
    `CODEX_COMPAT_CAPABILITIES=${escapeEnvValue(setup.preset)}`,
    'CODEX_NATIVE_API_ENABLE=1',
  ];
  if (bundledCodex) {
    lines.push(`CODEX_REAL_BIN=${escapeEnvValue(bundledCodex)}`);
  }
  lines.push('');
  await fsp.writeFile(envFile, `${lines.join('\n')}\n`, 'utf8');
}

function escapeEnvValue(value) {
  const text = String(value ?? '');
  if (/^[^\s"'#=]+$/u.test(text)) {
    return text;
  }
  return `"${text.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveBundledNodeBin() {
  const executable = process.platform === 'win32' ? 'node.exe' : 'node';
  const candidates = [
    path.join(process.resourcesPath || '', 'runtime', 'node', executable),
    path.join(ROOT_DIR, 'build', 'runtime', 'node', executable),
    path.join(ROOT_DIR, 'runtime', 'node', executable),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

function resolveBundledCodexBin() {
  const candidates = [
    path.join(ROOT_DIR, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
    path.join(ROOT_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex'),
    path.join(ROOT_DIR, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function defaultStateDir() {
  const sibling = path.join(PROJECT_PARENT, 'CodexBridgeData');
  if (fs.existsSync(sibling)) {
    return sibling;
  }
  return path.join(os.homedir(), '.codexbridge');
}

function defaultServiceEnvFile() {
  return path.join(ROOT_DIR, 'weixin.service.env');
}

function preferredServiceEnvFile(resolvedStateDir) {
  const preferencePath = path.join(resolvedStateDir, 'runtime', 'weixin-admin-preferences.json');
  const preference = safeJsonRead(preferencePath);
  const preferred = normalizeString(preference.serviceEnvFile);
  return preferred || defaultServiceEnvFile();
}

function safeJsonRead(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function resolveAdminUrl(env) {
  const host = env.WEIXIN_ADMIN_HOST || '127.0.0.1';
  const port = env.WEIXIN_ADMIN_PORT || '43183';
  return `http://${host}:${port}`;
}

function addQueryParam(url, key, value) {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}

function createSetupPageUrl(defaults) {
  const payload = encodeURIComponent(JSON.stringify(defaults));
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>CodexBridge Weixin Admin Setup</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: "Segoe UI", Arial, sans-serif;
      color: #1f2937;
      background: #f6f8fb;
    }
    main {
      width: min(680px, calc(100vw - 48px));
      padding: 30px;
      border: 1px solid #d9e1ee;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 18px 48px rgba(31, 41, 55, 0.12);
    }
    h1 { margin: 0 0 8px; font-size: 26px; line-height: 1.25; letter-spacing: 0; }
    .intro { margin: 0 0 24px; color: #667085; font-size: 14px; line-height: 1.6; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    label { display: grid; gap: 7px; font-size: 13px; font-weight: 600; color: #344054; }
    input, select {
      width: 100%;
      height: 40px;
      padding: 8px 10px;
      border: 1px solid #cfd8e6;
      border-radius: 6px;
      color: #101828;
      background: #fff;
      font-size: 14px;
      outline: none;
    }
    input:focus, select:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
    }
    .span { grid-column: 1 / -1; }
    .actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 24px;
    }
    button {
      height: 40px;
      padding: 0 16px;
      border: 0;
      border-radius: 6px;
      color: #fff;
      background: #2563eb;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    button:disabled { cursor: default; opacity: 0.65; }
    .status {
      min-height: 20px;
      margin-top: 14px;
      color: #b42318;
      font-size: 13px;
      line-height: 1.5;
    }
    .hint {
      margin-top: 18px;
      padding-top: 18px;
      border-top: 1px solid #eaecf0;
      color: #667085;
      font-size: 13px;
      line-height: 1.6;
    }
    @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>首次启动配置</h1>
    <p class="intro">请配置这台电脑使用的模型供应商。API key 只会保存在本机配置文件中。</p>
    <form id="setup-form">
      <div class="grid">
        <label>
          供应商预设
          <select name="preset" id="preset">
            <option value="default">OpenAI 兼容</option>
            <option value="deepseek">DeepSeek</option>
            <option value="qwen">Qwen</option>
            <option value="openrouter">OpenRouter</option>
            <option value="kimi">Kimi</option>
            <option value="gemini">Gemini</option>
            <option value="minimax">MiniMax</option>
            <option value="iflow">iFlow</option>
          </select>
        </label>
        <label>
          供应商名称
          <input name="provider" id="provider" autocomplete="off" required>
        </label>
        <label class="span">
          API key
          <input name="apiKey" id="apiKey" type="password" autocomplete="off" required>
        </label>
        <label class="span">
          接口地址 Base URL
          <input name="baseUrl" id="baseUrl" autocomplete="off" required>
        </label>
        <label class="span">
          模型
          <input name="model" id="model" autocomplete="off" required>
        </label>
      </div>
      <div class="actions">
        <button id="submit" type="submit">保存并启动</button>
      </div>
      <div class="status" id="status"></div>
      <div class="hint">启动后，在管理面板里生成微信登录二维码，并完成账号绑定。</div>
    </form>
  </main>
  <script>
    const defaults = JSON.parse(decodeURIComponent('${payload}'));
    const presets = {
      default: { provider: 'OpenAI Compatible', baseUrl: 'https://ztoken.app/', model: defaults.model || 'gpt-5.5' },
      deepseek: { provider: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
      qwen: { provider: 'Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
      openrouter: { provider: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
      kimi: { provider: 'Kimi', baseUrl: 'https://api.kimi.com/coding', model: 'kimi-k2' },
      gemini: { provider: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-pro' },
      minimax: { provider: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M2.7' },
      iflow: { provider: 'iFlow', baseUrl: 'https://apis.iflow.cn/v1', model: 'qwen3-coder-plus' }
    };
    const form = document.getElementById('setup-form');
    const status = document.getElementById('status');
    const submit = document.getElementById('submit');
    const preset = document.getElementById('preset');
    const provider = document.getElementById('provider');
    const baseUrl = document.getElementById('baseUrl');
    const model = document.getElementById('model');
    preset.value = defaults.preset || 'default';
    provider.value = defaults.provider || presets[preset.value].provider;
    baseUrl.value = defaults.baseUrl || presets[preset.value].baseUrl;
    model.value = defaults.model || presets[preset.value].model;
    preset.addEventListener('change', () => {
      const next = presets[preset.value] || presets.default;
      provider.value = next.provider;
      baseUrl.value = next.baseUrl;
      model.value = next.model;
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      status.textContent = '';
      submit.disabled = true;
      submit.textContent = '正在启动...';
      try {
        if (!window.codexbridgeSetup?.saveConfig) {
          throw new Error('Desktop setup bridge is unavailable.');
        }
        await window.codexbridgeSetup.saveConfig(Object.fromEntries(new FormData(form).entries()));
      } catch (error) {
        submit.disabled = false;
        submit.textContent = '保存并启动';
        status.textContent = error?.message || String(error);
      }
    });
  </script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createStatusPageUrl(title, detail) {
  const safeTitle = escapeHtml(title);
  const safeDetail = escapeHtml(detail);
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>CodexBridge Weixin Admin</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: "Segoe UI", Arial, sans-serif;
      color: #1f2937;
      background: #f6f8fb;
    }
    .shell {
      width: min(420px, calc(100vw - 48px));
      padding: 28px;
      border: 1px solid #d9e1ee;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 18px 48px rgba(31, 41, 55, 0.12);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
      font-size: 15px;
      font-weight: 600;
    }
    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid #d6deeb;
      border-top-color: #2563eb;
      border-radius: 999px;
      animation: spin 0.8s linear infinite;
      flex: 0 0 auto;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
      line-height: 1.25;
      font-weight: 650;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: #667085;
      font-size: 14px;
      line-height: 1.6;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <main class="shell">
    <div class="brand"><span class="spinner"></span><span>CodexBridge Weixin Admin</span></div>
    <h1>${safeTitle}</h1>
    <p>${safeDetail}</p>
  </main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--smoke-test') {
      parsed.smokeTest = true;
      continue;
    }
    if (arg === '--no-stop-on-close') {
      parsed.noStopOnClose = true;
      continue;
    }
    if (arg === '--force-setup') {
      parsed.forceSetup = true;
      continue;
    }
    if (arg === '--use-electron-node') {
      parsed.useElectronNode = true;
      continue;
    }
    if (arg.startsWith('--') && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      parsed[toCamel(arg.slice(2))] = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function toCamel(value) {
  return value.replace(/-([a-z])/gu, (_match, char) => char.toUpperCase());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
