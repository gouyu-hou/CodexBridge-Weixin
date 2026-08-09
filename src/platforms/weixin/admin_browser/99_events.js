
    initThemeMode();

    for (const link of /** @type {NodeListOf<HTMLElement>} */ (
      document.querySelectorAll('.side-nav a[data-page]')
    )) {
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
    for (const tab of /** @type {NodeListOf<HTMLElement>} */ (
      document.querySelectorAll('[data-setup-step]')
    )) {
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
