const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inst', {
  listar: () => ipcRenderer.invoke('listar'),
  abertos: (ids) => ipcRenderer.invoke('abertos', ids),
  fecharDiscord: (ids) => ipcRenderer.invoke('fechar-discord', ids),
  instalar: (ids, op) => ipcRenderer.invoke('instalar', ids, op),
  desinstalar: (ids, op) => ipcRenderer.invoke('desinstalar', ids, op),
  abrirDiscord: (ids) => ipcRenderer.invoke('abrir-discord', ids),
  abrirPasta: () => ipcRenderer.invoke('abrir-pasta'),
  confirmar: (t, m, b) => ipcRenderer.invoke('confirmar', t, m, b),
  janela: (acao) => ipcRenderer.send('janela', acao),
  aoLog: (fn) => ipcRenderer.on('log', (_e, msg) => fn(msg))
});
