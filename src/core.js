// ZeroCord core: shared by the standalone app and by the official Discord client (injected).
const { app, BrowserWindow, session, shell, desktopCapturer, protocol, net, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const DISCORD_URL = 'https://discord.com/app';
const MODS = {
  equicord: { url: 'https://github.com/Equicord/Equicord/releases/download/latest/Equicord.user.js', file: 'Equicord.user.js' },
  vencord: { url: 'https://github.com/Vendicated/Vencord/releases/download/devbuild/Vencord.user.js', file: 'Vencord.user.js' }
};

// ============================================================
//  Folders & config
// ============================================================

// Set by whoever loads the core: standalone (<project>/data) or injected (%APPDATA%\ZeroCord)
const dataDir = () => process.env.ZEROCORD_DATA || path.join(__dirname, '..', 'data');
const INJECTED = process.env.ZEROCORD_MODE === 'injected';
const data = (...p) => path.join(dataDir(), ...p);
const ensureDir = (p) => { try { fs.mkdirSync(p, { recursive: true }); } catch {} };

// Diagnostic log: %APPDATA%\ZeroCord\zerocord.log (kept small)
function log(...parts) {
  try {
    const file = data('zerocord.log');
    try { if (fs.statSync(file).size > 512 * 1024) fs.writeFileSync(file, ''); } catch {}
    const line = parts.map((x) => (x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`);
  } catch {}
}
process.on('uncaughtException', (e) => log('uncaughtException', e));

// Reads a file from the data folder, falling back to the shipped defaults
function readText(name, fallback = '') {
  for (const base of [dataDir(), path.join(__dirname, 'defaults'), __dirname]) {
    try { return fs.readFileSync(path.join(base, name), 'utf8'); } catch {}
  }
  return fallback;
}

const DEFAULTS = {
  hardwareAcceleration: true,
  blockTelemetry: true,
  noAnimations: true,
  spellcheck: false,
  zoom: 1.0,
  backgroundThrottling: true,
  plugins: true,
  mod: 'equicord',
  background: true,
  backgroundOpacity: 0.25,
  backgroundBlend: 'screen',
  onlineThemes: [],
  activeThemes: {},
  profile: { enabled: false, displayName: '', username: '', avatar: '', badges: [] },
  fakeMute: { enabled: false },
  zeroTwoIcon: true,
  themesEnabled: true
};

// ---- Migration from the old Portuguese names (MeuDiscord / early ZeroCord) ----
const LEGACY_KEYS = {
  aceleracaoHardware: 'hardwareAcceleration', bloquearTelemetria: 'blockTelemetry', semAnimacoes: 'noAnimations',
  corretorOrtografico: 'spellcheck', economizarEmSegundoPlano: 'backgroundThrottling', botaoPainel: 'panelButton',
  fundo: 'background', fundoOpacidade: 'backgroundOpacity', fundoMistura: 'backgroundBlend', temasOnline: 'onlineThemes',
  temasAtivos: 'activeThemes', sons: 'sounds', sonsGeral: 'soundsGlobal', perfil: 'profile', muteFalso: 'fakeMute',
  iconeZeroTwo: 'zeroTwoIcon'
};
function migrateLegacy() {
  const renames = [['temas', 'themes'], ['sons', 'sounds'], ['perfil', 'profile'], ['personalizado.css', 'custom.css'], ['estilo.css', null]];
  for (const ext of ['mp4', 'webm', 'gif', 'png', 'jpg', 'jpeg', 'webp']) renames.push([`fundo.${ext}`, `background.${ext}`]);
  for (const [from, to] of renames) {
    const a = data(from);
    if (!to || !fs.existsSync(a)) continue;
    const b = data(to);
    try { if (fs.existsSync(b) && fs.statSync(b).isDirectory() && !fs.readdirSync(b).length) fs.rmdirSync(b); } catch {}
    if (fs.existsSync(b)) continue;
    try { fs.renameSync(a, b); } catch {}
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(data('config.json'), 'utf8')); } catch { return; }
  if (!Object.keys(raw).some((k) => k in LEGACY_KEYS)) return;
  const out = {};
  for (const [k, v] of Object.entries(raw)) out[LEGACY_KEYS[k] || k] = v;
  const p = out.profile;
  if (p && 'ativo' in p) {
    out.profile = {
      enabled: !!p.ativo, displayName: p.nomeExibicao || '', username: p.usuario || '', avatar: p.avatar || '',
      badges: (p.badges || []).map((b) => ({ name: b.nome || b.name, preset: b.preset, file: b.arquivo || b.file }))
    };
  }
  for (const [n, s] of Object.entries(out.sounds || {})) out.sounds[n] = { volume: s.volume ?? 1, muted: !!(s.mudo ?? s.muted), file: s.arquivo || s.file };
  if (out.soundsGlobal && 'mudo' in out.soundsGlobal) out.soundsGlobal = { volume: out.soundsGlobal.volume ?? 1, muted: !!out.soundsGlobal.mudo };
  if (out.fakeMute && 'habilitado' in out.fakeMute) out.fakeMute = { enabled: false };
  const themes = {};
  for (const [id, on] of Object.entries(out.activeThemes || {})) themes[id.replace(/^arquivo:/, 'file:').replace(/^embutido:.*/, '')] = on;
  delete themes[''];
  out.activeThemes = themes;
  try { fs.writeFileSync(data('config.json'), JSON.stringify(out, null, 2)); } catch {}
}
ensureDir(dataDir());
migrateLegacy();

let config;
try { config = Object.assign({}, DEFAULTS, JSON.parse(readText('config.json', '{}') || '{}')); }
catch { config = Object.assign({}, DEFAULTS); }

function saveConfig() {
  try { fs.writeFileSync(data('config.json'), JSON.stringify(config, null, 2)); } catch (e) { console.error('[ZeroCord] could not save config', e); }
}

const currentMod = () => (MODS[config.mod] ? config.mod : 'equicord');

// Internal protocol that serves local files (background, avatar, badges, icons) to Discord
protocol.registerSchemesAsPrivileged([
  { scheme: 'zerocord', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
]);

const BACKGROUND_NAMES = ['background.mp4', 'background.webm', 'background.gif', 'background.png', 'background.jpg', 'background.jpeg', 'background.webp'];
function findBackground() {
  for (const name of BACKGROUND_NAMES) if (fs.existsSync(data(name))) return name;
  return null;
}
// First run: copy the shipped background into the data folder
if (!findBackground()) {
  const def = BACKGROUND_NAMES.find((n) => fs.existsSync(path.join(__dirname, 'defaults', n)));
  if (def) { try { fs.copyFileSync(path.join(__dirname, 'defaults', def), data(def)); } catch {} }
}

let mainWindow = null;

const isDiscord = (url) => {
  try { const h = new URL(url).hostname; return h === 'discord.com' || h.endsWith('.discord.com'); } catch { return false; }
};
const senderUrl = (e) => e.senderFrame?.url || e.sender.getURL();

// ============================================================
//  Plugins: Equicord (default, 370+ plugins) or Vencord
// ============================================================
const modCachePath = (mod) => data('mods', MODS[mod].file);

function readModCode() {
  const mod = currentMod();
  for (const p of [modCachePath(mod), path.join(__dirname, 'vendor', MODS[mod].file)]) {
    try { const t = fs.readFileSync(p, 'utf8'); if (t.includes('==UserScript==')) return t; } catch {}
  }
  return '';
}

// Downloads the newest build in the background; it's used the next time Discord opens
async function updateMod() {
  const mod = currentMod();
  try {
    const r = await net.fetch(MODS[mod].url);
    if (!r.ok) return;
    const t = await r.text();
    if (!t.includes('==UserScript==') || t.length < 100000) return;
    ensureDir(path.dirname(modCachePath(mod)));
    fs.writeFileSync(modCachePath(mod), t);
  } catch {}
}

ipcMain.on('zc:mod-code', (e) => {
  e.returnValue = config.plugins && isDiscord(senderUrl(e)) ? readModCode() : '';
});

ipcMain.handle('zc:fetch', async (e, url, options = {}) => {
  if (!isDiscord(senderUrl(e))) throw new Error('origin not allowed');
  if (!/^https?:\/\//i.test(String(url))) throw new Error('invalid url');
  const r = await net.fetch(String(url), {
    method: String(options.method || 'GET'),
    headers: options.headers || {},
    body: typeof options.body === 'string' ? options.body : undefined
  });
  const headers = [];
  r.headers.forEach((v, k) => headers.push(k + ': ' + v));
  return { status: r.status, headers: headers.join('\r\n'), body: await r.arrayBuffer() };
});



// ============================================================
//  Session: telemetry, CSP, permissions, protocol
// ============================================================
function setupSession() {
  const ses = session.defaultSession;

  protocol.handle('zerocord', (req) => {
    const u = new URL(req.url);
    const name = path.basename(decodeURIComponent(u.pathname));
    let file = null;
    if (u.hostname === 'background' && BACKGROUND_NAMES.includes(name)) file = data(name);
    else if (u.hostname === 'profile') file = data('profile', name);
    else if (u.hostname === 'badge') file = path.join(__dirname, 'badges', name);
    else if (u.hostname === 'icon') file = path.join(__dirname, 'icons', name);
    if (!file || !fs.existsSync(file)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  ses.setUserAgent(ses.getUserAgent().replace(/\s?Electron\/\S+/, '').replace(/\s?(meu-discord|meudiscord|zerocord)\/\S+/gi, ''));

  if (config.blockTelemetry) {
    ses.webRequest.onBeforeRequest(
      {
        urls: [
          'https://discord.com/api/v*/science', 'https://discord.com/api/v*/metrics*',
          'https://*.discord.com/api/v*/science', 'https://*.discord.com/api/v*/metrics*',
          'https://*.sentry.io/*', 'https://sentry.io/*'
        ]
      },
      (_d, cb) => cb({ cancel: true })
    );
  }

  // Plugins and themes load external resources: drop the CSP on Discord pages only
  ses.webRequest.onHeadersReceived({ urls: ['https://discord.com/*', 'https://*.discord.com/*'] }, (det, cb) => {
    const headers = det.responseHeaders || {};
    for (const k of Object.keys(headers)) if (/^content-security-policy(-report-only)?$/i.test(k)) delete headers[k];
    cb({ responseHeaders: headers });
  });

  ses.setPermissionRequestHandler((wc, permission, cb) => {
    cb(isDiscord(wc.getURL()) && ['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'display-capture'].includes(permission));
  });

  ses.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const r = { video: sources[0] };
      if (process.platform === 'win32') r.audio = 'loopback';
      cb(r);
    } catch { cb({}); }
  }, { useSystemPicker: true });
}

// ============================================================
//  Themes
// ============================================================
let themeKeys = [];
let noAnimKey = null;
let customCssKey = null;

function themeMeta(css, fallbackName) {
  const name = (css.match(/@name\s+([^\n*]+)/) || [])[1];
  const desc = (css.match(/@description\s+([^\n*]+)/) || [])[1];
  return { name: (name || fallbackName).trim(), description: (desc || '').trim() };
}

function listThemes() {
  const themes = [];
  // Built-in
  try {
    for (const n of fs.readdirSync(path.join(__dirname, 'themes')).filter((x) => x.endsWith('.css')).sort()) {
      const css = fs.readFileSync(path.join(__dirname, 'themes', n), 'utf8');
      const id = 'builtin:' + n;
      themes.push({ id, source: 'Built-in', ...themeMeta(css, n), css, active: config.activeThemes[id] === true });
    }
  } catch {}
  // Your files (on by default when you drop them in the folder)
  try {
    ensureDir(data('themes'));
    for (const n of fs.readdirSync(data('themes')).filter((x) => x.toLowerCase().endsWith('.css')).sort()) {
      const css = fs.readFileSync(data('themes', n), 'utf8');
      const id = 'file:' + n;
      themes.push({ id, source: 'File', ...themeMeta(css, n.replace(/(\.theme)?\.css$/i, '')), css, active: config.activeThemes[id] !== false });
    }
  } catch {}
  // Links
  for (const link of Array.isArray(config.onlineThemes) ? config.onlineThemes : []) {
    if (!/^https:\/\//i.test(link)) continue;
    const id = 'link:' + link;
    themes.push({ id, source: 'Link', name: link.split('/').pop() || link, description: link, css: `@import url("${link.replace(/"/g, '')}");`, active: config.activeThemes[id] !== false });
  }
  return themes;
}

async function removeKeys(wc, keys) {
  for (const k of keys) { try { await wc.removeInsertedCSS(k); } catch {} }
}

async function applyThemes() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  const old = themeKeys;
  themeKeys = [];
  for (const t of listThemes().filter((x) => x.active && config.themesEnabled !== false)) {
    try { themeKeys.push(await wc.insertCSS(t.css)); } catch {}
  }
  await removeKeys(wc, old);
}

async function applyBaseCss() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  if (noAnimKey) { try { await wc.removeInsertedCSS(noAnimKey); } catch {} noAnimKey = null; }
  if (config.noAnimations) noAnimKey = await wc.insertCSS(fs.readFileSync(path.join(__dirname, 'no-animations.css'), 'utf8'));
  if (customCssKey) { try { await wc.removeInsertedCSS(customCssKey); } catch {} customCssKey = null; }
  const css = readText('custom.css');
  if (css.trim()) customCssKey = await wc.insertCSS(css);
}

