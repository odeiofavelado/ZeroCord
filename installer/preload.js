const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installer', {
  list: () => ipcRenderer.invoke('list'),
  running: (ids) => ipcRenderer.invoke('running', ids),
  closeClients: (ids) => ipcRenderer.invoke('close-clients', ids),
  install: (ids, options) => ipcRenderer.invoke('install', ids, options),
  uninstall: (ids, options) => ipcRenderer.invoke('uninstall', ids, options),
  launch: (ids) => ipcRenderer.invoke('launch', ids),
  openData: () => ipcRenderer.invoke('open-data'),
  confirm: (title, message, buttons) => ipcRenderer.invoke('confirm', title, message, buttons),
  window: (action) => ipcRenderer.send('window', action),
  onLog: (fn) => ipcRenderer.on('log', (_e, msg) => fn(msg))
});
