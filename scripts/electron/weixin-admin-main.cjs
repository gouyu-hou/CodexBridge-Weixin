const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch {
  autoUpdater = null;
}

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const PROJECT_PARENT = path.dirname(ROOT_DIR);
const args = parseArgs(process.argv.slice(2));
const stateDir = path.resolve(args.stateDir || process.env.CODEXBRIDGE_STATE_DIR || defaultStateDir());
const envFile = path.resolve(args.envFile || preferredServiceEnvFile(stateDir));
const defaultCwd = path.resolve(args.cwd || PROJECT_PARENT);
const lightweightUpdatesDir = path.join(stateDir, 'updates');
const lightweightCurrentDir = path.join(lightweightUpdatesDir, 'current');
const lightweightBackupDir = path.join(lightweightUpdatesDir, 'backup');
const lightweightFailedDir = path.join(lightweightUpdatesDir, 'failed');
const lightweightDownloadsDir = path.join(lightweightUpdatesDir, 'downloads');
const LIGHTWEIGHT_MANIFEST_NAME = 'codexbridge-lightweight.json';
const serviceLogsDir = path.join(stateDir, 'logs');
const serviceStdoutLog = path.join(serviceLogsDir, 'weixin-bridge.out.log');
const serviceStderrLog = path.join(serviceLogsDir, 'weixin-bridge.err.log');
const smokeTest = Boolean(args.smokeTest);
const forceSetup = Boolean(args.forceSetup);
const stopOnClose = args.stopOnClose !== '0' && args.noStopOnClose !== true;
const DEFAULT_ADMIN_PORT = 43183;
const DEFAULT_NATIVE_API_PORT = 43182;
const FIRST_RUN_PROVIDER_PRESETS = {
  default: {
    label: 'Z Token - Codex',
    profileId: 'openai-default',
    providerId: 'openai-compatible',
    provider: 'Z Token - Codex',
    baseUrl: 'https://ztoken.app/',
    model: 'gpt-5.5',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2'],
    capabilities: 'default',
    restrictModels: true,
  },
  'ztoken-claude': {
    label: 'Z Token - Claude',
    profileId: 'claude-code',
    providerId: 'claude-code',
    provider: 'Z Token - Claude',
    baseUrl: 'https://ztoken.app/',
    model: 'claude-opus-4-8',
    models: [
      'claude-fable-5',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-5-20251101',
      'claude-opus-4-6',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-6',
    ],
    capabilities: 'claude-code',
    restrictModels: true,
  },
  'official-codex': {
    label: '官网 Codex',
    profileId: 'openai-official',
    providerId: 'openai-compatible',
    provider: '官网 Codex',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    models: [
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.2',
      'gpt-5.2-codex',
      'gpt-5.1-codex',
      'gpt-5.1-codex-mini',
      'gpt-5',
      'gpt-5-codex',
      'gpt-4.1',
      'gpt-4o',
      'gpt-4o-mini',
      'o3',
      'o3-mini',
      'o4-mini',
    ],
    capabilities: 'default',
  },
  'official-claude-code': {
    label: '官网 Claude Code',
    profileId: 'claude-official',
    providerId: 'claude',
    provider: '官网 Claude Code',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-6',
    models: [
      'claude-sonnet-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
      'claude-haiku-4-5-20251001',
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
    ],
    capabilities: 'claude',
  },
  deepseek: {
    label: 'DeepSeek',
    profileId: 'deepseek',
    providerId: 'deepseek',
    provider: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    models: [
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-chat',
      'deepseek-reasoner',
      'deepseek-coder',
      'deepseek-v3',
      'deepseek-r1',
    ],
    capabilities: 'deepseek',
  },
  qwen: {
    label: 'Qwen',
    profileId: 'qwen',
    providerId: 'qwen',
    provider: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-coder-flash',
    models: ['qwen3-coder-flash', 'qwen3-coder-plus', 'qwen3-max', 'qwen3-plus', 'qwen3-turbo', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
    capabilities: 'qwen',
  },
  openrouter: {
    label: 'OpenRouter',
    profileId: 'openrouter',
    providerId: 'openrouter',
    provider: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-5.1',
    models: [
      'openai/gpt-5.1',
      'openai/gpt-5',
      'openai/gpt-4.1',
      'anthropic/claude-opus-4',
      'anthropic/claude-sonnet-4',
      'deepseek/deepseek-chat-v3-0324',
      'deepseek/deepseek-r1',
      'google/gemini-2.5-pro',
      'qwen/qwen3-coder',
    ],
    capabilities: 'openrouter',
  },
  kimi: {
    label: 'Kimi',
    profileId: 'kimi',
    providerId: 'kimi',
    provider: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2-0905-preview',
    models: ['kimi-k2-0905-preview', 'kimi-k2-0711-preview', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    capabilities: 'kimi',
  },
  gemini: {
    label: 'Gemini',
    profileId: 'gemini',
    providerId: 'gemini',
    provider: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    capabilities: 'gemini',
  },
  minimax: {
    label: 'MiniMax',
    profileId: 'minimax',
    providerId: 'minimax',
    provider: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    model: 'MiniMax-M2.0',
    models: ['MiniMax-M2.0', 'MiniMax-M1', 'MiniMax-Text-01', 'abab6.5s-chat', 'abab6.5g-chat'],
    capabilities: 'minimax',
  },
  iflow: {
    label: 'iFlow',
    profileId: 'iflow',
    providerId: 'iflow',
    provider: 'iFlow',
    baseUrl: 'https://apis.iflow.cn/v1',
    model: 'iflow-default',
    models: ['iflow-default', 'Qwen3-Coder', 'DeepSeek-V3', 'DeepSeek-R1', 'GLM-4.5'],
    capabilities: 'iflow',
  },
};

let mainWindow = null;
let serviceProcess = null;
let serviceExited = false;
let isQuitting = false;
let updateInstallRequested = false;
let adminUrl = null;
let setupIpcInstalled = false;
let updateIpcInstalled = false;
let updateHandlersInstalled = false;
let autoUpdateCheckStarted = false;
let updatePromptedVersion = '';
let lightweightUpdateBusy = false;
let serviceRecoveryTimer = null;
let serviceFlowRunning = false;
let serviceFlowQueued = false;
let serviceWatchdogTimer = null;
let serviceWatchdogRunning = false;

const updateState = {
  supported: false,
  reason: '',
  currentVersion: app.getVersion(),
  checking: false,
  available: false,
  downloading: false,
  downloaded: false,
  latestVersion: null,
  releaseName: null,
  releaseDate: null,
  releaseNotes: '',
  progress: null,
  error: null,
  lastCheckedAt: null,
  lastEventAt: null,
};

const lightweightUpdateState = {
  supported: true,
  busy: false,
  checking: false,
  downloading: false,
  available: false,
  currentVersion: null,
  latestVersion: null,
  downloadUrl: null,
  downloadPath: null,
  progress: null,
  currentRoot: null,
  builtInVersion: app.getVersion(),
  usingLightweight: false,
  canRollback: false,
  error: null,
  lastActionAt: null,
};

app.setName('CodexBridge Weixin Admin');
Menu.setApplicationMenu(null);

const singleInstanceLock = smokeTest || app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

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
    if (isQuitting || updateInstallRequested) {
      return;
    }
    event.preventDefault();
    void shutdownAndQuit('before-quit');
  });
}

async function run() {
  await fsp.mkdir(serviceLogsDir, { recursive: true });
  installSetupIpcHandlers();
  installUpdateIpcHandlers();
  configureAutoUpdater();
  const serviceEnv = await buildServiceEnv();

  await assignAvailableServicePorts(serviceEnv);
  adminUrl = args.adminUrl || resolveAdminUrl(serviceEnv);

  if (!smokeTest && shouldShowFirstRunSetup(serviceEnv)) {
    mainWindow = createMainWindow();
    await loadSetupPage(serviceEnv);
    return;
  }

  await startBridgeFlow(serviceEnv);
}

async function startBridgeFlow(serviceEnv) {
  if (serviceFlowRunning) {
    serviceFlowQueued = true;
    return;
  }
  serviceFlowRunning = true;
  clearServiceRecoveryTimer();
  try {
    await startBridgeFlowInternal(serviceEnv);
  } finally {
    serviceFlowRunning = false;
    if (serviceFlowQueued && !isQuitting) {
      serviceFlowQueued = false;
      const nextEnv = await buildServiceEnv();
      await assignAvailableServicePorts(nextEnv);
      adminUrl = args.adminUrl || resolveAdminUrl(nextEnv);
      await startBridgeFlow(nextEnv);
    }
  }
}

