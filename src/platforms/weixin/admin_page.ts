export function renderAdminHtml(adminToken: string, cspNonce: string) {
  const faviconVersion = String(Date.now());
  const faviconIcoHref = `/favicon.ico?v=${faviconVersion}`;
  const faviconPngHref = `/favicon.png?v=${faviconVersion}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="codexbridge-admin-token" content="${adminToken}" />
  <title>CodexBridge Weixin</title>
  <link rel="icon" type="image/png" href="${faviconPngHref}" />
  <link rel="icon" type="image/x-icon" href="${faviconIcoHref}" />
  <link rel="shortcut icon" href="${faviconIcoHref}" />
  <link rel="apple-touch-icon" href="${faviconPngHref}" />
  <link rel="stylesheet" href="/admin/admin.css?v=${faviconVersion}" />
</head>
<body>
  <header>
    <div class="wrap topbar">
      <div class="page-brand">
        <img src="/favicon.png" alt="" />
        <div>
          <strong>CodexBridge</strong>
          <span>微信管理控制台</span>
        </div>
      </div>
      <div class="toolbar">
        <button class="theme-toggle" id="theme-toggle" type="button" aria-label="切换亮色或暗色主题">
          <span class="theme-icon" aria-hidden="true"></span>
          <span class="theme-label" id="theme-label">亮色</span>
        </button>
        <span class="pill" id="service-state">加载中</span>
        <button id="bridge-start">启动微信桥接</button>
        <button id="bridge-restart">重启微信桥接</button>
        <button class="danger" id="bridge-stop">停止微信桥接</button>
        <button id="setup-open">配置向导</button>
        <button class="support" id="donate-open">支持项目</button>
        <button id="refresh-btn">刷新列表</button>
      </div>
    </div>
  </header>
  <main class="wrap">
    <div class="shell">
      <aside class="sidebar">
        <div class="side-card side-nav-card">
          <div class="side-title">工作区</div>
          <nav class="side-nav" aria-label="管理面板分区">
            <a class="active" href="#overview" data-page="overview" data-icon="▦">数据概览</a>
            <a href="#users" data-page="users" data-icon="◎">用户入口</a>
            <a href="#runtime" data-page="runtime" data-icon="◌">运行状态</a>
            <a href="#diagnostics" data-page="diagnostics" data-icon="✓">诊断修复</a>
            <a href="#metrics" data-page="metrics" data-icon="▥">用量统计</a>
            <a href="#settings" data-page="settings" data-icon="⚙">运行配置</a>
            <a href="#updates" data-page="updates" data-icon="↻">软件更新</a>
            <a href="#provider" data-page="provider" data-icon="⌁">模型供应商</a>
            <a href="#phone-guide" data-page="phone-guide" data-icon="▯">手机使用 Codex</a>
            <a href="#sessions" data-page="sessions" data-icon="◇">会话管理</a>
            <a href="#logs" data-page="logs" data-icon="≡">运行日志</a>
            <a href="#backup" data-page="backup" data-icon="□">备份恢复</a>
          </nav>
        </div>
        <div class="side-card side-support">
          <strong>支持项目</strong>
          <span>觉得这个工具顺手的话，可以点开收款码支持一下，后续维护也更有动力。</span>
          <button class="support" id="donate-open-side">打开收款码</button>
        </div>
      </aside>
      <div class="content">
    <div class="page-group active" data-page-panel="overview">
    <section id="overview">
      <div class="section-head">
        <h2>数据概览</h2>
        <span class="muted" id="overview-updated">等待数据</span>
      </div>
      <div class="body">
        <div class="overview-grid">
          <div class="overview-summary">
            <div class="overview-stat-card overview-stat-card--messages">
              <div class="overview-stat-top"><span>收到消息</span><span class="overview-stat-icon" data-icon="↙" aria-hidden="true"></span></div>
              <div class="overview-stat-value" id="overview-messages-total">-</div>
              <div class="overview-stat-note">微信入口累计消息</div>
            </div>
            <div class="overview-stat-card overview-stat-card--turns">
              <div class="overview-stat-top"><span>完成回合</span><span class="overview-stat-icon" data-icon="✓" aria-hidden="true"></span></div>
              <div class="overview-stat-value" id="overview-turns-total">-</div>
              <div class="overview-stat-note">已完成 Codex 回复</div>
            </div>
            <div class="overview-stat-card overview-stat-card--errors">
              <div class="overview-stat-top"><span>最近错误</span><span class="overview-stat-icon" data-icon="!" aria-hidden="true"></span></div>
              <div class="overview-stat-value" id="overview-errors-hour">-</div>
              <div class="overview-stat-note">最近 1 小时错误</div>
            </div>
            <div class="overview-stat-card overview-stat-card--accounts">
              <div class="overview-stat-top"><span>微信账号</span><span class="overview-stat-icon" data-icon="◎" aria-hidden="true"></span></div>
              <div class="overview-stat-value" id="overview-account-total">-</div>
              <div class="overview-stat-note">当前已接入账号</div>
            </div>
          </div>
          <div class="overview-main-grid">
            <div class="chart-card overview-health-card">
              <div class="chart-title">回复健康度 <span id="delivery-rate-label">-</span></div>
              <div class="donut-wrap">
                <div class="donut" id="delivery-donut" data-label="-"></div>
                <div class="legend">
                  <div class="legend-row"><span class="legend-dot" style="background:#059669"></span><span>投递成功</span><strong id="chart-delivery-success">0</strong></div>
                  <div class="legend-row"><span class="legend-dot" style="background:#e11d48"></span><span>投递失败</span><strong id="chart-delivery-failed">0</strong></div>
                  <div class="legend-row"><span class="legend-dot" style="background:#f59e0b"></span><span>待补发</span><strong id="chart-delivery-pending">0</strong></div>
                </div>
              </div>
            </div>
            <div class="chart-card mini-grid">
              <div class="chart-title">并发占用 <span id="chart-concurrency-label">-</span></div>
              <div class="progress-row">
                <div class="progress-meta"><span>回复回合</span><strong id="chart-turns-active-label">0 / 0</strong></div>
                <div class="progress-track"><div class="progress-fill" id="chart-turns-active-fill"></div></div>
              </div>
              <div class="progress-row">
                <div class="progress-meta"><span>事件分发</span><strong id="chart-events-label">0</strong></div>
                <div class="progress-track"><div class="progress-fill" id="chart-events-fill"></div></div>
              </div>
              <div class="progress-row">
                <div class="progress-meta"><span>账号轮询</span><strong id="chart-poll-label">0</strong></div>
                <div class="progress-track"><div class="progress-fill" id="chart-poll-fill"></div></div>
              </div>
            </div>
          </div>
          <div class="overview-detail-grid">
            <div class="chart-card">
              <div class="chart-title">核心数据 <span>累计</span></div>
              <div class="bar-chart" id="metrics-bars"></div>
            </div>
            <div class="chart-card">
              <div class="chart-title">账号活跃度 <span id="account-bars-summary">暂无数据</span></div>
              <div class="account-bars" id="account-bars"></div>
            </div>
          </div>
        </div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="users">
    <div class="grid">
      <section id="users">
        <div class="section-head">
          <h2>已添加用户</h2>
          <span class="muted" id="account-count"></span>
        </div>
        <div class="role-help">
          <strong>角色说明</strong>
          <div class="role-help-grid">
            <div class="role-help-item"><b>主账号：</b>你的账号，权限最高，不能禁用或删除，默认可执行电脑操作命令。</div>
            <div class="role-help-item"><b>管理员：</b>适合可信任的人，可聊天、上传，也可以授权执行命令。</div>
            <div class="role-help-item"><b>普通用户：</b>适合一般朋友，建议只允许聊天和上传，不允许执行电脑操作命令。</div>
            <div class="role-help-item"><b>只读用户：</b>限制最多，建议只允许聊天，不允许上传和执行命令。</div>
          </div>
          <div class="role-help-note">实际权限以“可聊天 / 可上传 / 可执行命令”三个开关为准。</div>
        </div>
        <div class="table-wrap">
          <table class="accounts-table">
            <thead>
              <tr>
                <th style="width: 26%">名称</th>
                <th style="width: 21%">账号</th>
                <th style="width: 20%">用户</th>
                <th style="width: 13%">状态</th>
                <th style="width: 20%">操作</th>
              </tr>
            </thead>
            <tbody id="accounts-body"></tbody>
          </table>
        </div>
      </section>

      <section id="pairing">
        <div class="section-head">
          <h2>添加朋友</h2>
          <span class="pill" id="pairing-status">未生成</span>
        </div>
        <div class="body">
          <div class="qr-box clickable" id="qr-box" title="点击生成二维码" role="button" tabindex="0">
            <span class="muted">点击生成二维码</span>
          </div>
          <div class="qr-form">
            <input id="display-name" placeholder="备注名，可不填" />
            <div class="qr-buttons">
              <button class="primary" id="start-pairing">生成二维码</button>
              <button id="refresh-pairing">刷新二维码</button>
              <button id="cancel-pairing">取消</button>
            </div>
            <div class="status-line" id="qr-link"></div>
            <div class="status-line" id="message"></div>
          </div>
        </div>
      </section>
    </div>
    </div>

    <div class="page-group" data-page-panel="runtime">
    <section id="runtime">
      <div class="section-head">
        <h2>运行状态</h2>
        <span class="muted" id="status-updated"></span>
      </div>
      <div class="body">
        <div class="status-grid">
          <div class="metric">
            <div class="metric-label">当前回合</div>
            <div class="metric-value" id="metric-turns">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">事件分发</div>
            <div class="metric-value" id="metric-events">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">微信账号</div>
            <div class="metric-value" id="metric-accounts">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">最近错误</div>
            <div class="metric-value" id="metric-error">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">任务恢复</div>
            <div class="metric-value" id="metric-recovery">-</div>
          </div>
        </div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="diagnostics">
    <section id="diagnostics">
      <div class="section-head">
        <h2>一键诊断 / 修复</h2>
        <div class="toolbar">
          <span class="muted" id="diagnostics-updated">等待检查</span>
          <button class="primary" id="diagnostics-run">开始诊断</button>
        </div>
      </div>
      <div class="body">
        <div class="status-grid">
          <div class="metric">
            <div class="metric-label">总体状态</div>
            <div class="metric-value" id="diagnostics-summary-status">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">通过</div>
            <div class="metric-value" id="diagnostics-summary-ok">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">提醒</div>
            <div class="metric-value" id="diagnostics-summary-warn">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">需处理</div>
            <div class="metric-value" id="diagnostics-summary-fail">-</div>
          </div>
        </div>
        <div class="help-line" id="diagnostics-summary-text">点击“开始诊断”后，会检查服务运行、微信入口、API key、模型接口、端口和 Codex Native API。</div>
        <div class="diagnostics-list" id="diagnostics-list"></div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="metrics">
    <section id="metrics">
      <div class="section-head">
        <h2>用量统计</h2>
        <div class="toolbar">
          <span class="muted" id="metrics-uptime"></span>
          <button id="metrics-reset">清零统计</button>
        </div>
      </div>
      <div class="body">
        <div class="status-grid">
          <div class="metric">
            <div class="metric-label">收到消息</div>
            <div class="metric-value" id="metric-messages">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">完成回合 / 失败</div>
            <div class="metric-value" id="metric-turns-done">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">投递成功 / 失败</div>
            <div class="metric-value" id="metric-deliveries">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">当前错误状态</div>
            <div class="metric-value" id="metric-current-error">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">最近 1 小时错误</div>
            <div class="metric-value" id="metric-errors-hour">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">后台错误累计</div>
            <div class="metric-value" id="metric-errors-total">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">轮询错误 / 运行错误</div>
            <div class="metric-value" id="metric-error-breakdown">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">真正回复失败</div>
            <div class="metric-value" id="metric-reply-failures">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">平均回合耗时</div>
            <div class="metric-value" id="metric-avg-turn">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">最近回合耗时</div>
            <div class="metric-value" id="metric-last-turn">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">最近链路总耗时</div>
            <div class="metric-value" id="metric-latency-total">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">排队等待耗时</div>
            <div class="metric-value" id="metric-latency-queue">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">Codex 处理耗时</div>
            <div class="metric-value" id="metric-latency-coordinator">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">微信发送耗时</div>
            <div class="metric-value" id="metric-latency-delivery">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">进行中 / 排队回合</div>
            <div class="metric-value" id="metric-active-turns">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">待补发消息</div>
            <div class="metric-value" id="metric-pending">-</div>
          </div>
        </div>
        <div class="outbox-toolbar">
          <span id="delivery-outbox-status">暂无待补发消息</span>
          <button id="delivery-retry-now" type="button">立即补发</button>
        </div>
        <div class="help-line" id="metrics-error-detail">统计随服务重启保留；清零统计只清数字，不会删除会话、账号或日志。</div>
        <div class="provider-usage-block">
          <h3 class="subsection-title">Provider 用量</h3>
          <div class="provider-usage-toolbar">
            <div class="field">
              <label for="provider-usage-profile">Provider profile</label>
              <select id="provider-usage-profile"></select>
            </div>
            <button id="provider-usage-refresh" type="button">刷新</button>
          </div>
          <div class="provider-usage-summary" id="provider-usage-summary">正在加载用量...</div>
          <div class="provider-usage-windows" id="provider-usage-windows"></div>
        </div>
        <div class="latency-panel">
          <div class="latency-head">
            <strong>链路耗时统计</strong>
            <span id="metric-latency-detail">暂无链路数据</span>
          </div>
          <div class="latency-bars">
            <div class="progress-row">
              <div class="progress-meta"><span>排队等待</span><strong id="latency-queue-label">0 ms</strong></div>
              <div class="progress-track"><div class="progress-fill latency-queue" id="latency-queue-fill"></div></div>
            </div>
            <div class="progress-row">
              <div class="progress-meta"><span>Codex 处理</span><strong id="latency-coordinator-label">0 ms</strong></div>
              <div class="progress-track"><div class="progress-fill latency-coordinator" id="latency-coordinator-fill"></div></div>
            </div>
            <div class="progress-row">
              <div class="progress-meta"><span>微信发送</span><strong id="latency-delivery-label">0 ms</strong></div>
              <div class="progress-track"><div class="progress-fill latency-delivery" id="latency-delivery-fill"></div></div>
            </div>
          </div>
        </div>
        <h3 class="subsection-title">按账号</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width: 40%">账号</th>
                <th style="width: 20%">收到消息</th>
                <th style="width: 20%">完成 / 失败回合</th>
                <th style="width: 20%">平均回合耗时</th>
              </tr>
            </thead>
            <tbody id="metrics-by-account-body"></tbody>
          </table>
        </div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="settings">
    <section id="settings">
      <div class="section-head">
        <h2>运行配置</h2>
        <span class="muted" id="settings-message"></span>
      </div>
      <div class="body">
        <div class="settings-grid">
          <div class="field">
            <label for="max-concurrent-turns">最大同时回复数</label>
            <input id="max-concurrent-turns" type="number" min="1" max="64" step="1" />
          </div>
          <div class="field">
            <label for="event-dispatch-concurrency">事件分发并发</label>
            <input id="event-dispatch-concurrency" type="number" min="1" max="64" step="1" />
          </div>
          <div class="field">
            <label for="attachment-concurrency">附件处理并发</label>
            <input id="attachment-concurrency" type="number" min="1" max="64" step="1" />
          </div>
          <div class="field">
            <label for="account-poll-concurrency">账号轮询并发</label>
            <input id="account-poll-concurrency" type="number" min="1" max="64" step="1" />
          </div>
          <div class="field">
            <label for="log-retention-days">日志保留天数</label>
            <input id="log-retention-days" type="number" min="1" max="365" step="1" />
          </div>
          <div class="field">
            <label for="log-max-mb">单个日志最大 MB</label>
            <input id="log-max-mb" type="number" min="1" max="1024" step="1" />
          </div>
          <div class="field">
            <label for="log-cleanup-interval">清理间隔分钟</label>
            <input id="log-cleanup-interval" type="number" min="1" max="1440" step="1" />
          </div>
          <div class="field provider-span">
            <label for="alert-webhook-url">错误告警 Webhook（留空关闭，出错时 POST 通知）</label>
            <div class="webhook-row">
              <input id="alert-webhook-url" autocomplete="off" placeholder="https://..." />
              <button id="alert-test">测试</button>
            </div>
          </div>
          <div class="actions">
            <button class="primary" id="settings-save">保存配置</button>
          </div>
        </div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="updates">
    <section id="updates">
      <div class="section-head">
        <h2>软件更新</h2>
        <span class="muted" id="update-message"></span>
      </div>
      <div class="body">
        <div class="status-grid">
          <div class="metric">
            <div class="metric-label">当前版本</div>
            <div class="metric-value" id="update-current-version">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">最新版本</div>
            <div class="metric-value" id="update-latest-version">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">更新状态</div>
            <div class="metric-value" id="update-status-label">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">上次检查</div>
            <div class="metric-value" id="update-last-checked">-</div>
          </div>
        </div>
        <div class="progress-row">
          <div class="progress-meta">
            <span>下载进度</span>
            <strong id="update-progress-label">-</strong>
          </div>
          <div class="progress-track"><div class="progress-fill" id="update-progress-fill"></div></div>
        </div>
        <div class="update-actions">
          <button class="primary" id="update-check">检查更新</button>
          <button id="update-download">下载更新</button>
          <button class="danger" id="update-install">重启安装</button>
        </div>
        <div class="help-line">启动安装版时会自动检查更新。发现新版本后不会强制安装，需要你确认下载和重启安装；配置、API key、微信会话数据会保留在本机数据目录。</div>
        <h3 class="subsection-title">轻量代码更新</h3>
        <div class="status-grid">
          <div class="metric">
            <div class="metric-label">代码来源</div>
            <div class="metric-value" id="light-update-source">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">轻量版本</div>
            <div class="metric-value" id="light-update-version">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">轻量状态</div>
            <div class="metric-value" id="light-update-status">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">上次操作</div>
            <div class="metric-value" id="light-update-last-action">-</div>
          </div>
        </div>
        <label class="field provider-span">
          <span>本地轻量包路径</span>
          <input id="light-update-path" autocomplete="off" placeholder="选择或粘贴轻量更新包目录 / zip 文件路径" />
        </label>
        <div class="update-actions">
          <button id="light-update-pick-local">选择文件/文件夹</button>
          <button class="primary" id="light-update-check">检查轻量更新</button>
          <button id="light-update-download-install">下载并安装轻量更新</button>
          <button class="primary" id="light-update-install">安装轻量包</button>
          <button id="light-update-refresh">刷新轻量状态</button>
          <button class="danger" id="light-update-rollback">回退内置版本</button>
        </div>
        <div class="help-line" id="light-update-message">轻量更新只替换业务代码和页面，不重复下载 Electron、Node、Codex runtime。安装后关闭并重新打开应用即可使用新代码；启动失败会自动回退。</div>
        <h3 class="subsection-title">更新日志</h3>
        <pre class="release-notes" id="update-release-notes">暂无更新日志。</pre>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="provider">
    <section id="provider">
      <div class="section-head">
        <h2>模型供应商</h2>
        <span class="muted" id="provider-message"></span>
      </div>
      <div class="body">
        <div class="promo">
          <div class="promo-text">
            <span class="promo-title">推荐中转站 · Z Token</span>
            <span class="promo-sub">一个 key 直连 GPT-5.5 / GPT-5.4 等模型 · 支持 Claude Code · 免代理 · 按量计费 · 接口地址已自动填好</span>
          </div>
          <div class="promo-actions">
            <a class="promo-link" href="https://ztoken.app/register?aff=8M7CSMLY5J77" target="_blank" rel="noopener">前往 ztoken.app</a>
            <button id="promo-copy">复制链接</button>
          </div>
        </div>
        <div class="settings-grid provider-grid">
          <div class="field">
            <label for="provider-preset">供应商预设</label>
            <select id="provider-preset">
              <option value="default">Z Token - Codex</option>
              <option value="ztoken-claude">Z Token - Claude</option>
              <option value="official-codex">官网 Codex</option>
              <option value="official-claude-code">官网 Claude Code</option>
              <option value="deepseek">DeepSeek</option>
              <option value="qwen">Qwen</option>
              <option value="openrouter">OpenRouter</option>
              <option value="kimi">Kimi</option>
              <option value="gemini">Gemini</option>
              <option value="minimax">MiniMax</option>
              <option value="iflow">iFlow</option>
            </select>
          </div>
          <div class="field">
            <label for="provider-source">配置来源</label>
            <select id="provider-source">
              <option value="manual">手动填写</option>
              <option value="ccswitch">跟随 CCSwitch / Codex 当前配置</option>
            </select>
          </div>
          <div class="field">
            <label for="provider-name">供应商名称</label>
            <input id="provider-name" autocomplete="off" />
          </div>
          <div class="field">
            <label for="provider-model">模型</label>
            <select id="provider-model"></select>
            <input id="provider-model-custom" autocomplete="off" placeholder="自定义模型名称" style="display:none;" />
          </div>
          <div class="field">
            <label for="provider-api-key">API key</label>
            <input id="provider-api-key" type="password" autocomplete="off" placeholder="不填写则保留当前 key" />
          </div>
          <div class="field provider-span">
            <label for="provider-base-url">接口地址 Base URL</label>
            <input id="provider-base-url" autocomplete="off" />
          </div>
          <div class="field provider-span">
            <label>当前 key</label>
            <div class="readonly-line" id="provider-key-status">-</div>
          </div>
          <div class="field provider-span">
            <label for="provider-env-file">配置文件</label>
            <input id="provider-env-file" autocomplete="off" placeholder="例如 D:\\IT_learn\\codex_weixin\\CodexBridge\\weixin.service.env" />
          </div>
          <div class="field provider-span">
            <label for="provider-ccswitch-home">CCSwitch / Codex Home</label>
            <input id="provider-ccswitch-home" autocomplete="off" placeholder="默认使用当前用户的 .codex 目录" />
          </div>
          <div class="field">
            <label for="provider-ccswitch-interval">自动同步间隔（秒）</label>
            <input id="provider-ccswitch-interval" type="number" min="2" max="60" step="1" />
          </div>
          <div class="field">
            <label>CCSwitch 同步状态</label>
            <div class="readonly-line" id="provider-ccswitch-status">-</div>
          </div>
          <div class="actions">
            <button class="primary" id="provider-save">保存模型配置</button>
            <button id="provider-ccswitch-sync">立即同步 CCSwitch</button>
          </div>
        </div>
        <div class="help-line">
          没有 API key？可在 <a href="https://ztoken.app/register?aff=8M7CSMLY5J77" target="_blank" rel="noopener">ztoken.app</a> 注册中转站获取（OpenAI 兼容接口，支持 GPT-5.5 / GPT-5.4，也可选择 Claude Code 预设）。API key 留空表示保留当前已保存的 key。
        </div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="phone-guide">
    <section id="phone-guide">
      <div class="section-head">
        <h2>手机使用 Codex 详细文档</h2>
        <span class="muted">微信聊天、项目控制、上传图片、会话管理和常用命令</span>
      </div>
      <div class="body">
        <div class="doc-card wide">
          <h3>完整使用流程</h3>
          <p>手机使用 Codex 的核心逻辑是：微信消息先进入本机 CodexBridge 服务，再交给电脑上的 Codex 和模型处理，最后把最终结果发回微信。因此电脑必须保持开机、联网，并且本软件正在运行。</p>
          <ol>
            <li>双击打开 <strong>CodexBridge Weixin Admin</strong>，等待顶部状态显示服务正常。</li>
            <li>进入“模型供应商”，选择配置来源：手动填写 API key，或跟随 CCSwitch / Codex 当前配置。</li>
            <li>进入“用户入口”，生成微信登录二维码或朋友入口二维码，用微信扫码确认。</li>
            <li>在微信里发送 <code>你好</code> 测试普通聊天；发送 <code>/status</code> 查看当前会话、模型、权限和连接状态。</li>
            <li>如果要让手机控制电脑项目，先发送 <code>/project D:\\你的项目路径</code>，再发送具体任务。</li>
          </ol>
          <p>第一次使用建议先只测试普通聊天；确认能正常回复后，再开启项目控制和文件修改权限。</p>
        </div>

        <div class="doc-grid">
          <div class="doc-card">
            <h3>手机能做什么</h3>
            <ul>
              <li>像普通聊天一样向 Codex 提问，并把最终答案发回微信。</li>
              <li>让 Codex 在电脑项目目录里读代码、改文件、运行测试和总结结果。</li>
              <li>连续发送多张截图或多个文件，最后用一句提示词统一分析。</li>
              <li>在手机上新建会话、查找历史会话、按名字切换会话、重命名会话。</li>
              <li>在需要执行命令或修改文件时，通过 <code>/allow</code> 和 <code>/deny</code> 审批。</li>
            </ul>
          </div>

          <div class="doc-card">
            <h3>手机不能脱离电脑</h3>
            <ul>
              <li>电脑关机、睡眠、断网或软件退出后，微信端不能继续调用本地 Codex。</li>
              <li>朋友扫码后也使用的是你这台电脑上的服务、API key 和数据目录。</li>
              <li>如果 API key 没额度、provider 不可用或模型接口报错，微信端也会失败。</li>
              <li>如果二维码过期，需要重新生成；看到 <code>expired</code> 就代表旧二维码不能用了。</li>
            </ul>
          </div>

          <div class="doc-card wide">
            <h3>手机控制项目：推荐写法</h3>
            <p>先指定项目目录，再发送任务。任务最好包含：目标、范围、验证方式、输出要求。</p>
            <div class="doc-code">
              <code>/project D:\\IT_learn\\codex_weixin\\CodexBridge</code>
              <code>请检查为什么管理面板打不开。先定位原因，再修复；只改必要文件；修复后运行相关测试；最后只告诉我根因、修改文件和测试结果。</code>
            </div>
            <ul>
              <li><code>/project</code> 查看当前项目目录、默认目录和权限状态。</li>
              <li><code>/project on</code> 使用当前会话或默认目录开启项目控制。</li>
              <li><code>/project D:\\path</code> 指定电脑项目目录。</li>
              <li><code>/project cancel</code> 取消还没开始的项目控制会话。</li>
            </ul>
          </div>

          <div class="doc-card">
            <h3>审批和权限</h3>
            <p>当 Codex 需要改文件、运行命令或做高风险操作时，微信里可能会出现审批请求。</p>
            <div class="doc-code">
              <code>/allow</code>
              <code>/allow 1</code>
              <code>/allow 2</code>
              <code>/deny</code>
            </div>
            <ul>
              <li><code>/allow</code> 查看当前等待审批的请求。</li>
              <li><code>/allow 1</code> 单次批准第 1 个请求。</li>
              <li><code>/allow 2</code> 批准并在当前会话记住类似请求。</li>
              <li><code>/deny</code> 拒绝当前审批请求。</li>
            </ul>
          </div>

          <div class="doc-card">
            <h3>权限模式怎么选</h3>
            <div class="doc-code">
              <code>/permissions</code>
              <code>/permissions default-permissions</code>
              <code>/permissions auto-review</code>
              <code>/permissions full-access</code>
            </div>
            <ul>
              <li>新手优先用 <code>default-permissions</code>，工作区内可写，高风险操作会询问。</li>
              <li><code>auto-review</code> 会让审查代理辅助处理部分审批。</li>
              <li><code>full-access</code> 风险更高，只在你明确知道任务需要时使用。</li>
            </ul>
          </div>

          <div class="doc-card wide">
            <h3>图片和文件：多张一起发</h3>
            <p>需要连续发多张图片、截图或文件时，先开启上传模式。图片会先暂存，直到你发送文字提示词后才统一交给 Codex。</p>
            <div class="doc-code">
              <code>/up</code>
              <code>连续发送图片或文件</code>
              <code>请结合刚才所有截图，判断为什么服务启动失败，并给我按步骤排查。</code>
            </div>
            <ul>
              <li><code>/up</code> 开启上传暂存模式。</li>
              <li><code>/up status</code> 查看已经暂存的图片和文件。</li>
              <li><code>/up cancel</code> 取消本次上传模式并清空暂存。</li>
              <li>只发送图片通常不会立刻回答；发送文字说明后才开始处理。</li>
            </ul>
          </div>

          <div class="doc-card wide">
            <h3>会话管理：让历史对话好找</h3>
            <div class="command-table">
              <div class="command-row"><code>/new</code><span>准备新会话；发送下一条普通内容后才真正创建，避免空会话。</span></div>
              <div class="command-row"><code>/threads</code><span>查看历史会话列表，当前会话前面会有醒目标识。</span></div>
              <div class="command-row"><code>/next /prev</code><span>查看历史会话下一页或上一页，需要先用 <code>/threads</code> 或 <code>/search</code>。</span></div>
              <div class="command-row"><code>/search 项目学习</code><span>搜索标题或内容里包含关键词的会话。</span></div>
              <div class="command-row"><code>/open 2</code><span>打开当前列表第 2 个会话。</span></div>
              <div class="command-row"><code>/open 项目学习</code><span>按名字打开会话；如果重名，建议先搜索再按序号打开。</span></div>
              <div class="command-row"><code>/peek 2</code><span>预览第 2 个会话最近内容，但不切换。</span></div>
              <div class="command-row"><code>/rename this 项目学习</code><span>给当前会话改名。</span></div>
              <div class="command-row"><code>/rename 2 项目学习</code><span>给当前列表第 2 个会话改名。</span></div>
              <div class="command-row"><code>/threads del 2</code><span>归档列表第 2 个会话；通常不是彻底删除底层 Codex 历史。</span></div>
              <div class="command-row"><code>/threads pin 2</code><span>置顶列表第 2 个会话。</span></div>
              <div class="command-row"><code>/threads all</code><span>查看全部会话，包括归档项。</span></div>
            </div>
          </div>

          <div class="doc-card wide">
            <h3>模型和供应商</h3>
            <div class="command-table">
              <div class="command-row"><code>/provider</code><span>查看或切换 provider 配置。</span></div>
              <div class="command-row"><code>/models</code><span>查看当前 provider 下可用模型。</span></div>
              <div class="command-row"><code>/model</code><span>查看当前模型、模型来源和推理强度。</span></div>
              <div class="command-row"><code>/model gpt-5.6-sol</code><span>切换到指定模型。</span></div>
              <div class="command-row"><code>/model high</code><span>只切换推理强度。</span></div>
              <div class="command-row"><code>/model gpt-5.6-sol ultra</code><span>同时切换模型和推理强度。</span></div>
              <div class="command-row"><code>/model default</code><span>恢复 provider 默认模型和推理配置。</span></div>
            </div>
            <p>不同 provider 和模型支持的推理强度不同。如果某个强度不支持，系统会按模型能力兼容或提示。</p>
          </div>

          <div class="doc-card wide">
            <h3>所有常用命令速查</h3>
            <div class="command-table">
              <div class="command-row"><code>/helps</code><span>查看全部命令帮助；也可以用 <code>/helps project</code> 查看某个命令。</span></div>
              <div class="command-row"><code>/status</code><span>查看当前会话、项目目录、模型、权限和运行状态。</span></div>
              <div class="command-row"><code>/usage</code><span>查看当前账号用量和额度摘要。</span></div>
              <div class="command-row"><code>/stop</code><span>停止当前正在回复或执行的任务。</span></div>
              <div class="command-row"><code>/retry</code><span>重试上一条任务。</span></div>
              <div class="command-row"><code>/reconnect</code><span>刷新当前 provider / Codex 连接。</span></div>
              <div class="command-row"><code>/restart</code><span>请求重启桥接服务。</span></div>
              <div class="command-row"><code>/compact</code><span>手动压缩当前 Codex 上下文。</span></div>
              <div class="command-row"><code>/review</code><span>对当前项目改动做代码审查。</span></div>
              <div class="command-row"><code>/skills</code><span>查看当前项目可用 skills。</span></div>
              <div class="command-row"><code>/plugins</code><span>查看插件。</span></div>
              <div class="command-row"><code>/apps</code><span>查看 Apps / Connectors。</span></div>
              <div class="command-row"><code>/mcp</code><span>查看 MCP servers。</span></div>
              <div class="command-row"><code>/use @插件名 任务</code><span>指定本轮优先使用某个插件。</span></div>
              <div class="command-row"><code>/instructions</code><span>查看或修改全局自定义指令。</span></div>
              <div class="command-row"><code>/personality</code><span>查看或切换会话风格。</span></div>
              <div class="command-row"><code>/plan on / /plan off</code><span>开启或关闭规划模式。</span></div>
              <div class="command-row"><code>/fast / /fast off</code><span>开启或关闭 Fast 模式。</span></div>
              <div class="command-row"><code>/lang zh-CN / /lang en</code><span>切换桥接回复语言。</span></div>
              <div class="command-row"><code>/as</code><span>助理记录统一入口，自动识别日志、待办、提醒和笔记。</span></div>
              <div class="command-row"><code>/log / /todo / /remind / /note</code><span>分别保存日志、待办、提醒和笔记。</span></div>
            </div>
            <p>实际可用命令以微信里 <code>/helps</code> 返回为准。不同版本可能会新增、隐藏或调整部分命令。</p>
          </div>

          <div class="doc-card wide">
            <h3>常见问题排查</h3>
            <div class="command-table">
              <div class="command-row"><code>一直显示正在输入</code><span>先发 <code>/status</code> 看状态，再用 <code>/stop</code> 中断；必要时 <code>/reconnect</code> 或在管理面板重启服务。</span></div>
              <div class="command-row"><code>提示有一轮回复在进行中</code><span>同一会话通常会排队，等当前任务完成，或先 <code>/stop</code> 再发新任务。</span></div>
              <div class="command-row"><code>502 / 503</code><span>多半是上游模型服务临时不可用；稍后 <code>/retry</code>，并检查 API key、额度和 Base URL。</span></div>
              <div class="command-row"><code>429</code><span>通常是额度不足、请求太频繁或 provider 限速；换 key、降并发或等待额度恢复。</span></div>
              <div class="command-row"><code>朋友扫码无法连接</code><span>检查电脑是否开机联网、服务是否运行、微信账号是否在线、二维码是否过期。</span></div>
              <div class="command-row"><code>换 key 后仍报错</code><span>手动模式保存新 key；CCSwitch 模式先在 CCSwitch 切换，再点同步或发送 <code>/reconnect</code>。</span></div>
            </div>
          </div>

          <div class="doc-card wide">
            <h3>推荐任务模板</h3>
            <div class="doc-code">
              <code>请在当前项目里定位并修复这个问题：管理页面打开后一直检查失败。要求：先读相关代码，不要乱改无关文件；找到根因后再修改；修改后运行相关测试；最后只告诉我根因、修改文件和测试结果。</code>
              <code>请给当前项目新增功能：在管理面板增加会话导出按钮。要求：保持现有 UI 风格；功能完整可用；加必要测试；最后告诉我怎么使用。</code>
              <code>请结合我刚才发的截图分析问题。先判断最可能原因，再给我按步骤排查；如果需要更多信息，请明确告诉我要截图哪里或复制哪段日志。</code>
            </div>
          </div>
        </div>

        <div class="doc-hero">
          <h3>用手机微信控制电脑上的 Codex</h3>
          <p>这个软件会把微信消息转发给本机 Codex。你可以在手机上让 Codex 读项目代码、修改文件、运行测试、总结日志，也可以给朋友生成入口二维码。电脑必须保持开机并运行本软件，手机端才可以继续对话。</p>
          <div class="download-links">
            <a href="https://gh-proxy.org/https://github.com/farion1231/cc-switch/releases/download/v3.14.1/CC-Switch-v3.14.1-Windows.msi" target="_blank" rel="noopener">下载 CCSwitch Windows</a>
            <a href="https://gh-proxy.org/https://github.com/farion1231/cc-switch/releases/download/v3.14.1/CC-Switch-v3.14.1-macOS.dmg" target="_blank" rel="noopener">下载 CCSwitch macOS</a>
            <a href="https://ztoken.app/register?aff=8M7CSMLY5J77" target="_blank" rel="noopener">注册 ztoken.app</a>
          </div>
        </div>

        <div class="doc-grid">
          <div class="doc-card">
            <h3>1. 第一次使用</h3>
            <ol>
              <li>双击打开 CodexBridge Weixin Admin，等待顶部显示桥接运行中。</li>
              <li>进入“模型供应商”，选择 Z Token 或 Claude Code（Z Token），填写 API key、模型和 Base URL 后保存。</li>
              <li>如果你使用 CCSwitch，把“配置来源”改为“跟随 CCSwitch / Codex 当前配置”，点击“立即同步 CCSwitch”。</li>
              <li>进入“用户入口”，生成二维码，用你的微信或朋友微信扫码确认。</li>
              <li>在微信里发送一句普通消息，例如“你好”，确认能收到最终回复。</li>
            </ol>
          </div>

          <div class="doc-card">
            <h3>2. CCSwitch 和 API key</h3>
            <p>没有 CCSwitch 可以先下载安装。当前版本提供 Windows 安装包和 macOS dmg；如果你只想手动填 API key，可以不装 CCSwitch。</p>
            <ul>
              <li>手动模式：直接在“模型供应商”里填 API key、模型、Base URL，保存后生效。</li>
              <li>CCSwitch 模式：在 CCSwitch 切换 key 或模型后，本软件会按间隔自动同步，也可以手动点“立即同步 CCSwitch”。</li>
              <li>API key 留空保存时，会保留当前已经保存过的 key，不会清空。</li>
            </ul>
          </div>

          <div class="doc-card">
            <h3>3. 手机控制项目代码</h3>
            <p>先在微信里指定项目目录，再发送任务。这样 Codex 会在电脑对应目录里读代码、修改文件和运行命令。</p>
            <div class="doc-code">
              <code>/project D:\\IT_learn\\codex_weixin\\CodexBridge</code>
              <code>读取这个项目，帮我修复启动报错，跑测试后只告诉我结果</code>
            </div>
            <ul>
              <li><code>/project</code> 查看当前项目目录和权限状态。</li>
              <li><code>/project on</code> 使用当前会话或默认目录开启项目控制。</li>
              <li><code>/project cancel</code> 取消还没开始的新项目控制会话。</li>
              <li>默认是请求批准权限；需要执行高风险操作时，微信会提示你用 <code>/allow</code> 审批。</li>
            </ul>
          </div>

          <div class="doc-card">
            <h3>4. 上传图片和文件</h3>
            <p>需要一次发多张图片或多个文件时，先开启上传模式。图片会暂存，直到你发送文字提示词才一起提交给 Codex。</p>
            <div class="doc-code">
              <code>/up</code>
              <code>连续发送图片或文件</code>
              <code>请结合这些截图分析问题，并给我最终结论</code>
            </div>
            <ul>
              <li><code>/up status</code> 查看已经暂存的文件。</li>
              <li><code>/up cancel</code> 取消本次上传模式并清空暂存。</li>
              <li>只发图片不会立刻回答，发送文字说明后才会开始处理。</li>
            </ul>
          </div>

          <div class="doc-card wide">
            <h3>5. 常用命令大全</h3>
            <div class="command-table">
              <div class="command-row"><code>/helps</code><span>查看全部命令帮助；也可以用 <code>/helps project</code> 查看某个命令。</span></div>
              <div class="command-row"><code>/status</code><span>查看当前会话、项目目录、模型、权限和运行状态。</span></div>
              <div class="command-row"><code>/usage</code><span>查看当前账号用量和剩余额度摘要。</span></div>
              <div class="command-row"><code>/new</code><span>准备新会话；下一条普通消息才真正创建，避免空会话。</span></div>
              <div class="command-row"><code>/new D:\\path</code><span>在指定目录准备一个新会话。</span></div>
              <div class="command-row"><code>/project</code><span>查看手机项目控制状态。</span></div>
              <div class="command-row"><code>/project D:\\path</code><span>指定电脑项目目录，让手机消息控制 Codex 操作项目代码。</span></div>
              <div class="command-row"><code>/stop</code><span>停止当前正在回复或执行的任务。</span></div>
              <div class="command-row"><code>/retry</code><span>重试上一条任务。</span></div>
              <div class="command-row"><code>/reconnect</code><span>刷新当前 provider / Codex 连接。</span></div>
              <div class="command-row"><code>/restart</code><span>重启桥接服务。</span></div>
              <div class="command-row"><code>/model</code><span>查看当前模型；<code>/model gpt-5.6-sol high</code> 可切换模型和推理深度。</span></div>
              <div class="command-row"><code>/models</code><span>列出当前 provider 可用模型。</span></div>
              <div class="command-row"><code>/provider</code><span>查看或切换 provider 配置。</span></div>
              <div class="command-row"><code>/permissions</code><span>查看当前权限模式。</span></div>
              <div class="command-row"><code>/permissions default-permissions</code><span>工作区可写，越界或高风险操作请求批准，推荐日常使用。</span></div>
              <div class="command-row"><code>/permissions auto-review</code><span>工作区可写，由审查代理处理合格审批。</span></div>
              <div class="command-row"><code>/permissions full-access</code><span>完全访问且不审批，只在你明确信任任务时使用。</span></div>
              <div class="command-row"><code>/allow</code><span>查看当前待审批请求。</span></div>
              <div class="command-row"><code>/allow 1</code><span>单次批准第 1 个请求。</span></div>
              <div class="command-row"><code>/allow 2</code><span>批准并在当前会话内记住。</span></div>
              <div class="command-row"><code>/deny</code><span>拒绝当前审批请求；<code>/deny 2</code> 拒绝第 2 个请求。</span></div>
              <div class="command-row"><code>/up</code><span>开启上传模式，连续上传图片/文件后统一提交。</span></div>
              <div class="command-row"><code>/up status</code><span>查看已暂存上传文件。</span></div>
              <div class="command-row"><code>/up cancel</code><span>取消上传模式。</span></div>
              <div class="command-row"><code>/threads</code><span>查看历史会话列表。</span></div>
              <div class="command-row"><code>/next /prev</code><span>历史会话列表下一页 / 上一页。</span></div>
              <div class="command-row"><code>/search 名字</code><span>搜索历史会话标题或内容。</span></div>
              <div class="command-row"><code>/open 名字</code><span>切换到指定名字的历史会话。</span></div>
              <div class="command-row"><code>/peek 2</code><span>预览当前列表第 2 个会话最近内容。</span></div>
              <div class="command-row"><code>/rename this 项目学习</code><span>给当前会话改名。</span></div>
              <div class="command-row"><code>/rename 2 项目学习</code><span>给当前列表第 2 个会话改名。</span></div>
              <div class="command-row"><code>/threads del 2</code><span>归档当前列表第 2 个会话，原始 Codex 历史不会被直接删除。</span></div>
              <div class="command-row"><code>/threads pin 2</code><span>置顶当前列表第 2 个会话。</span></div>
              <div class="command-row"><code>/threads all</code><span>查看全部历史会话，包括归档项。</span></div>
              <div class="command-row"><code>/compact</code><span>手动压缩当前 Codex 上下文。</span></div>
              <div class="command-row"><code>/lang zh-CN / /lang en</code><span>切换桥接回复语言。</span></div>
              <div class="command-row"><code>/plan on / /plan off</code><span>切换规划模式。</span></div>
              <div class="command-row"><code>/fast / /fast off</code><span>切换服务速度档位。</span></div>
              <div class="command-row"><code>/personality</code><span>查看或切换会话风格。</span></div>
              <div class="command-row"><code>/instructions</code><span>查看、起草或确认全局自定义指令。</span></div>
              <div class="command-row"><code>/review</code><span>对当前项目改动运行代码审查。</span></div>
              <div class="command-row"><code>/as</code><span>助理记录统一入口，自动识别日志、待办、提醒和笔记。</span></div>
              <div class="command-row"><code>/log</code><span>记录或查询日志。</span></div>
              <div class="command-row"><code>/todo</code><span>记录、查询或完成待办事项。</span></div>
              <div class="command-row"><code>/remind</code><span>创建或管理提醒。</span></div>
              <div class="command-row"><code>/note</code><span>记录或查询笔记。</span></div>
              <div class="command-row"><code>/skills</code><span>查看当前项目可用技能。</span></div>
              <div class="command-row"><code>/apps / /plugins / /mcp</code><span>查看和管理 Codex 可见的连接器、插件和 MCP 服务。</span></div>
              <div class="command-row"><code>/use @插件名 任务</code><span>显式指定本轮优先使用某个插件。</span></div>
              <div class="command-row"><code>/login</code><span>管理 Codex 登录账号或刷新登录状态。</span></div>
            </div>
          </div>

          <div class="doc-card">
            <h3>6. 示例场景</h3>
            <div class="doc-code">
              <code>/project D:\\IT_learn\\codex_weixin\\CodexBridge</code>
              <code>帮我检查为什么管理页面打不开，修复后跑相关测试</code>
              <code>/allow 1</code>
            </div>
            <p>如果 Codex 需要运行命令或改文件，微信会显示审批提示。你确认没问题后再发 <code>/allow 1</code> 或 <code>/allow 2</code>。</p>
          </div>

          <div class="doc-card">
            <h3>7. 常见问题</h3>
            <ul>
              <li>电脑关机、断网或软件关闭后，微信端不能继续让本机 Codex 执行任务。</li>
              <li>一直显示正在输入时，先发 <code>/status</code> 查看状态，再用 <code>/stop</code> 中断。</li>
              <li>API key 换了后，手动模式在“模型供应商”里保存新 key；CCSwitch 模式在 CCSwitch 切换后点击同步。</li>
              <li>朋友扫码后产生的会话和数据会保存在你这台电脑的数据目录里。</li>
              <li>需要只看最终结果时，当前桥接默认会过滤思考过程，只把最终回答发到微信。</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="sessions">
    <section id="sessions">
      <div class="section-head">
        <h2>会话管理</h2>
        <span class="muted" id="session-count"></span>
      </div>
      <div class="body">
        <div class="filter-row">
          <input id="session-query" placeholder="搜索标题、账号、线程、最新问题" />
          <select id="session-account">
            <option value="">全部账号</option>
          </select>
          <select id="session-sort">
            <option value="updatedDesc">最近更新优先</option>
            <option value="updatedAsc">最早更新优先</option>
            <option value="titleAsc">标题 A-Z</option>
            <option value="titleDesc">标题 Z-A</option>
            <option value="createdDesc">新建时间优先</option>
          </select>
          <button id="sessions-refresh">刷新会话</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width: 30%">标题 / 最新问题</th>
                <th style="width: 16%">微信账号</th>
                <th style="width: 16%">模型</th>
                <th style="width: 16%">更新时间</th>
                <th style="width: 10%">状态</th>
                <th style="width: 12%">操作</th>
              </tr>
            </thead>
            <tbody id="sessions-body"></tbody>
          </table>
        </div>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="logs">
    <section id="logs">
      <div class="section-head">
        <h2>运行日志</h2>
        <div class="toolbar">
          <button id="logs-cleanup">立即清理</button>
          <button id="logs-copy">复制日志</button>
          <button id="logs-refresh">刷新日志</button>
        </div>
      </div>
      <div class="body">
        <div class="log-summary">
          <span class="pill" id="logs-size">日志大小：-</span>
          <span class="muted" id="logs-policy"></span>
        </div>
        <pre class="log-box" id="logs-box">正在加载日志...</pre>
      </div>
    </section>
    </div>

    <div class="page-group" data-page-panel="backup">
    <section id="backup">
      <div class="section-head">
        <h2>导出备份 / 导入恢复</h2>
        <span class="muted" id="import-message"></span>
      </div>
      <div class="body">
        <div class="export-row">
          <button class="primary" id="export-diagnostic">导出脱敏诊断</button>
          <button id="export-backup">导出完整备份（含密钥）</button>
          <span class="muted">诊断包可用于排查问题；完整备份包含微信 token、上下文、同步游标、provider 密钥、会话索引和最近日志，请勿分享。</span>
        </div>
        <div class="import-row">
          <label class="file-picker" for="import-file">
            <span class="file-picker-icon">JSON</span>
            <span class="file-picker-copy">
              <span class="file-picker-title" id="import-file-name">选择备份 JSON 文件</span>
              <span class="file-picker-meta" id="import-file-meta">支持 .json 文件，导入会覆盖同 id 的账号和会话</span>
            </span>
            <input type="file" id="import-file" accept="application/json,.json" />
          </label>
          <button id="import-backup">导入备份</button>
          <span class="muted">从导出的 JSON 恢复账号与会话（同 id 会被覆盖）。</span>
        </div>
      </div>
    </section>
    </div>
      </div>
    </div>
  </main>

  <div class="modal-overlay" id="history-modal" hidden>
    <div class="modal-card">
      <div class="modal-head">
        <h2 id="history-title">会话历史</h2>
        <button id="history-close">关闭</button>
      </div>
      <div class="modal-toolbar">
        <input id="history-search" placeholder="搜索这条会话的历史消息，回车搜索" />
        <span class="muted" id="history-count"></span>
      </div>
      <div class="history-body" id="history-body"></div>
    </div>
  </div>

  <div class="modal-overlay" id="setup-modal" hidden>
    <div class="modal-card setup-card">
      <div class="modal-head">
        <h2>首次配置向导</h2>
        <div class="toolbar">
          <span class="pill" id="setup-status">等待检查</span>
          <button id="setup-close">关闭</button>
        </div>
      </div>
      <div class="setup-progress" id="setup-progress">
        <button class="setup-step-tab active" data-setup-step="0">1 数据目录</button>
        <button class="setup-step-tab" data-setup-step="1">2 模型配置</button>
        <button class="setup-step-tab" data-setup-step="2">3 环境检查</button>
        <button class="setup-step-tab" data-setup-step="3">4 微信扫码</button>
        <button class="setup-step-tab" data-setup-step="4">5 测试完成</button>
      </div>
      <div class="setup-body">
        <div class="setup-step active" data-setup-panel="0">
          <div class="setup-intro">
            <strong>先确认数据保存位置</strong>
            <span class="muted">当前服务启动后会使用下面的数据目录和配置文件。需要迁移目录时，建议关闭应用后通过启动器或安装路径调整。</span>
          </div>
          <div class="setup-grid">
            <div class="setup-info">
              <span>数据目录</span>
              <code id="setup-data-dir">-</code>
            </div>
            <div class="setup-info">
              <span>配置文件</span>
              <code id="setup-env-file">-</code>
            </div>
            <div class="setup-info">
              <span>Codex Home</span>
              <code id="setup-codex-home">-</code>
            </div>
            <div class="setup-info">
              <span>管理页面</span>
              <code id="setup-admin-url">-</code>
            </div>
          </div>
        </div>
        <div class="setup-step setup-provider-panel" data-setup-panel="1">
          <div class="setup-intro">
            <strong>填写模型供应商</strong>
            <span class="muted">这里会保存到服务配置文件。API key 留空表示保留已有 key。</span>
          </div>
          <div class="settings-grid provider-grid">
            <div class="field">
              <label for="setup-provider-preset">供应商预设</label>
              <select id="setup-provider-preset">
                <option value="default">Z Token - Codex</option>
                <option value="ztoken-claude">Z Token - Claude</option>
                <option value="official-codex">官网 Codex</option>
                <option value="official-claude-code">官网 Claude Code</option>
                <option value="deepseek">DeepSeek</option>
                <option value="qwen">Qwen</option>
                <option value="openrouter">OpenRouter</option>
                <option value="kimi">Kimi</option>
                <option value="gemini">Gemini</option>
                <option value="minimax">MiniMax</option>
                <option value="iflow">iFlow</option>
              </select>
            </div>
            <div class="field">
              <label for="setup-provider-source">配置来源</label>
              <select id="setup-provider-source">
                <option value="manual">手动填写</option>
                <option value="ccswitch">跟随 CCSwitch / Codex 当前配置</option>
              </select>
            </div>
            <div class="field">
              <label for="setup-provider-name">供应商名称</label>
              <input id="setup-provider-name" autocomplete="off" />
            </div>
            <div class="field">
              <label for="setup-provider-model">模型</label>
              <select id="setup-provider-model"></select>
              <input id="setup-provider-model-custom" autocomplete="off" placeholder="自定义模型名称" style="display:none;" />
            </div>
            <div class="field provider-span">
              <label for="setup-provider-api-key">API key</label>
              <input id="setup-provider-api-key" type="password" autocomplete="off" placeholder="填写新 key，留空保留当前 key" />
            </div>
            <div class="field provider-span">
              <label for="setup-provider-base-url">接口地址 Base URL</label>
              <input id="setup-provider-base-url" autocomplete="off" />
            </div>
            <div class="help-line setup-provider-hint">如果使用中转站，可以点击 <a href="https://ztoken.app/register?aff=8M7CSMLY5J77" target="_blank" rel="noopener">ztoken.app</a> 跳转到中转站获取接口地址。API key 留空表示保留当前已保存的 key。</div>
            <div class="field provider-span">
              <label>当前 key</label>
              <div class="readonly-line" id="setup-provider-key-status">-</div>
            </div>
            <div class="field provider-span">
              <label for="setup-provider-env-file">配置文件</label>
              <input id="setup-provider-env-file" autocomplete="off" />
            </div>
            <div class="field provider-span">
              <label for="setup-provider-ccswitch-home">CCSwitch / Codex Home</label>
              <input id="setup-provider-ccswitch-home" autocomplete="off" placeholder="默认使用当前用户的 .codex 目录" />
            </div>
            <div class="field">
              <label for="setup-provider-ccswitch-interval">自动同步间隔（秒）</label>
              <input id="setup-provider-ccswitch-interval" type="number" min="2" max="60" step="1" />
            </div>
            <div class="field provider-span">
              <label>CCSwitch 同步状态</label>
              <div class="readonly-line" id="setup-provider-ccswitch-status">-</div>
            </div>
          </div>
          <div class="help-line" id="setup-provider-message">保存后关闭并重新打开应用，可让模型配置在整个服务中生效。</div>
        </div>
        <div class="setup-step" data-setup-panel="2">
          <div class="setup-intro">
            <strong>检查运行环境</strong>
            <span class="muted">如果有黄色项目，按提示补齐后点击刷新检查。</span>
          </div>
          <div class="setup-checks" id="setup-checks"></div>
        </div>
        <div class="setup-step" data-setup-panel="3">
          <div class="setup-intro">
            <strong>生成微信扫码入口</strong>
            <span class="muted">点击生成二维码，用微信扫描并确认后，这个账号就可以通过桥接服务聊天。</span>
          </div>
          <div class="grid">
            <div class="qr-box setup-qr-box" id="setup-qr-box">
              <span class="muted">点击下方按钮生成二维码</span>
            </div>
            <div class="qr-form">
              <input id="setup-display-name" placeholder="入口备注名，可不填" />
              <div class="qr-buttons">
                <button class="primary" id="setup-start-pairing">生成二维码</button>
                <button id="setup-refresh-pairing">刷新二维码</button>
              </div>
              <div class="status-line" id="setup-qr-link"></div>
              <div class="status-line" id="setup-message"></div>
            </div>
          </div>
        </div>
        <div class="setup-step" data-setup-panel="4">
          <div class="setup-test-card">
            <strong>最后做一次测试</strong>
            <span>在微信里发送：你好，测试一下</span>
            <span>收到正常回复后，点击“完成引导”。如果暂时不测试，也可以先跳过，后面再从右上角打开配置向导。</span>
          </div>
          <div class="setup-test-actions">
            <button id="setup-test-api-key">测试 API key</button>
            <button id="setup-test-weixin">测试微信连通</button>
            <button id="setup-test-codex">测试 Codex 命令</button>
          </div>
          <div class="setup-test-result" id="setup-test-result">还没有测试；可以逐项点击上面的按钮。</div>
          <div class="setup-checks" id="setup-final-checks"></div>
        </div>
      </div>
      <div class="setup-actions">
        <button id="setup-skip">跳过</button>
        <div class="toolbar">
          <button id="setup-prev">上一步</button>
          <button id="setup-refresh">刷新检查</button>
          <button class="primary" id="setup-save-provider">保存模型配置</button>
          <button id="setup-ccswitch-sync">同步 CCSwitch</button>
          <button class="primary" id="setup-next">下一步</button>
          <button class="primary" id="setup-complete">完成引导</button>
        </div>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="donate-modal" hidden>
    <div class="modal-card" style="width:min(420px, 100%);">
      <div class="modal-head">
        <h2>支持项目</h2>
        <button id="donate-close">关闭</button>
      </div>
      <div class="donate-body">
        <img src="/donate/wechat-reward.png" alt="微信收款码" />
        <div class="donate-note">如果这个工具帮到了你，可以用微信扫码支持一下。感谢你的鼓励。</div>
      </div>
    </div>
  </div>

  <script nonce="${cspNonce}" src="/admin/admin.js?v=${faviconVersion}"></script>
</body>
</html>`;
}
