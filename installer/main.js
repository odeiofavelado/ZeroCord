// ZeroCord installer (Zero Two edition)
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Smoke test (used by CI): open the window, record the result and quit
const SMOKE = process.env.ZEROCORD_SMOKE;
function smoke(result) {
  if (!SMOKE) return;
  try { fs.writeFileSync(SMOKE, JSON.stringify(result, null, 2)); } catch {}
  app.exit(result.ok ? 0 : 1);
}
process.on('uncaughtException', (e) => { console.error(e); smoke({ ok: false, step: 'main', error: String(e && e.stack || e) }); });

const logic = require('./logic');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1000, height: 640, minWidth: 900, minHeight: 600,
    frame: false, backgroundColor: '#0c0812', show: false,
    title: 'ZeroCord Installer',
    icon: path.join(__dirname, '..', 'src', 'icons', process.platform === 'win32' ? 'installer.ico' : 'installer.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
  });
  win.once('ready-to-show', () => win.show());
  if (SMOKE) {
    win.webContents.on('render-process-gone', (_e, d) => smoke({ ok: false, step: 'renderer', error: d.reason }));
    win.webContents.on('did-fail-load', (_e, code, desc) => smoke({ ok: false, step: 'load', error: code + ' ' + desc }));
    win.webContents.on('did-finish-load', () => setTimeout(async () => {
      try {
        const ui = await win.webContents.executeJavaScript("({ title: document.title, clients: document.querySelectorAll('.client, .empty').length, installer: typeof window.installer })");
        smoke({ ok: ui.installer === 'object', step: 'ui', ui, clients: logic.list(), electron: process.versions.electron });
      } catch (e) { smoke({ ok: false, step: 'ui', error: String(e) }); }
    }, 2500));
  }
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

const log = (msg) => { if (win && !win.isDestroyed()) win.webContents.send('log', msg); };

ipcMain.handle('list', () => logic.list());
ipcMain.handle('running', (_e, ids) => logic.runningClients(ids));
ipcMain.handle('close-clients', (_e, ids) => logic.closeClients(ids));
ipcMain.handle('install', async (_e, ids, options) => {
  try { return { ok: true, list: await logic.install(ids, options, log) }; }
  catch (e) { log('✗ Error: ' + e.message); return { ok: false, error: e.message, list: logic.list() }; }
});
ipcMain.handle('uninstall', async (_e, ids, options) => {
  try { return { ok: true, list: await logic.uninstall(ids, options, log) }; }
  catch (e) { log('✗ Error: ' + e.message); return { ok: false, error: e.message, list: logic.list() }; }
});
ipcMain.handle('launch', (_e, ids) => { for (const id of ids) logic.launch(id); });
ipcMain.handle('open-data', () => shell.openPath(logic.DATA_DIR()));
ipcMain.handle('confirm', async (_e, title, message, buttons) => {
  const r = await dialog.showMessageBox(win, { type: 'question', title, message: title, detail: message, buttons, defaultId: 0, cancelId: buttons.length - 1 });
  return r.response;
});
ipcMain.on('window', (_e, action) => {
  if (!win) return;
  if (action === 'close') win.close();
  if (action === 'minimize') win.minimize();
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