async function startBridgeFlowInternal(serviceEnv) {
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
  await loadAdminPanelWithRetry();
  startServiceWatchdog();
  scheduleStartupUpdateCheck();
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
  serviceEnv.WEIXIN_ADMIN_PORT = serviceEnv.WEIXIN_ADMIN_PORT || String(DEFAULT_ADMIN_PORT);
  serviceEnv.CODEX_NATIVE_API_PORT = serviceEnv.CODEX_NATIVE_API_PORT || String(DEFAULT_NATIVE_API_PORT);
  serviceEnv.WEIXIN_PROGRESS_PREVIEWS = serviceEnv.WEIXIN_PROGRESS_PREVIEWS || '0';
  serviceEnv.CODEX_REAL_BIN = serviceEnv.CODEX_REAL_BIN || resolveBundledCodexBin() || '';
  return serviceEnv;
}

async function assignAvailableServicePorts(serviceEnv) {
  if (args.adminUrl) {
    return;
  }
  const adminHost = serviceEnv.WEIXIN_ADMIN_HOST || '127.0.0.1';
  const preferredAdminPort = parsePort(serviceEnv.WEIXIN_ADMIN_PORT, DEFAULT_ADMIN_PORT);
  const preferredAdminUrl = `http://${adminHost}:${preferredAdminPort}`;
  const existingState = await tryGetAdminState(preferredAdminUrl, 800);
  if (existingState) {
    serviceEnv.WEIXIN_ADMIN_PORT = String(preferredAdminPort);
    serviceEnv.CODEX_NATIVE_API_PORT = String(parsePort(serviceEnv.CODEX_NATIVE_API_PORT, DEFAULT_NATIVE_API_PORT));
    return;
  }

  const adminPort = await findAvailablePort(adminHost, preferredAdminPort, 50);
  serviceEnv.WEIXIN_ADMIN_PORT = String(adminPort);

  const nativeHost = serviceEnv.CODEX_NATIVE_API_HOST || '127.0.0.1';
  const preferredNativePort = parsePort(serviceEnv.CODEX_NATIVE_API_PORT, DEFAULT_NATIVE_API_PORT);
  const nativePort = await findAvailablePort(nativeHost, preferredNativePort, 50, new Set([adminPort]));
  serviceEnv.CODEX_NATIVE_API_PORT = String(nativePort);
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

async function findAvailablePort(host, preferredPort, maxAttempts, reserved = new Set()) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = preferredPort + offset;
    if (port > 65535) {
      break;
    }
    if (reserved.has(port)) {
      continue;
    }
    if (await isTcpPortAvailable(host, port)) {
      return port;
    }
  }
  throw new Error(`No available local port found from ${preferredPort} on ${host}`);
}

function isTcpPortAvailable(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
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
  ipcMain.handle('codexbridge:first-run:sync-ccswitch', async () => {
    const state = resolveCcswitchSetupState();
    if (!state.apiKey) {
      throw new Error('没有在 CCSwitch / Codex 当前配置中找到 API key。请先在 CCSwitch 中切换到可用账号，或在 Codex 登录/配置后重试。');
    }
    if (!state.model) {
      throw new Error('没有在 CCSwitch / Codex 当前配置中找到模型名称。请先在 CCSwitch 中选择模型后重试。');
    }
    return {
      ok: true,
      provider: state.providerName || 'OpenAI Compatible',
      baseUrl: state.baseUrl || 'https://api.openai.com/v1',
      model: state.model,
      capabilities: state.capabilities || 'default',
      providerId: state.providerId || 'openai-compatible',
      apiKey: state.apiKey,
      source: state.source,
      codexHome: state.codexHome,
      configPath: state.configPath,
      authPath: state.authPath,
      apiKeyMasked: maskSecret(state.apiKey),
      errors: state.errors,
    };
  });
}

function installUpdateIpcHandlers() {
  if (updateIpcInstalled) {
    return;
  }
  updateIpcInstalled = true;
  ipcMain.handle('codexbridge:update:get-status', () => getUpdateStatus());
  ipcMain.handle('codexbridge:update:check', async () => {
    await requestUpdateCheck('manual');
    return getUpdateStatus();
  });
  ipcMain.handle('codexbridge:update:download', async () => {
    await requestUpdateDownload();
    return getUpdateStatus();
  });
  ipcMain.handle('codexbridge:update:install', async () => {
    await requestUpdateInstall();
    return { ok: true };
  });
  ipcMain.handle('codexbridge:lightweight-update:get-status', () => getLightweightUpdateStatus());
  ipcMain.handle('codexbridge:lightweight-update:check', async () => {
    await checkLightweightUpdate();
    return getLightweightUpdateStatus();
  });
  ipcMain.handle('codexbridge:lightweight-update:download-install', async () => {
    await downloadAndInstallLightweightUpdate();
    return getLightweightUpdateStatus();
  });
  ipcMain.handle('codexbridge:lightweight-update:install-local', async (_event, payload) => {
    const sourcePath = normalizeString(payload?.path);
    await installLightweightUpdateFromPath(sourcePath);
    return getLightweightUpdateStatus();
  });
  ipcMain.handle('codexbridge:lightweight-update:rollback', async () => {
    await rollbackLightweightCurrent(`manual-rollback-${Date.now()}`);
    patchLightweightUpdateState({ error: null });
    return getLightweightUpdateStatus();
  });
}

function configureAutoUpdater() {
  if (updateHandlersInstalled) {
    return;
  }
  updateHandlersInstalled = true;
  updateState.supported = Boolean(autoUpdater) && app.isPackaged;
  updateState.reason = autoUpdater
    ? (app.isPackaged ? '' : '开发模式不会检查安装包更新，请安装打包版后使用。')
    : 'electron-updater 未安装，无法检查更新。';

  if (!autoUpdater) {
    broadcastUpdateState();
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    patchUpdateState({
      checking: true,
      error: null,
      errorCode: null,
      lastCheckedAt: new Date().toISOString(),
    });
  });
  autoUpdater.on('update-available', (info) => {
    const serialized = serializeUpdateInfo(info);
    patchUpdateState({
      checking: false,
      available: true,
      downloaded: false,
      latestVersion: serialized.version,
      releaseName: serialized.releaseName,
      releaseDate: serialized.releaseDate,
      releaseNotes: serialized.releaseNotes,
      progress: null,
      error: null,
      errorCode: null,
      reason: '',
    });
    void showUpdateAvailablePrompt(serialized);
  });
  autoUpdater.on('update-not-available', (info) => {
    const serialized = serializeUpdateInfo(info);
    patchUpdateState({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      latestVersion: serialized.version || updateState.latestVersion,
      releaseName: serialized.releaseName,
      releaseDate: serialized.releaseDate,
      releaseNotes: serialized.releaseNotes,
      progress: null,
      error: null,
      errorCode: null,
      reason: '',
    });
  });
  autoUpdater.on('download-progress', (progress) => {
    patchUpdateState({
      downloading: true,
      progress: serializeDownloadProgress(progress),
      error: null,
      errorCode: null,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    const serialized = serializeUpdateInfo(info);
    patchUpdateState({
      checking: false,
      available: true,
      downloading: false,
      downloaded: true,
      latestVersion: serialized.version || updateState.latestVersion,
      releaseName: serialized.releaseName || updateState.releaseName,
      releaseDate: serialized.releaseDate || updateState.releaseDate,
      releaseNotes: serialized.releaseNotes || updateState.releaseNotes,
      progress: {
        percent: 100,
        transferred: null,
        total: null,
        bytesPerSecond: null,
      },
      error: null,
      errorCode: null,
      reason: '',
    });
    void showUpdateDownloadedPrompt();
  });
  autoUpdater.on('error', (error) => {
    const normalized = normalizeUpdateError(error);
    patchUpdateState({
      checking: false,
      downloading: false,
      available: false,
      error: normalized.message,
      errorCode: normalized.code,
      reason: normalized.reason || updateState.reason,
    });
  });
  broadcastUpdateState();
}

function scheduleStartupUpdateCheck() {
  if (smokeTest || autoUpdateCheckStarted) {
    return;
  }
  autoUpdateCheckStarted = true;
  if (!autoUpdater || !app.isPackaged) {
    broadcastUpdateState();
    return;
  }
  setTimeout(() => {
    void requestUpdateCheck('startup').catch(() => {});
  }, 2500);
}

async function requestUpdateCheck(_trigger) {
  configureAutoUpdater();
  if (!autoUpdater) {
    patchUpdateState({
      supported: false,
      reason: 'electron-updater 未安装，无法检查更新。',
      error: '当前版本不支持自动更新。',
    });
    return;
  }
  if (!app.isPackaged) {
    patchUpdateState({
      supported: false,
      reason: '开发模式不会检查安装包更新，请安装打包版后使用。',
      error: null,
    });
    return;
  }
  if (updateState.checking) {
    return;
  }
  try {
    patchUpdateState({
      supported: true,
      reason: '',
      checking: true,
      error: null,
      errorCode: null,
      lastCheckedAt: new Date().toISOString(),
    });
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const normalized = normalizeUpdateError(error);
    patchUpdateState({
      checking: false,
      downloading: false,
      available: false,
      error: normalized.message,
      errorCode: normalized.code,
      reason: normalized.reason || updateState.reason,
    });
  }
}

async function requestUpdateDownload() {
  configureAutoUpdater();
  if (!autoUpdater || !app.isPackaged) {
    throw new Error(updateState.reason || '当前版本不支持自动更新。');
  }
  if (!updateState.available) {
    throw new Error('还没有发现可下载的新版本，请先检查更新。');
  }
  if (updateState.downloaded) {
    return;
  }
  if (updateState.downloading) {
    return;
  }
  try {
    patchUpdateState({ downloading: true, progress: null, error: null, errorCode: null });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    const normalized = normalizeUpdateError(error);
    patchUpdateState({
      downloading: false,
      error: normalized.message,
      errorCode: normalized.code,
      reason: normalized.reason || updateState.reason,
    });
    throw error;
  }
}

async function requestUpdateInstall() {
  configureAutoUpdater();
  if (!autoUpdater || !app.isPackaged) {
    throw new Error(updateState.reason || '当前版本不支持自动更新。');
  }
  if (!updateState.downloaded) {
    throw new Error('更新包还没有下载完成。');
  }
  updateInstallRequested = true;
  isQuitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setClosable(false);
    mainWindow.setTitle('CodexBridge Weixin Admin - Installing update...');
    mainWindow.hide();
  }
  if (stopOnClose) {
    await stopService('software-update').catch(() => {});
  }
  autoUpdater.quitAndInstall(false, true);
}

