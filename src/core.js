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
  panelButton: true,
  background: true,
  backgroundOpacity: 0.25,
  backgroundBlend: 'screen',
  onlineThemes: [],
  activeThemes: {},
  sounds: {},
  soundsGlobal: { volume: 1, muted: false },
  profile: { enabled: false, displayName: '', username: '', avatar: '', badges: [] },
  fakeMute: { enabled: false },
  zeroTwoIcon: true
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

// Internal protocol that serves local files (background, sounds, avatar, badges) to Discord
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
let panel = null;

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

ipcMain.on('zc:open-panel', (e) => {
  if (isDiscord(senderUrl(e))) openPanel();
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
    else if (u.hostname === 'sound') file = data('sounds', name);
    else if (u.hostname === 'profile') file = data('profile', name);
    else if (u.hostname === 'badge') file = path.join(__dirname, 'badges', name);
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

  // Plugins, themes and sounds load external resources: drop the CSP on Discord pages only
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
  for (const t of listThemes().filter((x) => x.active)) {
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

let previewBusy = false;
async function makePreview(id) {
  if (!mainWindow || mainWindow.isDestroyed() || previewBusy) return null;
  const theme = listThemes().find((t) => t.id === id);
  if (!theme) return null;
  previewBusy = true;
  const wc = mainWindow.webContents;
  try {
    await removeKeys(wc, themeKeys);
    themeKeys = [];
    const k = await wc.insertCSS(theme.css);
    await new Promise((r) => setTimeout(r, theme.source === 'Link' ? 1500 : 450));
    const img = await wc.capturePage();
    await wc.removeInsertedCSS(k);
    return img.resize({ width: 640 }).toDataURL();
  } finally {
    await applyThemes();
    previewBusy = false;
  }
}

function watchThemes() {
  ensureDir(data('themes'));
  let wait;
  try { fs.watch(data('themes'), () => { clearTimeout(wait); wait = setTimeout(() => { applyThemes(); notifyPanel(); }, 300); }); } catch {}
}

// ============================================================
//  Runtime inside Discord (background, sounds, profile, fake mute)
// ============================================================
function runInPage(code) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(null);
  return mainWindow.webContents.executeJavaScript(code, true).catch((e) => { console.error('[ZeroCord]', e); return null; });
}
const call = (fn, ...args) => runInPage(`window.__zerocord && window.__zerocord.${fn}(...${JSON.stringify(args)})`);

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
  const p = data(kind === 'sound' ? 'sounds' : 'profile', file);
  if (!fs.existsSync(p)) return '';
  return `zerocord://${kind}/${encodeURIComponent(file)}?v=${fileVersion(p)}`;
};

function soundsData() {
  const cfg = {};
  for (const [name, c] of Object.entries(config.sounds || {})) cfg[name] = { volume: c.volume ?? 1, muted: !!c.muted, url: localUrl('sound', c.file) };
  return { cfg, global: config.soundsGlobal || { volume: 1, muted: false } };
}

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
  await runInPage(fs.readFileSync(path.join(__dirname, 'runtime.js'), 'utf8'));
  // First launch: turn on Equicord's button APIs, which only take effect after one reload
  if (config.plugins && !reloadedForApis && (await call('ensureApis'))) {
    reloadedForApis = true;
    mainWindow.webContents.reload();
    return;
  }
  await call('background', backgroundData());
  await call('setSounds', soundsData());
  await call('panelButton', !!config.panelButton);
  await call('fakeMuteConfig', Object.assign({}, DEFAULTS.fakeMute, config.fakeMute));
  call('setProfile', profileData()); // waits for Discord to load the user: don't block the rest
}

// ============================================================
//  Discord window (ours or the official client's)
// ============================================================
function attachWindow(win, { standalone = false } = {}) {
  if (standalone) mainWindow = win;
  win.webContents.on('did-finish-load', async () => {
    const url = win.webContents.getURL();
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
    if (standalone && panel && !panel.isDestroyed()) panel.close();
  });
}

// ============================================================
//  Panel
// ============================================================
function openPanel() {
  if (panel && !panel.isDestroyed()) { panel.show(); panel.focus(); return; }
  panel = new BrowserWindow({
    zeroCord: true,
    width: 1060, height: 760, minWidth: 820, minHeight: 560,
    title: 'ZeroCord Panel', backgroundColor: '#313338', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icons', process.platform === 'win32' ? 'discord.ico' : 'discord.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'panel', 'preload.js') }
  });
  panel.loadFile(path.join(__dirname, 'panel', 'index.html'));
  panel.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  panel.on('closed', () => { panel = null; });
}

function notifyPanel() {
  if (panel && !panel.isDestroyed()) panel.webContents.send('zc-panel:refresh');
}