function watchThemes() {
  ensureDir(data('themes'));
  let wait;
  try { fs.watch(data('themes'), () => { clearTimeout(wait); wait = setTimeout(applyThemes, 300); }); } catch {}
}

// ============================================================
//  Runtime inside Discord (background, profile, fake mute, settings)
// ============================================================
function runInPage(code, label = 'script') {
  if (!mainWindow || mainWindow.isDestroyed()) { log('runInPage skipped (no window):', label); return Promise.resolve(null); }
  return mainWindow.webContents.executeJavaScript(code, true).catch((e) => { log('page error in', label + ':', e); return null; });
}
// Calls a runtime function and reports errors thrown inside the page
const call = (fn, ...args) => runInPage(
  `(async () => { try { if (!window.__zerocord) return { __zcError: 'runtime not loaded' }; return await window.__zerocord.${fn}(...${JSON.stringify(args)}); }
   catch (e) { return { __zcError: String(e && (e.stack || e.message) || e) }; } })()`, fn
).then((r) => { if (r && r.__zcError) { log('runtime error in', fn + ':', r.__zcError); return null; } return r; });

function fileVersion(p) { try { return Math.floor(fs.statSync(p).mtimeMs); } catch { return 0; } }

function backgroundData() {
  const name = findBackground();
  return {
    enabled: !!config.background && !!name,
    src: name ? `zerocord://background/${name}?v=${fileVersion(data(name))}` : '',
    video: !!name && /\.(mp4|webm)$/i.test(name),
    opacity: Number(config.backgroundOpacity) || 0.25,
    blend: String(config.backgroundBlend || 'screen'),
    file: name
  };
}

