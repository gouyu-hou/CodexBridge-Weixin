function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}

export function renderAdminHtml(adminToken: string, cspNonce: string) {
  const assetVersion = String(Date.now());
  const escapedToken = escapeHtmlAttribute(adminToken);
  const escapedNonce = escapeHtmlAttribute(cspNonce);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="codexbridge-admin-token" content="${escapedToken}" />
  <meta name="color-scheme" content="light dark" />
  <title>CodexBridge 微信管理后台</title>
  <link rel="icon" type="image/png" href="/favicon.png?v=${assetVersion}" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico?v=${assetVersion}" />
  <link rel="shortcut icon" href="/favicon.ico?v=${assetVersion}" />
  <link rel="apple-touch-icon" href="/favicon.png?v=${assetVersion}" />
  <script nonce="${escapedNonce}">try{var t=localStorage.getItem('codexbridge-admin-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}</script>
  <link rel="stylesheet" href="/admin/admin.css?v=${assetVersion}" />
</head>
<body>
  <div id="admin-root"><div class="admin-boot" role="status">正在加载管理后台...</div></div>
  <noscript>此管理后台需要启用 JavaScript。</noscript>
  <script nonce="${escapedNonce}" src="/admin/admin.js?v=${assetVersion}"></script>
</body>
</html>`;
}
