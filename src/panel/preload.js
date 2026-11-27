const { contextBridge, ipcRenderer } = require('electron');

const channels = [
  'state', 'theme-toggle', 'theme-preview', 'theme-import', 'theme-link', 'theme-remove', 'open-folder',
  'background', 'background-pick',
  'sounds-list', 'sound-pick', 'sound-config', 'sound-reset', 'sounds-global', 'sound-url',
  'profile', 'profile-avatar', 'badge-custom',
  'plugins-list', 'plugins-toggle', 'reload',
  'fake-mute',
  'css-read', 'css-save', 'config', 'restart'
];

const api = {};
for (const c of channels) {
  const name = c.replace(/-(\w)/g, (_, l) => l.toUpperCase());
  api[name] = (...args) => ipcRenderer.invoke('zc-panel:' + c, ...args);
}
api.onRefresh = (fn) => ipcRenderer.on('zc-panel:refresh', () => fn());

contextBridge.exposeInMainWorld('api', api);
