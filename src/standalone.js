// ZeroCord as a standalone app (npm start / portable .exe)
const { app, BrowserWindow } = require('electron');
const path = require('path');

if (!process.env.ZEROCORD_DATA) {
  const base = process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..'));
  process.env.ZEROCORD_DATA = path.join(base, 'data');
}
process.env.ZEROCORD_MODE = 'standalone';

const core = require('./core');
const { config } = core;

if (!config.hardwareAcceleration) app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService,SpareRendererForSitePerProcess');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 940, minHeight: 500,
    title: 'ZeroCord', backgroundColor: '#1e1f22', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, 'icons', process.platform === 'win32' ? 'discord.ico' : 'discord.png'),
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: !!config.spellcheck,
      backgroundThrottling: !!config.backgroundThrottling
    }
  });
  win.once('ready-to-show', () => win.show());
  core.attachWindow(win, { standalone: true });
  win.on('closed', () => { win = null; });
  win.loadURL(core.DISCORD_URL);
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  core.startWhenReady();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