function getUpdateStatus() {
  return {
    ...updateState,
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    canCheck: Boolean(autoUpdater) && app.isPackaged && !updateState.checking && !updateState.downloading,
    canDownload: Boolean(autoUpdater) && app.isPackaged && updateState.available && !updateState.downloading && !updateState.downloaded,
    canInstall: Boolean(autoUpdater) && app.isPackaged && updateState.downloaded,
  };
}

function getLightweightUpdateStatus() {
  const activeRootDir = resolveActiveRootDir();
  const manifest = isValidLightweightRoot(activeRootDir)
    ? readLightweightManifest(activeRootDir)
    : null;
  const status = {
    ...lightweightUpdateState,
    busy: lightweightUpdateBusy,
    currentVersion: manifest?.version || null,
    currentRoot: activeRootDir,
    builtInVersion: app.getVersion(),
    usingLightweight: activeRootDir !== ROOT_DIR,
    canRollback: fs.existsSync(lightweightCurrentDir),
    canCheck: !lightweightUpdateBusy && !lightweightUpdateState.checking && !lightweightUpdateState.downloading,
    canDownloadInstall: !lightweightUpdateBusy && lightweightUpdateState.available && Boolean(lightweightUpdateState.downloadUrl),
  };
  Object.assign(lightweightUpdateState, status);
  return status;
}

function patchLightweightUpdateState(patch) {
  Object.assign(lightweightUpdateState, patch, {
    lastActionAt: new Date().toISOString(),
  });
}

async function installLightweightUpdateFromPath(sourcePath) {
  if (!sourcePath) {
    throw new Error('请选择轻量更新包目录或 zip 文件。');
  }
  if (lightweightUpdateBusy) {
    throw new Error('轻量更新正在处理中，请稍后再试。');
  }
  lightweightUpdateBusy = true;
  patchLightweightUpdateState({ busy: true, error: null });
  const stagingDir = path.join(lightweightDownloadsDir, `staging-${Date.now()}`);
  try {
    await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    await fsp.mkdir(stagingDir, { recursive: true });
    const stat = await fsp.stat(sourcePath);
    if (stat.isDirectory()) {
      await copyDirectory(sourcePath, stagingDir);
    } else if (stat.isFile() && /\.zip$/iu.test(sourcePath)) {
      await extractZipArchive(sourcePath, stagingDir);
    } else {
      throw new Error('轻量更新包只支持目录或 .zip 文件。');
    }
    const packageRoot = findLightweightPackageRoot(stagingDir);
    const manifest = validateLightweightPackageRoot(packageRoot);
    await activateLightweightPackage(packageRoot, manifest);
    patchLightweightUpdateState({
      currentVersion: manifest.version || null,
      currentRoot: lightweightCurrentDir,
      usingLightweight: true,
      canRollback: true,
      error: null,
    });
  } catch (error) {
    patchLightweightUpdateState({ error: error?.message || String(error) });
    throw error;
  } finally {
    lightweightUpdateBusy = false;
    patchLightweightUpdateState({ busy: false });
    await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function checkLightweightUpdate() {
  if (lightweightUpdateBusy || lightweightUpdateState.checking) {
    return;
  }
  lightweightUpdateBusy = true;
  patchLightweightUpdateState({
    busy: true,
    checking: true,
    error: null,
    progress: null,
  });
  try {
    const release = await fetchJson('https://api.github.com/repos/gouyu-hou/CodexBridge-Weixin/releases/latest');
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find((item) => {
      const name = normalizeString(item?.name);
      return /^CodexBridge-Lightweight-.+\.zip$/iu.test(name);
    });
    if (!asset) {
      patchLightweightUpdateState({
        checking: false,
        available: false,
        latestVersion: normalizeString(release.tag_name || release.name),
        downloadUrl: null,
        error: '最新 Release 里没有轻量更新包，请使用完整安装包更新。',
      });
      return;
    }
    const latestVersion = extractLightweightVersion(asset.name) || normalizeString(release.tag_name || release.name);
    const currentVersion = getLightweightUpdateStatus().currentVersion || app.getVersion();
    const available = isVersionNewer(latestVersion, currentVersion);
    patchLightweightUpdateState({
      checking: false,
      available,
      latestVersion,
      downloadUrl: normalizeString(asset.browser_download_url),
      downloadPath: null,
      error: available ? null : '当前轻量代码已经是最新。',
    });
  } catch (error) {
    patchLightweightUpdateState({
      checking: false,
      available: false,
      error: error?.message || String(error),
    });
  } finally {
    lightweightUpdateBusy = false;
    patchLightweightUpdateState({ busy: false, checking: false });
  }
}

async function downloadAndInstallLightweightUpdate() {
  if (lightweightUpdateBusy || lightweightUpdateState.downloading) {
    return;
  }
  const downloadUrl = normalizeString(lightweightUpdateState.downloadUrl);
  if (!downloadUrl) {
    throw new Error('还没有可下载的轻量更新包，请先检查更新。');
  }
  lightweightUpdateBusy = true;
  patchLightweightUpdateState({
    busy: true,
    downloading: true,
    error: null,
    progress: null,
  });
  try {
    await fsp.mkdir(lightweightDownloadsDir, { recursive: true });
    const fileName = sanitizeFileName(path.basename(new URL(downloadUrl).pathname) || `CodexBridge-Lightweight-${Date.now()}.zip`);
    const targetPath = path.join(lightweightDownloadsDir, fileName);
    await downloadFile(downloadUrl, targetPath);
    patchLightweightUpdateState({ downloadPath: targetPath });
    lightweightUpdateBusy = false;
    patchLightweightUpdateState({ busy: false, downloading: false });
    await installLightweightUpdateFromPath(targetPath);
    patchLightweightUpdateState({
      available: false,
      downloadPath: targetPath,
      error: null,
    });
  } catch (error) {
    patchLightweightUpdateState({
      downloading: false,
      error: error?.message || String(error),
    });
    throw error;
  } finally {
    lightweightUpdateBusy = false;
    patchLightweightUpdateState({ busy: false, downloading: false });
  }
}

function extractLightweightVersion(name) {
  const match = String(name || '').match(/^CodexBridge-Lightweight-(.+)\.zip$/iu);
  return normalizeString(match?.[1]);
}

function isVersionNewer(candidate, current) {
  const left = parseVersionParts(candidate);
  const right = parseVersionParts(current);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index] || 0;
    const r = right[index] || 0;
    if (l > r) return true;
    if (l < r) return false;
  }
  return false;
}

function parseVersionParts(value) {
  return String(value || '')
    .replace(/^v/iu, '')
    .split(/[.-]/u)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

async function fetchJson(url) {
  const text = await requestText(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'CodexBridge-Weixin-Admin',
    },
  });
  return JSON.parse(text);
}

async function downloadFile(url, targetPath) {
  const response = await requestBuffer(url, {
    headers: {
      accept: 'application/octet-stream',
      'user-agent': 'CodexBridge-Weixin-Admin',
    },
    onProgress(progress) {
      patchLightweightUpdateState({ progress });
    },
  });
  await fsp.writeFile(targetPath, response);
}

