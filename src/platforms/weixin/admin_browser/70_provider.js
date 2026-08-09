
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
      $('provider-ccswitch-interval').value = String(Math.max(2, Math.round(Number((state.currentModelProvider.ccswitch && state.currentModelProvider.ccswitch.intervalMs) || 10000) / 1000)));
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
      $('setup-provider-ccswitch-interval').value = String(Math.max(2, Math.round(Number((current.ccswitch && current.ccswitch.intervalMs) || 10000) / 1000)));
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
