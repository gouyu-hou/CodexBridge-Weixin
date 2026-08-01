
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
