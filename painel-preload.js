const { contextBridge, ipcRenderer } = require('electron');

const canais = [
  'estado', 'tema-ativar', 'tema-previa', 'tema-importar', 'tema-link', 'tema-remover', 'abrir-pasta',
  'fundo', 'fundo-trocar',
  'sons-listar', 'som-escolher', 'som-config', 'som-restaurar', 'sons-geral', 'som-url',
  'perfil', 'perfil-avatar', 'badge-custom',
  'plugins-status', 'plugins-listar', 'plugins-ativar', 'recarregar',
  'mute-falso-config', 'mute-falso-alternar', 'mute-falso-estado',
  'css-ler', 'css-salvar', 'config', 'reiniciar'
];

const api = {};
for (const c of canais) {
  const nome = c.replace(/-(\w)/g, (_, l) => l.toUpperCase());
  api[nome] = (...args) => ipcRenderer.invoke('painel:' + c, ...args);
}
api.aoAtualizar = (fn) => ipcRenderer.on('painel:atualizar', () => fn());

contextBridge.exposeInMainWorld('api', api);
