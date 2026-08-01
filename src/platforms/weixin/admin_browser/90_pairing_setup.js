
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