const localUrl = (kind, file) => {
  if (!file) return '';
  const p = data('profile', file);
  if (!fs.existsSync(p)) return '';
  return `zerocord://${kind}/${encodeURIComponent(file)}?v=${fileVersion(p)}`;
};

function profileData() {
  const p = config.profile || {};
  return {
    enabled: !!p.enabled,
    displayName: p.displayName || '',
    username: p.username || '',
    avatar: localUrl('profile', p.avatar),
    badges: (p.badges || []).map((b) => ({
      name: b.name,
      url: b.preset ? `zerocord://badge/${encodeURIComponent(b.preset)}` : localUrl('profile', b.file)
    })).filter((b) => b.url)
  };
}

let reloadedForApis = false;
async function applyAllInPage() {
  log('applying ZeroCord to', mainWindow && mainWindow.webContents.getURL());
  await runInPage(fs.readFileSync(path.join(__dirname, 'runtime.js'), 'utf8'), 'runtime.js');
  const probe = await runInPage(`({ runtime: !!window.__zerocord, engine: typeof window.Vencord, metaPatched: !!window.__zcMetaPatched,
    settingsPlugin: !!(window.Vencord && window.Vencord.Plugins && window.Vencord.Plugins.plugins && window.Vencord.Plugins.plugins.Settings),
    apiSettings: !!(window.Vencord && window.Vencord.Api && window.Vencord.Api.Settings), userArea: !!(window.Vencord && window.Vencord.Api && window.Vencord.Api.UserArea) })`, 'probe');
  log('page state:', probe);
  // First launch: turn on Equicord's button APIs, which only take effect after one reload
  if (config.plugins && !reloadedForApis && (await call('ensureApis'))) {
    reloadedForApis = true;
    mainWindow.webContents.reload();
    return;
  }
  log('setupEngine:', await call('setupEngine', pageState()));
  await call('background', backgroundData());
  await call('fakeMuteConfig', Object.assign({}, DEFAULTS.fakeMute, config.fakeMute));
  call('setProfile', profileData()); // waits for Discord to load the user: don't block the rest
}