function requestText(url, options = {}) {
  return requestBuffer(url, options).then((buffer) => buffer.toString('utf8'));
}

function requestBuffer(url, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: options.headers || {},
      timeout: 30_000,
    }, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirectCount >= 5) {
          reject(new Error('下载重定向次数过多。'));
          return;
        }
        const nextUrl = new URL(location, url).toString();
        requestBuffer(nextUrl, options, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      const chunks = [];
      let transferred = 0;
      const total = Number(response.headers['content-length']) || null;
      response.on('data', (chunk) => {
        chunks.push(chunk);
        transferred += chunk.length;
        if (options.onProgress) {
          options.onProgress({
            transferred,
            total,
            percent: total ? (transferred / total) * 100 : null,
          });
        }
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.on('timeout', () => {
      request.destroy(new Error('request timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}

function findLightweightPackageRoot(rootDir) {
  if (isValidLightweightRoot(rootDir)) {
    return rootDir;
  }
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length === 1) {
    const nested = path.join(rootDir, directories[0].name);
    if (isValidLightweightRoot(nested)) {
      return nested;
    }
  }
  return rootDir;
}

function validateLightweightPackageRoot(rootDir) {
  const manifest = readLightweightManifest(rootDir);
  if (!manifest || manifest.kind !== 'codexbridge-lightweight-update') {
    throw new Error(`轻量更新包缺少 ${LIGHTWEIGHT_MANIFEST_NAME}。`);
  }
  if (!fs.existsSync(path.join(rootDir, 'src', 'cli.ts'))) {
    throw new Error('轻量更新包缺少 src/cli.ts。');
  }
  if (!fs.existsSync(path.join(rootDir, 'scripts', 'service', 'run-weixin-service.mjs'))) {
    throw new Error('轻量更新包缺少服务启动脚本。');
  }
  if (!fs.existsSync(path.join(rootDir, 'package.json'))) {
    throw new Error('轻量更新包缺少 package.json。');
  }
  return manifest;
}

async function activateLightweightPackage(packageRoot, manifest) {
  await fsp.mkdir(lightweightUpdatesDir, { recursive: true });
  const nextDir = path.join(lightweightUpdatesDir, `next-${Date.now()}`);
  await fsp.rm(nextDir, { recursive: true, force: true }).catch(() => {});
  await copyDirectory(packageRoot, nextDir);
  validateLightweightPackageRoot(nextDir);

  const previousBackup = path.join(lightweightBackupDir, 'previous');
  await fsp.mkdir(lightweightBackupDir, { recursive: true });
  await fsp.rm(previousBackup, { recursive: true, force: true }).catch(() => {});
  if (fs.existsSync(lightweightCurrentDir)) {
    await fsp.rename(lightweightCurrentDir, previousBackup);
  }
  try {
    await fsp.rename(nextDir, lightweightCurrentDir);
    await fsp.writeFile(
      path.join(lightweightCurrentDir, '.installed.json'),
      `${JSON.stringify({
        installedAt: new Date().toISOString(),
        version: manifest.version || null,
        baseVersion: app.getVersion(),
      }, null, 2)}\n`,
      'utf8',
    );
    await linkLightweightDependencies(lightweightCurrentDir);
  } catch (error) {
    await fsp.rm(lightweightCurrentDir, { recursive: true, force: true }).catch(() => {});
    if (fs.existsSync(previousBackup)) {
      await fsp.rename(previousBackup, lightweightCurrentDir).catch(() => {});
    }
    throw error;
  }
}

async function linkLightweightDependencies(targetRootDir) {
  const sourceNodeModules = path.join(ROOT_DIR, 'node_modules');
  const targetNodeModules = path.join(targetRootDir, 'node_modules');
  if (!fs.existsSync(sourceNodeModules) || fs.existsSync(targetNodeModules)) {
    return;
  }
  try {
    await fsp.symlink(sourceNodeModules, targetNodeModules, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    // If linking is blocked, keep the package installed. Startup will fall back
    // to the built-in code if dependencies cannot be resolved.
  }
}

async function copyDirectory(sourceDir, targetDir) {
  await fsp.cp(sourceDir, targetDir, {
    recursive: true,
    force: true,
    dereference: false,
    filter: (source) => {
      const normalized = source.replace(/\\/gu, '/');
      return !/\/(?:node_modules|release|CodexBridgeData|\.git)(?:\/|$)/u.test(normalized);
    },
  });
}

async function extractZipArchive(zipPath, targetDir) {
  if (process.platform === 'win32') {
    const command = [
      '$ErrorActionPreference = "Stop"',
      `Expand-Archive -LiteralPath ${quotePowerShell(zipPath)} -DestinationPath ${quotePowerShell(targetDir)} -Force`,
    ].join('; ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || '解压轻量更新包失败。');
    }
    return;
  }
  const result = spawnSync('unzip', ['-q', zipPath, '-d', targetDir], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || '解压轻量更新包失败。');
  }
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

function serializeUpdateInfo(info) {
  const record = info && typeof info === 'object' ? info : {};
  return {
    version: normalizeString(record.version),
    releaseName: normalizeString(record.releaseName),
    releaseDate: normalizeString(record.releaseDate),
    releaseNotes: normalizeReleaseNotes(record.releaseNotes),
  };
}

function normalizeReleaseNotes(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          return item.trim();
        }
        if (item && typeof item === 'object') {
          return normalizeString(item.note || item.notes || item.description || item.releaseNotes);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
  return normalizeString(value);
}

function serializeDownloadProgress(progress) {
  const record = progress && typeof progress === 'object' ? progress : {};
  return {
    percent: normalizeFiniteNumber(record.percent),
    transferred: normalizeFiniteNumber(record.transferred),
    total: normalizeFiniteNumber(record.total),
    bytesPerSecond: normalizeFiniteNumber(record.bytesPerSecond),
  };
}

function normalizeFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function patchUpdateState(patch) {
  Object.assign(updateState, patch, {
    currentVersion: app.getVersion(),
    lastEventAt: new Date().toISOString(),
  });
  broadcastUpdateState();
}

function broadcastUpdateState() {
  const status = getUpdateStatus();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('codexbridge:update:status', status);
    }
  }
}

async function showUpdateAvailablePrompt(info) {
  if (smokeTest || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const version = info.version || updateState.latestVersion || '';
  if (!version || updatePromptedVersion === version) {
    return;
  }
  updatePromptedVersion = version;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '发现新版本',
    message: `发现 CodexBridge Weixin Admin 新版本 ${version}`,
    detail: '可以现在下载更新包；下载完成后会让你确认是否重启安装。',
    buttons: ['稍后', '下载更新'],
    defaultId: 1,
    cancelId: 0,
  }).catch(() => ({ response: 0 }));
  if (result.response === 1) {
    await requestUpdateDownload().catch(() => {});
  }
}

async function showUpdateDownloadedPrompt() {
  if (smokeTest || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '更新已下载',
    message: '新版本已经下载完成',
    detail: '点击“重启安装”后会先停止微信桥接服务，然后安装新版本。',
    buttons: ['稍后', '重启安装'],
    defaultId: 1,
    cancelId: 0,
  }).catch(() => ({ response: 0 }));
  if (result.response === 1) {
    await requestUpdateInstall().catch(() => {});
  }
}

function formatError(error) {
  return error?.stack || error?.message || String(error);
}

function normalizeUpdateError(error) {
  const raw = formatError(error);
  const statusCode = Number(error?.statusCode ?? error?.status ?? error?.code);
  const lower = raw.toLowerCase();
  if ((statusCode === 404 || lower.includes('404')) && lower.includes('latest.yml')) {
    return {
      code: 'missing-latest-yml',
      reason: 'GitHub Release 缺少自动更新清单 latest.yml。',
      message: '自动更新清单未配置：当前 GitHub Release 里没有 latest.yml。请把 release/latest.yml、安装包 exe 和 exe.blockmap 一起上传到对应版本的 Release；上传前可以先手动下载安装包使用。',
    };
  }
  if (lower.includes('github.com') && (lower.includes('404') || lower.includes('not found'))) {
    return {
      code: 'github-release-not-found',
      reason: 'GitHub Release 或附件不存在。',
      message: '没有找到 GitHub Release 更新文件。请检查 package.json 里的版本号、GitHub Release 标签，以及 Release 附件是否已上传完整。',
    };
  }
  if (lower.includes('net::') || lower.includes('timeout') || lower.includes('timed out') || lower.includes('econn')) {
    return {
      code: 'network',
      reason: '网络连接 GitHub 失败。',
      message: '检查更新失败：无法连接 GitHub。请检查网络或稍后重试；这不会影响微信桥接服务正常使用。',
    };
  }
  return {
    code: 'unknown',
    reason: '',
    message: raw,
  };
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
  serviceExited = false;
  serviceProcess = startService(serviceEnv);
  try {
    return await waitForAdminState(adminUrl, 90_000);
  } catch (error) {
    if (resolveActiveRootDir() !== ROOT_DIR) {
      await rollbackLightweightCurrent(`startup-failed-${Date.now()}`);
      await loadStatusPage('Recovering CodexBridge', 'The lightweight code update failed to start. Rolling back to the built-in version...');
      serviceExited = false;
      serviceProcess = startService(serviceEnv);
      return waitForAdminState(adminUrl, 90_000);
    }
    throw error;
  }
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
    if (isQuitting || errorCode === -3) {
      return;
    }
    void loadStatusPage(
      'Recovering admin panel',
      `The local dashboard is not ready yet (${errorDescription || errorCode}). Retrying...`,
    );
    scheduleServiceRecovery('admin-panel-load-failed');
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
  const activeRootDir = resolveActiveRootDir();
  const runner = path.join(activeRootDir, 'scripts', 'service', 'run-weixin-service.mjs');
  if (!fs.existsSync(runner)) {
    throw new Error(`Service runner not found: ${runner}`);
  }
  const runtimeEnv = {
    ...runtime.env,
    CODEXBRIDGE_APP_ROOT: activeRootDir,
    CODEXBRIDGE_BASE_ROOT: ROOT_DIR,
    NODE_PATH: buildNodePath(activeRootDir, ROOT_DIR, runtime.env.NODE_PATH),
  };
  const child = spawn(runtime.command, [
    runner,
    '--once',
    '--root-dir', activeRootDir,
    '--base-root-dir', ROOT_DIR,
    '--home-dir', os.homedir(),
    '--state-dir', stateDir,
    '--service-env-file', envFile,
    '--stdout-log', serviceStdoutLog,
    '--stderr-log', serviceStderrLog,
    '--cwd', defaultCwd,
  ], {
    cwd: activeRootDir,
    env: runtimeEnv,
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  });
  child.once('exit', () => {
    serviceExited = true;
    serviceProcess = null;
    scheduleServiceRecovery('service-exited');
  });
  child.once('error', (error) => {
    serviceExited = true;
    serviceProcess = null;
    if (!isQuitting) {
      scheduleServiceRecovery(`service-spawn-error: ${error.message || error}`);
    }
  });
  return child;
}

function resolveActiveRootDir() {
  if (isValidLightweightRoot(lightweightCurrentDir)) {
    return lightweightCurrentDir;
  }
  return ROOT_DIR;
}

function isValidLightweightRoot(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return false;
  }
  const manifest = readLightweightManifest(rootDir);
  if (!manifest || manifest.kind !== 'codexbridge-lightweight-update') {
    return false;
  }
  return fs.existsSync(path.join(rootDir, 'src', 'cli.ts'))
    && fs.existsSync(path.join(rootDir, 'scripts', 'service', 'run-weixin-service.mjs'))
    && fs.existsSync(path.join(rootDir, 'package.json'));
}

function readLightweightManifest(rootDir) {
  return safeJsonRead(path.join(rootDir, LIGHTWEIGHT_MANIFEST_NAME));
}

function buildNodePath(activeRootDir, baseRootDir, inheritedNodePath) {
  const entries = [
    path.join(activeRootDir, 'node_modules'),
    path.join(baseRootDir, 'node_modules'),
    inheritedNodePath,
  ].filter(Boolean);
  return entries.join(path.delimiter);
}

async function rollbackLightweightCurrent(reason) {
  if (!fs.existsSync(lightweightCurrentDir)) {
    return false;
  }
  await fsp.mkdir(lightweightFailedDir, { recursive: true });
  const failedTarget = path.join(lightweightFailedDir, sanitizeFileName(reason || `failed-${Date.now()}`));
  await fsp.rm(failedTarget, { recursive: true, force: true }).catch(() => {});
  await fsp.rename(lightweightCurrentDir, failedTarget).catch(async () => {
    await fsp.rm(lightweightCurrentDir, { recursive: true, force: true }).catch(() => {});
  });
  return true;
}

function sanitizeFileName(value) {
  return String(value || 'item').replace(/[<>:"/\\|?*\x00-\x1F]/gu, '-').slice(0, 120) || 'item';
}

function scheduleServiceRecovery(reason) {
  if (isQuitting || smokeTest) {
    return;
  }
  if (serviceRecoveryTimer) {
    return;
  }
  serviceRecoveryTimer = setTimeout(() => {
    serviceRecoveryTimer = null;
    void recoverService(reason);
  }, 1500);
}

function startServiceWatchdog() {
  if (serviceWatchdogTimer || smokeTest) {
    return;
  }
  serviceWatchdogTimer = setInterval(() => {
    void checkServiceWatchdog();
  }, 5000);
  if (typeof serviceWatchdogTimer.unref === 'function') {
    serviceWatchdogTimer.unref();
  }
}

async function checkServiceWatchdog() {
  if (isQuitting || serviceFlowRunning || serviceWatchdogRunning) {
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  serviceWatchdogRunning = true;
  try {
    const state = await tryGetAdminState(adminUrl, 2500);
    if (!state && !isQuitting) {
      await recoverService('service-watchdog');
    }
  } finally {
    serviceWatchdogRunning = false;
  }
}

async function recoverService(reason) {
  if (isQuitting || smokeTest) {
    return;
  }
  try {
    await loadStatusPage('Recovering WeChat bridge', `The local service stopped (${reason}). Restarting it now...`);
    const serviceEnv = await buildServiceEnv();
    await assignAvailableServicePorts(serviceEnv);
    adminUrl = args.adminUrl || resolveAdminUrl(serviceEnv);
    await startBridgeFlow(serviceEnv);
  } catch (error) {
    if (!isQuitting) {
      await loadStatusPage('WeChat bridge needs attention', formatError(error));
      await showFatalError(error);
    }
  }
}

async function loadAdminPanelWithRetry() {
  const targetUrl = addQueryParam(adminUrl, 'shutdownOnClose', '0');
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await waitForAdminState(adminUrl, attempt === 1 ? 5000 : 10000);
      await mainWindow.loadURL(targetUrl);
      return;
    } catch (error) {
      lastError = error;
      await loadStatusPage(
        'Opening admin panel',
        `Waiting for the local dashboard... (${attempt}/5)`,
      );
      await sleep(1000);
      if (!isQuitting && attempt === 2) {
        scheduleServiceRecovery('admin-panel-load-retry');
      }
    }
  }
  throw lastError || new Error(`Could not load admin panel: ${targetUrl}`);
}

function clearServiceRecoveryTimer() {
  if (serviceRecoveryTimer) {
    clearTimeout(serviceRecoveryTimer);
    serviceRecoveryTimer = null;
  }
}

function clearServiceWatchdogTimer() {
  if (serviceWatchdogTimer) {
    clearInterval(serviceWatchdogTimer);
    serviceWatchdogTimer = null;
  }
  serviceWatchdogRunning = false;
}

async function shutdownAndQuit(reason) {
  if (isQuitting) {
    return;
  }
  isQuitting = true;
  clearServiceRecoveryTimer();
  clearServiceWatchdogTimer();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle('CodexBridge Weixin Admin - Stopping service...');
    mainWindow.hide();
  }
  try {
    if (stopOnClose) {
      await stopService(reason);
    }
  } finally {
    setTimeout(() => {
      process.exit(0);
    }, 1000).unref?.();
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
  const preset = normalizeFirstRunProviderPreset(
    serviceEnv.CODEX_COMPAT_PRESET
      || presetKeyForFirstRunProvider({
        capabilities: serviceEnv.CODEX_COMPAT_CAPABILITIES,
        providerId: serviceEnv.CODEX_COMPAT_PROVIDER_ID,
        provider: serviceEnv.CODEX_COMPAT_PROVIDER_NAME,
        baseUrl: serviceEnv.CODEX_COMPAT_BASE_URL,
        model: serviceEnv.CODEX_COMPAT_DEFAULT_MODEL || serviceEnv.CODEX_COMPAT_MODEL,
      }),
  );
  const presetConfig = FIRST_RUN_PROVIDER_PRESETS[preset] || FIRST_RUN_PROVIDER_PRESETS.default;
  await mainWindow.loadURL(createSetupPageUrl({
    provider: serviceEnv.CODEX_COMPAT_PROVIDER_NAME || presetConfig.provider,
    baseUrl: serviceEnv.CODEX_COMPAT_BASE_URL || presetConfig.baseUrl,
    model: serviceEnv.CODEX_COMPAT_DEFAULT_MODEL || serviceEnv.CODEX_COMPAT_MODEL || presetConfig.model,
    preset,
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
  const presetKey = normalizeFirstRunProviderPreset(record.preset);
  const preset = FIRST_RUN_PROVIDER_PRESETS[presetKey] || FIRST_RUN_PROVIDER_PRESETS.default;
  const provider = normalizeString(record.provider) || preset.provider || 'Z Token - Codex';
  const apiKey = normalizeString(record.apiKey);
  let baseUrl = normalizeString(record.baseUrl) || preset.baseUrl;
  const model = normalizeFirstRunModelForPreset(preset, normalizeString(record.model), '');
  if (!apiKey) {
    throw new Error('请填写 API key。');
  }
  if (!baseUrl || !/^https?:\/\//iu.test(baseUrl)) {
    throw new Error('接口地址必须以 http:// 或 https:// 开头。');
  }
  if (!model) {
    throw new Error('请填写模型名称。');
  }
  if ((preset.capabilities || '').toLowerCase() === 'deepseek') {
    baseUrl = normalizeFirstRunDeepSeekBaseUrl(baseUrl);
  }
  return {
    provider,
    apiKey,
    baseUrl: normalizeFirstRunUrlValue(baseUrl),
    model,
    preset: presetKey,
  };
}

function normalizeProviderPreset(value) {
  const normalized = normalizeString(value).toLowerCase();
  const allowed = new Set(['default', 'ztoken-claude', 'official-codex', 'official-claude-code', 'deepseek', 'minimax', 'qwen', 'openrouter', 'kimi', 'gemini', 'iflow']);
  return allowed.has(normalized) ? normalized : 'default';
}

function normalizeFirstRunProviderPreset(value) {
  const normalized = normalizeString(value).toLowerCase();
  return Object.hasOwn(FIRST_RUN_PROVIDER_PRESETS, normalized) ? normalized : 'default';
}

function normalizeFirstRunUrlValue(value) {
  return String(value || '').trim().replace(/\/+$/u, '');
}

function normalizeFirstRunDeepSeekBaseUrl(value) {
  const raw = normalizeFirstRunUrlValue(value);
  if (!raw) {
    return 'https://api.deepseek.com/v1';
  }
  if (/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/v1(?:\/responses)?$/iu.test(raw)) {
    return 'https://api.deepseek.com/v1';
  }
  if (/^https?:\/\/api\.deepseek\.com\/?$/iu.test(raw)) {
    return 'https://api.deepseek.com/v1';
  }
  if (/^https?:\/\/api\.deepseek\.com\/v1(?:\/)?$/iu.test(raw)) {
    return 'https://api.deepseek.com/v1';
  }
  return raw;
}

function normalizeFirstRunModelForPreset(preset, model, fallbackModel) {
  const value = normalizeString(model);
  const fallback = normalizeString(fallbackModel);
  const lower = value.toLowerCase();
  const fallbackLower = fallback.toLowerCase();
  const capabilities = normalizeString(preset?.capabilities).toLowerCase() || 'default';
  const allowedModels = Array.isArray(preset?.models) ? preset.models : [];
  if (preset?.restrictModels && allowedModels.length) {
    if (allowedModels.includes(value)) return value;
    if (allowedModels.includes(fallback)) return fallback;
    return preset.model || allowedModels[0] || '';
  }
  if (capabilities === 'deepseek') {
    if (lower.startsWith('deepseek-')) return value;
    if (fallbackLower.startsWith('deepseek-')) return fallback;
    return preset.model || 'deepseek-v4-flash';
  }
  if (capabilities === 'claude-code' || capabilities === 'claude') {
    if (lower.startsWith('claude-')) return value;
    if (fallbackLower.startsWith('claude-')) return fallback;
    return preset.model || 'claude-opus-4-8';
  }
  if (capabilities === 'qwen') {
    if (lower.startsWith('qwen')) return value;
    if (fallbackLower.startsWith('qwen')) return fallback;
    return preset.model || 'qwen3-coder-flash';
  }
  if (capabilities === 'gemini') {
    if (lower.startsWith('gemini-')) return value;
    if (fallbackLower.startsWith('gemini-')) return fallback;
    return preset.model || 'gemini-2.5-flash';
  }
  if (capabilities === 'kimi') {
    if (lower.startsWith('kimi-') || lower.startsWith('moonshot-')) return value;
    if (fallbackLower.startsWith('kimi-') || fallbackLower.startsWith('moonshot-')) return fallback;
    return preset.model || 'kimi-k2-0905-preview';
  }
  if (capabilities === 'minimax') {
    if (lower.startsWith('minimax-') || lower.startsWith('abab')) return value;
    if (fallbackLower.startsWith('minimax-') || fallbackLower.startsWith('abab')) return fallback;
    return preset.model || 'MiniMax-M2.0';
  }
  return value || fallback || preset?.model || '';
}

function presetKeyForFirstRunProvider(provider) {
  const capabilities = normalizeString(provider?.capabilities).toLowerCase();
  const providerId = normalizeString(provider?.providerId).toLowerCase();
  const providerName = normalizeString(provider?.provider || provider?.providerName).replace(/\s+/gu, '').toLowerCase();
  const baseUrl = normalizeString(provider?.baseUrl).toLowerCase();
  const model = normalizeString(provider?.model).toLowerCase();
  const isZToken = providerName.includes('ztoken') || baseUrl.includes('ztoken.app');
  if (isZToken && model.startsWith('claude-')) {
    return 'ztoken-claude';
  }
  if (isZToken) {
    return 'default';
  }
  if ((providerName.includes('官网') || providerName.includes('official')) && providerName.includes('claude')) {
    return 'official-claude-code';
  }
  if ((providerName.includes('官网') || providerName.includes('official') || baseUrl.includes('api.openai.com')) && (providerName.includes('codex') || model.startsWith('gpt-') || model.startsWith('o'))) {
    return 'official-codex';
  }
  if (capabilities === 'claude') {
    return 'official-claude-code';
  }
  if (Object.hasOwn(FIRST_RUN_PROVIDER_PRESETS, capabilities)) {
    return capabilities;
  }
  if (providerName.includes('claude')) {
    return 'ztoken-claude';
  }
  for (const [key, preset] of Object.entries(FIRST_RUN_PROVIDER_PRESETS)) {
    if (providerId === normalizeString(preset.providerId).toLowerCase()) {
      return key;
    }
  }
  if (providerName.includes('deepseek')) return 'deepseek';
  if (providerName.includes('qwen')) return 'qwen';
  if (providerName.includes('openrouter')) return 'openrouter';
  if (providerName.includes('kimi') || providerName.includes('moonshot')) return 'kimi';
  if (providerName.includes('gemini') || providerName.includes('google')) return 'gemini';
  if (providerName.includes('minimax')) return 'minimax';
  if (providerName.includes('iflow')) return 'iflow';
  return 'default';
}

async function writeFirstRunEnvFile(setup) {
  await fsp.mkdir(path.dirname(envFile), { recursive: true });
  const bundledCodex = resolveBundledCodexBin();
  const preset = FIRST_RUN_PROVIDER_PRESETS[setup.preset] || FIRST_RUN_PROVIDER_PRESETS.default;
  const capabilities = preset.capabilities || 'default';
  const profileId = preset.profileId || 'openai-default';
  const providerId = preset.providerId || 'openai-compatible';
  const modelIds = Array.isArray(preset.models) && preset.models.length
    ? preset.models.join(',')
    : setup.model;
  const lines = [
    '# CodexBridge Weixin Admin configuration',
    '# Generated by the desktop app first-run setup.',
    '',
    'WEIXIN_DM_POLICY=open',
    'WEIXIN_GROUP_POLICY=disabled',
    'WEIXIN_ADMIN_ENABLE=1',
    'WEIXIN_ADMIN_HOST=127.0.0.1',
    `WEIXIN_ADMIN_PORT=${DEFAULT_ADMIN_PORT}`,
    'WEIXIN_PROGRESS_PREVIEWS=0',
    'WEIXIN_MAX_CONCURRENT_TURNS=3',
    'WEIXIN_EVENT_DISPATCH_CONCURRENCY=12',
    'WEIXIN_ATTACHMENT_CONCURRENCY=3',
    'WEIXIN_ACCOUNT_POLL_CONCURRENCY=4',
    '',
    `CODEX_DEFAULT_PROVIDER_PROFILE_ID=${escapeEnvValue(profileId)}`,
    `CODEX_COMPAT_PROVIDER_ID=${escapeEnvValue(providerId)}`,
    `CODEX_COMPAT_PROVIDER_NAME=${escapeEnvValue(setup.provider)}`,
    `CODEX_COMPAT_API_KEY=${escapeEnvValue(setup.apiKey)}`,
    `CODEX_COMPAT_BASE_URL=${escapeEnvValue(setup.baseUrl)}`,
    `CODEX_COMPAT_DEFAULT_MODEL=${escapeEnvValue(setup.model)}`,
    `CODEX_COMPAT_MODEL_IDS=${escapeEnvValue(modelIds)}`,
    `CODEX_COMPAT_CAPABILITIES=${escapeEnvValue(capabilities)}`,
    `CODEX_COMPAT_PRESET=${escapeEnvValue(setup.preset)}`,
    'CODEX_NATIVE_API_ENABLE=1',
    `CODEX_NATIVE_API_PORT=${DEFAULT_NATIVE_API_PORT}`,
  ];
  if (bundledCodex) {
    lines.push(`CODEX_REAL_BIN=${escapeEnvValue(bundledCodex)}`);
  }
  lines.push('');
  await fsp.writeFile(envFile, `${lines.join('\n')}\n`, 'utf8');
}

function resolveCcswitchSetupState() {
  const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const configPath = path.join(codexHome, 'config.toml');
  const authPath = path.join(codexHome, 'auth.json');
  const errors = [];
  const configText = readTextFileSync(configPath, errors);
  const auth = readJsonFileSync(authPath, errors);
  const config = parseCodexConfigToml(configText);
  const providerId = normalizeString(config.root.model_provider) || 'openai';
  const provider = config.modelProviders[providerId] || {};
  const envKey = normalizeString(provider.env_key) || 'OPENAI_API_KEY';
  const providerToken = normalizeString(provider.experimental_bearer_token)
    || normalizeString(provider.api_key)
    || normalizeString(provider.apiKey);
  const authApiKey = readAuthSecret(auth, envKey)
    || (envKey === 'OPENAI_API_KEY' ? '' : readAuthSecret(auth, 'OPENAI_API_KEY'));
  const envApiKey = normalizeString(process.env[envKey])
    || (envKey === 'OPENAI_API_KEY' ? '' : normalizeString(process.env.OPENAI_API_KEY));
  const apiKey = providerToken || authApiKey || envApiKey || '';
  const baseUrl = normalizeString(provider.base_url)
    || normalizeString(provider.baseUrl)
    || normalizeString(process.env.OPENAI_BASE_URL)
    || normalizeString(process.env.CODEX_COMPAT_BASE_URL)
    || 'https://api.openai.com/v1';
  const model = normalizeString(config.root.model)
    || normalizeString(provider.model)
    || normalizeString(process.env.CODEX_DEFAULT_MODEL)
    || normalizeString(process.env.CODEX_COMPAT_DEFAULT_MODEL)
    || '';
  const providerName = normalizeProviderDisplayName(
    normalizeString(provider.name)
      || normalizeString(provider.display_name)
      || providerId,
  );
  const endpoint = normalizeCcswitchProviderEndpoint({
    providerId,
    providerName,
    baseUrl,
    model,
  });
  return {
    codexHome,
    configPath,
    authPath,
    source: apiKey ? (providerToken ? 'codex-config' : 'codex-auth') : 'none',
    providerId,
    providerName: endpoint.providerName || providerName,
    baseUrl: endpoint.baseUrl,
    model,
    capabilities: endpoint.capabilities,
    apiKey,
    apiKeyEnv: envKey,
    errors,
  };
}

function readTextFileSync(filePath, errors) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      errors.push(`${filePath}: ${error?.message || String(error)}`);
    }
    return '';
  }
}

function readJsonFileSync(filePath, errors) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      errors.push(`${filePath}: ${error?.message || String(error)}`);
    }
    return null;
  }
}

