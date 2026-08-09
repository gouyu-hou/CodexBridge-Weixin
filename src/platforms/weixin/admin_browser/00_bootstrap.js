    const ADMIN_TOKEN = /** @type {HTMLMetaElement | null} */ (
      document.querySelector('meta[name="codexbridge-admin-token"]')
    )?.content || '';
    const queryParams = new URLSearchParams(window.location.search);
    /** @type {AdminState} */
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
    /**
     * @param {string} id
     * @returns {AdminElement}
     */
    const $ = (id) => {
      const element = document.getElementById(id);
      if (!element) {
        throw new Error('Missing Weixin admin element: ' + id);
      }
      return /** @type {AdminElement} */ (element);
    };
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
      const links = Array.from(/** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll('.side-nav a[data-page]')
      ));
      const panels = Array.from(/** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll('[data-page-panel]')
      ));
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