const fromPanel = (e) => panel && !panel.isDestroyed() && e.sender === panel.webContents;
function handle(channel, fn) {
  ipcMain.handle('zc-panel:' + channel, async (e, ...args) => {
    if (!fromPanel(e)) throw new Error('not allowed');
    return fn(...args);
  });
}

async function pickFile(title, extensions) {
  const r = await dialog.showOpenDialog(panel, { title, properties: ['openFile'], filters: [{ name: 'Files', extensions }] });
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

function panelState() {
  return {
    config: {
      hardwareAcceleration: config.hardwareAcceleration, blockTelemetry: config.blockTelemetry,
      noAnimations: config.noAnimations, spellcheck: config.spellcheck, zoom: config.zoom,
      backgroundThrottling: config.backgroundThrottling, plugins: config.plugins, panelButton: config.panelButton,
      mod: currentMod(), injected: INJECTED
    },
    themes: listThemes().map(({ css, ...t }) => t),
    background: backgroundData(),
    sounds: { cfg: config.sounds || {}, global: config.soundsGlobal || { volume: 1, muted: false } },
    profile: Object.assign({}, DEFAULTS.profile, config.profile),
    profileUrls: profileData(),
    fakeMute: Object.assign({}, DEFAULTS.fakeMute, config.fakeMute),
    badgePresets: listBadgePresets(),
    dataDir: dataDir()
  };
}

function registerPanel() {
  handle('state', async () => panelState());

  // ---- Themes ----
  handle('theme-toggle', async (id, on) => { config.activeThemes[id] = !!on; saveConfig(); await applyThemes(); return true; });
  handle('theme-preview', async (id) => makePreview(id));
  handle('theme-import', async () => {
    const f = await pickFile('Choose a theme (.css)', ['css']);
    if (!f) return false;
    ensureDir(data('themes'));
    fs.copyFileSync(f, data('themes', safeName(path.basename(f))));
    await applyThemes(); return true;
  });
  handle('theme-link', async (link) => {
    link = String(link || '').trim();
    if (!/^https:\/\/\S+$/i.test(link)) return false;
    config.onlineThemes = Array.from(new Set([...(config.onlineThemes || []), link]));
    saveConfig(); await applyThemes(); return true;
  });
  handle('theme-remove', async (id) => {
    if (id.startsWith('link:')) config.onlineThemes = (config.onlineThemes || []).filter((l) => 'link:' + l !== id);
    else if (id.startsWith('file:')) { try { fs.unlinkSync(data('themes', path.basename(id.slice(5)))); } catch {} }
    delete config.activeThemes[id];
    saveConfig(); await applyThemes(); return true;
  });
  handle('open-folder', async (which) => {
    const p = { themes: data('themes'), sounds: data('sounds'), data: dataDir() }[which] || dataDir();
    ensureDir(p); shell.openPath(p); return true;
  });

  // ---- Background ----
  handle('background', async (partial) => {
    if ('enabled' in partial) config.background = !!partial.enabled;
    if ('opacity' in partial) config.backgroundOpacity = Math.max(0.02, Math.min(1, Number(partial.opacity) || 0.25));
    if ('blend' in partial) config.backgroundBlend = String(partial.blend);
    saveConfig(); await call('background', backgroundData()); return backgroundData();
  });
  handle('background-pick', async () => {
    const f = await pickFile('Choose a video, GIF or image', ['mp4', 'webm', 'gif', 'png', 'jpg', 'jpeg', 'webp']);
    if (!f) return backgroundData();
    for (const n of BACKGROUND_NAMES) { try { fs.unlinkSync(data(n)); } catch {} }
    const ext = path.extname(f).toLowerCase().replace('.jpeg', '.jpg');
    fs.copyFileSync(f, data('background' + ext));
    config.background = true; saveConfig();
    await call('background', backgroundData()); return backgroundData();
  });

  // ---- Sounds ----
  handle('sounds-list', async () => (await call('listSounds')) || {});
  handle('sound-pick', async (name) => {
    const f = await pickFile('Choose a sound', ['mp3', 'ogg', 'wav', 'm4a', 'webm', 'flac']);
    if (!f) return false;
    ensureDir(data('sounds'));
    const old = config.sounds[name]?.file;
    if (old) { try { fs.unlinkSync(data('sounds', old)); } catch {} }
    const file = safeName(name) + path.extname(f).toLowerCase();
    fs.copyFileSync(f, data('sounds', file));
    config.sounds[name] = Object.assign({ volume: 1, muted: false }, config.sounds[name], { file });
    saveConfig(); await call('setSounds', soundsData()); return true;
  });
  handle('sound-config', async (name, partial) => {
    config.sounds[name] = Object.assign({ volume: 1, muted: false }, config.sounds[name], {
      ...('volume' in partial ? { volume: Math.max(0, Math.min(1, Number(partial.volume))) } : {}),
      ...('muted' in partial ? { muted: !!partial.muted } : {})
    });
    saveConfig(); await call('setSounds', soundsData()); return true;
  });
  handle('sound-reset', async (name) => {
    const file = config.sounds[name]?.file;
    if (file) { try { fs.unlinkSync(data('sounds', file)); } catch {} }
    delete config.sounds[name];
    saveConfig(); await call('setSounds', soundsData()); return true;
  });
  handle('sounds-global', async (partial) => {
    config.soundsGlobal = Object.assign({ volume: 1, muted: false }, config.soundsGlobal, partial);
    config.soundsGlobal.volume = Math.max(0, Math.min(1, Number(config.soundsGlobal.volume)));
    saveConfig(); await call('setSounds', soundsData()); return true;
  });
  handle('sound-url', async (name) => localUrl('sound', config.sounds[name]?.file));

  // ---- Local profile ----
  handle('profile', async (partial) => {
    const p = config.profile = Object.assign({}, DEFAULTS.profile, config.profile);
    for (const k of ['enabled', 'displayName', 'username']) if (k in partial) p[k] = k === 'enabled' ? !!partial[k] : String(partial[k]).slice(0, 64);
    if (Array.isArray(partial.badges)) p.badges = partial.badges;
    saveConfig(); await call('setProfile', profileData()); return panelState();
  });
  handle('profile-avatar', async (remove) => {
    const p = config.profile = Object.assign({}, DEFAULTS.profile, config.profile);
    if (p.avatar) { try { fs.unlinkSync(data('profile', p.avatar)); } catch {} p.avatar = ''; }
    if (!remove) {
      const f = await pickFile('Choose an image or GIF', ['png', 'jpg', 'jpeg', 'gif', 'webp']);
      if (f) { ensureDir(data('profile')); p.avatar = 'avatar-' + Date.now() + path.extname(f).toLowerCase(); fs.copyFileSync(f, data('profile', p.avatar)); }
    }
    saveConfig(); await call('setProfile', profileData()); return panelState();
  });
  handle('badge-custom', async (name) => {
    const f = await pickFile('Choose the badge image', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
    if (!f) return panelState();
    ensureDir(data('profile'));
    const file = 'badge-' + Date.now() + path.extname(f).toLowerCase();
    fs.copyFileSync(f, data('profile', file));
    const p = config.profile = Object.assign({}, DEFAULTS.profile, config.profile);
    p.badges = [...(p.badges || []), { name: String(name || 'My badge').slice(0, 60), file }];
    saveConfig(); await call('setProfile', profileData()); return panelState();
  });

  // ---- Plugins ----
  handle('plugins-list', async () => (await call('listPlugins')) || null);
  handle('plugins-toggle', async (names, on) => (await call('togglePlugins', names, on)) || null);
  handle('reload', async () => { if (mainWindow) mainWindow.reload(); return true; });

  // ---- Fake mute ----
  handle('fake-mute', async (enabled) => {
    config.fakeMute = { enabled: !!enabled };
    saveConfig();
    await call('fakeMuteConfig', config.fakeMute);
    return config.fakeMute;
  });

  // ---- Custom CSS ----
  handle('css-read', async () => readText('custom.css'));
  handle('css-save', async (text) => { fs.writeFileSync(data('custom.css'), String(text)); await applyBaseCss(); return true; });

  // ---- Settings ----
  handle('config', async (partial) => {
    const allowed = ['hardwareAcceleration', 'blockTelemetry', 'noAnimations', 'spellcheck', 'zoom', 'backgroundThrottling', 'plugins', 'panelButton'];
    for (const k of allowed) if (k in partial) config[k] = k === 'zoom' ? Math.max(0.5, Math.min(2, Number(partial[k]) || 1)) : !!partial[k];
    if ('mod' in partial && MODS[partial.mod]) config.mod = partial.mod;
    saveConfig();
    if (mainWindow) {
      if ('zoom' in partial) mainWindow.webContents.setZoomFactor(config.zoom);
      if ('noAnimations' in partial) await applyBaseCss();
      if ('panelButton' in partial) await call('panelButton', config.panelButton);
    }
    return true;
  });
  handle('restart', async () => { app.relaunch(); app.exit(0); });
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
  setupSession();
  registerPanel();
  watchThemes();
  if (config.plugins) updateMod();
}

module.exports = { config, attachWindow, startWhenReady, originalPreloads, openPanel, DISCORD_URL };
