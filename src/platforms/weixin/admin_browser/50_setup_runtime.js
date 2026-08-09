
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
      for (const tab of /** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll('[data-setup-step]')
      )) {
        tab.classList.toggle('active', Number(tab.dataset.setupStep) === next);
      }
      for (const panel of /** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll('[data-setup-panel]')
      )) {
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
      $('log-max-mb').value = String(Math.max(1, Math.round(Number(logCleanup.maxBytes || 10485760) / 1024 / 1024)));
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
