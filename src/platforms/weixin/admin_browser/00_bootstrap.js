    const ADMIN_TOKEN = document.querySelector('meta[name="codexbridge-admin-token"]')?.content || '';
    const queryParams = new URLSearchParams(window.location.search);
    const state = {
      pairingTimer: null,
      shutdownOnClose: queryParams.get('shutdownOnClose') !== '0',
      pageId: (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(16).slice(2),
      lifecycleTimer: null,
      lifecycleClosed: false,
      closeBeacon: null,
      statusTimer: null,
      settingsLoaded: false,
      currentModelProvider: null,
      updaterStatus: null,
      updaterUnsubscribe: null,
      diagnostics: null,
      setup: null,
      setupStep: 0,
      setupAutoOpened: false,
      providerModelCatalogs: new Map(),
      providerModelCatalogPromises: new Map(),
      providerModelCatalogGenerations: new Map(),
      providerUsageRequestId: 0,
      providerUsageProfileId: '',
      providerProfiles: []
    };
    const $ = (id) => document.getElementById(id);
    const THEME_STORAGE_KEY = 'codexbridge-admin-theme';

    function normalizeThemeMode(mode) {
      return ['light', 'dark'].includes(String(mode || '')) ? String(mode) : 'light';
    }

    function getPreferredThemeMode() {
      try {
        const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (saved) {
          return normalizeThemeMode(saved);
        }
      } catch {}
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function setThemeMode(mode) {
      const next = normalizeThemeMode(mode);
      document.body.dataset.theme = next;
      const label = $('theme-label');
      if (label) {
        label.textContent = next === 'dark' ? '切换到亮色主题' : '切换到暗色主题';
      }
      const toggle = $('theme-toggle');
      if (toggle) {
        toggle.title = next === 'dark' ? '切换到亮色主题' : '切换到暗色主题';
        toggle.setAttribute('aria-label', toggle.title);
      }
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {}
    }

    function initThemeMode() {
      setThemeMode(getPreferredThemeMode());
      const toggle = $('theme-toggle');
      if (toggle) {
        toggle.addEventListener('click', () => {
          setThemeMode(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
        });
      }
    }

    const providerPresets = {
      default: {
        profileId: 'openai-default',
        providerId: 'openai-compatible',
        providerName: 'Z Token - Codex',
        baseUrl: 'https://ztoken.app/',
        model: 'gpt-5.5',
        models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2'],
        capabilities: 'default',
        restrictModels: true
      },
      'ztoken-claude': {
        profileId: 'claude-code',
        providerId: 'claude-code',
        providerName: 'Z Token - Claude',
        baseUrl: 'https://ztoken.app/',
        model: 'claude-opus-4-8',
        models: ['claude-fable-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-5-20251101', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-6'],
        capabilities: 'claude-code',
        restrictModels: true
      },
      'official-codex': {
        profileId: 'openai-official',
        providerId: 'openai-compatible',
        providerName: '官网 Codex',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.5',
        models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.1-codex', 'gpt-5.1-codex-mini', 'gpt-5', 'gpt-5-codex', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o3-mini', 'o4-mini'],
        capabilities: 'default'
      },
      'official-claude-code': {
        profileId: 'claude-official',
        providerId: 'claude',
        providerName: '官网 Claude Code',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-6',
        models: ['claude-sonnet-4-6', 'claude-sonnet-4-5-20250929', 'claude-opus-4-6', 'claude-opus-4-5-20251101', 'claude-haiku-4-5-20251001', 'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022'],
        capabilities: 'claude'
      },
      deepseek: {
        profileId: 'deepseek',
        providerId: 'deepseek',
        providerName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-flash',
        models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner', 'deepseek-coder', 'deepseek-v3', 'deepseek-r1'],
        capabilities: 'deepseek'
      },
      qwen: {
        profileId: 'qwen',
        providerId: 'qwen',
        providerName: 'Qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3-coder-flash',
        models: ['qwen3-coder-flash', 'qwen3-coder-plus', 'qwen3-max', 'qwen3-plus', 'qwen3-turbo', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
        capabilities: 'qwen'
      },
      openrouter: {
        profileId: 'openrouter',
        providerId: 'openrouter',
        providerName: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openai/gpt-5.1',
        models: ['openai/gpt-5.1', 'openai/gpt-5', 'openai/gpt-4.1', 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4', 'deepseek/deepseek-chat-v3-0324', 'deepseek/deepseek-r1', 'google/gemini-2.5-pro', 'qwen/qwen3-coder'],
        capabilities: 'openrouter'
      },
      kimi: {
        profileId: 'kimi',
        providerId: 'kimi',
        providerName: 'Kimi',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2-0905-preview',
        models: ['kimi-k2-0905-preview', 'kimi-k2-0711-preview', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
        capabilities: 'kimi'
      },
      gemini: {
        profileId: 'gemini',
        providerId: 'gemini',
        providerName: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-2.5-flash',
        models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
        capabilities: 'gemini'
      },
      minimax: {
        profileId: 'minimax',
        providerId: 'minimax',
        providerName: 'MiniMax',
        baseUrl: 'https://api.minimax.chat/v1',
        model: 'MiniMax-M2.0',
        models: ['MiniMax-M2.0', 'MiniMax-M1', 'MiniMax-Text-01', 'abab6.5s-chat', 'abab6.5g-chat'],
        capabilities: 'minimax'
      },
      iflow: {
        profileId: 'iflow',
        providerId: 'iflow',
        providerName: 'iFlow',
        baseUrl: 'https://apis.iflow.cn/v1',
        model: 'iflow-default',
        models: ['iflow-default', 'Qwen3-Coder', 'DeepSeek-V3', 'DeepSeek-R1', 'GLM-4.5'],
        capabilities: 'iflow'
      }
    };

    function pageLifecycleUrl(path, extra) {
      const params = new URLSearchParams({
        pageId: state.pageId,
        shutdownOnClose: state.shutdownOnClose ? '1' : '0',
        adminToken: ADMIN_TOKEN
      });
      for (const [key, value] of Object.entries(extra || {})) {
        if (value !== undefined && value !== null) {
          params.set(key, String(value));
        }
      }
      return path + '?' + params.toString();
    }

    function sendPageLifecycle(path, extra) {
      if (!state.shutdownOnClose) return;
      const url = pageLifecycleUrl(path, extra);
      const payload = JSON.stringify({
        pageId: state.pageId,
        shutdownOnClose: state.shutdownOnClose,
        ...(extra || {})
      });
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        if (navigator.sendBeacon(url, blob)) {
          return;
        }
      }
      fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-codexbridge-admin-token': ADMIN_TOKEN
        },
        body: payload,
        keepalive: true
      }).catch(() => {});
    }

    function sendPageCloseLifecycle() {
      const extra = { closedAt: Date.now() };
      sendPageLifecycle('/api/page/close', extra);
      sendShutdownRequest('admin-page-closed');
      const image = new Image();
      image.src = pageLifecycleUrl('/api/page/close', extra);
      state.closeBeacon = image;
    }

    function sendShutdownRequest(reason) {
      if (!state.shutdownOnClose) return;
      const payload = JSON.stringify({ reason: reason || 'admin-page-closed' });
      const shutdownUrl = '/api/service/shutdown?adminToken=' + encodeURIComponent(ADMIN_TOKEN);
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        if (navigator.sendBeacon(shutdownUrl, blob)) {
          return;
        }
      }
      fetch(shutdownUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-codexbridge-admin-token': ADMIN_TOKEN
        },
        body: payload,
        keepalive: true
      }).catch(() => {});
    }

    function showPage(page) {
      const target = String(page || 'overview').replace(/^#/, '') || 'overview';
      const links = Array.from(document.querySelectorAll('.side-nav a[data-page]'));
      const panels = Array.from(document.querySelectorAll('[data-page-panel]'));
      const known = panels.some((panel) => panel.dataset.pagePanel === target);
      const next = known ? target : 'overview';
      for (const link of links) {
        link.classList.toggle('active', link.dataset.page === next);
      }
      for (const panel of panels) {
        panel.classList.toggle('active', panel.dataset.pagePanel === next);
      }
      if (window.location.hash !== '#' + next) {
        history.replaceState(null, '', '#' + next);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function startPageLifecycle() {
      if (!state.shutdownOnClose) return;
      sendPageLifecycle('/api/page/heartbeat');
      state.lifecycleTimer = window.setInterval(() => {
        sendPageLifecycle('/api/page/heartbeat');
      }, 5000);
      const closePage = () => {
        if (state.lifecycleClosed) return;
        state.lifecycleClosed = true;
        if (state.lifecycleTimer) {
          window.clearInterval(state.lifecycleTimer);
          state.lifecycleTimer = null;
        }
        sendPageCloseLifecycle();
      };
      window.addEventListener('pagehide', closePage);
      window.addEventListener('beforeunload', closePage);
      window.addEventListener('unload', closePage);
    }

    function fmtTime(value) {
      if (!value) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN');
    }

    function fmtRelativeMs(value) {
      const timestamp = Number(value || 0);
      if (!timestamp) return '-';
      const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
      if (seconds < 60) return seconds + ' 秒前';
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return minutes + ' 分钟前';
      const hours = Math.round(minutes / 60);
      if (hours < 24) return hours + ' 小时前';
      return Math.round(hours / 24) + ' 天前';
    }

    function fmtBytes(value) {
      const bytes = Number(value || 0);
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
      return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
    }

    function readPositiveIntInput(id, fallback) {
      const parsed = Number.parseInt(String($(id).value || ''), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    function setMessage(text, danger) {
      const el = $('message');
      el.textContent = text || '';
      el.style.color = danger ? '#e11d48' : '#64708a';
    }

    function renderImportFileState() {
      const input = $('import-file');
      const file = input.files && input.files[0];
      if (!file) {
        $('import-file-name').textContent = '选择备份 JSON 文件';
        $('import-file-meta').textContent = '支持 .json 文件，导入会覆盖同 id 的账号和会话';
        return;
      }
      $('import-file-name').textContent = file.name || '已选择备份文件';
      $('import-file-meta').textContent = [
        fmtBytes(file.size || 0),
        file.type || 'JSON',
        file.lastModified ? ('修改时间 ' + fmtTime(file.lastModified)) : ''
      ].filter(Boolean).join(' · ');
      $('import-message').textContent = '';
    }

    async function requestJson(url, options) {
      const requestedHeaders = (options && options.headers) || {};
      const res = await fetch(url, {
        ...options,
        headers: {
          'content-type': 'application/json',
          'x-codexbridge-admin-token': ADMIN_TOKEN,
          ...requestedHeaders
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || ('HTTP ' + res.status));
      }
      return data;
    }

    async function runSetupTest(target, buttonId) {
      const button = $(buttonId);
      const result = $('setup-test-result');
      button.disabled = true;
      result.textContent = '正在测试，请稍等...';
      result.style.color = '#64708a';
      try {
        const data = await requestJson('/api/setup/test', {
          method: 'POST',
          body: JSON.stringify({ target })
        });
        const check = data.check || {};
        const ok = check.status === 'ok';
        const warn = check.status === 'warn';
        result.textContent = [
          data.message || '测试完成。',
          data.repairHint ? ('建议：' + data.repairHint) : ''
        ].filter(Boolean).join('\n');
        result.style.color = ok ? '#047857' : (warn ? '#b45309' : '#e11d48');
        await loadState();
      } finally {
        button.disabled = false;
      }
    }

    function browserSleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function isDesktopAdminWindow() {
      return Boolean(window.codexbridgeSetup || window.codexbridgeUpdater || window.codexbridgeLightweightUpdater);
    }

    async function waitForAdminServerReadyAfterServiceRestart(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      await browserSleep(1200);
      while (Date.now() < deadline) {
        try {
          await requestJson('/api/state', { method: 'GET', cache: 'no-store' });
          return true;
        } catch {
          await browserSleep(1000);
        }
      }
      return false;
    }

    async function restartServiceAfterProviderSave(messageId) {
      const message = $(messageId);
      if (!isDesktopAdminWindow()) {
        message.textContent = '已保存。请手动重启软件或服务后生效。';
        return;
      }
      message.textContent = '已保存，正在重启本地服务以应用新的 API key / 模型配置...';
      await fetch('/api/service/shutdown?adminToken=' + encodeURIComponent(ADMIN_TOKEN), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-codexbridge-admin-token': ADMIN_TOKEN
        },
        body: JSON.stringify({ reason: 'model-provider-settings-updated' })
      }).catch(() => {});
      const ready = await waitForAdminServerReadyAfterServiceRestart(60000);
      if (!ready) {
        message.textContent = '配置已保存，但没有检测到服务自动恢复。请关闭并重新打开软件。';
        return;
      }
      await loadState().catch(() => {});
      message.textContent = '服务已重启，新 API key / 模型配置已生效。';
    }

    function updaterApi() {
      return window.codexbridgeUpdater || null;
    }

    function renderUpdaterStatus(status) {
      const api = updaterApi();
      const current = status || {
        supported: false,
        packaged: false,
        reason: api ? '正在读取更新状态...' : '请在桌面安装版窗口中使用自动更新。'
      };
      state.updaterStatus = current;
      $('update-current-version').textContent = current.currentVersion || '-';
      $('update-latest-version').textContent = current.latestVersion || (current.available ? '发现新版本' : '-');
      $('update-last-checked').textContent = current.lastCheckedAt ? fmtTime(current.lastCheckedAt) : '-';
      let label = '等待检查';
      if (!api) {
        label = '浏览器页面不可用';
      } else if (!current.packaged) {
        label = '开发模式';
      } else if (current.errorCode === 'missing-latest-yml') {
        label = '更新清单未配置';
      } else if (current.error) {
        label = '检查失败';
      } else if (current.checking) {
        label = '正在检查';
      } else if (current.downloading) {
        label = '正在下载';
      } else if (current.downloaded) {
        label = '已下载';
      } else if (current.available) {
        label = '发现新版本';
      } else if (current.lastCheckedAt) {
        label = '已是最新';
      }
      $('update-status-label').textContent = label;
      const progress = current.progress || {};
      const percent = Number.isFinite(Number(progress.percent)) ? Math.max(0, Math.min(100, Math.round(Number(progress.percent)))) : (current.downloaded ? 100 : 0);
      setWidth('update-progress-fill', percent);
      if (current.downloading || current.downloaded) {
        const transferred = progress.transferred ? fmtBytes(progress.transferred) : '';
        const total = progress.total ? fmtBytes(progress.total) : '';
        $('update-progress-label').textContent = [percent + '%', transferred && total ? (transferred + ' / ' + total) : ''].filter(Boolean).join(' · ');
      } else {
        $('update-progress-label').textContent = '-';
      }
      const message = current.error || current.reason || (current.available
        ? '发现新版本，可以下载更新。'
        : (current.lastCheckedAt ? '当前已经是最新版本。' : '启动安装版后会自动检查更新。'));
      $('update-message').textContent = message;
      $('update-check').disabled = !api || current.checking || current.downloading || current.canCheck === false;
      $('update-download').disabled = !api || current.downloading || current.downloaded || current.canDownload === false;
      $('update-install').disabled = !api || current.canInstall === false;
      const notes = String(current.releaseNotes || '').trim();
      $('update-release-notes').textContent = notes || '暂无更新日志。';
    }

    async function refreshUpdaterStatus() {
      const api = updaterApi();
      if (!api || !api.getStatus) {
        renderUpdaterStatus(null);
        return;
      }
      renderUpdaterStatus(await api.getStatus());
    }

    async function checkForUpdate() {
      const api = updaterApi();
      if (!api || !api.check) {
        renderUpdaterStatus(null);
        return;
      }
      $('update-message').textContent = '正在检查更新...';
      renderUpdaterStatus(await api.check());
    }

    async function downloadUpdate() {
      const api = updaterApi();
      if (!api || !api.download) {
        renderUpdaterStatus(null);
        return;
      }
      $('update-message').textContent = '正在下载更新包...';
      renderUpdaterStatus(await api.download());
    }

    async function installUpdate() {
      const api = updaterApi();
      if (!api || !api.install) {
        renderUpdaterStatus(null);
        return;
      }
      if (!confirm('确认重启并安装新版本？安装前会先停止微信桥接服务。')) {
        return;
      }
      $('update-message').textContent = '正在停止服务并准备安装...';
      await api.install();
    }

    function lightweightUpdaterApi() {
      return window.codexbridgeLightweightUpdater || null;
    }

    function renderLightweightUpdaterStatus(status) {
      const api = lightweightUpdaterApi();
      const current = status || {
        supported: Boolean(api),
        usingLightweight: false,
        builtInVersion: '-',
        currentVersion: null,
        currentRoot: '',
        canRollback: false,
        error: api ? '' : '请在桌面应用窗口中使用轻量更新。'
      };
      $('light-update-source').textContent = current.usingLightweight ? '轻量代码包' : '内置安装包';
      $('light-update-version').textContent = current.currentVersion || current.builtInVersion || '-';
      $('light-update-status').textContent = current.busy
        ? '处理中'
        : current.error
          ? '有错误'
          : current.available
            ? '发现轻量更新'
          : current.usingLightweight
            ? '已启用'
            : '未启用';
      $('light-update-last-action').textContent = current.lastActionAt ? fmtTime(current.lastActionAt) : '-';
      $('light-update-message').textContent = current.error
        || (current.downloading && current.progress && Number.isFinite(Number(current.progress.percent))
          ? ('正在下载轻量更新：' + Math.round(Number(current.progress.percent)) + '%')
          : '')
        || (current.available ? ('发现轻量更新：' + (current.latestVersion || '-')) : '')
        || (current.currentRoot ? ('当前代码目录：' + current.currentRoot) : '轻量更新只替换业务代码和页面，不重复下载 Electron、Node、Codex runtime。');
      $('light-update-check').disabled = !api || current.busy || current.checking || current.downloading || current.canCheck === false;
      $('light-update-download-install').disabled = !api || current.busy || current.downloading || current.canDownloadInstall === false;
      $('light-update-pick-local').disabled = !api || !api.pickLocal || current.busy;
      $('light-update-install').disabled = !api || current.busy;
      $('light-update-refresh').disabled = !api || current.busy;
      $('light-update-rollback').disabled = !api || current.busy || !current.canRollback;
    }

    async function refreshLightweightUpdaterStatus() {
      const api = lightweightUpdaterApi();
      if (!api || !api.getStatus) {
        renderLightweightUpdaterStatus(null);
        return;
      }
      renderLightweightUpdaterStatus(await api.getStatus());
    }

    async function installLightweightUpdate() {
      const api = lightweightUpdaterApi();
      if (!api || !api.installLocal) {
        renderLightweightUpdaterStatus(null);
        return;
      }
      const sourcePath = $('light-update-path').value.trim();
      if (!sourcePath) {
        $('light-update-message').textContent = '请先填写轻量更新包目录或 zip 文件路径。';
        return;
      }
      $('light-update-message').textContent = '正在安装轻量更新包...';
      const status = await api.installLocal({ path: sourcePath });
      renderLightweightUpdaterStatus(status);
      $('light-update-message').textContent = '轻量更新已安装。请关闭并重新打开应用，让新代码生效。';
    }

    async function pickLocalLightweightUpdate() {
      const api = lightweightUpdaterApi();
      if (!api || !api.pickLocal) {
        $('light-update-message').textContent = '请在桌面应用窗口中使用文件选择功能。';
        return;
      }
      const result = await api.pickLocal();
      if (!result || result.canceled) {
        $('light-update-message').textContent = '已取消选择。';
        return;
      }
      $('light-update-path').value = result.path || '';
      $('light-update-message').textContent = result.path ? '已选择轻量更新包，可以点击“安装轻量包”。' : '没有选择文件。';
    }

    async function checkLightweightUpdate() {
      const api = lightweightUpdaterApi();
      if (!api || !api.check) {
        renderLightweightUpdaterStatus(null);
        return;
      }
      $('light-update-message').textContent = '正在检查轻量更新...';
      renderLightweightUpdaterStatus(await api.check());
    }

    async function downloadInstallLightweightUpdate() {
      const api = lightweightUpdaterApi();
      if (!api || !api.downloadInstall) {
        renderLightweightUpdaterStatus(null);
        return;
      }
      $('light-update-message').textContent = '正在下载并安装轻量更新...';
      const status = await api.downloadInstall();
      renderLightweightUpdaterStatus(status);
      $('light-update-message').textContent = '轻量更新已安装。请关闭并重新打开应用，让新代码生效。';
    }

    async function rollbackLightweightUpdate() {
      const api = lightweightUpdaterApi();
      if (!api || !api.rollback) {
        renderLightweightUpdaterStatus(null);
        return;
      }
      if (!confirm('确认回退到内置安装包代码？回退后请关闭并重新打开应用。')) {
        return;
      }
      $('light-update-message').textContent = '正在回退轻量代码包...';
      const status = await api.rollback();
      renderLightweightUpdaterStatus(status);
      $('light-update-message').textContent = '已回退到内置安装包代码。请关闭并重新打开应用。';
    }

    function startUpdaterBridge() {
      const api = updaterApi();
      if (api && api.onStatus) {
        state.updaterUnsubscribe = api.onStatus((status) => {
          renderUpdaterStatus(status);
        });
      }
      refreshUpdaterStatus().catch((error) => {
        renderUpdaterStatus({
          supported: false,
          reason: error.message || String(error),
          currentVersion: '-'
        });
      });
      refreshLightweightUpdaterStatus().catch((error) => {
        renderLightweightUpdaterStatus({
          supported: false,
          error: error.message || String(error)
        });
      });
    }

    async function loadState() {
      const data = await requestJson('/api/state');
      state.accounts = data.accounts || [];
      state.providerProfiles = data.providerProfiles || [];
      state.setup = data.setup || null;
      renderAccounts(data.accounts || []);
      renderSessionFilters(data.accounts || []);
      renderPairing(data.pairing);
      renderSetup(data);
      renderBridge(data.bridge || { running: true });
      renderRuntimeStatus(data);
      if (!state.settingsLoaded) {
        renderSettings(data.settings || {});
        state.settingsLoaded = true;
      }
      populateProviderUsageProfiles();
      void loadProviderUsage(false);
      renderLogSummary(data.logs || {});
      await Promise.all([
        loadSessions(),
        loadLogs(),
        loadMetrics()
      ]);
      $('account-count').textContent = String((data.accounts || []).length) + ' 个入口';
    }

    async function refreshRuntimeState() {
      const data = await requestJson('/api/state');
      state.setup = data.setup || null;
      renderBridge(data.bridge || { running: true });
      renderRuntimeStatus(data);
      renderPairing(data.pairing);
      renderSetup(data);
      renderLogSummary(data.logs || {});
      await loadMetrics().catch(() => {});
    }

    async function runRefreshList() {
      const button = $('refresh-btn');
      if (button.disabled) return;
      const original = button.textContent || '刷新列表';
      button.disabled = true;
      button.classList.add('refreshing');
      button.innerHTML = '<span class="refresh-spin" aria-hidden="true"></span><span>刷新中...</span>';
      try {
        await loadState();
        button.innerHTML = '<span>已刷新</span>';
        setMessage('列表已刷新', false);
        window.setTimeout(() => {
          button.textContent = original;
          button.classList.remove('refreshing');
          button.disabled = false;
        }, 700);
      } catch (error) {
        button.textContent = original;
        button.classList.remove('refreshing');
        button.disabled = false;
        throw error;
      }
    }

    function fmtDuration(ms) {
      const value = Number(ms || 0);
      if (value <= 0) return '0 ms';
      if (value < 1000) return Math.round(value) + ' ms';
      if (value < 60000) return (value / 1000).toFixed(1) + ' 秒';
      const minutes = Math.floor(value / 60000);
      const seconds = Math.round((value % 60000) / 1000);
      return minutes + ' 分 ' + seconds + ' 秒';
    }

    function fmtNumber(value) {
      const number = Number(value || 0);
      if (!Number.isFinite(number)) return '0';
      return number.toLocaleString('zh-CN');
    }

    function pct(part, total) {
      const p = Number(part || 0);
      const t = Number(total || 0);
      if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return 0;
      return Math.max(0, Math.min(100, Math.round((p / t) * 100)));
    }

    function setWidth(id, percent) {
      const el = $(id);
      if (el) el.style.width = Math.max(0, Math.min(100, Number(percent || 0))) + '%';
    }

    async function loadMetrics() {
      const data = await requestJson('/api/metrics');
      renderMetrics(data || {});
    }

    function populateProviderUsageProfiles() {
      const select = $('provider-usage-profile');
      const previous = String(select.value || state.providerUsageProfileId || '').trim();
      const preferred = String(state.currentModelProvider && state.currentModelProvider.profileId || '').trim();
      select.textContent = '';
      for (const profile of Array.isArray(state.providerProfiles) ? state.providerProfiles : []) {
        const id = String(profile.providerProfileId || '').trim();
        if (!id) continue;
        const option = document.createElement('option');
        option.value = id;
        const displayName = String(profile.displayName || '').trim();
        option.textContent = displayName && displayName !== id ? (displayName + ' (' + id + ')') : id;
        select.appendChild(option);
      }
      const available = [...select.options].map((option) => option.value);
      const selected = available.includes(previous)
        ? previous
        : available.includes(preferred)
          ? preferred
          : (available[0] || '');
      select.value = selected;
      state.providerUsageProfileId = selected;
      select.disabled = available.length === 0;
      $('provider-usage-refresh').disabled = available.length === 0;
      if (available.length === 0) {
        $('provider-usage-summary').textContent = '暂无可查询的 Provider profile';
        $('provider-usage-windows').textContent = '';
      }
    }

    async function loadProviderUsage(forceRefresh) {
      const select = $('provider-usage-profile');
      const providerProfileId = String(select.value || '').trim();
      if (!providerProfileId) return;
      const requestId = ++state.providerUsageRequestId;
      state.providerUsageProfileId = providerProfileId;
      select.disabled = true;
      $('provider-usage-refresh').disabled = true;
      $('provider-usage-summary').textContent = forceRefresh ? '正在刷新用量...' : '正在加载用量...';
      const suffix = forceRefresh ? '/usage/refresh' : '/usage';
      try {
        const data = await requestJson(
          '/api/provider-profiles/' + encodeURIComponent(providerProfileId) + suffix,
          { method: forceRefresh ? 'POST' : 'GET' }
        );
        if (requestId !== state.providerUsageRequestId || select.value !== providerProfileId) return;
        renderProviderUsage(data || {});
      } catch (error) {
        if (requestId !== state.providerUsageRequestId || select.value !== providerProfileId) return;
        $('provider-usage-summary').textContent = error.message || '用量查询失败';
        $('provider-usage-windows').textContent = '';
      } finally {
        if (requestId === state.providerUsageRequestId) {
          select.disabled = false;
          $('provider-usage-refresh').disabled = false;
        }
      }
    }

    function renderProviderUsage(data) {
      const report = data && data.report || null;
      const summary = $('provider-usage-summary');
      const windowsRoot = $('provider-usage-windows');
      windowsRoot.textContent = '';
      if (!report || data.status !== 'available') {
        summary.textContent = data.refreshFailed
          ? '用量查询失败，请稍后刷新'
          : '暂不支持用量查询';
        return;
      }
      const summaryParts = [report.provider || data.providerKind || 'Provider'];
      if (report.plan) summaryParts.push('套餐 ' + report.plan);
      if (report.credits && report.credits.unlimited) {
        summaryParts.push('Credits 不限量');
      } else if (report.credits && report.credits.balance) {
        summaryParts.push('Credits ' + report.credits.balance);
      }
      summaryParts.push(data.source === 'cache' ? '缓存数据' : '最新数据');
      summary.textContent = summaryParts.join(' · ');

      const buckets = Array.isArray(report.buckets) ? report.buckets : [];
      for (const bucket of buckets) {
        for (const windowInfo of Array.isArray(bucket.windows) ? bucket.windows : []) {
          const used = Math.max(0, Math.min(100, Number(windowInfo.usedPercent || 0)));
          const remaining = Math.max(0, 100 - used);
          const row = document.createElement('div');
          row.className = 'provider-usage-window';
          const meta = document.createElement('div');
          meta.className = 'progress-meta';
          const label = document.createElement('span');
          label.textContent = [bucket.name, windowInfo.name].filter(Boolean).join(' · ') || '用量窗口';
          const value = document.createElement('strong');
          value.textContent = '剩余 ' + Math.round(remaining) + '% · ' + formatUsageReset(windowInfo.resetAfterSeconds);
          meta.appendChild(label);
          meta.appendChild(value);
          const track = document.createElement('div');
          track.className = 'progress-track';
          const fill = document.createElement('div');
          fill.className = 'progress-fill';
          fill.style.width = remaining + '%';
          track.appendChild(fill);
          row.appendChild(meta);
          row.appendChild(track);
          windowsRoot.appendChild(row);
        }
      }
      if (!windowsRoot.childElementCount) {
        windowsRoot.textContent = '当前 Provider 没有返回额度窗口';
      }
    }

    function formatUsageReset(seconds) {
      const value = Math.max(0, Number(seconds || 0));
      if (value < 60) return '即将重置';
      if (value < 3600) return Math.ceil(value / 60) + ' 分钟后重置';
      if (value < 86400) return Math.ceil(value / 3600) + ' 小时后重置';
      return Math.ceil(value / 86400) + ' 天后重置';
    }

    function formatErrorStage(stage) {
      if (stage === 'poll') return '轮询';
      if (stage === 'commit') return '游标';
      if (stage === 'runtime') return '运行';
      return stage || '未知';
    }

    function renderMetrics(m) {
      const breakdown = m.errorBreakdown || {};
      const currentError = m.currentError || null;
      const replyFailures = Number(m.replyFailures || 0);
      $('metric-messages').textContent = fmtNumber(m.messagesReceived || 0);
      $('metric-turns-done').textContent = fmtNumber(m.turnsCompleted || 0) + ' / ' + fmtNumber(m.turnsFailed || 0);
      $('metric-deliveries').textContent = fmtNumber(m.deliveriesSucceeded || 0) + ' / ' + fmtNumber(m.deliveriesFailed || 0);
      $('metric-current-error').textContent = currentError ? ('异常 · ' + formatErrorStage(currentError.stage)) : '正常';
      $('metric-errors-hour').textContent = fmtNumber(m.errorsRecentHour || 0);
      $('metric-errors-total').textContent = fmtNumber(m.errors || 0);
      $('metric-error-breakdown').textContent = fmtNumber(breakdown.poll || 0) + ' / ' + fmtNumber(breakdown.runtime || 0);
      $('metric-reply-failures').textContent = fmtNumber(replyFailures);
      $('metric-avg-turn').textContent = fmtDuration(m.avgTurnDurationMs);
      $('metric-last-turn').textContent = fmtDuration(m.lastTurnDurationMs);
      renderLatencyMetrics(m.latency || {});
      $('metric-active-turns').textContent = fmtNumber(m.activeTurns || 0) + ' / ' + fmtNumber(m.queuedTurns || 0);
      $('metric-pending').textContent = fmtNumber(m.pendingDeliveryRetries || 0);
      $('metrics-uptime').textContent = m.uptimeMs ? ('运行 ' + fmtDuration(m.uptimeMs)) : '';
      $('metrics-error-detail').textContent = currentError
        ? ('当前错误：' + formatErrorStage(currentError.stage) + ' · ' + (currentError.message || '未知错误'))
        : ('当前无持续错误。最近 1 小时错误 ' + fmtNumber(m.errorsRecentHour || 0) + ' 次；后台错误累计 ' + fmtNumber(m.errors || 0) + ' 次。');
      renderMetricCharts(m);
      renderMetricsByAccount(m.byAccount || {});
    }

    function renderLatencyMetrics(latency) {
      const last = latency.last || {};
      const avg = latency.avg || {};
      const total = Number(last.totalMs || 0);
      const queue = Number(last.queueMs || 0);
      const coordinator = Number(last.coordinatorMs || 0);
      const delivery = Number(last.deliveryMs || 0);
      $('metric-latency-total').textContent = fmtDuration(total);
      $('metric-latency-queue').textContent = fmtDuration(queue);
      $('metric-latency-coordinator').textContent = fmtDuration(coordinator);
      $('metric-latency-delivery').textContent = fmtDuration(delivery);
      $('latency-queue-label').textContent = fmtDuration(queue);
      $('latency-coordinator-label').textContent = fmtDuration(coordinator);
      $('latency-delivery-label').textContent = fmtDuration(delivery);
      setWidth('latency-queue-fill', total ? Math.max(4, pct(queue, total)) : 0);
      setWidth('latency-coordinator-fill', total ? Math.max(4, pct(coordinator, total)) : 0);
      setWidth('latency-delivery-fill', total ? Math.max(4, pct(delivery, total)) : 0);
      const count = Number(latency.count || 0);
      const command = last.commandName ? (' · ' + last.commandName) : '';
      const account = last.accountId ? (' · ' + last.accountId) : '';
      $('metric-latency-detail').textContent = count
        ? ('最近一次' + account + command + '；平均总耗时 ' + fmtDuration(avg.totalMs)
          + '，平均 Codex ' + fmtDuration(avg.coordinatorMs)
          + '，平均微信发送 ' + fmtDuration(avg.deliveryMs))
        : '暂无链路数据；收到并回复一条微信消息后会自动统计。';
    }

    async function resetMetrics() {
      if (!window.confirm('确认清零统计数字？这不会删除会话、账号或日志。')) {
        return;
      }
      const data = await requestJson('/api/metrics/reset', { method: 'POST' });
      renderMetrics(data.metrics || {});
      setMessage('统计已清零。');
    }

    async function runDiagnostics() {
      $('diagnostics-run').disabled = true;
      $('diagnostics-updated').textContent = '正在检查...';
      $('diagnostics-summary-text').textContent = '正在检查服务、微信入口、模型接口和本地端口...';
      try {
        const data = await requestJson('/api/diagnostics/run', { method: 'POST' });
        state.diagnostics = data;
        renderDiagnostics(data);
      } finally {
        $('diagnostics-run').disabled = false;
      }
    }

    function renderDiagnostics(data) {
      const summary = (data && data.summary) || {};
      const status = summary.status || 'ok';
      $('diagnostics-summary-status').textContent = status === 'fail' ? '需要处理' : (status === 'warn' ? '有提醒' : '正常');
      $('diagnostics-summary-ok').textContent = fmtNumber(summary.ok || 0);
      $('diagnostics-summary-warn').textContent = fmtNumber(summary.warned || 0);
      $('diagnostics-summary-fail').textContent = fmtNumber(summary.failed || 0);
      $('diagnostics-summary-text').textContent = summary.text || '诊断完成。';
      $('diagnostics-updated').textContent = data && data.generatedAt ? ('检查于 ' + fmtTime(data.generatedAt)) : '已检查';
      const box = $('diagnostics-list');
      box.textContent = '';
      const checks = Array.isArray(data && data.checks) ? data.checks : [];
      if (!checks.length) {
        const empty = document.createElement('div');
        empty.className = 'help-line';
        empty.textContent = '暂无诊断结果。';
        box.appendChild(empty);
        return;
      }
      for (const check of checks) {
        box.appendChild(renderDiagnosticCard(check));
      }
    }

    function renderDiagnosticCard(check) {
      const card = document.createElement('div');
      const status = check && check.status ? String(check.status) : 'warn';
      card.className = 'diagnostic-card ' + status;
      const head = document.createElement('div');
      head.className = 'diagnostic-head';
      const title = document.createElement('div');
      title.className = 'diagnostic-title';
      title.textContent = check.title || check.id || '诊断项';
      const pill = document.createElement('span');
      pill.className = status === 'ok' ? 'pill ok' : (status === 'fail' ? 'pill warn' : 'pill');
      pill.textContent = status === 'ok' ? '正常' : (status === 'fail' ? '需处理' : '提醒');
      head.appendChild(title);
      head.appendChild(pill);
      const detail = document.createElement('div');
      detail.className = 'diagnostic-detail';
      detail.textContent = check.detail || '-';
      const reason = document.createElement('div');
      reason.className = 'diagnostic-reason';
      reason.textContent = check.reason || '';
      const actions = document.createElement('div');
      actions.className = 'diagnostic-actions';
      for (const action of (Array.isArray(check.actions) ? check.actions : [])) {
        const button = document.createElement('button');
        button.textContent = action.label || '处理';
        button.onclick = () => runDiagnosticAction(action).catch((error) => setMessage(error.message, true));
        actions.appendChild(button);
      }
      card.appendChild(head);
      card.appendChild(detail);
      if (reason.textContent) card.appendChild(reason);
      if (actions.childElementCount) card.appendChild(actions);
      return card;
    }

    async function runDiagnosticAction(action) {
      const type = String((action && action.action) || '');
      if (type === 'open-page') {
        showPage(action.target || 'overview');
        return;
      }
      if (type === 'start-bridge') {
        setMessage('正在启动微信桥接...', false);
        const data = await requestJson('/api/bridge/start', { method: 'POST' });
        renderBridge(data.bridge || { running: true });
        await loadState();
        await runDiagnostics();
        setMessage('微信桥接已启动', false);
        return;
      }
      if (type === 'restart-bridge') {
        setMessage('正在重启微信桥接...', false);
        const data = await requestJson('/api/bridge/restart', { method: 'POST' });
        renderBridge(data.bridge || { running: true });
        await loadState();
        await runDiagnostics();
        setMessage('微信桥接已重启', false);
        return;
      }
      if (type === 'start-pairing') {
        showPage('users');
        await startPairing();
        return;
      }
      if (type === 'sync-ccswitch') {
        showPage('provider');
        await syncProviderFromCcswitch('provider');
        await runDiagnostics();
        return;
      }
      setMessage('暂不支持这个处理动作：' + type, true);
    }

    function renderMetricCharts(m) {
      const success = Number(m.deliveriesSucceeded || 0);
      const failed = Number(m.deliveriesFailed || 0);
      const pending = Number(m.pendingDeliveryRetries || 0);
      const totalDelivery = success + failed;
      const successRate = pct(success, totalDelivery);
      const donut = $('delivery-donut');
      donut.dataset.label = totalDelivery ? (successRate + '%') : '暂无';
      donut.style.background = totalDelivery
        ? 'conic-gradient(#059669 0deg ' + (successRate * 3.6) + 'deg, #e11d48 ' + (successRate * 3.6) + 'deg 360deg)'
        : 'conic-gradient(#dbe4f0 0deg 360deg)';
      $('delivery-rate-label').textContent = totalDelivery ? ('成功率 ' + successRate + '%') : '暂无投递数据';
      $('chart-delivery-success').textContent = fmtNumber(success);
      $('chart-delivery-failed').textContent = fmtNumber(failed);
      $('chart-delivery-pending').textContent = fmtNumber(pending);
      $('overview-messages-total').textContent = fmtNumber(m.messagesReceived || 0);
      $('overview-turns-total').textContent = fmtNumber(m.turnsCompleted || 0);
      $('overview-errors-hour').textContent = fmtNumber(m.errorsRecentHour || 0);

      const bars = [
        { label: '收到消息', value: Number(m.messagesReceived || 0), color: 'linear-gradient(90deg, #2563eb, #06b6d4)' },
        { label: '完成回合', value: Number(m.turnsCompleted || 0), color: 'linear-gradient(90deg, #059669, #22c55e)' },
        { label: '真正回复失败', value: Number(m.replyFailures || 0), color: 'linear-gradient(90deg, #f59e0b, #f43f5e)' },
        { label: '最近1小时错误', value: Number(m.errorsRecentHour || 0), color: 'linear-gradient(90deg, #06b6d4, #8b5cf6)' },
        { label: '后台错误累计', value: Number(m.errors || 0), color: 'linear-gradient(90deg, #e11d48, #8b5cf6)' },
      ];
      const max = Math.max(1, ...bars.map((item) => item.value));
      const box = $('metrics-bars');
      box.textContent = '';
      for (const item of bars) {
        const row = document.createElement('div');
        row.className = 'bar-row';
        const label = document.createElement('span');
        label.textContent = item.label;
        const track = document.createElement('div');
        track.className = 'bar-track';
        const fill = document.createElement('div');
        fill.className = 'bar-fill';
        fill.style.width = Math.max(4, Math.round((item.value / max) * 100)) + '%';
        fill.style.background = item.color;
        track.appendChild(fill);
        const value = document.createElement('strong');
        value.textContent = fmtNumber(item.value);
        row.appendChild(label);
        row.appendChild(track);
        row.appendChild(value);
        box.appendChild(row);
      }
      renderAccountBars(m.byAccount || {});
    }

    function renderMetricsByAccount(byAccount) {
      const body = $('metrics-by-account-body');
      body.textContent = '';
      const names = {};
      for (const account of (state.accounts || [])) {
        names[account.accountId] = account.displayName || account.accountId;
      }
      const ids = Object.keys(byAccount);
      if (!ids.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 4;
        td.className = 'muted';
        td.textContent = '暂无数据';
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }
      for (const id of ids) {
        const a = byAccount[id] || {};
        const label = id === 'default' ? (names[id] || '默认 / 主账号') : (names[id] || id);
        const tr = document.createElement('tr');
        tr.appendChild(textCell('账号', label));
        tr.appendChild(textCell('收到消息', String(a.messagesReceived || 0)));
        tr.appendChild(textCell('完成 / 失败回合', String(a.turnsCompleted || 0) + ' / ' + String(a.turnsFailed || 0)));
        tr.appendChild(textCell('平均回合耗时', fmtDuration(a.avgTurnDurationMs)));
        body.appendChild(tr);
      }
    }

    function renderAccountBars(byAccount) {
      const box = $('account-bars');
      box.textContent = '';
      const names = {};
      for (const account of (state.accounts || [])) {
        names[account.accountId] = account.displayName || account.accountId;
      }
      const rows = Object.entries(byAccount || {})
        .map(([id, value]) => ({ id, data: value || {}, messages: Number((value || {}).messagesReceived || 0) }))
        .sort((a, b) => b.messages - a.messages)
        .slice(0, 6);
      if (!rows.length) {
        $('account-bars-summary').textContent = '暂无数据';
        const empty = document.createElement('div');
        empty.className = 'muted';
        empty.textContent = '收到微信消息后，这里会显示各账号活跃度。';
        box.appendChild(empty);
        return;
      }
      const max = Math.max(1, ...rows.map((row) => row.messages));
      $('account-bars-summary').textContent = rows.length + ' 个账号';
      for (const row of rows) {
        const labelText = row.id === 'default' ? (names[row.id] || '默认 / 主账号') : (names[row.id] || row.id);
        const wrap = document.createElement('div');
        wrap.className = 'account-bar-row';
        const meta = document.createElement('div');
        meta.className = 'account-bar-meta';
        const label = document.createElement('span');
        label.textContent = labelText;
        const value = document.createElement('strong');
        value.textContent = fmtNumber(row.messages);
        meta.appendChild(label);
        meta.appendChild(value);
        const track = document.createElement('div');
        track.className = 'account-bar-track';
        const fill = document.createElement('div');
        fill.className = 'account-bar-fill';
        fill.style.width = Math.max(5, Math.round((row.messages / max) * 100)) + '%';
        track.appendChild(fill);
        wrap.appendChild(meta);
        wrap.appendChild(track);
        box.appendChild(wrap);
      }
    }

    function renderSessionFilters(accounts) {
      const select = $('session-account');
      const selected = select.value;
      select.textContent = '';
      const all = document.createElement('option');
      all.value = '';
      all.textContent = '全部账号';
      select.appendChild(all);
      for (const account of accounts) {
        const option = document.createElement('option');
        option.value = account.accountId;
        option.textContent = (account.displayName || account.accountId) + (account.primary ? '（主账号）' : '');
        select.appendChild(option);
      }
      select.value = selected;
    }

    async function loadSessions() {
      const params = new URLSearchParams();
      const query = $('session-query').value.trim();
      const accountId = $('session-account').value.trim();
      const sort = $('session-sort').value;
      if (query) params.set('query', query);
      if (accountId) params.set('accountId', accountId);
      if (sort) params.set('sort', sort);
      const data = await requestJson('/api/sessions?' + params.toString());
      renderSessions(data.sessions || [], data.total || 0, data.returned || 0);
    }

    function renderSessions(sessions, total, returned) {
      const body = $('sessions-body');
      body.textContent = '';
      $('session-count').textContent = total ? ('显示 ' + returned + ' / ' + total + ' 个') : '暂无会话';
      if (!sessions.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 6;
        td.className = 'muted';
        td.textContent = '没有找到匹配的会话';
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }
      for (const session of sessions) {
        const tr = document.createElement('tr');
        tr.appendChild(sessionTitleCell(session));
        tr.appendChild(textCell('微信账号', formatSessionAccounts(session)));
        tr.appendChild(textCell('模型', formatSessionModel(session)));
        tr.appendChild(textCell('更新时间', fmtTime(session.updatedAt) || '-'));
        tr.appendChild(sessionStatusCell(session));
        tr.appendChild(sessionActionsCell(session));
        body.appendChild(tr);
      }
    }

    function sessionTitleCell(session) {
      const td = document.createElement('td');
      td.dataset.label = '标题 / 最新问题';
      const title = document.createElement('div');
      title.className = 'session-title';
      title.textContent = session.title || session.codexThreadId || '(无标题)';
      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.textContent = '线程：' + (session.codexThreadId || '-') + '  项目：' + (session.cwd || '-');
      td.appendChild(title);
      if (session.preview) {
        const preview = document.createElement('div');
        preview.className = 'session-preview';
        preview.textContent = '最新问题：' + session.preview;
        td.appendChild(preview);
      }
      td.appendChild(meta);
      return td;
    }

    function sessionStatusCell(session) {
      const td = document.createElement('td');
      td.dataset.label = '状态';
      const wrap = document.createElement('div');
      wrap.className = 'actions';
      if (session.pinned) {
        const pinned = document.createElement('span');
        pinned.className = 'pill ok';
        pinned.textContent = '置顶';
        wrap.appendChild(pinned);
      }
      if (session.archived) {
        const archived = document.createElement('span');
        archived.className = 'pill warn';
        archived.textContent = '归档';
        wrap.appendChild(archived);
      }
      if (!session.pinned && !session.archived) {
        const normal = document.createElement('span');
        normal.className = 'pill';
        normal.textContent = '正常';
        wrap.appendChild(normal);
      }
      td.appendChild(wrap);
      return td;
    }

    function sessionActionsCell(session) {
      const td = document.createElement('td');
      td.dataset.label = '操作';
      const wrap = document.createElement('div');
      wrap.className = 'actions';

      const history = document.createElement('button');
      history.textContent = '查看历史';
      history.onclick = () => openSessionHistory(session)
        .catch((error) => setMessage(error.message, true));

      const archive = document.createElement('button');
      archive.textContent = session.archived ? '恢复' : '归档';
      archive.onclick = () => setSessionArchived(session, !session.archived)
        .catch((error) => setMessage(error.message, true));

      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '删除';
      del.onclick = () => deleteSession(session)
        .catch((error) => setMessage(error.message, true));

      wrap.appendChild(history);
      wrap.appendChild(archive);
      wrap.appendChild(del);
      td.appendChild(wrap);
      return td;
    }

    async function setSessionArchived(session, archived) {
      const name = session.title || session.codexThreadId || session.id;
      await requestJson('/api/sessions/' + encodeURIComponent(session.id), {
        method: 'PATCH',
        body: JSON.stringify({ archived })
      });
      setMessage((archived ? '已归档：' : '已恢复：') + name, false);
      await loadSessions();
    }

    async function deleteSession(session) {
      const name = session.title || session.codexThreadId || session.id;
      const lineBreak = String.fromCharCode(10);
      const prompt = [
        '确定删除这个本地会话记录吗？',
        name,
        '',
        '不会删除 Codex 原始历史文件。'
      ].join(lineBreak);
      if (!confirm(prompt)) {
        return;
      }
      await requestJson('/api/sessions/' + encodeURIComponent(session.id), { method: 'DELETE' });
      setMessage('已删除本地会话记录：' + name, false);
      await loadSessions();
    }

    let historySessionId = null;

    async function openSessionHistory(session) {
      historySessionId = session.id;
      $('history-title').textContent = '会话历史 · ' + (session.title || session.codexThreadId || session.id);
      $('history-search').value = '';
      $('history-count').textContent = '';
      $('history-body').textContent = '正在加载历史...';
      $('history-modal').hidden = false;
      await loadSessionHistory('');
    }

    async function loadSessionHistory(query) {
      if (!historySessionId) return;
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      const url = '/api/sessions/' + encodeURIComponent(historySessionId) + '/history'
        + (params.toString() ? ('?' + params.toString()) : '');
      const data = await requestJson(url);
      renderHistory(data);
    }

    function renderHistory(data) {
      const body = $('history-body');
      body.textContent = '';
      const messages = (data && data.messages) || [];
      const total = data && data.total ? data.total : 0;
      $('history-count').textContent = total
        ? ('显示 ' + messages.length + ' / ' + total + ' 条' + (data.truncated ? '（仅最近）' : ''))
        : '';
      if (!data || !data.sessionPath) {
        body.textContent = '没有找到这条会话的 Codex 历史文件。';
        return;
      }
      if (!messages.length) {
        body.textContent = '没有匹配的历史消息。';
        return;
      }
      for (const message of messages) {
        const card = document.createElement('div');
        card.className = 'history-msg ' + (message.role === 'user' ? 'user' : 'assistant');
        const meta = document.createElement('div');
        meta.className = 'history-meta';
        const role = document.createElement('span');
        role.className = 'history-role';
        role.textContent = message.role === 'user' ? '用户' : '助手';
        meta.appendChild(role);
        const time = document.createElement('span');
        time.textContent = fmtTime(message.timestamp) || '';
        meta.appendChild(time);
        const text = document.createElement('div');
        text.className = 'history-text';
        text.textContent = message.text || '';
        card.appendChild(meta);
        card.appendChild(text);
        body.appendChild(card);
      }
    }

    function closeSessionHistory() {
      historySessionId = null;
      $('history-modal').hidden = true;
    }

    function openDonateModal() {
      $('donate-modal').hidden = false;
    }

    function closeDonateModal() {
      $('donate-modal').hidden = true;
    }

    function openSetupWizard(step) {
      $('setup-modal').hidden = false;
      setSetupStep(Number.isFinite(Number(step)) ? Number(step) : state.setupStep || 0);
    }

    function closeSetupWizard() {
      $('setup-modal').hidden = true;
    }

    function setSetupStep(step) {
      const next = Math.max(0, Math.min(4, Number(step || 0)));
      state.setupStep = next;
      for (const tab of document.querySelectorAll('[data-setup-step]')) {
        tab.classList.toggle('active', Number(tab.dataset.setupStep) === next);
      }
      for (const panel of document.querySelectorAll('[data-setup-panel]')) {
        panel.classList.toggle('active', Number(panel.dataset.setupPanel) === next);
      }
      $('setup-prev').disabled = next === 0;
      $('setup-next').style.display = next < 4 ? '' : 'none';
      $('setup-complete').style.display = next === 4 ? '' : 'none';
      $('setup-save-provider').style.display = next === 1 ? '' : 'none';
      $('setup-ccswitch-sync').style.display = next === 1 ? '' : 'none';
      $('setup-refresh').style.display = next === 2 ? '' : 'none';
    }

    function setupCheckCard(title, check) {
      const card = document.createElement('div');
      const ok = Boolean(check && check.ok);
      card.className = 'setup-check ' + (ok ? 'ok' : 'warn');
      const head = document.createElement('div');
      head.className = 'setup-check-title';
      const label = document.createElement('span');
      label.textContent = title;
      const pill = document.createElement('span');
      pill.className = ok ? 'pill ok' : 'pill warn';
      pill.textContent = ok ? '通过' : '待处理';
      head.appendChild(label);
      head.appendChild(pill);
      const main = document.createElement('div');
      main.className = 'setup-check-main';
      main.textContent = (check && check.label) || '-';
      const detail = document.createElement('div');
      detail.className = 'setup-check-detail';
      detail.textContent = (check && check.detail) || '';
      card.appendChild(head);
      card.appendChild(main);
      card.appendChild(detail);
      return card;
    }

    function renderSetup(data) {
      const setup = (data && data.setup) || {};
      const settings = (data && data.settings) || {};
      const checks = setup.checks || {};
      const modelProvider = settings.modelProvider || state.currentModelProvider || {};
      $('setup-data-dir').textContent = data.stateDir || (checks.dataDir && checks.dataDir.path) || '-';
      $('setup-env-file').textContent = modelProvider.serviceEnvFile || (checks.serviceEnvFile && checks.serviceEnvFile.path) || '-';
      $('setup-codex-home').textContent = (checks.codexHome && checks.codexHome.path) || modelProvider.codexHome || '-';
      $('setup-admin-url').textContent = data.adminUrl || window.location.href;
      $('setup-status').textContent = setup.completedAt
        ? '已完成'
        : setup.skippedAt
          ? '已跳过'
          : setup.needsSetup
            ? '需要配置'
            : '检查通过';
      $('setup-status').className = setup.needsSetup ? 'pill warn' : 'pill ok';
      if ($('setup-modal').hidden || state.setupStep !== 1) {
        renderSetupProvider(modelProvider);
      }
      renderSetupChecks(checks);
      renderSetupPairing(data.pairing);
      if (setup.needsSetup && !state.setupAutoOpened) {
        state.setupAutoOpened = true;
        openSetupWizard(0);
      }
    }

    function renderSetupChecks(checks) {
      const entries = [
        ['数据目录', checks.dataDir],
        ['配置文件', checks.serviceEnvFile],
        ['Node 环境', checks.node],
        ['Codex CLI', checks.codex],
        ['模型配置', checks.modelProvider],
        ['微信入口', checks.weixinAccount]
      ];
      for (const id of ['setup-checks', 'setup-final-checks']) {
        const box = $(id);
        box.textContent = '';
        for (const [title, check] of entries) {
          box.appendChild(setupCheckCard(title, check || {}));
        }
      }
    }

    function formatSessionAccounts(session) {
      const scopes = Array.isArray(session.scopes) ? session.scopes : [];
      if (!scopes.length) return '未绑定';
      return scopes.map((scope) => scope.accountDisplayName || scope.accountId || scope.scopeId || scope.externalScopeId).filter(Boolean).join('，') || '未绑定';
    }

    function formatSessionModel(session) {
      const model = session.model ? String(session.model) : '';
      const effort = session.reasoningEffort ? String(session.reasoningEffort) : '';
      if (!model && !effort) return '-';
      const sourceLabels = {
        session: '会话',
        account: '账号',
        provider: 'Provider 默认',
        default: '当前默认',
        none: ''
      };
      const modelSource = sourceLabels[session.modelSource] || '';
      const effortSource = sourceLabels[session.reasoningEffortSource] || '';
      const modelText = model ? (model + (modelSource ? '（' + modelSource + '）' : '')) : '';
      const effortText = effort ? (effort + (effortSource ? '（推理：' + effortSource + '）' : '')) : '';
      return [modelText, effortText].filter(Boolean).join(' / ') || '-';
    }

    function renderRuntimeStatus(data) {
      const bridge = data.bridge || {};
      const weixin = bridge.weixin || {};
      const turnRecovery = bridge.turnRecovery || {};
      const active = Number(bridge.activeTurns || 0);
      const queued = Number(bridge.queuedTurns || 0);
      const maxTurns = Number(bridge.maxConcurrentTurns || 0);
      const eventDispatch = Number(bridge.eventDispatchConcurrency || 0);
      const accountPoll = Number(weixin.accountPollConcurrency || 0);
      const accountCount = Number(weixin.accountCount || 0);
      $('metric-turns').textContent = active + ' 运行 / ' + queued + ' 排队 / 上限 ' + (maxTurns || '-');
      $('metric-events').textContent = '分发 ' + (eventDispatch || '-') + ' / 补发 ' + (bridge.pendingDeliveryRetries || 0);
      $('metric-accounts').textContent = accountCount + ' 个 / 轮询 ' + (accountPoll || '-');
      $('metric-error').textContent = bridge.lastError
        ? String(bridge.lastError).slice(0, 80)
        : '无';
      $('metric-error').title = bridge.lastError || '';
      $('metric-recovery').textContent = Number(turnRecovery.total || 0)
        ? (Number(turnRecovery.running || 0) + ' 运行 / '
          + Number(turnRecovery.reconciling || 0) + ' 对账 / '
          + Number(turnRecovery.uncertain || 0) + ' 待确认')
        : '无待恢复任务';
      $('overview-account-total').textContent = fmtNumber(accountCount);
      $('status-updated').textContent = [
        '上次轮询 ' + fmtRelativeMs(bridge.lastPollAt),
        '上次提交 ' + fmtRelativeMs(bridge.lastCommitAt),
        '重启 ' + (bridge.restartCount || 0) + ' 次'
      ].join('  ');
      $('overview-updated').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
      $('chart-concurrency-label').textContent = maxTurns ? ('上限 ' + maxTurns) : '未配置';
      $('chart-turns-active-label').textContent = active + ' / ' + (maxTurns || 0);
      setWidth('chart-turns-active-fill', maxTurns ? pct(active, maxTurns) : 0);
      $('chart-events-label').textContent = eventDispatch ? ('分发 ' + eventDispatch) : '未配置';
      setWidth('chart-events-fill', eventDispatch ? Math.min(100, Math.max(8, eventDispatch * 6)) : 0);
      $('chart-poll-label').textContent = accountCount + ' 个账号 / 并发 ' + (accountPoll || 0);
      setWidth('chart-poll-fill', accountPoll ? pct(Math.min(accountCount, accountPoll), accountPoll) : 0);
    }

    function renderSettings(settings) {
      const concurrency = settings.concurrency || {};
      const logCleanup = settings.logCleanup || {};
      $('max-concurrent-turns').value = concurrency.maxConcurrentTurns || 3;
      $('event-dispatch-concurrency').value = concurrency.eventDispatchConcurrency || 12;
      $('attachment-concurrency').value = concurrency.attachmentProcessingConcurrency || 3;
      $('account-poll-concurrency').value = concurrency.accountPollConcurrency || 4;
      $('log-retention-days').value = logCleanup.retentionDays || 7;
      $('log-max-mb').value = Math.max(1, Math.round(Number(logCleanup.maxBytes || 10485760) / 1024 / 1024));
      $('log-cleanup-interval').value = logCleanup.intervalMinutes || 60;
      $('alert-webhook-url').value = settings.alertWebhookUrl || '';
      renderModelProvider(settings.modelProvider || {});
    }

    function renderLogSummary(logs) {
      const settings = logs.settings || {};
      $('logs-size').textContent = '日志大小：' + fmtBytes(logs.totalSizeBytes || 0);
      $('logs-policy').textContent = '自动清理：'
        + (settings.enabled === false ? '关闭' : '开启')
        + '，保留 ' + (settings.retentionDays || 7)
        + ' 天，单文件上限 ' + fmtBytes(settings.maxBytes || 10485760);
    }

    function renderLogs(data) {
      renderLogSummary(data);
      const files = Array.isArray(data && data.files) ? data.files : [];
      const hasContent = files.some((file) => String(file && file.text || '').trim());
      $('logs-box').textContent = hasContent ? (data.text || '(暂无日志)') : '(暂无日志)';
    }

    async function loadLogs() {
      const data = await requestJson('/api/logs?limit=300');
      renderLogs(data);
    }

    function renderBridge(bridge) {
      const running = Boolean(bridge && bridge.running);
      const starting = Boolean(bridge && bridge.starting);
      const stopping = Boolean(bridge && bridge.stopping);
      const restarting = Boolean(bridge && bridge.restarting);
      const retryCount = Number(bridge && bridge.pendingDeliveryRetries || 0);
      const label = restarting ? '重启中' : starting ? '启动中' : stopping ? '停止中' : running ? '桥接运行中' : '桥接已停止';
      $('service-state').textContent = label;
      $('service-state').title = retryCount > 0 ? ('待补发消息：' + retryCount) : '';
      $('service-state').className = running || starting || restarting ? 'pill ok' : 'pill warn';
      $('bridge-start').disabled = running || starting || restarting;
      $('bridge-restart').disabled = starting || stopping || restarting;
      $('bridge-stop').disabled = !running || stopping || restarting;
      const outbox = bridge && bridge.deliveryOutbox || {};
      const pending = Number(outbox.pending || retryCount || 0);
      const oldest = fmtTime(outbox.oldestCreatedAt);
      const nextAttempt = fmtTime(outbox.nextAttemptAt);
      $('delivery-outbox-status').textContent = pending > 0
        ? ('待补发 ' + pending + ' 条 · 最早 ' + (oldest || '-') + ' · 下次 ' + (nextAttempt || '-'))
        : '暂无待补发消息';
      $('delivery-retry-now').disabled = !running || starting || stopping || restarting || pending === 0;
    }

    function renderAccounts(accounts) {
      const body = $('accounts-body');
      body.textContent = '';
      if (!accounts.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.className = 'muted';
        td.textContent = '暂无账号';
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }
      for (const account of accounts) {
        const tr = document.createElement('tr');
        tr.appendChild(nameCell(account));
        tr.appendChild(accountIdCell(account));
        tr.appendChild(accountConfigCell(account));
        tr.appendChild(statusCell(account));
        tr.appendChild(actionCell(account));
        body.appendChild(tr);
      }
    }

    function nameCell(account) {
      const td = document.createElement('td');
      td.dataset.label = '名称';
      const wrap = document.createElement('div');
      wrap.className = 'name-cell';
      const row = document.createElement('div');
      row.className = 'rename-row';
      const input = document.createElement('input');
      input.value = account.displayName || '';
      input.placeholder = account.primary ? '我的账号' : '朋友备注';
      const save = document.createElement('button');
      save.textContent = '保存';
      save.onclick = async () => {
        await patchAccount(account.accountId, { displayName: input.value });
      };
      row.appendChild(input);
      row.appendChild(save);
      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.textContent = '添加：' + (fmtTime(account.savedAt) || '-') + '  同步：' + (fmtTime(account.syncUpdatedAt) || '-');
      wrap.appendChild(row);
      wrap.appendChild(meta);
      td.appendChild(wrap);
      return td;
    }

    function accountIdCell(account) {
      const td = document.createElement('td');
      td.dataset.label = '账号';
      const wrap = document.createElement('div');
      wrap.className = 'account-id';
      const main = document.createElement('div');
      main.className = 'account-id-main';
      main.textContent = account.accountId || '-';
      wrap.appendChild(main);
      const sub = document.createElement('div');
      sub.className = 'account-id-sub';
      sub.textContent = account.primary ? '主账号' : '朋友入口';
      wrap.appendChild(sub);
      td.appendChild(wrap);
      return td;
    }

    function textCell(label, text) {
      const td = document.createElement('td');
      td.dataset.label = label;
      td.textContent = text || '-';
      return td;
    }

    function accountConfigCell(account) {
      const td = document.createElement('td');
      td.dataset.label = '用户 / 权限';
      const wrap = document.createElement('div');
      wrap.className = 'account-config';
      const savedTriple = {
        providerProfileId: (account.modelProvider && account.modelProvider.providerProfileId) || '',
        model: (account.modelProvider && account.modelProvider.model) || '',
        reasoningEffort: (account.modelProvider && account.modelProvider.reasoningEffort) || '',
      };
      const user = document.createElement('div');
      user.className = 'muted';
      user.textContent = '用户：' + (account.userId || '-');
      wrap.appendChild(user);

      const groupRole = document.createElement('div');
      groupRole.className = 'account-config-row';
      const group = document.createElement('input');
      group.value = account.group || '';
      group.placeholder = '分组，例如：朋友';
      const role = document.createElement('select');
      for (const item of [
        ['owner', '主账号'],
        ['admin', '管理员'],
        ['member', '普通用户'],
        ['viewer', '只读用户'],
      ]) {
        const option = document.createElement('option');
        option.value = item[0];
        option.textContent = item[1];
        role.appendChild(option);
      }
      role.value = account.role || (account.primary ? 'owner' : 'member');
      role.disabled = Boolean(account.primary);
      groupRole.appendChild(group);
      groupRole.appendChild(role);
      wrap.appendChild(groupRole);

      const permissions = account.permissions || {};
      const permissionRow = document.createElement('div');
      permissionRow.className = 'account-permissions';
      const canChat = accountPermissionToggle('可聊天', permissions.canChat !== false);
      const canUpload = accountPermissionToggle('可上传', permissions.canUpload !== false);
      const canExecute = accountPermissionToggle('可执行命令', account.primary || permissions.canExecuteCommands === true);
      canExecute.input.disabled = Boolean(account.primary);
      permissionRow.appendChild(canChat.label);
      permissionRow.appendChild(canUpload.label);
      permissionRow.appendChild(canExecute.label);
      wrap.appendChild(permissionRow);

      const modelRow = document.createElement('div');
      modelRow.className = 'account-config-row';
      const provider = document.createElement('select');
      populateAccountProviderOptions(provider, savedTriple.providerProfileId);
      const model = document.createElement('select');
      const modelControl = document.createElement('div');
      modelControl.className = 'account-model-control';
      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.className = 'account-model-refresh';
      refresh.textContent = '↻';
      refresh.title = '刷新模型';
      refresh.setAttribute('aria-label', '刷新模型');
      populateAccountModelOptions(model, provider.value, null, savedTriple.model);
      modelControl.appendChild(model);
      modelControl.appendChild(refresh);
      modelRow.appendChild(provider);
      modelRow.appendChild(modelControl);
      wrap.appendChild(modelRow);
      const modelStatus = document.createElement('div');
      modelStatus.className = 'account-model-status';
      wrap.appendChild(modelStatus);

      const effortRow = document.createElement('div');
      effortRow.className = 'account-config-row';
      const effort = document.createElement('select');
      for (const item of ['', 'low', 'medium', 'high', 'xhigh']) {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = item || '推理默认';
        effort.appendChild(option);
      }
      effort.value = (account.modelProvider && account.modelProvider.reasoningEffort) || '';
      populateAccountReasoningEffortOptions(effort, null, savedTriple.reasoningEffort);
      const save = document.createElement('button');
      save.className = 'account-config-save';
      save.textContent = '保存权限';
      save.onclick = async () => {
        await patchAccount(account.accountId, {
          group: group.value,
          role: role.value,
          permissions: {
            canChat: canChat.input.checked,
            canUpload: canUpload.input.checked,
            canExecuteCommands: canExecute.input.checked,
          },
          modelProvider: {
            providerProfileId: provider.value,
            model: model.value,
            reasoningEffort: effort.value,
          },
        });
      };
      effortRow.appendChild(effort);
      effortRow.appendChild(save);
      wrap.appendChild(effortRow);

      const rowState = {
        savedTriple,
        provider,
        model,
        effort,
        refresh,
        save,
        status: modelStatus,
        catalog: null,
        loading: false,
        modelLocked: false,
        effortLocked: false,
      };

      async function loadCatalogForCurrentProvider(forceRefresh, useCurrentSelection) {
        const requestedProviderProfileId = provider.value;
        if (!requestedProviderProfileId) {
          rowState.catalog = null;
          rowState.modelLocked = false;
          rowState.effortLocked = false;
          populateAccountModelOptions(model, '', null, '');
          populateAccountReasoningEffortOptions(effort, null, '');
          setAccountModelStatus(modelStatus, '', false);
          setAccountModelControlsLoading(rowState, false);
          updateAccountModelSaveState(rowState);
          return;
        }
        const selectedModel = useCurrentSelection ? model.value : savedTriple.model;
        const selectedEffort = useCurrentSelection ? effort.value : savedTriple.reasoningEffort;
        setAccountModelControlsLoading(rowState, true);
        setAccountModelStatus(
          modelStatus,
          forceRefresh ? '正在刷新模型列表...' : '正在加载模型列表...',
          false,
        );
        try {
          const catalog = await loadProviderModelCatalog(requestedProviderProfileId, forceRefresh);
          if (provider.value !== requestedProviderProfileId) return;
          rowState.catalog = catalog;
          rowState.modelLocked = false;
          rowState.effortLocked = false;
          applyAccountModelCatalog(rowState, catalog, selectedModel, selectedEffort);
          const catalogStatus = accountCatalogStatus(catalog);
          setAccountModelStatus(modelStatus, catalogStatus.text, catalogStatus.warn);
        } catch (_error) {
          if (provider.value !== requestedProviderProfileId) return;
          rowState.catalog = null;
          rowState.modelLocked = true;
          rowState.effortLocked = true;
          populateAccountModelOptions(model, requestedProviderProfileId, null, selectedModel);
          populateAccountReasoningEffortOptions(effort, null, selectedEffort);
          setAccountModelStatus(
            modelStatus,
            forceRefresh ? '模型刷新失败，已保留当前选择' : '模型加载失败，已保留当前选择',
            true,
          );
        } finally {
          if (provider.value !== requestedProviderProfileId) return;
          setAccountModelControlsLoading(rowState, false);
          updateAccountModelSaveState(rowState);
        }
      }

      provider.onchange = () => {
        rowState.catalog = null;
        rowState.modelLocked = false;
        rowState.effortLocked = false;
        populateAccountModelOptions(model, provider.value, null, '');
        populateAccountReasoningEffortOptions(effort, null, '');
        setAccountModelStatus(modelStatus, '', false);
        updateAccountModelSaveState(rowState);
        void loadCatalogForCurrentProvider(false, true);
      };
      model.onchange = () => {
        populateAccountReasoningEffortOptions(
          effort,
          findAccountCatalogModel(rowState.catalog, model.value),
          effort.value,
        );
        updateAccountModelSaveState(rowState);
      };
      effort.onchange = () => updateAccountModelSaveState(rowState);
      refresh.onclick = () => {
        void loadCatalogForCurrentProvider(true, true);
      };
      updateAccountModelSaveState(rowState);
      if (provider.value) {
        void loadCatalogForCurrentProvider(false, false);
      }

      td.appendChild(wrap);
      return td;
    }

    function populateAccountProviderOptions(select, selectedProviderProfileId) {
      const wanted = String(selectedProviderProfileId || '').trim();
      select.textContent = '';
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '默认 provider';
      select.appendChild(empty);
      const profiles = Array.isArray(state.providerProfiles) ? state.providerProfiles : [];
      for (const profile of profiles) {
        const id = String(profile.providerProfileId || '').trim();
        if (!id) continue;
        const option = document.createElement('option');
        option.value = id;
        option.textContent = profile.displayName ? (profile.displayName + ' (' + id + ')') : id;
        select.appendChild(option);
      }
      if (wanted && !profiles.some((profile) => profile.providerProfileId === wanted)) {
        const missing = document.createElement('option');
        missing.value = wanted;
        missing.textContent = wanted + ' (未找到)';
        select.appendChild(missing);
      }
      select.value = wanted;
    }

    function populateAccountModelOptions(select, providerProfileId, catalog, selectedModel) {
      const wanted = String(selectedModel || '').trim();
      const seen = new Set();
      const models = Array.isArray(catalog && catalog.models) ? catalog.models : [];
      select.textContent = '';
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = providerProfileId ? 'provider 默认模型' : '默认模型';
      select.appendChild(empty);
      for (const modelInfo of models) {
        const modelId = String((modelInfo && (modelInfo.id || modelInfo.model)) || '').trim();
        if (!modelId || seen.has(modelId)) continue;
        seen.add(modelId);
        const option = document.createElement('option');
        option.value = modelId;
        option.textContent = accountModelDisplayText(modelInfo);
        select.appendChild(option);
      }
      if (wanted && !seen.has(wanted)) {
        const missing = document.createElement('option');
        missing.value = wanted;
        missing.textContent = wanted + ' （不可用）';
        select.appendChild(missing);
      }
      select.value = wanted;
    }

    function populateAccountReasoningEffortOptions(select, modelInfo, selectedEffort) {
      const wanted = String(selectedEffort || '').trim();
      const declared = Array.isArray(modelInfo && modelInfo.supportedReasoningEfforts)
        ? modelInfo.supportedReasoningEfforts.slice()
        : [];
      const efforts = declared.length > 0 ? declared : ['low', 'medium', 'high', 'xhigh'];
      select.textContent = '';
      select.title = '支持的推理强度';
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '推理默认';
      select.appendChild(empty);
      for (const effort of efforts) {
        const option = document.createElement('option');
        option.value = effort;
        option.textContent = effort;
        select.appendChild(option);
      }
      if (wanted && !efforts.includes(wanted)) {
        const missing = document.createElement('option');
        missing.value = wanted;
        missing.textContent = wanted + ' （不可用）';
        select.appendChild(missing);
      }
      select.value = wanted;
    }

    function invalidateProviderModelCatalogCache(providerProfileId) {
      const id = String(providerProfileId || '').trim();
      if (!id) return;
      state.providerModelCatalogGenerations.set(
        id,
        (state.providerModelCatalogGenerations.get(id) || 0) + 1,
      );
      state.providerModelCatalogs.delete(id);
      state.providerModelCatalogPromises.delete(id);
    }

    function reloadAccountsAfterProviderChange(providerProfileId, accounts) {
      invalidateProviderModelCatalogCache(providerProfileId);
      if (Array.isArray(accounts)) {
        state.accounts = accounts;
      }
      renderAccounts(Array.isArray(state.accounts) ? state.accounts : []);
    }

    async function loadProviderModelCatalog(providerProfileId, forceRefresh) {
      const id = String(providerProfileId || '').trim();
      if (!id) return null;
      const cached = state.providerModelCatalogs.get(id);
      if (!forceRefresh && cached && Number(cached.expiresAt) > Date.now()) {
        return cached;
      }
      if (!forceRefresh && cached) {
        state.providerModelCatalogs.delete(id);
      }
      if (state.providerModelCatalogPromises.has(id)) {
        return state.providerModelCatalogPromises.get(id);
      }
      const generation = state.providerModelCatalogGenerations.get(id) || 0;
      const suffix = forceRefresh ? '/models/refresh' : '/models';
      const promise = requestJson('/api/provider-profiles/' + encodeURIComponent(id) + suffix, {
        method: forceRefresh ? 'POST' : 'GET'
      }).then((catalog) => {
        if ((state.providerModelCatalogGenerations.get(id) || 0) !== generation) {
          throw new Error('provider model catalog invalidated');
        }
        state.providerModelCatalogs.set(id, catalog);
        return catalog;
      }).finally(() => {
        if (state.providerModelCatalogPromises.get(id) === promise) {
          state.providerModelCatalogPromises.delete(id);
        }
      });
      state.providerModelCatalogPromises.set(id, promise);
      return promise;
    }

    function accountModelDisplayText(modelInfo) {
      const id = String((modelInfo && (modelInfo.id || modelInfo.model)) || '').trim();
      const displayName = String((modelInfo && modelInfo.displayName) || '').trim();
      if (!id) return '';
      return displayName && displayName !== id ? (displayName + ' (' + id + ')') : id;
    }

    function findAccountCatalogModel(catalog, modelId) {
      const wanted = String(modelId || '').trim();
      if (!wanted || !catalog || !Array.isArray(catalog.models)) {
        return null;
      }
      return catalog.models.find((item) => String((item && (item.id || item.model)) || '').trim() === wanted) || null;
    }

    function accountCatalogStatus(catalog) {
      if (!catalog) {
        return { text: '', warn: false };
      }
      const parts = [];
      let warn = false;
      if (catalog.refreshFailed) {
        parts.push('模型刷新失败，使用备用列表');
        warn = true;
      }
      if (catalog.stale) {
        parts.push('已使用缓存模型');
        warn = true;
      } else if (String(catalog.source || '') !== 'provider') {
        parts.push('已使用配置模型');
        warn = true;
      }
      return {
        text: parts.join(' / '),
        warn,
      };
    }

    function setAccountModelStatus(status, text, warn) {
      status.textContent = text || '';
      status.className = warn ? 'account-model-status warn' : 'account-model-status';
    }

    function currentAccountModelTriple(rowState) {
      return {
        providerProfileId: String(rowState.provider.value || '').trim(),
        model: String(rowState.model.value || '').trim(),
        reasoningEffort: String(rowState.effort.value || '').trim(),
      };
    }

    function sameAccountModelTriple(left, right) {
      return left.providerProfileId === right.providerProfileId
        && left.model === right.model
        && left.reasoningEffort === right.reasoningEffort;
    }

    function providerProfileExists(providerProfileId) {
      const wanted = String(providerProfileId || '').trim();
      if (!wanted) return false;
      return (Array.isArray(state.providerProfiles) ? state.providerProfiles : [])
        .some((profile) => String(profile.providerProfileId || '').trim() === wanted);
    }

    function availableReasoningEffortsForModel(modelInfo) {
      const declared = Array.isArray(modelInfo && modelInfo.supportedReasoningEfforts)
        ? modelInfo.supportedReasoningEfforts.slice()
        : [];
      return declared.length > 0 ? declared : ['low', 'medium', 'high', 'xhigh'];
    }

    function canSaveAccountModelSelection(rowState) {
      const current = currentAccountModelTriple(rowState);
      if (sameAccountModelTriple(current, rowState.savedTriple)) {
        return true;
      }
      if (!current.providerProfileId) {
        return !current.model && !current.reasoningEffort;
      }
      if (!providerProfileExists(current.providerProfileId)) {
        return false;
      }
      if (!rowState.catalog) {
        return false;
      }
      if (!current.model) {
        return !current.reasoningEffort || availableReasoningEffortsForModel(null).includes(current.reasoningEffort);
      }
      const modelInfo = findAccountCatalogModel(rowState.catalog, current.model);
      if (!modelInfo) {
        return false;
      }
      return !current.reasoningEffort || availableReasoningEffortsForModel(modelInfo).includes(current.reasoningEffort);
    }

    function syncAccountModelControlState(rowState) {
      rowState.model.disabled = rowState.loading || rowState.modelLocked;
      rowState.effort.disabled = rowState.loading || rowState.effortLocked;
      rowState.refresh.disabled = rowState.loading || !rowState.provider.value;
      rowState.save.disabled = rowState.loading || !canSaveAccountModelSelection(rowState);
    }

    function setAccountModelControlsLoading(rowState, loading) {
      rowState.loading = Boolean(loading);
      syncAccountModelControlState(rowState);
    }

    function updateAccountModelSaveState(rowState) {
      syncAccountModelControlState(rowState);
    }

    function applyAccountModelCatalog(rowState, catalog, selectedModel, selectedEffort) {
      populateAccountModelOptions(rowState.model, rowState.provider.value, catalog, selectedModel);
      populateAccountReasoningEffortOptions(
        rowState.effort,
        findAccountCatalogModel(catalog, rowState.model.value),
        selectedEffort,
      );
    }

    function accountPermissionToggle(text, checked) {
      const label = document.createElement('label');
      label.className = 'account-permission';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(checked);
      const span = document.createElement('span');
      span.textContent = text;
      label.appendChild(input);
      label.appendChild(span);
      return { label, input };
    }

    function statusCell(account) {
      const td = document.createElement('td');
      td.dataset.label = '状态';
      const pill = document.createElement('span');
      pill.className = account.disabled ? 'pill warn' : 'pill ok';
      pill.textContent = account.disabled ? '已禁用' : '监听中';
      td.appendChild(pill);
      return td;
    }

    function actionCell(account) {
      const td = document.createElement('td');
      td.dataset.label = '操作';
      const wrap = document.createElement('div');
      wrap.className = 'actions account-actions';
      if (account.primary) {
        const badge = document.createElement('span');
        badge.className = 'tag-primary';
        badge.textContent = '★ 当前主账号';
        wrap.appendChild(badge);
        td.appendChild(wrap);
        return td;
      }
      const primary = document.createElement('button');
      primary.textContent = '设为主账号';
      primary.onclick = async () => {
        await setPrimaryAccount(account.accountId);
      };
      const toggle = document.createElement('button');
      toggle.textContent = account.disabled ? '启用' : '禁用';
      toggle.onclick = async () => {
        await patchAccount(account.accountId, { disabled: !account.disabled });
      };
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '删除';
      del.onclick = async () => {
        if (!confirm('确认删除这个入口？')) return;
        await requestJson('/api/accounts/' + encodeURIComponent(account.accountId), { method: 'DELETE' });
        await loadState();
      };
      wrap.appendChild(primary);
      wrap.appendChild(toggle);
      wrap.appendChild(del);
      td.appendChild(wrap);
      return td;
    }

    async function setPrimaryAccount(accountId) {
      await requestJson('/api/primary', {
        method: 'POST',
        body: JSON.stringify({ accountId })
      });
      await loadState();
    }

    async function patchAccount(accountId, patch) {
      await requestJson('/api/accounts/' + encodeURIComponent(accountId), {
        method: 'PATCH',
        body: JSON.stringify(patch)
      });
      await loadState();
    }

    const CUSTOM_MODEL_OPTION = '__custom__';

    function populateModelOptionsFor(selectId, customId, presetKey, selectedModel) {
      const preset = providerPresets[presetKey] || providerPresets.default;
      const select = $(selectId);
      const custom = $(customId);
      const models = Array.isArray(preset.models) && preset.models.length
        ? preset.models.slice()
        : [preset.model].filter(Boolean);
      const wanted = String(selectedModel || '').trim();
      if (wanted && !models.includes(wanted) && !preset.restrictModels) {
        models.push(wanted);
      }
      select.innerHTML = '';
      for (const model of models) {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        select.appendChild(option);
      }
      const customOption = document.createElement('option');
      customOption.value = CUSTOM_MODEL_OPTION;
      customOption.textContent = '自定义…';
      select.appendChild(customOption);
      select.value = wanted || preset.model || models[0] || '';
      custom.value = '';
      custom.style.display = 'none';
    }

    function populateModelOptions(presetKey, selectedModel) {
      populateModelOptionsFor('provider-model', 'provider-model-custom', presetKey, selectedModel);
    }

    function syncCustomModelVisibilityFor(selectId, customId) {
      const select = $(selectId);
      const custom = $(customId);
      const isCustom = select.value === CUSTOM_MODEL_OPTION;
      custom.style.display = isCustom ? '' : 'none';
      if (isCustom) {
        custom.focus();
      }
    }

    function syncCustomModelVisibility() {
      syncCustomModelVisibilityFor('provider-model', 'provider-model-custom');
    }

    function getSelectedModelFrom(selectId, customId) {
      const select = $(selectId);
      if (select.value === CUSTOM_MODEL_OPTION) {
        return $(customId).value.trim();
      }
      return String(select.value || '').trim();
    }

    function getSelectedModel() {
      return getSelectedModelFrom('provider-model', 'provider-model-custom');
    }

    function presetKeyForProvider(provider) {
      const capabilities = String(provider.capabilities || '').toLowerCase();
      const providerId = String(provider.providerId || '').toLowerCase();
      const providerName = String(provider.providerName || '').replace(/s+/g, '').toLowerCase();
      const baseUrl = String(provider.baseUrl || '').toLowerCase();
      const model = String(provider.model || '').toLowerCase();
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
      if (providerPresets[capabilities]) {
        return capabilities;
      }
      if (providerName.includes('claude')) {
        return 'ztoken-claude';
      }
      for (const [key, preset] of Object.entries(providerPresets)) {
        if (providerId === String(preset.providerId).toLowerCase()) {
          return key;
        }
      }
      if (providerName.includes('deepseek')) {
        return 'deepseek';
      }
      if (providerName.includes('qwen')) {
        return 'qwen';
      }
      if (providerName.includes('openrouter')) {
        return 'openrouter';
      }
      if (providerName.includes('kimi') || providerName.includes('moonshot')) {
        return 'kimi';
      }
      if (providerName.includes('gemini') || providerName.includes('google')) {
        return 'gemini';
      }
      if (providerName.includes('minimax')) {
        return 'minimax';
      }
      if (providerName.includes('iflow')) {
        return 'iflow';
      }
      return 'default';
    }

    function providerKeyStatusText(provider) {
      return provider && provider.apiKeyConfigured
        ? ('已配置：' + (provider.apiKeyMasked || '********'))
        : '未配置';
    }

    function renderModelProvider(provider) {
      state.currentModelProvider = provider || {};
      const presetKey = presetKeyForProvider(state.currentModelProvider);
      const preset = providerPresets[presetKey] || providerPresets.default;
      $('provider-preset').value = presetKey;
      $('provider-name').value = state.currentModelProvider.providerName || preset.providerName || '';
      populateModelOptions(presetKey, state.currentModelProvider.model || '');
      $('provider-base-url').value = state.currentModelProvider.baseUrl || preset.baseUrl || '';
      $('provider-api-key').value = '';
      $('provider-key-status').textContent = providerKeyStatusText(state.currentModelProvider);
      $('provider-env-file').value = state.currentModelProvider.serviceEnvFile || '';
      $('provider-source').value = state.currentModelProvider.source || 'manual';
      $('provider-ccswitch-home').value = (state.currentModelProvider.ccswitch && state.currentModelProvider.ccswitch.codexHome) || '';
      $('provider-ccswitch-interval').value = Math.max(2, Math.round(Number((state.currentModelProvider.ccswitch && state.currentModelProvider.ccswitch.intervalMs) || 10000) / 1000));
      renderCcswitchStatus('provider-ccswitch-status', state.currentModelProvider.ccswitch);
    }

    function applyProviderPreset(presetKey) {
      const preset = providerPresets[presetKey] || providerPresets.default;
      $('provider-name').value = preset.providerName;
      populateModelOptions(presetKey, preset.model);
      $('provider-base-url').value = preset.baseUrl;
      $('provider-message').textContent = '';
    }

    function renderSetupProvider(provider) {
      const current = provider || {};
      const presetKey = presetKeyForProvider(current);
      const preset = providerPresets[presetKey] || providerPresets.default;
      $('setup-provider-preset').value = presetKey;
      $('setup-provider-name').value = current.providerName || preset.providerName || '';
      populateModelOptionsFor('setup-provider-model', 'setup-provider-model-custom', presetKey, current.model || '');
      $('setup-provider-base-url').value = current.baseUrl || preset.baseUrl || '';
      $('setup-provider-api-key').value = '';
      $('setup-provider-key-status').textContent = providerKeyStatusText(current);
      $('setup-provider-env-file').value = current.serviceEnvFile || '';
      $('setup-provider-source').value = current.source || 'manual';
      $('setup-provider-ccswitch-home').value = (current.ccswitch && current.ccswitch.codexHome) || '';
      $('setup-provider-ccswitch-interval').value = Math.max(2, Math.round(Number((current.ccswitch && current.ccswitch.intervalMs) || 10000) / 1000));
      renderCcswitchStatus('setup-provider-ccswitch-status', current.ccswitch);
    }

    function applySetupProviderPreset(presetKey) {
      const preset = providerPresets[presetKey] || providerPresets.default;
      $('setup-provider-name').value = preset.providerName;
      populateModelOptionsFor('setup-provider-model', 'setup-provider-model-custom', presetKey, preset.model);
      $('setup-provider-base-url').value = preset.baseUrl;
      $('setup-provider-message').textContent = '';
    }

    function readProviderPayloadFrom(prefix) {
      const preset = providerPresets[$(prefix + '-preset').value] || providerPresets.default;
      const current = state.currentModelProvider || {};
      const providerName = $(prefix + '-name').value.trim() || preset.providerName || current.providerName || 'Z Token';
      const rawModel = getSelectedModelFrom(prefix + '-model', prefix + '-model-custom');
      const model = normalizeModelForPreset(preset, rawModel, current.model || '');
      let baseUrl = normalizeUrlValue($(prefix + '-base-url').value.trim());
      const apiKey = $(prefix + '-api-key').value.trim();
      const serviceEnvFile = $(prefix + '-env-file').value.trim();
      let source = $(prefix + '-source').value || 'manual';
      const ccswitchCodexHome = $(prefix + '-ccswitch-home').value.trim();
      const ccswitchSyncIntervalMs = Math.max(2, Number.parseInt($(prefix + '-ccswitch-interval').value || '10', 10) || 10) * 1000;
      if (!model) {
        throw new Error('请填写模型名称');
      }
      if (!serviceEnvFile) {
        throw new Error('请填写配置文件路径');
      }
      const lowerBaseUrl = baseUrl.toLowerCase();
      if (!lowerBaseUrl.startsWith('http://') && !lowerBaseUrl.startsWith('https://')) {
        throw new Error('接口地址必须以 http:// 或 https:// 开头');
      }
      if (capabilitiesForPreset(preset) === 'deepseek' && source === 'manual') {
        baseUrl = normalizeDeepSeekBaseUrl(baseUrl || preset.baseUrl || current.baseUrl);
      }
      const payload = {
        profileId: preset.profileId || current.profileId || 'openai-default',
        providerId: preset.providerId || current.providerId || 'openai-compatible',
        providerName,
        baseUrl,
        model,
        modelIds: model,
        capabilities: preset.capabilities || current.capabilities || 'default',
        serviceEnvFile,
        source,
        ccswitchCodexHome,
        ccswitchSyncIntervalMs
      };
      if (apiKey) {
        payload.apiKey = apiKey;
      }
      return payload;
    }

    function capabilitiesForPreset(preset) {
      return String((preset && preset.capabilities) || 'default').toLowerCase();
    }

    function normalizeUrlValue(value) {
      return String(value || '').trim().replace(/\/+$/u, '');
    }

    function normalizeDeepSeekBaseUrl(value) {
      const raw = String(value || '').trim().replace(/\/+$/u, '');
      if (!raw) {
        return 'https://api.deepseek.com/v1';
      }
      if (/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/v1(?:\/responses)?$/iu.test(raw)) {
        return 'https://api.deepseek.com/v1';
      }
      if (/^https?:\/\/api.deepseek.com\/?$/iu.test(raw)) {
        return 'https://api.deepseek.com/v1';
      }
      if (/^https?:\/\/api.deepseek.com\/v1(?:\/)?$/iu.test(raw)) {
        return 'https://api.deepseek.com/v1';
      }
      return raw;
    }

    function normalizeModelForPreset(preset, model, fallbackModel) {
      const value = String(model || '').trim();
      const fallback = String(fallbackModel || '').trim();
      const lower = value.toLowerCase();
      const capabilities = String((preset && preset.capabilities) || 'default').toLowerCase();
      const allowedModels = Array.isArray(preset && preset.models) ? preset.models : [];
      if (preset && preset.restrictModels && allowedModels.length) {
        if (allowedModels.includes(value)) return value;
        if (allowedModels.includes(fallback)) return fallback;
        return preset.model || allowedModels[0] || '';
      }
      if (capabilities === 'deepseek') {
        if (lower.startsWith('deepseek-')) return value;
        if (fallback.toLowerCase().startsWith('deepseek-')) return fallback;
        return preset.model || 'deepseek-v4-flash';
      }
      if (capabilities === 'claude-code') {
        if (lower.startsWith('claude-')) return value;
        if (fallback.toLowerCase().startsWith('claude-')) return fallback;
        return preset.model || 'claude-opus-4-8';
      }
      if (capabilities === 'qwen') {
        if (lower.startsWith('qwen')) return value;
        if (fallback.toLowerCase().startsWith('qwen')) return fallback;
        return preset.model || 'qwen3-coder-flash';
      }
      if (capabilities === 'gemini') {
        if (lower.startsWith('gemini-')) return value;
        if (fallback.toLowerCase().startsWith('gemini-')) return fallback;
        return preset.model || 'gemini-2.5-flash';
      }
      if (capabilities === 'kimi') {
        if (lower.startsWith('kimi-') || lower.startsWith('moonshot-')) return value;
        if (fallback.toLowerCase().startsWith('kimi-') || fallback.toLowerCase().startsWith('moonshot-')) return fallback;
        return preset.model || 'kimi-k2-0905-preview';
      }
      if (capabilities === 'minimax') {
        if (lower.startsWith('minimax-') || lower.startsWith('abab')) return value;
        if (fallback.toLowerCase().startsWith('minimax-') || fallback.toLowerCase().startsWith('abab')) return fallback;
        return preset.model || 'MiniMax-M2.0';
      }
      return value || fallback || (preset && preset.model) || '';
    }

    function renderCcswitchStatus(id, ccswitch) {
      const el = $(id);
      if (!el) return;
      const last = ccswitch && ccswitch.lastSync;
      if (!ccswitch || !ccswitch.enabled) {
        el.textContent = '未启用跟随';
        return;
      }
      if (!last) {
        el.textContent = '等待自动同步';
        return;
      }
      const ok = last.ok ? '成功' : '失败';
      const model = last.model ? (' · ' + last.model) : '';
      const time = last.syncedAt ? (' · ' + fmtTime(last.syncedAt)) : '';
      el.textContent = ok + model + time + ' · ' + (last.message || '');
      el.title = [
        last.configPath ? ('config: ' + last.configPath) : '',
        last.authPath ? ('auth: ' + last.authPath) : '',
        Array.isArray(last.errors) && last.errors.length ? last.errors.join('\n') : ''
      ].filter(Boolean).join('\n');
    }

    function readModelProviderPayload() {
      return readProviderPayloadFrom('provider');
    }

    async function saveProviderSettings() {
      $('provider-message').textContent = '正在保存...';
      const modelProvider = readModelProviderPayload();
      const data = await requestJson('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          modelProvider
        })
      });
      reloadAccountsAfterProviderChange(modelProvider.profileId, data.state && data.state.accounts);
      renderSettings(data.settings || {});
      $('provider-api-key').value = '';
      if (data.restartRequired) {
        await restartServiceAfterProviderSave('provider-message');
      } else {
        $('provider-message').textContent = '已保存。';
      }
    }

    async function syncProviderFromCcswitch(targetPrefix) {
      const isSetup = targetPrefix === 'setup-provider';
      const messageId = isSetup ? 'setup-provider-message' : 'provider-message';
      $(messageId).textContent = '正在读取 CCSwitch / Codex 当前配置...';
      const data = await requestJson('/api/model-provider/sync-ccswitch', {
        method: 'POST',
        body: JSON.stringify({
          codexHome: $(targetPrefix + '-ccswitch-home').value.trim(),
          persistSource: true
        })
      });
      const syncedProvider = (data.settings && data.settings.modelProvider)
        || (data.state && data.state.settings && data.state.settings.modelProvider)
        || state.currentModelProvider
        || {};
      reloadAccountsAfterProviderChange(syncedProvider.profileId, data.state && data.state.accounts);
      renderSettings(data.settings || {});
      renderSetup(data.state || {});
      if (isSetup) {
        renderSetupProvider(syncedProvider);
      }
      $(messageId).textContent = data.message || '已同步 CCSwitch / Codex 当前配置';
      if (data.state && data.state.settings) {
        renderSettings(data.state.settings);
        if (isSetup && data.state.settings.modelProvider) {
          renderSetupProvider(data.state.settings.modelProvider);
        }
      }
    }

    async function saveSetupProviderSettings() {
      $('setup-provider-message').textContent = '正在保存...';
      const modelProvider = readProviderPayloadFrom('setup-provider');
      const data = await requestJson('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          modelProvider
        })
      });
      reloadAccountsAfterProviderChange(modelProvider.profileId, data.state && data.state.accounts);
      state.setup = (data.state && data.state.setup) || null;
      renderSettings(data.settings || {});
      renderSetup(data.state || {});
      $('setup-provider-api-key').value = '';
      if (data.restartRequired) {
        await restartServiceAfterProviderSave('setup-provider-message');
      } else {
        $('setup-provider-message').textContent = '已保存。';
      }
    }

    async function saveSettings() {
      const payload = {
        concurrency: {
          maxConcurrentTurns: readPositiveIntInput('max-concurrent-turns', 3),
          eventDispatchConcurrency: readPositiveIntInput('event-dispatch-concurrency', 12),
          attachmentProcessingConcurrency: readPositiveIntInput('attachment-concurrency', 3),
          accountPollConcurrency: readPositiveIntInput('account-poll-concurrency', 4)
        },
        logCleanup: {
          enabled: true,
          retentionDays: readPositiveIntInput('log-retention-days', 7),
          maxBytes: readPositiveIntInput('log-max-mb', 10) * 1024 * 1024,
          intervalMinutes: readPositiveIntInput('log-cleanup-interval', 60)
        },
        alertWebhookUrl: $('alert-webhook-url').value
      };
      $('settings-message').textContent = '正在保存...';
      const data = await requestJson('/api/settings', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      renderSettings(data.settings || {});
      renderRuntimeStatus(data.state || {});
      renderLogSummary((data.state && data.state.logs) || {});
      await loadLogs();
      $('settings-message').textContent = '已保存并即时生效';
    }

    async function testAlertWebhook() {
      const url = $('alert-webhook-url').value.trim();
      $('settings-message').textContent = '正在发送测试告警...';
      const data = await requestJson('/api/alert/test', {
        method: 'POST',
        body: JSON.stringify({ url: url })
      });
      if (!data.configured) {
        $('settings-message').textContent = '请先填写 Webhook 地址';
      } else if (data.ok) {
        $('settings-message').textContent = '测试告警已发送，请检查接收端';
      } else {
        $('settings-message').textContent = '发送失败：请检查地址是否可达（需 http/https）';
      }
    }

    async function importBackup() {
      const fileInput = $('import-file');
      const file = fileInput.files && fileInput.files[0];
      if (!file) {
        $('import-message').textContent = '请先选择一个备份 JSON 文件';
        return;
      }
      if (!confirm('导入会覆盖同 id 的账号和会话记录，确定继续？')) {
        return;
      }
      $('import-message').textContent = '正在导入...';
      const text = await file.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (parseError) {
        $('import-message').textContent = '文件不是有效的 JSON';
        return;
      }
      const data = await requestJson('/api/import', { method: 'POST', body: JSON.stringify(payload) });
      const im = data.imported || {};
      const parts = [
        '账号 ' + (im.accounts || 0),
        '会话 ' + (im.bridgeSessions || 0),
        '绑定 ' + (im.platformBindings || 0),
        '设置 ' + (im.sessionSettings || 0),
        '供应商 ' + (im.providerProfiles || 0),
        '元数据 ' + (im.threadMetadata || 0),
        '配置 ' + (im.configuration || 0)
      ];
      const errCount = Array.isArray(data.errors) ? data.errors.length : 0;
      $('import-message').textContent = '导入完成：' + parts.join('，') + (errCount ? ('（' + errCount + ' 条失败）') : '');
      fileInput.value = '';
      renderImportFileState();
      await loadState();
    }

    async function cleanupLogsNow() {
      $('settings-message').textContent = '正在清理日志...';
      const data = await requestJson('/api/logs/cleanup', { method: 'POST' });
      renderLogs(data.logs || {});
      const count = data.cleanup && Array.isArray(data.cleanup.actions) ? data.cleanup.actions.length : 0;
      $('settings-message').textContent = count ? ('已清理 ' + count + ' 个日志文件') : '无需清理';
    }

    async function copyLogsNow() {
      const text = String($('logs-box').textContent || '');
      if (!text.trim() || text.trim() === '(暂无日志)') {
        setMessage('暂无可复制的日志', true);
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setMessage('日志已复制');
    }

    function renderPairing(pairing) {
      const status = $('pairing-status');
      const box = $('qr-box');
      const link = $('qr-link');
      status.textContent = pairing ? pairing.status : '未生成';
      status.className = pairing && pairing.status === 'confirmed' ? 'pill ok' : 'pill';
      box.textContent = '';
      link.textContent = '';
      if (pairing && pairing.qrImageDataUrl) {
        const img = document.createElement('img');
        img.src = pairing.qrImageDataUrl;
        img.alt = '微信二维码';
        box.appendChild(img);
        box.classList.remove('clickable');
        box.title = '';
      } else {
        const empty = document.createElement('span');
        empty.className = 'muted';
        empty.textContent = pairing && pairing.status === 'starting' ? '正在生成二维码...' : '点击生成二维码';
        box.appendChild(empty);
        box.classList.add('clickable');
        box.title = '点击生成二维码';
      }
      if (pairing && pairing.qrUrl) {
        const a = document.createElement('a');
        a.href = pairing.qrUrl;
        a.textContent = pairing.qrUrl;
        a.target = '_blank';
        a.rel = 'noreferrer';
        link.appendChild(a);
      }
      if (pairing && pairing.status === 'confirmed') {
        setMessage('已添加：' + pairing.accountId, false);
        window.clearInterval(state.pairingTimer);
        state.pairingTimer = null;
        void loadState();
      } else if (pairing && pairing.error) {
        setMessage(pairing.error, true);
      }
    }

    function renderSetupPairing(pairing) {
      const box = $('setup-qr-box');
      const link = $('setup-qr-link');
      const message = $('setup-message');
      box.textContent = '';
      link.textContent = '';
      message.textContent = '';
      if (pairing && pairing.qrImageDataUrl) {
        const img = document.createElement('img');
        img.src = pairing.qrImageDataUrl;
        img.alt = '微信二维码';
        box.appendChild(img);
      } else {
        const empty = document.createElement('span');
        empty.className = 'muted';
        empty.textContent = pairing && pairing.status === 'starting' ? '正在生成二维码...' : '点击生成二维码';
        box.appendChild(empty);
      }
      if (pairing && pairing.qrUrl) {
        const a = document.createElement('a');
        a.href = pairing.qrUrl;
        a.textContent = pairing.qrUrl;
        a.target = '_blank';
        a.rel = 'noreferrer';
        link.appendChild(a);
      }
      if (pairing && pairing.status === 'confirmed') {
        message.textContent = '已添加：' + pairing.accountId;
        message.style.color = '#059669';
      } else if (pairing && pairing.error) {
        message.textContent = pairing.error;
        message.style.color = '#e11d48';
      } else if (pairing) {
        message.textContent = '状态：' + pairing.status;
        message.style.color = '#64708a';
      }
    }

    async function startPairing(displayName) {
      setMessage('正在生成二维码...', false);
      const data = await requestJson('/api/pairing/start', {
        method: 'POST',
        body: JSON.stringify({ displayName: displayName ?? $('display-name').value })
      });
      renderPairing(data.pairing);
      renderSetupPairing(data.pairing);
      if (!state.pairingTimer) {
        state.pairingTimer = window.setInterval(refreshPairingStatus, 2000);
      }
      setMessage('等待微信扫码确认', false);
    }

    async function refreshPairingStatus() {
      const data = await requestJson('/api/pairing/current');
      renderPairing(data.pairing);
      renderSetupPairing(data.pairing);
    }

    async function startSetupPairing() {
      $('setup-message').textContent = '正在生成二维码...';
      await startPairing($('setup-display-name').value);
      $('setup-message').textContent = '等待微信扫码确认';
    }

    async function completeSetup(skipped) {
      const data = await requestJson('/api/setup/complete', {
        method: 'POST',
        body: JSON.stringify({ skipped: Boolean(skipped) })
      });
      state.setup = data.setup || null;
      renderSetup(data.state || {});
      if (!skipped) {
        closeSetupWizard();
        setMessage('首次配置引导已完成', false);
      } else {
        closeSetupWizard();
        setMessage('已跳过首次配置引导，可随时重新打开配置向导', false);
      }
    }

    initThemeMode();

    for (const link of document.querySelectorAll('.side-nav a[data-page]')) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        showPage(link.dataset.page);
      });
    }
    window.addEventListener('hashchange', () => showPage(window.location.hash.slice(1) || 'overview'));
    showPage(window.location.hash.slice(1) || 'overview');

    $('refresh-btn').onclick = () => runRefreshList().catch((error) => setMessage(error.message, true));
    $('bridge-start').onclick = async () => {
      setMessage('正在启动微信桥接...', false);
      const data = await requestJson('/api/bridge/start', { method: 'POST' });
      renderBridge(data.bridge || { running: true });
      await loadState();
      setMessage('微信桥接已启动', false);
    };
    $('bridge-restart').onclick = async () => {
      setMessage('正在重启微信桥接...', false);
      const data = await requestJson('/api/bridge/restart', { method: 'POST' });
      renderBridge(data.bridge || { running: true });
      await loadState();
      setMessage('微信桥接已重启', false);
    };
    $('bridge-stop').onclick = async () => {
      if (!confirm('停止后，微信消息会暂停处理。管理面板仍可继续打开。')) return;
      setMessage('正在停止微信桥接...', false);
      const data = await requestJson('/api/bridge/stop', { method: 'POST' });
      renderBridge(data.bridge || { running: false });
      await loadState();
      setMessage('微信桥接已停止', false);
    };
    $('delivery-retry-now').onclick = async () => {
      if (!confirm('将立即尝试补发所有待处理消息，是否继续？')) return;
      const button = $('delivery-retry-now');
      button.disabled = true;
      setMessage('正在补发待处理消息...', false);
      try {
        const data = await requestJson('/api/delivery-outbox/retry', { method: 'POST' });
        const before = Number(data.before && data.before.pending || 0);
        const after = Number(data.after && data.after.pending || 0);
        await loadState();
        await loadMetrics();
        setMessage('补发完成：' + before + ' 条待处理，当前剩余 ' + after + ' 条', after > 0);
      } catch (error) {
        await loadState().catch(() => {});
        setMessage(error.message, true);
      }
    };
    $('start-pairing').onclick = () => startPairing().catch((error) => setMessage(error.message, true));
    $('refresh-pairing').onclick = () => startPairing().catch((error) => setMessage(error.message, true));
    $('qr-box').onclick = () => {
      if ($('qr-box').querySelector('img')) return;
      startPairing().catch((error) => setMessage(error.message, true));
    };
    $('qr-box').addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !$('qr-box').querySelector('img')) {
        event.preventDefault();
        startPairing().catch((error) => setMessage(error.message, true));
      }
    });
    $('cancel-pairing').onclick = async () => {
      await requestJson('/api/pairing/cancel', { method: 'POST' });
      await loadState();
      setMessage('已取消', false);
    };
    $('setup-open').onclick = () => openSetupWizard(0);
    $('setup-close').onclick = () => closeSetupWizard();
    $('setup-prev').onclick = () => setSetupStep(state.setupStep - 1);
    $('setup-next').onclick = () => setSetupStep(state.setupStep + 1);
    $('setup-refresh').onclick = () => loadState().catch((error) => {
      $('setup-status').textContent = '检查失败';
      setMessage(error.message, true);
    });
    $('setup-save-provider').onclick = () => saveSetupProviderSettings().catch((error) => {
      $('setup-provider-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('setup-ccswitch-sync').onclick = () => syncProviderFromCcswitch('setup-provider').catch((error) => {
      $('setup-provider-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('setup-test-api-key').onclick = () => runSetupTest('api-key', 'setup-test-api-key').catch((error) => {
      $('setup-test-result').textContent = error.message;
      $('setup-test-result').style.color = '#e11d48';
      setMessage(error.message, true);
    });
    $('setup-test-weixin').onclick = () => runSetupTest('weixin', 'setup-test-weixin').catch((error) => {
      $('setup-test-result').textContent = error.message;
      $('setup-test-result').style.color = '#e11d48';
      setMessage(error.message, true);
    });
    $('setup-test-codex').onclick = () => runSetupTest('codex-command', 'setup-test-codex').catch((error) => {
      $('setup-test-result').textContent = error.message;
      $('setup-test-result').style.color = '#e11d48';
      setMessage(error.message, true);
    });
    $('setup-complete').onclick = () => completeSetup(false).catch((error) => setMessage(error.message, true));
    $('setup-skip').onclick = () => completeSetup(true).catch((error) => setMessage(error.message, true));
    $('setup-provider-preset').onchange = () => applySetupProviderPreset($('setup-provider-preset').value);
    $('setup-provider-model').onchange = () => syncCustomModelVisibilityFor('setup-provider-model', 'setup-provider-model-custom');
    $('setup-provider-source').onchange = () => {
      $('setup-provider-message').textContent = $('setup-provider-source').value === 'ccswitch'
        ? '保存后将自动跟随 CCSwitch / Codex 当前配置'
        : '已切换为手动填写模式';
      if ($('setup-provider-source').value === 'manual' && $('setup-provider-preset').value === 'deepseek') {
        const normalized = normalizeDeepSeekBaseUrl($('setup-provider-base-url').value || 'https://api.deepseek.com/v1');
        $('setup-provider-base-url').value = /^(?:https?:\/\/)?api.deepseek.com(?:\/v1)?$/iu.test(normalized)
          ? 'https://api.deepseek.com/v1'
          : normalized;
      }
    };
    $('setup-start-pairing').onclick = () => startSetupPairing().catch((error) => {
      $('setup-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('setup-refresh-pairing').onclick = () => startSetupPairing().catch((error) => {
      $('setup-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('setup-qr-box').onclick = () => {
      if ($('setup-qr-box').querySelector('img')) return;
      startSetupPairing().catch((error) => {
        $('setup-message').textContent = error.message;
        setMessage(error.message, true);
      });
    };
    for (const tab of document.querySelectorAll('[data-setup-step]')) {
      tab.addEventListener('click', () => setSetupStep(Number(tab.dataset.setupStep || 0)));
    }
    $('sessions-refresh').onclick = () => loadSessions().catch((error) => setMessage(error.message, true));
    $('donate-open').onclick = () => openDonateModal();
    $('donate-open-side').onclick = () => openDonateModal();
    $('donate-close').onclick = () => closeDonateModal();
    $('donate-modal').addEventListener('click', (event) => {
      if (event.target === $('donate-modal')) {
        closeDonateModal();
      }
    });
    $('history-close').onclick = () => closeSessionHistory();
    $('setup-modal').addEventListener('click', (event) => {
      if (event.target === $('setup-modal')) {
        closeSetupWizard();
      }
    });
    $('history-modal').addEventListener('click', (event) => {
      if (event.target === $('history-modal')) {
        closeSessionHistory();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!$('donate-modal').hidden) closeDonateModal();
        if (!$('history-modal').hidden) closeSessionHistory();
        if (!$('setup-modal').hidden) closeSetupWizard();
      }
    });
    $('history-search').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        void loadSessionHistory($('history-search').value.trim()).catch((error) => setMessage(error.message, true));
      }
    });
    $('session-query').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        void loadSessions().catch((error) => setMessage(error.message, true));
      }
    });
    $('session-account').onchange = () => loadSessions().catch((error) => setMessage(error.message, true));
    $('session-sort').onchange = () => loadSessions().catch((error) => setMessage(error.message, true));
    $('diagnostics-run').onclick = () => runDiagnostics().catch((error) => {
      $('diagnostics-updated').textContent = '检查失败';
      $('diagnostics-summary-text').textContent = error.message;
      setMessage(error.message, true);
    });
    $('metrics-reset').onclick = () => resetMetrics().catch((error) => setMessage(error.message, true));
    $('provider-usage-profile').onchange = () => loadProviderUsage(false);
    $('provider-usage-refresh').onclick = () => loadProviderUsage(true);
    $('settings-save').onclick = () => saveSettings().catch((error) => {
      $('settings-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('update-check').onclick = () => checkForUpdate().catch((error) => {
      $('update-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('update-download').onclick = () => downloadUpdate().catch((error) => {
      $('update-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('update-install').onclick = () => installUpdate().catch((error) => {
      $('update-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('light-update-check').onclick = () => checkLightweightUpdate().catch((error) => {
      $('light-update-message').textContent = error.message;
      setMessage(error.message, true);
      refreshLightweightUpdaterStatus().catch(() => {});
    });
    $('light-update-download-install').onclick = () => downloadInstallLightweightUpdate().catch((error) => {
      $('light-update-message').textContent = error.message;
      setMessage(error.message, true);
      refreshLightweightUpdaterStatus().catch(() => {});
    });
    $('light-update-pick-local').onclick = () => pickLocalLightweightUpdate().catch((error) => {
      $('light-update-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('light-update-refresh').onclick = () => refreshLightweightUpdaterStatus().catch((error) => {
      $('light-update-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('light-update-install').onclick = () => installLightweightUpdate().catch((error) => {
      $('light-update-message').textContent = error.message;
      setMessage(error.message, true);
      refreshLightweightUpdaterStatus().catch(() => {});
    });
    $('light-update-rollback').onclick = () => rollbackLightweightUpdate().catch((error) => {
      $('light-update-message').textContent = error.message;
      setMessage(error.message, true);
      refreshLightweightUpdaterStatus().catch(() => {});
    });
    $('alert-test').onclick = () => testAlertWebhook().catch((error) => {
      $('settings-message').textContent = error.message;
    });
    $('provider-preset').onchange = () => applyProviderPreset($('provider-preset').value);
    $('provider-model').onchange = () => syncCustomModelVisibility();
    $('provider-source').onchange = () => {
      $('provider-message').textContent = $('provider-source').value === 'ccswitch'
        ? '保存后将自动跟随 CCSwitch / Codex 当前配置'
        : '已切换为手动填写模式';
      if ($('provider-source').value === 'manual' && $('provider-preset').value === 'deepseek') {
        const normalized = normalizeDeepSeekBaseUrl($('provider-base-url').value || 'https://api.deepseek.com/v1');
        $('provider-base-url').value = /^(?:https?:\/\/)?api.deepseek.com(?:\/v1)?$/iu.test(normalized)
          ? 'https://api.deepseek.com/v1'
          : normalized;
      }
    };
    $('provider-save').onclick = () => saveProviderSettings().catch((error) => {
      $('provider-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('provider-ccswitch-sync').onclick = () => syncProviderFromCcswitch('provider').catch((error) => {
      $('provider-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('promo-copy').onclick = () => {
      const url = 'https://ztoken.app/register?aff=8M7CSMLY5J77';
      const notify = () => {
        $('provider-message').textContent = '已复制中转站地址：' + url;
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(notify).catch(() => {
          $('provider-message').textContent = url;
        });
      } else {
        $('provider-message').textContent = url;
      }
    };
    $('logs-cleanup').onclick = () => cleanupLogsNow().catch((error) => {
      $('settings-message').textContent = error.message;
      setMessage(error.message, true);
    });
    $('logs-copy').onclick = () => copyLogsNow().catch((error) => setMessage(error.message, true));
    $('logs-refresh').onclick = () => loadLogs().catch((error) => setMessage(error.message, true));
    $('export-diagnostic').onclick = () => {
      window.location.href = '/api/export/diagnostic';
    };
    $('export-backup').onclick = () => {
      window.location.href = '/api/export';
    };
    $('import-backup').onclick = () => importBackup().catch((error) => {
      $('import-message').textContent = error.message;
    });
    $('import-file').onchange = () => renderImportFileState();

    startUpdaterBridge();
    startPageLifecycle();
    state.statusTimer = window.setInterval(() => {
      refreshRuntimeState().catch(() => {});
    }, 5000);
    loadState().catch((error) => {
      $('service-state').textContent = '异常';
      $('service-state').className = 'pill warn';
      setMessage(error.message, true);
    });
