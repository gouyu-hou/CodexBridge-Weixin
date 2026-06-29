const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexbridgeSetup', {
  saveConfig(payload) {
    return ipcRenderer.invoke('codexbridge:first-run:save', payload);
  },
});