function readAuthSecret(auth, key) {
  if (!auth || !key) {
    return '';
  }
  return normalizeString(auth[key]) || normalizeString(auth.tokens?.[key]);
}

function parseCodexConfigToml(text) {
  const root = {};
  const modelProviders = {};
  let section = '';
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([^\]]+)\]$/u);
    if (sectionMatch) {
      section = sectionMatch[1]?.trim() || '';
      if (section.startsWith('model_providers.')) {
        const id = unquoteTomlString(section.slice('model_providers.'.length).trim());
        if (id) {
          modelProviders[id] ||= {};
        }
      }
      continue;
    }
    const equalAt = line.indexOf('=');
    if (equalAt <= 0) {
      continue;
    }
    const key = line.slice(0, equalAt).trim();
    const value = parseTomlScalar(line.slice(equalAt + 1).trim());
    if (!key || value === null) {
      continue;
    }
    if (!section) {
      root[key] = value;
      continue;
    }
    if (section.startsWith('model_providers.')) {
      const id = unquoteTomlString(section.slice('model_providers.'.length).trim());
      if (id) {
        modelProviders[id] ||= {};
        modelProviders[id][key] = value;
      }
    }
  }
  return { root, modelProviders };
}

function stripTomlComment(line) {
  let quoted = false;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] || '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"' || char === "'") {
      if (quoted && quote === char) {
        quoted = false;
        quote = '';
      } else if (!quoted) {
        quoted = true;
        quote = char;
      }
      continue;
    }
    if (!quoted && char === '#') {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseTomlScalar(raw) {
  const normalized = raw.trim();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('"') || normalized.startsWith("'")) {
    return unquoteTomlString(normalized);
  }
  if (normalized === 'true' || normalized === 'false') {
    return normalized;
  }
  return normalized.replace(/,+$/u, '').trim();
}

