
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