// ============================================================
//  Discord window (ours or the official client's)
// ============================================================
function attachWindow(win, { standalone = false } = {}) {
  if (standalone) mainWindow = win;
  log('window attached', standalone ? '(standalone)' : '(Discord client)');
  win.webContents.on('did-finish-load', async () => {
    const url = win.webContents.getURL();
    log('did-finish-load', url);
    if (!isDiscord(url)) return;
    // In the official client, only the main window (not call popouts etc.)
    if (!standalone) {
      if (/\/popout/i.test(new URL(url).pathname)) return;
      mainWindow = win;
    }
    win.webContents.setZoomFactor(Number(config.zoom) || 1);
    noAnimKey = null; customCssKey = null; themeKeys = [];
    await applyBaseCss();
    await applyThemes();
    await applyAllInPage();
  });

  if (standalone) {
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.control && !input.shift && input.key.toLowerCase() === 'r') { win.reload(); e.preventDefault(); }
      if (input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (!isDiscord(url)) { e.preventDefault(); shell.openExternal(url); }
    });
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
}

// ============================================================
//  Settings live inside Discord (Equicord's Plugins page): IPC for the page
// ============================================================
const fromDiscord = (e) => isDiscord(senderUrl(e));
function handlePage(channel, fn) {
  ipcMain.handle('zc:' + channel, async (e, ...args) => {
    if (!fromDiscord(e)) throw new Error('not allowed');
    return fn(...args);
  });
}

