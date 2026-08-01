
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
