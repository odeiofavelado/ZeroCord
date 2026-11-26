// Instalador do ZeroCord (edição Zero Two)
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const logica = require('./logica');

let janela;

function criar() {
  janela = new BrowserWindow({
    width: 1000, height: 640, minWidth: 900, minHeight: 600,
    frame: false, backgroundColor: '#0c0812', show: false, resizable: true,
    title: 'ZeroCord • Instalador',
    icon: path.join(__dirname, '..', 'icones', process.platform === 'win32' ? 'icone-instalador.ico' : 'icone-instalador.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
  });
  janela.once('ready-to-show', () => janela.show());
  janela.loadFile(path.join(__dirname, 'index.html'));
  janela.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

const log = (msg) => { if (janela && !janela.isDestroyed()) janela.webContents.send('log', msg); };

ipcMain.handle('listar', () => logica.listar());
ipcMain.handle('abertos', (_e, ids) => logica.processosAbertos(ids));
ipcMain.handle('fechar-discord', (_e, ids) => logica.fecharDiscord(ids));
ipcMain.handle('instalar', async (_e, ids, opcoes) => {
  try { return { ok: true, lista: await logica.instalar(ids, opcoes, log) }; }
  catch (e) { log('✗ Erro: ' + e.message); return { ok: false, erro: e.message, lista: logica.listar() }; }
});
ipcMain.handle('desinstalar', async (_e, ids, opcoes) => {
  try { return { ok: true, lista: await logica.desinstalar(ids, opcoes, log) }; }
  catch (e) { log('✗ Erro: ' + e.message); return { ok: false, erro: e.message, lista: logica.listar() }; }
});
ipcMain.handle('abrir-discord', (_e, ids) => { for (const id of ids) logica.abrirDiscord(id); });
ipcMain.handle('abrir-pasta', () => shell.openPath(logica.PASTA_DADOS()));
ipcMain.handle('confirmar', async (_e, titulo, msg, botoes) => {
  const r = await dialog.showMessageBox(janela, { type: 'question', title: titulo, message: titulo, detail: msg, buttons: botoes, defaultId: 0, cancelId: botoes.length - 1 });
  return r.response;
});
ipcMain.on('janela', (_e, acao) => {
  if (!janela) return;
  if (acao === 'fechar') janela.close();
  if (acao === 'minimizar') janela.minimize();
});

app.whenReady().then(criar);
app.on('window-all-closed', () => app.quit());