function unquoteTomlString(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const body = value.slice(1, -1);
    if (value.startsWith("'")) {
      return body;
    }
    return body.replace(/\\(["\\/bfnrt])/gu, (_match, token) => {
      if (token === 'n') return '\n';
      if (token === 'r') return '\r';
      if (token === 't') return '\t';
      if (token === 'b') return '\b';
      if (token === 'f') return '\f';
      return token;
    });
  }
  return value;
}

function normalizeProviderDisplayName(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  const compact = normalized.replace(/[\s_-]+/gu, '').toLowerCase();
  if (compact === 'ztoken') {
    return 'Z Token';
  }
  if (compact === 'openai' || compact === 'openaicompatible') {
    return 'OpenAI Compatible';
  }
  return normalized;
}

function normalizeCcswitchProviderEndpoint({ providerId, providerName, baseUrl, model }) {
  const normalizedBaseUrl = normalizeString(baseUrl).replace(/\/+$/u, '');
  const providerHint = `${providerId} ${providerName} ${model}`.replace(/[\s_-]+/gu, '').toLowerCase();
  const isLocalResponsesProxy = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/.*)?\/v1\/responses$/iu.test(normalizedBaseUrl)
    || /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/.*)?\/responses$/iu.test(normalizedBaseUrl);
  const useCanonicalProviderUrl = !normalizedBaseUrl || isLocalResponsesProxy;
  if (providerHint.includes('deepseek')) {
    return {
      providerName: 'DeepSeek',
      baseUrl: useCanonicalProviderUrl ? 'https://api.deepseek.com' : normalizedBaseUrl,
      capabilities: 'deepseek',
    };
  }
  if (providerHint.includes('qwen') || providerHint.includes('dashscope')) {
    return {
      providerName: 'Qwen',
      baseUrl: useCanonicalProviderUrl ? 'https://dashscope.aliyuncs.com/compatible-mode/v1' : normalizedBaseUrl,
      capabilities: 'qwen',
    };
  }
  if (providerHint.includes('openrouter')) {
    return {
      providerName: 'OpenRouter',
      baseUrl: useCanonicalProviderUrl ? 'https://openrouter.ai/api/v1' : normalizedBaseUrl,
      capabilities: 'openrouter',
    };
  }
  if (providerHint.includes('kimi') || providerHint.includes('moonshot')) {
    return {
      providerName: 'Kimi',
      baseUrl: useCanonicalProviderUrl ? 'https://api.moonshot.cn/v1' : normalizedBaseUrl,
      capabilities: 'kimi',
    };
  }
  if (providerHint.includes('gemini') || providerHint.includes('google')) {
    return {
      providerName: 'Gemini',
      baseUrl: useCanonicalProviderUrl ? 'https://generativelanguage.googleapis.com/v1beta/openai' : normalizedBaseUrl,
      capabilities: 'gemini',
    };
  }
  if (providerHint.includes('minimax')) {
    return {
      providerName: 'MiniMax',
      baseUrl: useCanonicalProviderUrl ? 'https://api.minimax.chat/v1' : normalizedBaseUrl,
      capabilities: 'minimax',
    };
  }
  if (providerHint.includes('iflow')) {
    return {
      providerName: 'iFlow',
      baseUrl: useCanonicalProviderUrl ? 'https://apis.iflow.cn/v1' : normalizedBaseUrl,
      capabilities: 'iflow',
    };
  }
  if (providerHint.includes('claude')) {
    return {
      providerName: 'Claude Code',
      baseUrl: normalizedBaseUrl,
      capabilities: 'claude-code',
    };
  }
  return {
    providerName,
    baseUrl: normalizedBaseUrl,
    capabilities: 'default',
  };
}

