const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexbridgeSetup', {
  saveConfig(payload) {
    return ipcRenderer.invoke('codexbridge:first-run:save', payload);
  },
  syncCcswitch() {
    return ipcRenderer.invoke('codexbridge:first-run:sync-ccswitch');
  },
});

contextBridge.exposeInMainWorld('codexbridgeUpdater', {
  getStatus() {
    return ipcRenderer.invoke('codexbridge:update:get-status');
  },
  check() {
    return ipcRenderer.invoke('codexbridge:update:check');
  },
  download() {
    return ipcRenderer.invoke('codexbridge:update:download');
  },
  install() {
    return ipcRenderer.invoke('codexbridge:update:install');
  },
  onStatus(callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('codexbridge:update:status', listener);
    return () => {
      ipcRenderer.removeListener('codexbridge:update:status', listener);
    };
  },
});
