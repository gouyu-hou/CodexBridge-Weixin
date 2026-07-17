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
  <style nonce="${cspNonce}">
    :root {
      color-scheme: light;
      --bg: #eef2f7;
      --app-chrome: #e3e8ef;
      --panel: rgba(255, 255, 255, 0.94);
      --panel-solid: #ffffff;
      --text: #151b28;
      --muted: #667085;
      --line: rgba(15, 23, 42, 0.10);
      --line-strong: rgba(15, 23, 42, 0.18);
      --accent: #159661;
      --accent-2: #2563eb;
      --accent-dark: #087443;
      --cyan: #06b6d4;
      --amber: #f59e0b;
      --support: #ff4d6d;
      --danger: #e11d48;
      --ok: #059669;
      --grad: linear-gradient(135deg, #159661 0%, #17b681 55%, #2563eb 100%);
      --support-grad: linear-gradient(135deg, #ffb703 0%, #ff4d6d 48%, #8b5cf6 100%);
      --shadow: 0 18px 42px -30px rgba(15, 23, 42, 0.34), 0 8px 18px -16px rgba(15, 23, 42, 0.18);
      --sidebar-bg: #e4e9f0;
      --code-bg: #f5f7fb;
      --code-text: #0f172a;
      --doc-text: #465269;
      --doc-muted: #4b5568;
    }
    body[data-theme="dark"] {
      color-scheme: dark;
      --bg: #141414;
      --app-chrome: #202226;
      --panel: rgba(31, 31, 31, 0.96);
      --panel-solid: #1f1f1f;
      --text: #f3f4f6;
      --muted: #a3a3a3;
      --line: rgba(255, 255, 255, 0.10);
      --line-strong: rgba(255, 255, 255, 0.17);
      --accent: #34e99c;
      --accent-2: #60a5fa;
      --accent-dark: #34e99c;
      --cyan: #22d3ee;
      --amber: #fbbf24;
      --support: #fb7185;
      --danger: #fb7185;
      --ok: #34e99c;
      --grad: linear-gradient(135deg, #34e99c 0%, #22d3ee 58%, #60a5fa 100%);
      --support-grad: linear-gradient(135deg, #fbbf24 0%, #fb7185 48%, #a78bfa 100%);
      --shadow: none;
      --sidebar-bg: #202226;
      --code-bg: #151515;
      --code-text: #e5e7eb;
      --doc-text: #d4d4d4;
      --doc-muted: #a3a3a3;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      overflow-x: hidden;
    }
    body[data-theme="dark"] {
      background: var(--bg);
    }
    body::before {
      content: none;
    }
    body[data-theme="dark"]::before {
      content: none;
    }
    header, main, .modal-overlay {
      position: relative;
      z-index: 2;
    }
    ::selection { background: rgba(139, 92, 246, 0.22); }
    a { color: #6d28d9; }
    header {
      border-bottom: 1px solid var(--line);
      background: rgba(248, 250, 252, 0.92);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      position: sticky;
      top: 0;
      z-index: 20;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7);
    }
    .wrap {
      width: 100%;
      margin: 0;
      padding: 0 clamp(16px, 2.4vw, 30px);
    }
    .topbar {
      min-height: 86px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
    }
    h1 {
      margin: 0;
      font-size: clamp(24px, 2vw, 32px);
      font-weight: 800;
      letter-spacing: 0.2px;
      color: var(--text);
      background: none;
    }
    .page-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .page-brand img {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      box-shadow: 0 10px 24px -14px rgba(15, 23, 42, 0.46);
      flex: 0 0 auto;
    }
    .page-brand strong {
      display: block;
      font-size: clamp(22px, 1.8vw, 30px);
      line-height: 1.2;
      font-weight: 800;
    }
    .page-brand span {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 14px;
      overflow-wrap: anywhere;
    }
    main {
      padding: 0 0 44px;
    }
    .shell {
      display: grid;
      grid-template-columns: 300px minmax(0, 1fr);
      min-height: calc(100vh - 86px);
      align-items: stretch;
    }
    .sidebar {
      position: sticky;
      top: 86px;
      height: calc(100vh - 86px);
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      gap: 14px;
      align-self: stretch;
      padding: 18px 16px 20px 0;
      overflow: hidden;
      border-right: 1px solid var(--line);
      background: var(--app-chrome);
    }
    .side-card {
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.42);
      box-shadow: none;
      overflow: hidden;
    }
    .side-nav-card {
      min-height: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }
    .side-title {
      padding: 12px 12px 7px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }
    .side-nav {
      display: grid;
      padding: 6px 8px 10px;
      gap: 6px;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      align-content: start;
      scrollbar-width: thin;
    }
    .side-nav::-webkit-scrollbar {
      width: 8px;
    }
    .side-nav::-webkit-scrollbar-thumb {
      background: rgba(100, 112, 138, 0.34);
      border-radius: 999px;
    }
    .side-nav a {
      position: relative;
      display: flex;
      align-items: center;
      gap: 11px;
      min-height: 46px;
      border-radius: 9px;
      padding: 0 13px;
      color: var(--text);
      text-decoration: none;
      font-size: 15px;
      font-weight: 760;
      transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
    }
    .side-nav a::before {
      content: attr(data-icon);
      width: 26px;
      height: 26px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      background: rgba(255, 255, 255, 0.55);
      color: var(--muted);
      box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
      flex: 0 0 auto;
      font-size: 13px;
      transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
    }
    .side-nav a.active {
      background: rgba(21, 150, 97, 0.13);
      color: var(--accent-dark);
      box-shadow: inset 0 0 0 1px rgba(21, 150, 97, 0.18);
    }
    .side-nav a.active::before {
      background: var(--accent);
      color: #ffffff;
      box-shadow: 0 8px 20px -12px rgba(21, 150, 97, 0.85);
    }
    .side-nav a:hover {
      background: rgba(255, 255, 255, 0.72);
      color: var(--accent-dark);
      transform: translateX(2px);
    }
    .side-nav a::after {
      content: "";
      width: 6px;
      height: 6px;
      border-top: 2px solid currentColor;
      border-right: 2px solid currentColor;
      transform: rotate(45deg);
      color: var(--muted);
      margin-left: auto;
      opacity: 0.36;
    }
    .side-support {
      padding: 14px;
      display: grid;
      gap: 10px;
      background:
        linear-gradient(135deg, rgba(255, 183, 3, 0.16), rgba(255, 77, 109, 0.12)),
        #ffffff;
    }
    .side-support strong {
      font-size: 15px;
      color: #9f1239;
    }
    .side-support span {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.6;
    }
    .content {
      display: grid;
      gap: clamp(14px, 1.4vw, 22px);
      min-width: 0;
      padding: 24px 0 0 24px;
    }
    .page-group {
      display: none;
      gap: clamp(14px, 1.4vw, 22px);
      min-width: 0;
    }
    .page-group.active {
      display: grid;
      animation: pageEnter 0.22s ease-out both;
    }
    @keyframes pageEnter {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
      gap: 20px;
      align-items: start;
    }
    section {
      position: relative;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      box-shadow: var(--shadow);
      overflow: hidden;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
      min-width: 0;
    }
    section::before {
      content: none;
    }
    section:hover { border-color: var(--line-strong); }
    section[id] {
      scroll-margin-top: 90px;
    }
    .section-head {
      padding: 16px 20px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
      background: rgba(248, 250, 252, 0.72);
    }
    h2 {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }
    .body {
      padding: 18px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .theme-toggle {
      width: 42px;
      height: 42px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      background: #ffffff;
      color: #111827;
      font-weight: 700;
      transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease, background 0.16s ease;
    }
    .theme-toggle:hover {
      border-color: rgba(15, 23, 42, 0.24);
      box-shadow: 0 12px 22px -18px rgba(15, 23, 42, 0.45);
      transform: translateY(-1px);
    }
    body[data-theme="dark"] .theme-toggle {
      background: #2b2b2b;
      border-color: var(--line-strong);
      color: #f8fafc;
      box-shadow: none;
    }
    .theme-icon {
      position: relative;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      flex: 0 0 auto;
      display: block;
      background: transparent;
      border: 0;
      box-shadow: inset 6px -4px 0 0 currentColor;
      transform: rotate(-12deg);
    }
    .theme-icon::before,
    .theme-icon::after {
      content: "";
      position: absolute;
      display: block;
      transition: transform 0.2s ease, opacity 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
    }
    .theme-icon::before {
      display: none;
    }
    .theme-icon::after {
      width: 3px;
      height: 3px;
      left: 50%;
      top: 50%;
      border-radius: 50%;
      background: currentColor;
      transform: translate(-50%, -50%);
      opacity: 0;
    }
    body[data-theme="dark"] .theme-icon {
      background: currentColor;
      box-shadow: none;
      transform: rotate(0deg) scale(0.72);
    }
    body[data-theme="dark"] .theme-icon::before {
      opacity: 0;
      transform: scale(0);
    }
    body[data-theme="dark"] .theme-icon::after {
      opacity: 1;
      transform: translate(-50%, -50%);
      box-shadow:
        0 -13px 0 currentColor,
        0 13px 0 currentColor,
        13px 0 0 currentColor,
        -13px 0 0 currentColor,
        9px 9px 0 currentColor,
        -9px 9px 0 currentColor,
        9px -9px 0 currentColor,
        -9px -9px 0 currentColor;
    }
    .theme-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    body[data-theme="dark"] header {
      background: rgba(20, 20, 20, 0.96);
      box-shadow: none;
    }
    body[data-theme="dark"] .side-card,
    body[data-theme="dark"] section {
      background: var(--panel);
      border-color: var(--line);
    }
    body[data-theme="dark"] .section-head,
    body[data-theme="dark"] .modal-head {
      background: #1f1f1f;
      border-color: var(--line);
    }
    body[data-theme="dark"] .side-nav a::before {
      background: #292b2f;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    body[data-theme="dark"] .side-nav a:hover {
      background: #303236;
    }
    body[data-theme="dark"] .side-support {
      background:
        radial-gradient(140px 120px at 100% 0%, rgba(251, 191, 36, 0.16), transparent 70%),
        radial-gradient(160px 130px at 0% 100%, rgba(251, 113, 133, 0.12), transparent 70%),
        rgba(15, 23, 42, 0.88);
    }
    body[data-theme="dark"] .side-support strong,
    body[data-theme="dark"] .promo-title {
      color: #fecdd3;
    }
    body[data-theme="dark"] button,
    body[data-theme="dark"] input,
    body[data-theme="dark"] select {
      background: #2b2b2b;
      color: var(--text);
      border-color: var(--line-strong);
    }
    body[data-theme="dark"] button:hover {
      background: #333333;
      border-color: rgba(255, 255, 255, 0.22);
    }
    body[data-theme="dark"] select option {
      background: #111827;
      color: var(--text);
    }
    body[data-theme="dark"] th {
      background: rgba(96, 165, 250, 0.08);
      color: var(--muted);
    }
    body[data-theme="dark"] tbody tr:hover {
      background: rgba(96, 165, 250, 0.08);
    }
    body[data-theme="dark"] .pill,
    body[data-theme="dark"] .readonly-line,
    body[data-theme="dark"] .chart-card,
    body[data-theme="dark"] .overview-stat-card,
    body[data-theme="dark"] .metric,
    body[data-theme="dark"] .diagnostic-card,
    body[data-theme="dark"] .latency-panel,
    body[data-theme="dark"] .release-notes,
    body[data-theme="dark"] .qr-box,
    body[data-theme="dark"] .file-picker,
    body[data-theme="dark"] .promo,
    body[data-theme="dark"] .modal-card,
    body[data-theme="dark"] .setup-card,
    body[data-theme="dark"] .setup-info,
    body[data-theme="dark"] .setup-test-card,
    body[data-theme="dark"] .setup-test-result,
    body[data-theme="dark"] .account-permission,
    body[data-theme="dark"] .role-help,
    body[data-theme="dark"] .doc-card,
    body[data-theme="dark"] .command-row,
    body[data-theme="dark"] .download-links a {
      background: #1f1f1f;
      color: var(--text);
      border-color: var(--line);
    }
    body[data-theme="dark"] .donut::after {
      background: #1f1f1f;
      color: var(--text);
    }
    body[data-theme="dark"] .bar-track,
    body[data-theme="dark"] .progress-track,
    body[data-theme="dark"] .account-bar-track {
      background: rgba(148, 163, 184, 0.16);
    }
    body[data-theme="dark"] .qr-box img {
      background: #ffffff;
      border-color: rgba(255, 255, 255, 0.12);
    }
    body[data-theme="dark"] .diagnostic-detail,
    body[data-theme="dark"] .release-notes {
      color: #cbd5e1;
    }
    body[data-theme="dark"] .log-box {
      background: #050914;
      color: #dbeafe;
      border-color: rgba(148, 163, 184, 0.2);
    }
    button, input, select {
      height: 36px;
      border-radius: 8px;
      border: 1px solid var(--line-strong);
      background: #ffffff;
      color: var(--text);
      font: inherit;
      transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
    }
    input, select {
      min-width: 0;
      padding: 0 11px;
    }
    select option {
      background: #ffffff;
      color: var(--text);
    }
    button {
      padding: 0 13px;
      cursor: pointer;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
    }
    button:hover {
      background: #f1f3f9;
      border-color: rgba(15, 23, 42, 0.22);
    }
    button:active { transform: translateY(1px); }
    button.primary {
      border: 0;
      background: var(--grad);
      background-size: 160% 160%;
      color: #fff;
      font-weight: 650;
      box-shadow: 0 10px 22px -8px rgba(21, 150, 97, 0.55);
    }
    button.primary:hover {
      background-position: 100% 0;
      box-shadow: 0 14px 28px -8px rgba(21, 150, 97, 0.68);
      transform: translateY(-1px);
    }
    button.support {
      border: 0;
      background: var(--support-grad);
      background-size: 160% 160%;
      color: #ffffff;
      font-weight: 800;
      box-shadow: 0 13px 26px -12px rgba(244, 63, 94, 0.75);
    }
    button.support:hover {
      background-position: 100% 0;
      box-shadow: 0 16px 32px -12px rgba(245, 158, 11, 0.6);
      transform: translateY(-1px);
    }
    button.danger {
      border-color: rgba(225, 29, 72, 0.32);
      color: #be123c;
      background: rgba(225, 29, 72, 0.07);
    }
    button.danger:hover {
      background: rgba(225, 29, 72, 0.13);
      border-color: rgba(225, 29, 72, 0.5);
    }
    button:disabled {
      opacity: 0.5;
      cursor: default;
      transform: none;
    }
    button.refreshing {
      border-color: rgba(21, 150, 97, 0.38);
      background: rgba(21, 150, 97, 0.09);
      color: var(--accent-dark);
    }
    .refresh-spin {
      width: 14px;
      height: 14px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 999px;
      display: inline-block;
      animation: refreshSpin 0.75s linear infinite;
    }
    @keyframes refreshSpin {
      to { transform: rotate(360deg); }
    }
    .table-wrap {
      max-width: 100%;
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: auto;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 10px 12px;
      text-align: left;
      vertical-align: middle;
    }
    th {
      font-size: 12px;
      color: var(--muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      background: rgba(99, 102, 241, 0.05);
    }
    td {
      overflow-wrap: anywhere;
      min-width: 0;
    }
    tbody tr { transition: background 0.15s ease; }
    tbody tr:hover { background: rgba(99, 102, 241, 0.06); }
    tr:last-child td {
      border-bottom: 0;
    }
    .name-cell {
      display: grid;
      gap: 6px;
    }
    .rename-row {
      display: grid;
      grid-template-columns: minmax(150px, 1fr) auto;
      gap: 6px;
      align-items: center;
    }
    .account-config {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .account-config-row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      align-items: center;
    }
    .account-model-control {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 34px;
      gap: 6px;
      min-width: 0;
    }
    .account-config input,
    .account-config select {
      width: 100%;
      min-width: 0;
      height: 34px;
      font-size: 12.5px;
      padding: 0 10px;
    }
    .account-model-refresh {
      width: 34px;
      min-width: 34px;
      height: 34px;
      padding: 0;
      font-size: 18px;
      line-height: 1;
    }
    .account-model-status {
      min-height: 16px;
      font-size: 11.5px;
      color: #64708a;
      line-height: 1.4;
    }
    .account-model-status.warn {
      color: #b45309;
    }
    .account-permissions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .account-permission {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 28px;
      padding: 0 9px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      background: rgba(255, 255, 255, 0.72);
      font-size: 12px;
      white-space: nowrap;
    }
    .account-permission input {
      width: 14px;
      height: 14px;
      padding: 0;
      margin: 0;
    }
    .account-config-save {
      justify-self: start;
      height: 32px;
      padding: 0 12px;
      font-size: 12.5px;
    }
    .role-help {
      margin: 14px 18px 0;
      padding: 12px 14px;
      border: 1px solid rgba(37, 99, 235, 0.16);
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.07), rgba(6, 182, 212, 0.06));
      color: var(--muted);
      display: grid;
      gap: 8px;
      line-height: 1.65;
    }
    .role-help strong {
      color: var(--text);
      font-size: 13.5px;
    }
    .role-help-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px 14px;
    }
    .role-help-item {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .role-help-item b {
      color: var(--text);
    }
    .role-help-note {
      font-size: 12.5px;
      color: var(--muted);
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 26px;
      border-radius: 999px;
      border: 1px solid var(--line-strong);
      padding: 0 11px;
      font-size: 12px;
      color: var(--muted);
      background: #ffffff;
      width: fit-content;
      white-space: nowrap;
    }
    .pill.ok {
      border-color: rgba(5, 150, 105, 0.3);
      color: #047857;
      background: rgba(16, 185, 129, 0.10);
    }
    .pill.warn {
      border-color: rgba(217, 119, 6, 0.3);
      color: #b45309;
      background: rgba(245, 158, 11, 0.13);
    }
    .pill.ok::before, .pill.warn::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      flex: 0 0 auto;
    }
    .pill.ok::before {
      animation: pillPulse 1.8s ease-in-out infinite;
    }
    @keyframes pillPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45); }
      50% { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.06); }
    }
    .muted {
      color: var(--muted);
      font-size: 12px;
    }
    .actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .account-actions {
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      min-width: 118px;
    }
    .account-actions button {
      height: 32px;
      padding: 0 12px;
      font-size: 12.5px;
    }
    .tag-primary {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 30px;
      padding: 0 13px;
      border-radius: 999px;
      font-size: 12.5px;
      font-weight: 650;
      color: #6d28d9;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.14), rgba(217, 70, 239, 0.12));
      border: 1px solid rgba(139, 92, 246, 0.3);
      white-space: nowrap;
    }
    .account-id {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .account-id-main {
      font-weight: 650;
      overflow-wrap: anywhere;
      line-height: 1.35;
    }
    .account-id-sub {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
      line-height: 1.35;
    }
    .accounts-table th:nth-child(1), .accounts-table td:nth-child(1) { width: 26%; min-width: 230px; }
    .accounts-table th:nth-child(2), .accounts-table td:nth-child(2) { width: 20%; min-width: 180px; }
    .accounts-table th:nth-child(3), .accounts-table td:nth-child(3) { width: 26%; min-width: 220px; }
    .accounts-table th:nth-child(4), .accounts-table td:nth-child(4) { width: 12%; min-width: 110px; }
    .accounts-table th:nth-child(5), .accounts-table td:nth-child(5) { width: 16%; min-width: 132px; }
    .status-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .overview-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 14px;
    }
    .overview-summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .overview-stat-card {
      min-width: 0;
      padding: 15px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: #ffffff;
      display: grid;
      gap: 8px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
    }
    .overview-stat-card::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 3px;
      background: var(--overview-accent, var(--accent));
      opacity: 0.9;
    }
    .overview-stat-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: var(--muted);
      font-size: 12px;
    }
    .overview-stat-icon {
      width: 38px;
      height: 38px;
      border-radius: 12px;
      display: grid;
      place-items: center;
      color: var(--overview-accent, var(--accent-dark));
      background: var(--overview-icon-bg, rgba(21, 150, 97, 0.12));
      box-shadow: inset 0 0 0 1px var(--overview-icon-line, rgba(21, 150, 97, 0.18));
      font-size: 18px;
      font-weight: 800;
      flex: 0 0 auto;
    }
    .overview-stat-icon::before {
      content: attr(data-icon);
      line-height: 1;
    }
    .overview-stat-card--messages {
      --overview-accent: #3b82f6;
      --overview-icon-bg: rgba(59, 130, 246, 0.12);
      --overview-icon-line: rgba(59, 130, 246, 0.2);
    }
    .overview-stat-card--turns {
      --overview-accent: #10b981;
      --overview-icon-bg: rgba(16, 185, 129, 0.13);
      --overview-icon-line: rgba(16, 185, 129, 0.22);
    }
    .overview-stat-card--errors {
      --overview-accent: #f97316;
      --overview-icon-bg: rgba(249, 115, 22, 0.13);
      --overview-icon-line: rgba(249, 115, 22, 0.22);
    }
    .overview-stat-card--accounts {
      --overview-accent: #06b6d4;
      --overview-icon-bg: rgba(6, 182, 212, 0.13);
      --overview-icon-line: rgba(6, 182, 212, 0.22);
    }
    .overview-stat-value {
      font-size: clamp(22px, 2vw, 30px);
      font-weight: 850;
      line-height: 1.1;
      overflow-wrap: anywhere;
    }
    .overview-stat-note {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .overview-main-grid {
      display: grid;
      grid-template-columns: minmax(300px, 0.9fr) minmax(360px, 1.1fr);
      gap: 14px;
      align-items: stretch;
    }
    .overview-detail-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .chart-card {
      border: 1px solid var(--line);
      border-radius: 9px;
      padding: 14px;
      background: #ffffff;
      min-width: 0;
    }
    .overview-health-card {
      display: grid;
      align-content: start;
      gap: 12px;
    }
    .chart-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 12px;
      font-weight: 750;
    }
    .chart-title span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
    }
    .donut-wrap {
      display: grid;
      grid-template-columns: 126px minmax(0, 1fr);
      align-items: center;
      gap: 16px;
    }
    .donut {
      width: 126px;
      aspect-ratio: 1 / 1;
      border-radius: 50%;
      background: conic-gradient(var(--ok) 0deg, var(--ok) 0deg, #e5e7eb 0deg 360deg);
      display: grid;
      place-items: center;
      box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.06);
    }
    .donut::after {
      content: attr(data-label);
      width: 76px;
      aspect-ratio: 1 / 1;
      border-radius: 50%;
      background: #ffffff;
      display: grid;
      place-items: center;
      text-align: center;
      font-weight: 800;
      color: var(--text);
      box-shadow: 0 8px 18px -14px rgba(15, 23, 42, 0.45);
    }
    .legend {
      display: grid;
      gap: 10px;
    }
    .legend-row {
      display: grid;
      grid-template-columns: 10px minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      color: var(--muted);
      font-size: 12px;
    }
    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--accent);
    }
    .bar-chart {
      display: grid;
      gap: 12px;
    }
    .bar-row {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr) 54px;
      gap: 10px;
      align-items: center;
      font-size: 12px;
      color: var(--muted);
    }
    .bar-track {
      height: 12px;
      border-radius: 999px;
      overflow: hidden;
      background: #e8eef8;
    }
    .bar-fill {
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: var(--grad);
      transition: width 0.25s ease;
    }
    .mini-grid {
      display: grid;
      gap: 10px;
    }
    .progress-row {
      display: grid;
      gap: 6px;
    }
    .progress-meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      color: var(--muted);
      font-size: 12px;
    }
    .progress-track {
      height: 10px;
      border-radius: 999px;
      background: #e8eef8;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: linear-gradient(90deg, #2563eb, #06b6d4);
      transition: width 0.25s ease;
    }
    .latency-panel {
      margin: 14px 0 6px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background:
        linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(6, 182, 212, 0.08)),
        rgba(255, 255, 255, 0.72);
      display: grid;
      gap: 12px;
    }
    .latency-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: var(--muted);
      font-size: 12px;
      min-width: 0;
    }
    .latency-head strong {
      color: var(--text);
      font-size: 14px;
      flex: 0 0 auto;
    }
    .latency-head span {
      min-width: 0;
      overflow-wrap: anywhere;
      text-align: right;
    }
    .latency-bars {
      display: grid;
      gap: 10px;
    }
    .progress-fill.latency-queue {
      background: linear-gradient(90deg, #f59e0b, #f97316);
    }
    .progress-fill.latency-coordinator {
      background: linear-gradient(90deg, #2563eb, #8b5cf6);
    }
    .progress-fill.latency-delivery {
      background: linear-gradient(90deg, #059669, #06b6d4);
    }
    .account-bars {
      display: grid;
      gap: 10px;
    }
    .account-bar-row {
      display: grid;
      gap: 5px;
    }
    .account-bar-meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 12px;
      color: var(--muted);
    }
    .account-bar-track {
      height: 9px;
      border-radius: 999px;
      background: #edf2fb;
      overflow: hidden;
    }
    .account-bar-fill {
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: linear-gradient(90deg, #f59e0b, #f43f5e);
    }
    .metric {
      position: relative;
      border: 1px solid var(--line);
      border-radius: 9px;
      padding: 12px 14px;
      background: #ffffff;
      min-height: 78px;
      overflow: hidden;
      transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
    }
    .metric:hover {
      transform: translateY(-1px);
      border-color: rgba(37, 99, 235, 0.2);
      box-shadow: 0 15px 30px -24px rgba(37, 99, 235, 0.52);
    }
    .metric::after {
      content: none;
    }
    .metric-label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
    }
    .metric-value {
      position: relative;
      font-size: 19px;
      font-weight: 750;
      overflow-wrap: anywhere;
    }
    .outbox-toolbar {
      min-height: 38px;
      margin-top: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: var(--muted);
      font-size: 12px;
    }
    .outbox-toolbar button {
      min-width: 96px;
      height: 34px;
      flex: 0 0 auto;
    }
    .provider-usage-block {
      margin-top: 18px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
    }
    .provider-usage-toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 420px) 84px;
      gap: 8px;
      align-items: end;
      max-width: 520px;
    }
    .provider-usage-toolbar button {
      width: 84px;
      height: 36px;
      padding: 0 10px;
    }
    .provider-usage-summary {
      min-height: 20px;
      margin-top: 10px;
      color: var(--muted);
      font-size: 12px;
    }
    .provider-usage-windows {
      display: grid;
      gap: 10px;
      margin-top: 12px;
      max-width: 760px;
    }
    .provider-usage-window {
      display: grid;
      gap: 6px;
    }
    .provider-usage-window .progress-fill {
      background: linear-gradient(90deg, #159661, #2563eb);
    }
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      align-items: end;
    }
    .provider-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .provider-span {
      grid-column: span 2;
    }
    .readonly-line {
      min-height: 36px;
      display: flex;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 9px;
      padding: 0 11px;
      background: #f6f7fb;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .update-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
      margin-top: 16px;
    }
    .diagnostics-list {
      display: grid;
      gap: 12px;
      margin-top: 14px;
    }
    .diagnostic-card {
      display: grid;
      gap: 10px;
      padding: 14px;
      border: 1px solid var(--line);
      border-left: 5px solid #64748b;
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 12px 24px -22px rgba(15, 23, 42, 0.35);
    }
    .diagnostic-card.ok { border-left-color: #059669; }
    .diagnostic-card.warn { border-left-color: #f59e0b; }
    .diagnostic-card.fail { border-left-color: #e11d48; }
    .diagnostic-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }
    .diagnostic-title {
      font-size: 15px;
      font-weight: 750;
    }
    .diagnostic-detail {
      color: #334155;
      line-height: 1.6;
      overflow-wrap: anywhere;
    }
    .diagnostic-reason {
      color: var(--muted);
      line-height: 1.6;
      overflow-wrap: anywhere;
    }
    .diagnostic-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .release-notes {
      min-height: 140px;
      max-height: 260px;
      overflow: auto;
      margin: 12px 0 0;
      padding: 13px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #f8fafc;
      color: #334155;
      font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .field {
      display: grid;
      gap: 5px;
    }
    .field label {
      color: var(--muted);
      font-size: 12px;
    }
    .log-summary {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .qr-box {
      min-height: 260px;
      display: grid;
      place-items: center;
      border: 1px dashed var(--line-strong);
      border-radius: 12px;
      background: #f6f7fb;
      margin-bottom: 12px;
      padding: 16px;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .qr-box.clickable {
      cursor: pointer;
    }
    .qr-box.clickable:hover {
      border-color: var(--accent);
      background: rgba(99, 102, 241, 0.06);
    }
    .qr-box img {
      width: min(260px, 100%);
      aspect-ratio: 1 / 1;
      object-fit: contain;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 8px;
      box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.12), 0 14px 30px -12px rgba(124, 58, 237, 0.35);
    }
    .qr-form {
      display: grid;
      gap: 10px;
    }
    .qr-buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .status-line {
      min-height: 20px;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .filter-row {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) minmax(150px, 190px) minmax(140px, 170px) auto;
      gap: 8px;
      margin-bottom: 12px;
    }
    .session-title {
      font-weight: 650;
    }
    .session-preview {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
    }
    .log-box {
      min-height: 220px;
      max-height: 420px;
      overflow: auto;
      margin: 0;
      padding: 14px;
      border: 1px solid rgba(15, 23, 42, 0.18);
      border-radius: 12px;
      background: #0d1426;
      color: #d7def0;
      font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 14px 30px -20px rgba(15, 23, 42, 0.55);
    }
    .export-row {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    .import-row {
      display: grid;
      grid-template-columns: minmax(280px, 1fr) auto minmax(260px, 1fr);
      gap: 10px;
      align-items: center;
      margin-top: 12px;
    }
    .file-picker {
      position: relative;
      min-height: 56px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fff;
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
      overflow: hidden;
    }
    .file-picker:hover {
      border-color: var(--accent);
      box-shadow: 0 10px 22px -16px rgba(99, 102, 241, 0.8);
      transform: translateY(-1px);
    }
    .file-picker:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
    }
    .file-picker input[type="file"] {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      cursor: pointer;
    }
    .file-picker-icon {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 46px;
      height: 32px;
      border-radius: 8px;
      background: rgba(99, 102, 241, 0.1);
      color: var(--accent-dark);
      font-size: 12px;
      font-weight: 800;
    }
    .file-picker-copy {
      min-width: 0;
      display: grid;
      gap: 2px;
    }
    .file-picker-title {
      font-weight: 750;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .file-picker-meta {
      color: var(--muted);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    input:focus, select:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
      background: #ffffff;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 11px;
    }
    .brand img {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      flex: 0 0 auto;
      box-shadow: 0 6px 16px -4px rgba(124, 58, 237, 0.45);
    }
    .promo {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      padding: 16px 18px;
      border: 1px solid rgba(139, 92, 246, 0.28);
      border-radius: 14px;
      background:
        radial-gradient(120% 140% at 0% 0%, rgba(99, 102, 241, 0.14), transparent 55%),
        radial-gradient(120% 160% at 100% 0%, rgba(217, 70, 239, 0.12), transparent 55%),
        #ffffff;
      box-shadow: 0 16px 34px -20px rgba(124, 58, 237, 0.5);
      overflow: hidden;
    }
    .promo-text {
      display: grid;
      gap: 4px;
      min-width: 220px;
    }
    .promo-title {
      font-weight: 800;
      font-size: 15px;
      color: #4c1d95;
      letter-spacing: 0.2px;
    }
    .promo-sub {
      color: #6f63a6;
      font-size: 12px;
    }
    .promo-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .promo .promo-link {
      display: inline-flex;
      align-items: center;
      height: 36px;
      padding: 0 16px;
      border-radius: 9px;
      background: var(--grad);
      background-size: 160% 160%;
      color: #fff;
      text-decoration: none;
      font-weight: 700;
      white-space: nowrap;
      animation: promoGlow 2.4s ease-in-out infinite;
    }
    .promo .promo-link:hover {
      background-position: 100% 0;
      transform: translateY(-1px);
    }
    @keyframes promoGlow {
      0%, 100% { box-shadow: 0 6px 16px -6px rgba(139, 92, 246, 0.45); }
      50% { box-shadow: 0 10px 24px -4px rgba(139, 92, 246, 0.6); }
    }
    .help-line {
      margin-top: 14px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.6;
    }
    .help-line a {
      color: #6d28d9;
      text-decoration: none;
    }
    .help-line a:hover {
      text-decoration: underline;
    }
    .subsection-title {
      margin: 20px 0 10px;
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
    }
    .subsection-title:first-child { margin-top: 0; }
    .webhook-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .webhook-row input { flex: 1; }
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(3px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      z-index: 50;
    }
    .modal-overlay[hidden] { display: none; }
    .modal-card {
      width: min(820px, 100%);
      max-height: calc(100vh - 64px);
      display: flex;
      flex-direction: column;
      background: var(--panel-solid);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
    }
    .modal-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 18px;
      border-bottom: 1px solid var(--line);
    }
    .modal-toolbar input { flex: 1; }
    .history-body {
      padding: 16px 18px;
      overflow: auto;
      display: grid;
      gap: 10px;
    }
    .history-msg {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 12px;
    }
    .history-msg.user {
      background: rgba(99, 102, 241, 0.06);
      border-color: rgba(99, 102, 241, 0.22);
    }
    .history-msg.assistant {
      background: #f6f7fb;
    }
    .history-meta {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    .history-role {
      font-weight: 650;
      color: var(--text);
    }
    .history-text {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.55;
    }
    .donate-body {
      padding: 18px;
      display: grid;
      gap: 12px;
      justify-items: center;
      text-align: center;
      background:
        radial-gradient(220px 160px at 0% 0%, rgba(255, 183, 3, 0.20), transparent 70%),
        radial-gradient(240px 180px at 100% 20%, rgba(244, 63, 94, 0.16), transparent 70%),
        #ffffff;
    }
    .donate-body img {
      width: min(320px, 78vw);
      aspect-ratio: 1 / 1;
      object-fit: contain;
      border-radius: 20px;
      border: 1px solid rgba(244, 63, 94, 0.24);
      background: #ffffff;
      padding: 10px;
      box-shadow: 0 24px 50px -30px rgba(244, 63, 94, 0.9), 0 0 0 5px rgba(255, 183, 3, 0.13);
    }
    .donate-note {
      color: #9f1239;
      font-size: 13px;
      line-height: 1.6;
      font-weight: 650;
    }
    .setup-card {
      width: min(920px, 100%);
    }
    .setup-progress {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      background: #f8fbff;
    }
    .setup-step-tab {
      height: 42px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: #ffffff;
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
      cursor: pointer;
    }
    .setup-step-tab.active {
      border-color: rgba(37, 99, 235, 0.35);
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.14), rgba(6, 182, 212, 0.12));
      color: var(--accent-dark);
      box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.12);
    }
    .setup-body {
      padding: 18px;
      overflow-y: auto;
      overflow-x: hidden;
      display: grid;
      gap: 16px;
    }
    .setup-step {
      display: none;
      gap: 14px;
    }
    .setup-step.active {
      display: grid;
    }
    .setup-intro {
      display: grid;
      gap: 6px;
      padding: 14px 16px;
      border: 1px solid rgba(37, 99, 235, 0.18);
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(6, 182, 212, 0.08));
    }
    .setup-intro strong {
      font-size: 16px;
    }
    .setup-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .setup-info {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px;
      background: #ffffff;
      display: grid;
      gap: 5px;
    }
    .setup-info span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .setup-info code {
      display: block;
      color: var(--text);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .setup-checks {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .setup-check {
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 13px;
      background: #ffffff;
      display: grid;
      gap: 6px;
    }
    .setup-check.ok {
      border-color: rgba(5, 150, 105, 0.25);
      background: rgba(5, 150, 105, 0.05);
    }
    .setup-check.warn {
      border-color: rgba(245, 158, 11, 0.30);
      background: rgba(245, 158, 11, 0.06);
    }
    .setup-check-title {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      font-weight: 800;
    }
    .setup-check-title > span:first-child {
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
      line-height: 1.35;
    }
    .setup-check-title .pill {
      flex: 0 0 auto;
    }
    .setup-check-main {
      min-width: 0;
      max-width: 100%;
      color: var(--text);
      font-size: 12px;
      line-height: 1.5;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .setup-check-detail {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.6;
      overflow-wrap: anywhere;
    }
    .setup-provider-panel .settings-grid {
      align-items: start;
    }
    .setup-provider-panel .provider-grid {
      gap: 14px;
    }
    .setup-provider-panel .field {
      min-width: 0;
    }
    .setup-provider-panel input,
    .setup-provider-panel select,
    .setup-provider-panel .readonly-line {
      width: 100%;
    }
    .setup-provider-panel .readonly-line {
      min-height: 36px;
      align-items: center;
      line-height: 1.45;
    }
    .setup-provider-hint {
      grid-column: 1 / -1;
      margin-top: -2px;
      padding: 10px 12px;
      border: 1px solid rgba(37, 99, 235, 0.14);
      border-radius: 10px;
      background: rgba(37, 99, 235, 0.05);
    }
    .setup-actions {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 14px 18px;
      border-top: 1px solid var(--line);
      background: #ffffff;
    }
    .setup-actions .toolbar {
      justify-content: flex-end;
    }
    .setup-qr-box {
      min-height: 280px;
    }
    .setup-test-card {
      border: 1px solid rgba(5, 150, 105, 0.24);
      border-radius: 12px;
      padding: 16px;
      background: rgba(5, 150, 105, 0.06);
      display: grid;
      gap: 10px;
    }
    .setup-test-card strong {
      color: #065f46;
    }
    .setup-test-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .setup-test-result {
      min-height: 42px;
      padding: 10px 12px;
      border: 1px solid rgba(5, 150, 105, 0.18);
      border-radius: 10px;
      color: var(--muted);
      background: rgba(255, 255, 255, 0.72);
      line-height: 1.55;
      overflow-wrap: anywhere;
    }
    .doc-hero {
      display: grid;
      gap: 12px;
      padding: 20px;
      border: 1px solid rgba(37, 99, 235, 0.16);
      border-radius: 14px;
      background:
        linear-gradient(135deg, rgba(37, 99, 235, 0.10), rgba(6, 182, 212, 0.08) 48%, rgba(244, 63, 94, 0.08)),
        #ffffff;
    }
    .doc-hero h3 {
      margin: 0;
      font-size: 20px;
      line-height: 1.25;
    }
    .doc-hero p {
      margin: 0;
      color: var(--muted);
      max-width: 920px;
    }
    .doc-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-top: 16px;
    }
    .doc-card {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 16px;
      background: #ffffff;
      display: grid;
      gap: 10px;
    }
    .doc-card.wide {
      grid-column: 1 / -1;
    }
    .doc-card h3 {
      margin: 0;
      font-size: 15px;
    }
    .doc-card p,
    .doc-card li {
      color: var(--doc-text);
    }
    .doc-card p {
      margin: 0;
    }
    .doc-card ol,
    .doc-card ul {
      margin: 0;
      padding-left: 20px;
    }
    .doc-card li + li {
      margin-top: 6px;
    }
    .command-table {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 12px;
    }
    .command-row {
      display: grid;
      grid-template-columns: minmax(190px, 0.34fr) minmax(0, 1fr);
      gap: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      align-items: start;
    }
    .command-row:last-child {
      border-bottom: 0;
    }
    .command-row code,
    .doc-code code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: var(--code-text);
      overflow-wrap: anywhere;
    }
    .doc-card :not(.doc-code) > code,
    .command-row span code {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 1px 6px;
      border-radius: 6px;
      background: var(--code-bg);
      border: 1px solid var(--line);
      color: var(--code-text);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.94em;
    }
    .command-row span {
      color: var(--doc-muted);
    }
    .doc-code {
      display: grid;
      gap: 6px;
      padding: 12px;
      border-radius: 12px;
      background: var(--code-bg);
      border: 1px solid var(--line);
    }
    .download-links {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .download-links a {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid rgba(37, 99, 235, 0.18);
      border-radius: 10px;
      background: rgba(37, 99, 235, 0.07);
      color: var(--accent-dark);
      text-decoration: none;
      font-weight: 750;
    }
    @media (max-width: 1240px) {
      .shell {
        grid-template-columns: 260px minmax(0, 1fr);
      }
      .content {
        padding-left: 18px;
      }
      .accounts-table,
      .accounts-table thead,
      .accounts-table tbody,
      .accounts-table tr,
      .accounts-table th,
      .accounts-table td {
        display: block;
      }
      .accounts-table thead {
        display: none;
      }
      .accounts-table tr {
        display: grid;
        grid-template-columns: minmax(260px, 1.2fr) minmax(210px, 1fr) minmax(220px, 1fr);
        gap: 12px;
        padding: 16px 18px;
        border-bottom: 1px solid var(--line);
      }
      .accounts-table td {
        width: auto !important;
        min-width: 0 !important;
        padding: 0;
        border-bottom: 0;
      }
      .accounts-table td::before {
        content: attr(data-label);
        display: block;
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 5px;
      }
      .accounts-table td:nth-child(1) {
        grid-row: span 2;
      }
      .accounts-table td:nth-child(5) {
        grid-column: 3;
        grid-row: 1 / span 2;
      }
      .accounts-table .account-actions {
        min-width: 0;
      }
    }
    @media (max-width: 1080px) {
      .wrap {
        padding: 0 16px;
      }
      .shell {
        grid-template-columns: 1fr;
        min-height: auto;
      }
      .sidebar {
        position: static;
        height: auto;
        padding: 16px 0 0;
        overflow: visible;
        border-right: 0;
        background: transparent;
      }
      .content {
        padding: 18px 0 0;
      }
      .side-nav {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .side-nav a::after {
        content: "";
        display: none;
      }
      .side-support {
        display: none;
      }
      .overview-grid {
        grid-template-columns: 1fr;
      }
      .overview-summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .overview-main-grid,
      .overview-detail-grid {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 860px) {
      header {
        position: static;
      }
      .grid {
        grid-template-columns: 1fr;
      }
      .topbar {
        align-items: flex-start;
        flex-direction: column;
        padding: 14px 0 16px;
      }
      .topbar .toolbar {
        width: 100%;
      }
      .topbar .toolbar button,
      .topbar .toolbar .pill {
        flex: 1 1 auto;
      }
      .filter-row {
        grid-template-columns: 1fr;
      }
      .import-row {
        grid-template-columns: 1fr;
      }
      .status-grid,
      .settings-grid {
        grid-template-columns: 1fr;
      }
      .side-nav {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .side-nav a {
        min-height: 42px;
        font-size: 14px;
      }
      .side-nav a::before {
        width: 24px;
        height: 24px;
        font-size: 12px;
      }
      .accounts-table tr {
        grid-template-columns: 1fr;
      }
      .accounts-table td:nth-child(1),
      .accounts-table td:nth-child(5) {
        grid-column: auto;
        grid-row: auto;
      }
      .rename-row {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .donut-wrap {
        grid-template-columns: 1fr;
        justify-items: center;
      }
      .overview-summary {
        grid-template-columns: 1fr;
      }
      .bar-row {
        grid-template-columns: 76px minmax(0, 1fr) 44px;
      }
      .provider-span {
        grid-column: auto;
      }
      .setup-progress,
      .setup-grid,
      .setup-checks,
      .doc-grid {
        grid-template-columns: 1fr;
      }
      .command-row {
        grid-template-columns: 1fr;
      }
      table, thead, tbody, tr, th, td {
        display: block;
      }
      thead {
        display: none;
      }
      tr {
        border-bottom: 1px solid var(--line);
      }
      td {
        border-bottom: 0;
      }
      td::before {
        content: attr(data-label);
        display: block;
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 4px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-duration: 0.001ms !important;
      }
    }
    @media (max-width: 560px) {
      .wrap {
        padding: 0 12px;
      }
      h1 {
        font-size: 24px;
      }
      .page-brand span {
        font-size: 13px;
      }
      .page-brand img {
        width: 42px;
        height: 42px;
      }
      .side-nav {
        grid-template-columns: 1fr;
      }
      .section-head {
        align-items: flex-start;
        flex-direction: column;
      }
      .body {
        padding: 14px;
      }
      .topbar .toolbar button,
      .topbar .toolbar .pill {
        flex: 1 1 100%;
      }
      .provider-usage-toolbar {
        grid-template-columns: minmax(0, 1fr);
      }
      .provider-usage-toolbar button {
        width: 100%;
      }
    }
  </style>
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

  <script nonce="${cspNonce}">
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
        ].filter(Boolean).join('\\n');
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
      const providerName = String(provider.providerName || '').replace(/\s+/g, '').toLowerCase();
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
      return String(value || '').trim().replace(/\\/+$/u, '');
    }

    function normalizeDeepSeekBaseUrl(value) {
      const raw = String(value || '').trim().replace(/\\/+$/u, '');
      if (!raw) {
        return 'https://api.deepseek.com/v1';
      }
      if (/^https?:\\/\\/(?:127\\.0\\.0\\.1|localhost)(?::\\d+)?\\/v1(?:\\/responses)?$/iu.test(raw)) {
        return 'https://api.deepseek.com/v1';
      }
      if (/^https?:\\/\\/api\.deepseek\.com\\/?$/iu.test(raw)) {
        return 'https://api.deepseek.com/v1';
      }
      if (/^https?:\\/\\/api\.deepseek\.com\\/v1(?:\\/)?$/iu.test(raw)) {
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
        Array.isArray(last.errors) && last.errors.length ? last.errors.join('\\n') : ''
      ].filter(Boolean).join('\\n');
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
        $('setup-provider-base-url').value = /^(?:https?:\\/\\/)?api\.deepseek\.com(?:\\/v1)?$/iu.test(normalized)
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
        $('provider-base-url').value = /^(?:https?:\\/\\/)?api\.deepseek\.com(?:\\/v1)?$/iu.test(normalized)
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
  </script>
</body>
</html>`;
}