function maskSecret(value) {
  const text = normalizeString(value);
  if (!text) {
    return '';
  }
  if (text.length <= 8) {
    return `${text.slice(0, 1)}***${text.slice(-1)}`;
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
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
  const presetsPayload = encodeURIComponent(JSON.stringify(FIRST_RUN_PROVIDER_PRESETS));
  const presetOptions = Object.entries(FIRST_RUN_PROVIDER_PRESETS)
    .map(([key, preset]) => `<option value="${escapeHtml(key)}">${escapeHtml(preset.label || preset.provider || key)}</option>`)
    .join('\n            ');
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
    .field-help {
      display: block;
      margin-top: 8px;
      color: #667085;
      font-size: 13px;
      font-weight: 400;
      line-height: 1.5;
    }
    .field-help a {
      color: #2563eb;
      font-weight: 700;
      text-decoration: none;
    }
    .field-help a:hover { text-decoration: underline; }
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
    button.secondary {
      color: #1f2937;
      border: 1px solid #cfd8e6;
      background: #fff;
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
            ${presetOptions}
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
          <span class="field-help">如果使用中转站，可以点击 <a href="https://ztoken.app/register?aff=8M7CSMLY5J77" target="_blank" rel="noopener">ztoken.app</a> 跳转到中转站获取接口地址。</span>
        </label>
        <label class="span">
          模型
          <select name="model" id="model" required></select>
          <input id="model-custom" autocomplete="off" placeholder="自定义模型名称" style="display:none;">
        </label>
      </div>
      <div class="actions">
        <button class="secondary" id="sync-ccswitch" type="button">同步 CCSwitch</button>
        <button id="submit" type="submit">保存并启动</button>
      </div>
      <div class="status" id="status"></div>
      <div class="hint">启动后，在管理面板里生成微信登录二维码，并完成账号绑定。</div>
    </form>
  </main>
  <script>
    const defaults = JSON.parse(decodeURIComponent('${payload}'));
    const presets = JSON.parse(decodeURIComponent('${presetsPayload}'));
    const CUSTOM_MODEL_OPTION = '__custom__';
    const form = document.getElementById('setup-form');
    const status = document.getElementById('status');
    const submit = document.getElementById('submit');
    const syncCcswitch = document.getElementById('sync-ccswitch');
    const preset = document.getElementById('preset');
    const provider = document.getElementById('provider');
    const baseUrl = document.getElementById('baseUrl');
    const model = document.getElementById('model');
    const modelCustom = document.getElementById('model-custom');
    const apiKey = document.getElementById('apiKey');

    function presetKeyForProvider(data) {
      const capabilities = String(data?.capabilities || data?.preset || '').toLowerCase();
      const providerId = String(data?.providerId || '').toLowerCase();
      const providerName = String(data?.provider || data?.providerName || '').replace(/\s+/g, '').toLowerCase();
      const url = String(data?.baseUrl || '').toLowerCase();
      const modelName = String(data?.model || '').toLowerCase();
      const isZToken = providerName.includes('ztoken') || url.includes('ztoken.app');
      if (isZToken && modelName.startsWith('claude-')) return 'ztoken-claude';
      if (isZToken) return 'default';
      if ((providerName.includes('官网') || providerName.includes('official')) && providerName.includes('claude')) return 'official-claude-code';
      if ((providerName.includes('官网') || providerName.includes('official') || url.includes('api.openai.com')) && (providerName.includes('codex') || modelName.startsWith('gpt-') || modelName.startsWith('o'))) return 'official-codex';
      if (capabilities === 'claude') return 'official-claude-code';
      if (presets[capabilities]) return capabilities;
      if (providerName.includes('claude')) return 'ztoken-claude';
      for (const [key, item] of Object.entries(presets)) {
        if (providerId && providerId === String(item.providerId || '').toLowerCase()) return key;
      }
      if (providerName.includes('deepseek')) return 'deepseek';
      if (providerName.includes('qwen')) return 'qwen';
      if (providerName.includes('openrouter')) return 'openrouter';
      if (providerName.includes('kimi') || providerName.includes('moonshot')) return 'kimi';
      if (providerName.includes('gemini') || providerName.includes('google')) return 'gemini';
      if (providerName.includes('minimax')) return 'minimax';
      if (providerName.includes('iflow')) return 'iflow';
      return 'default';
    }

    function populateModelOptions(presetKey, selectedModel) {
      const item = presets[presetKey] || presets.default;
      const models = Array.isArray(item.models) && item.models.length ? item.models.slice() : [item.model].filter(Boolean);
      const wanted = String(selectedModel || '').trim();
      if (wanted && !models.includes(wanted) && !item.restrictModels) {
        models.push(wanted);
      }
      model.innerHTML = '';
      for (const name of models) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        model.appendChild(option);
      }
      const customOption = document.createElement('option');
      customOption.value = CUSTOM_MODEL_OPTION;
      customOption.textContent = '自定义';
      model.appendChild(customOption);
      if (wanted && models.includes(wanted)) {
        model.value = wanted;
      } else if (wanted && !item.restrictModels) {
        model.value = wanted;
      } else {
        model.value = item.model || models[0] || '';
      }
      modelCustom.value = '';
      syncCustomModelVisibility();
    }

    function syncCustomModelVisibility() {
      const isCustom = model.value === CUSTOM_MODEL_OPTION;
      modelCustom.style.display = isCustom ? '' : 'none';
      modelCustom.required = isCustom;
    }

    function selectedModel() {
      if (model.value === CUSTOM_MODEL_OPTION) {
        return modelCustom.value.trim();
      }
      return String(model.value || '').trim();
    }

    function normalizeModelForPreset(item, value, fallback) {
      const raw = String(value || '').trim();
      const backup = String(fallback || '').trim();
      const allowed = Array.isArray(item.models) ? item.models : [];
      if (item.restrictModels && allowed.length) {
        if (allowed.includes(raw)) return raw;
        if (allowed.includes(backup)) return backup;
        return item.model || allowed[0] || '';
      }
      return raw || backup || item.model || '';
    }

    function applyPreset(presetKey, selected) {
      const item = presets[presetKey] || presets.default;
      provider.value = item.provider;
      baseUrl.value = item.baseUrl;
      populateModelOptions(presetKey, selected || item.model);
    }

    preset.value = presets[defaults.preset] ? defaults.preset : presetKeyForProvider(defaults);
    provider.value = defaults.provider || presets[preset.value].provider;
    baseUrl.value = defaults.baseUrl || presets[preset.value].baseUrl;
    populateModelOptions(preset.value, defaults.model || presets[preset.value].model);

    preset.addEventListener('change', () => {
      applyPreset(preset.value);
    });
    model.addEventListener('change', syncCustomModelVisibility);

    syncCcswitch.addEventListener('click', async () => {
      status.textContent = '';
      syncCcswitch.disabled = true;
      syncCcswitch.textContent = '正在同步...';
      try {
        if (!window.codexbridgeSetup?.syncCcswitch) {
          throw new Error('Desktop setup bridge is unavailable.');
        }
        const result = await window.codexbridgeSetup.syncCcswitch();
        const nextPreset = presetKeyForProvider(result);
        preset.value = nextPreset;
        provider.value = result.provider || provider.value;
        baseUrl.value = result.baseUrl || baseUrl.value;
        populateModelOptions(nextPreset, result.model || selectedModel());
        apiKey.value = result.apiKey || apiKey.value;
        status.style.color = '#047857';
        status.textContent = '已同步 CCSwitch / Codex 当前配置：' + [
          result.provider,
          result.model,
          result.apiKeyMasked ? ('key ' + result.apiKeyMasked) : ''
        ].filter(Boolean).join(' · ');
      } catch (error) {
        status.style.color = '#b42318';
        status.textContent = error?.message || String(error);
      } finally {
        syncCcswitch.disabled = false;
        syncCcswitch.textContent = '同步 CCSwitch';
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      status.textContent = '';
      status.style.color = '#b42318';
      submit.disabled = true;
      submit.textContent = '正在启动...';
      try {
        if (!window.codexbridgeSetup?.saveConfig) {
          throw new Error('Desktop setup bridge is unavailable.');
        }
        const item = presets[preset.value] || presets.default;
        await window.codexbridgeSetup.saveConfig({
          preset: preset.value,
          provider: provider.value.trim() || item.provider,
          apiKey: apiKey.value.trim(),
          baseUrl: baseUrl.value.trim() || item.baseUrl,
          model: normalizeModelForPreset(item, selectedModel(), item.model)
        });
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
