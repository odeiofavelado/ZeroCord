// ZeroCord inside the official Discord client (Stable / PTB / Canary).
// Loaded by resources/app/index.js, which the installer creates.
const electron = require('electron');
const path = require('path');
const fs = require('fs');
const Module = require('module');

process.env.ZEROCORD_DATA = path.join(process.env.APPDATA || electron.app.getPath('appData'), 'ZeroCord');
process.env.ZEROCORD_MODE = 'injected';

// ...\app-1.0.xxxx\resources (the "app" folder created by the installer lives inside it)
const resources = path.dirname(electron.app.getAppPath());
const originalAsar = path.join(resources, 'app.asar');

let core = null;
try {
  core = require('./core');
} catch (e) {
  console.error('[ZeroCord] failed to load, starting plain Discord', e);
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
  const previous = process.noAsar;
  process.noAsar = true; // see app.asar as a plain file, not a folder
  try {
    const root = path.dirname(path.dirname(resources)); // ...\Discord
    const ourIndex = path.join(resources, 'app', 'index.js');
    const ourPkg = path.join(resources, 'app', 'package.json');
    for (const dir of fs.readdirSync(root)) {
      if (!/^app-/.test(dir)) continue;
      const res = path.join(root, dir, 'resources');
      if (!fs.existsSync(path.join(res, 'app.asar'))) continue;
      if (fs.existsSync(path.join(res, '_app.asar'))) continue; // another mod is installed
      const target = path.join(res, 'app');
      if (fs.existsSync(path.join(target, 'index.js'))) continue;
      fs.mkdirSync(target, { recursive: true });
      fs.copyFileSync(ourIndex, path.join(target, 'index.js'));
      fs.copyFileSync(ourPkg, path.join(target, 'package.json'));
    }
  } catch (e) {
    console.error('[ZeroCord] reinject', e);
  } finally {
    process.noAsar = previous;
  }
}
reinject();
electron.app.on('before-quit', reinject);

// Now start the real Discord
const pkg = require(path.join(originalAsar, 'package.json'));
electron.app.setAppPath(originalAsar);
if (pkg.name) electron.app.name = pkg.name;
Module._load(path.join(originalAsar, pkg.main || 'index.js'), null, true);
