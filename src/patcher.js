// ZeroCord inside the official Discord client (Stable / PTB / Canary).
// Loaded by resources/app/index.js, which the installer creates.
const electron = require('electron');
const path = require('path');
const fs = require('fs');
const Module = require('module');

process.env.ZEROCORD_DATA = path.join(process.env.APPDATA || electron.app.getPath('appData'), 'ZeroCord');
process.env.ZEROCORD_MODE = 'injected';

// Electron sees .asar files as folders; to check plain files we briefly turn that off
function plain(fn) {
  const previous = process.noAsar;
  process.noAsar = true;
  try { return fn(); } finally { process.noAsar = previous; }
}

// ...\app-1.0.xxxx\resources. The installer turned app.asar into a folder that loads us
// and renamed Discord's original to _app.asar (older ZeroCord used a separate "app" folder).
const resources = path.dirname(electron.app.getAppPath());
const originalAsar = plain(() => fs.existsSync(path.join(resources, '_app.asar')))
  ? path.join(resources, '_app.asar')
  : path.join(resources, 'app.asar');

let core = null;
try {
  core = require('./core');
} catch (e) {
  console.error('[ZeroCord] failed to load, starting plain Discord', e);
  try { fs.mkdirSync(process.env.ZEROCORD_DATA, { recursive: true }); fs.appendFileSync(path.join(process.env.ZEROCORD_DATA, 'zerocord.log'), `[${new Date().toISOString()}] core failed to load: ${e && e.stack}\n`); } catch {}
}

if (core) {
  // Wrap Discord's window: swap its preload for ours, which then loads the original one
  class BrowserWindow extends electron.BrowserWindow {
    constructor(options) {
      const wp = options && options.webPreferences;
      const isDiscordWindow = !!(options && !options.zeroCord && wp && wp.preload && options.title);
      const icon = path.join(__dirname, 'icons', process.platform === 'win32' ? 'discord.ico' : 'discord.png');
      const useIcon = isDiscordWindow && core.config.zeroTwoIcon !== false && fs.existsSync(icon);
      let originalPreload = null;
      if (useIcon) options.icon = icon;
      if (isDiscordWindow) {
        originalPreload = wp.preload;
        wp.preload = path.join(__dirname, 'preload.js');
        wp.sandbox = false;
        if (core.config.backgroundThrottling === false) wp.backgroundThrottling = false;
      }
      super(options);
      if (useIcon) {
        try { this.setIcon(icon); } catch {}
        // Discord sometimes changes the icon later: keep ours
        const setIcon = this.setIcon.bind(this);
        this.setIcon = () => setIcon(icon);
      }
      if (options && options.webPreferences && !options.zeroCord) {
        core.log && core.log('BrowserWindow', { title: options.title, hasPreload: !!originalPreload || !!options.webPreferences.preload, wrapped: isDiscordWindow });
      }
      if (isDiscordWindow) {
        core.originalPreloads.set(this.webContents.id, originalPreload);
        core.attachWindow(this);
      }
    }
  }
  Object.assign(BrowserWindow, electron.BrowserWindow);
  Object.defineProperty(BrowserWindow, 'name', { value: 'BrowserWindow', configurable: true });

  const electronPath = require.resolve('electron');
  delete require.cache[electronPath].exports;
  require.cache[electronPath].exports = { ...electron, BrowserWindow };

  electron.app.whenReady().then(() => core.startWhenReady());
}

// When Discord updates, it creates a new app-x.y.z folder without ZeroCord.
// Put ZeroCord in it too (when Discord opens and when it closes).
function reinject() {
  plain(() => {
    try {
      const root = path.dirname(path.dirname(resources)); // ...\Discord
      const loader = electron.app.getAppPath();             // our app.asar (or legacy app) folder
      const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
      for (const dir of fs.readdirSync(root)) {
        if (!/^app-/.test(dir)) continue;
        const res = path.join(root, dir, 'resources');
        const asar = path.join(res, 'app.asar');
        if (!fs.existsSync(asar) || isDir(asar)) continue;          // already has a loader (ours or another mod)
        if (fs.existsSync(path.join(res, '_app.asar'))) continue;
        fs.renameSync(asar, path.join(res, '_app.asar'));
        fs.mkdirSync(asar);
        fs.copyFileSync(path.join(loader, 'index.js'), path.join(asar, 'index.js'));
        fs.copyFileSync(path.join(loader, 'package.json'), path.join(asar, 'package.json'));
      }
    } catch (e) {
      console.error('[ZeroCord] reinject', e);
    }
  });
}
reinject();
electron.app.on('before-quit', reinject);

// Now start the real Discord
const pkg = require(path.join(originalAsar, 'package.json'));
electron.app.setAppPath(originalAsar);
if (pkg.name) electron.app.name = pkg.name;
Module._load(path.join(originalAsar, pkg.main || 'index.js'), null, true);