async function pickFile(title, extensions) {
  const r = await dialog.showOpenDialog(mainWindow, { title, properties: ['openFile'], filters: [{ name: 'Files', extensions }] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
}

const safeName = (s) => String(s).replace(/[^\w.-]+/g, '_').slice(0, 80);

const BADGE_NAMES = {
  'nitro.svg': 'Nitro', 'hypesquad_bravery.svg': 'HypeSquad Bravery', 'hypesquad_brilliance.svg': 'HypeSquad Brilliance',
  'hypesquad_balance.svg': 'HypeSquad Balance', 'hypesquad_events.svg': 'HypeSquad Events', 'early_supporter.svg': 'Early Supporter',
  'active_developer.svg': 'Active Developer', 'early_verified_developer.svg': 'Early Verified Bot Developer',
  'bug_hunter_level_1.svg': 'Bug Hunter', 'bug_hunter_level_2.svg': 'Bug Hunter (gold)',
  'partnered_server_owner.svg': 'Partnered Server Owner', 'boosting_1_months.svg': 'Boosting 1 month',
  'boosting_2_months.svg': 'Boosting 2 months', 'boosting_3_months.svg': 'Boosting 3 months', 'boosting_6_months.svg': 'Boosting 6 months',
  'boosting_9_months.svg': 'Boosting 9 months', 'boosting_12_months.svg': 'Boosting 1 year', 'boosting_15_months.svg': 'Boosting 15 months',
  'boosting_18_months.svg': 'Boosting 18 months', 'boosting_24_months.svg': 'Boosting 2 years'
};
function listBadgePresets() {
  try {
    return fs.readdirSync(path.join(__dirname, 'badges')).filter((n) => n.endsWith('.svg')).sort()
      .map((n) => ({ id: n, name: BADGE_NAMES[n] || n.replace('.svg', ''), url: `zerocord://badge/${n}` }));
  } catch { return []; }
}

// Everything the in-Discord settings need
const VERSION = (() => { try { return require('../package.json').version; } catch { return ''; } })() + '+' + fileVersion(path.join(__dirname, 'runtime.js'));
function pageState() {
  return {
    version: VERSION,
    config: {
      background: !!config.background, backgroundOpacity: config.backgroundOpacity, backgroundBlend: config.backgroundBlend,
      noAnimations: !!config.noAnimations, blockTelemetry: !!config.blockTelemetry, zoom: config.zoom,
      fakeMute: !!(config.fakeMute && config.fakeMute.enabled), themesEnabled: config.themesEnabled !== false,
      profile: Object.assign({}, DEFAULTS.profile, config.profile)
    },
    backgroundFile: findBackground(),
    themes: listThemes().map(({ css, ...t }) => t),
    badgePresets: listBadgePresets(),
    profileUrls: profileData()
  };
}

async function applyConfigChange(partial) {
  const p = partial || {};
  if ('background' in p) config.background = !!p.background;
  if ('backgroundOpacity' in p) config.backgroundOpacity = Math.max(0.02, Math.min(1, Number(p.backgroundOpacity) || 0.25));
  if ('backgroundBlend' in p) config.backgroundBlend = String(p.backgroundBlend);
  if ('noAnimations' in p) config.noAnimations = !!p.noAnimations;
  if ('blockTelemetry' in p) config.blockTelemetry = !!p.blockTelemetry;
  if ('zoom' in p) config.zoom = Math.max(0.5, Math.min(2, Number(p.zoom) || 1));
  if ('fakeMute' in p) config.fakeMute = { enabled: !!p.fakeMute };
  if ('themesEnabled' in p) config.themesEnabled = !!p.themesEnabled;
  if (p.profile) {
    const prof = config.profile = Object.assign({}, DEFAULTS.profile, config.profile);
    for (const k of ['enabled', 'displayName', 'username']) if (k in p.profile) prof[k] = k === 'enabled' ? !!p.profile[k] : String(p.profile[k]).slice(0, 64);
    if (Array.isArray(p.profile.badges)) prof.badges = p.profile.badges;
  }
  saveConfig();
  if ('background' in p || 'backgroundOpacity' in p || 'backgroundBlend' in p) await call('background', backgroundData());
  if ('noAnimations' in p) await applyBaseCss();
  if ('themesEnabled' in p) await applyThemes();
  if ('zoom' in p && mainWindow) mainWindow.webContents.setZoomFactor(config.zoom);
  if (p.profile) await call('setProfile', profileData());
  return pageState();
}

const ACTIONS = {
  async pickBackground() {
    const f = await pickFile('Choose a video, GIF or image', ['mp4', 'webm', 'gif', 'png', 'jpg', 'jpeg', 'webp']);
    if (!f) return pageState();
    for (const n of BACKGROUND_NAMES) { try { fs.unlinkSync(data(n)); } catch {} }
    fs.copyFileSync(f, data('background' + path.extname(f).toLowerCase().replace('.jpeg', '.jpg')));
    config.background = true; saveConfig();
    await call('background', backgroundData());
    return pageState();
  },
  async toggleTheme({ id, on }) { config.activeThemes[id] = !!on; saveConfig(); await applyThemes(); return pageState(); },
  async importTheme() {
    const f = await pickFile('Choose a theme (.css)', ['css']);
    if (f) { ensureDir(data('themes')); fs.copyFileSync(f, data('themes', safeName(path.basename(f)))); await applyThemes(); }
    return pageState();
  },
  async addThemeLink(link) {
    link = String(link || '').trim();
    if (/^https:\/\/\S+$/i.test(link)) { config.onlineThemes = Array.from(new Set([...(config.onlineThemes || []), link])); saveConfig(); await applyThemes(); }
    return pageState();
  },
  async removeTheme(id) {
    if (id.startsWith('link:')) config.onlineThemes = (config.onlineThemes || []).filter((l) => 'link:' + l !== id);
    else if (id.startsWith('file:')) { try { fs.unlinkSync(data('themes', path.basename(id.slice(5)))); } catch {} }
    delete config.activeThemes[id]; saveConfig(); await applyThemes();
    return pageState();
  },
  async openFolder(which) {
    const p = { themes: data('themes'), data: dataDir() }[which] || dataDir();
    ensureDir(p); shell.openPath(p); return pageState();
  },
  async pickAvatar() {
    const prof = config.profile = Object.assign({}, DEFAULTS.profile, config.profile);
    const f = await pickFile('Choose an image or GIF', ['png', 'jpg', 'jpeg', 'gif', 'webp']);
    if (f) {
      if (prof.avatar) { try { fs.unlinkSync(data('profile', prof.avatar)); } catch {} }
      ensureDir(data('profile')); prof.avatar = 'avatar-' + Date.now() + path.extname(f).toLowerCase();
      fs.copyFileSync(f, data('profile', prof.avatar)); saveConfig(); await call('setProfile', profileData());
    }
    return pageState();
  },
  async resetAvatar() {
    const prof = config.profile = Object.assign({}, DEFAULTS.profile, config.profile);
    if (prof.avatar) { try { fs.unlinkSync(data('profile', prof.avatar)); } catch {} prof.avatar = ''; }
    saveConfig(); await call('setProfile', profileData()); return pageState();
  },
  async addCustomBadge(name) {
    const f = await pickFile('Choose the badge image', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
    if (f) {
      ensureDir(data('profile'));
      const file = 'badge-' + Date.now() + path.extname(f).toLowerCase();
      fs.copyFileSync(f, data('profile', file));
      const prof = config.profile = Object.assign({}, DEFAULTS.profile, config.profile);
      prof.badges = [...(prof.badges || []), { name: String(name || 'My badge').slice(0, 60), file }];
      saveConfig(); await call('setProfile', profileData());
    }
    return pageState();
  },
  async restart() { app.relaunch(); app.exit(0); }
};

function registerPageIpc() {
  handlePage('state', async () => pageState());
  handlePage('set', async (partial) => applyConfigChange(partial));
  handlePage('action', async (name, arg) => {
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, name)) throw new Error('unknown action');
    return ACTIONS[name](arg);
  });
}

// ============================================================
//  Discord's original preload (injected mode)
// ============================================================
const originalPreloads = new Map();
ipcMain.on('zc:original-preload', (e) => { e.returnValue = originalPreloads.get(e.sender.id) || ''; });

let started = false;
function startWhenReady() {
  if (started) return;
  started = true;
  log('ZeroCord starting', { mode: process.env.ZEROCORD_MODE, electron: process.versions.electron, dir: __dirname });
  setupSession();
  registerPageIpc();
  watchThemes();
  if (config.plugins) updateMod();
}

module.exports = { config, attachWindow, startWhenReady, originalPreloads, DISCORD_URL, log };
