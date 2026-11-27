// Installer logic: finds Discord (Stable/PTB/Canary/Development), installs, uninstalls and swaps icons.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');

// Electron treats .asar files as folders and reports Discord's app.asar as missing.
// The installer only needs plain file access.
process.noAsar = true;

const VARIANTS = [
  { id: 'stable', name: 'Discord', folder: 'Discord', exe: 'Discord.exe' },
  { id: 'ptb', name: 'Discord PTB', folder: 'DiscordPTB', exe: 'DiscordPTB.exe' },
  { id: 'canary', name: 'Discord Canary', folder: 'DiscordCanary', exe: 'DiscordCanary.exe' },
  { id: 'dev', name: 'Discord Development', folder: 'DiscordDevelopment', exe: 'DiscordDevelopment.exe' }
];

const MARKER = 'ZeroCord';
const MARKERS = ['ZeroCord', 'MeuDiscord']; // MeuDiscord = legacy name
const LOCAL = () => process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const ROAMING = () => process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const DATA_DIR = () => path.join(ROAMING(), 'ZeroCord');
const CODE_DIR = () => path.join(DATA_DIR(), 'app');
const SRC_DIR = path.join(__dirname, '..', 'src');

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const isWindows = process.platform === 'win32';

function compareVersions(a, b) {
  const x = (a.match(/\d+/g) || []).map(Number), y = (b.match(/\d+/g) || []).map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// Which client mod (if any) is loaded by this resources folder
function detectMod(resources) {
  for (const entry of [path.join(resources, 'app.asar', 'index.js'), path.join(resources, 'app', 'index.js')]) {
    let t = '';
    try { t = fs.readFileSync(entry, 'utf8'); } catch { continue; }
    if (MARKERS.some((m) => t.includes(m))) return 'ZeroCord';
    if (/equicord/i.test(t)) return 'Equicord';
    if (/vencord/i.test(t)) return 'Vencord';
    if (/betterdiscord/i.test(t)) return 'BetterDiscord';
    return 'another mod';
  }
  if (exists(path.join(resources, '_app.asar'))) return 'another mod';
  return null;
}

function resourcesState(resources) {
  const mod = detectMod(resources);
  if (!mod) return { state: 'clean', mod: null };
  if (mod === 'ZeroCord') return { state: 'installed', mod };
  return { state: 'other-mod', mod };
}

// ---------------------------------------------------------------
function list() {
  const out = [];
  for (const v of VARIANTS) {
    const root = path.join(LOCAL(), v.folder);
    if (!exists(root)) continue;
    let apps = [];
    try {
      apps = fs.readdirSync(root)
        .filter((n) => /^app-\d/.test(n) && (exists(path.join(root, n, 'resources', 'app.asar')) || exists(path.join(root, n, 'resources', '_app.asar'))))
        .sort(compareVersions);
    } catch {}
    if (!apps.length) continue;
    const latest = apps[apps.length - 1];
    const { state, mod } = resourcesState(path.join(root, latest, 'resources'));
    out.push({ ...v, root, version: latest.replace(/^app-/, ''), apps, state, mod, installed: state === 'installed', otherMod: state === 'other-mod' });
  }
  return out;
}

// ---------------------------------------------------------------
// Users of the legacy name: bring their settings over to the new folder
function migrateLegacyFolder(log) {
  const old = path.join(ROAMING(), 'MeuDiscord');
  if (exists(old) && !exists(DATA_DIR())) {
    try { fs.renameSync(old, DATA_DIR()); log('Your previous settings were migrated'); }
    catch { try { fs.cpSync(old, DATA_DIR(), { recursive: true }); } catch {} }
  }
}

function copyFiles(log) {
  migrateLegacyFolder(log);
  const target = CODE_DIR();
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(SRC_DIR, target, { recursive: true });
  log('ZeroCord files copied');
}

// Windows can keep a file locked for a moment after Discord closes: retry briefly
function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (i >= 20 || !['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }
}

// Puts Discord's original app.asar back (removes ZeroCord or another mod)
function restoreOriginal(resources) {
  const asar = path.join(resources, 'app.asar');
  const original = path.join(resources, '_app.asar');
  if (exists(original)) {
    if (isDir(asar)) fs.rmSync(asar, { recursive: true, force: true });
    if (!exists(asar)) renameRetry(original, asar);
  }
  // legacy layout (resources/app)
  const appDir = path.join(resources, 'app');
  if (isDir(appDir)) fs.rmSync(appDir, { recursive: true, force: true });
}
const removeOtherMod = restoreOriginal;

// Same method Vencord/Equicord use: Discord's app.asar becomes _app.asar and
// app.asar becomes a folder that loads ZeroCord, which then starts the original.
function injectInto(resources) {
  const asar = path.join(resources, 'app.asar');
  const original = path.join(resources, '_app.asar');
  const legacy = path.join(resources, 'app');
  if (isDir(legacy)) fs.rmSync(legacy, { recursive: true, force: true });
  if (!isDir(asar)) {
    if (!exists(asar)) throw new Error('app.asar not found in ' + resources);
    if (exists(original)) fs.rmSync(original, { force: true });
    renameRetry(asar, original);
    fs.mkdirSync(asar);
  }
  const patcher = path.join(CODE_DIR(), 'patcher.js');
  fs.writeFileSync(path.join(asar, 'index.js'), `// ${MARKER}: loads ZeroCord, then the regular Discord\nrequire(${JSON.stringify(patcher)});\n`);
  fs.writeFileSync(path.join(asar, 'package.json'), JSON.stringify({ name: 'discord', main: 'index.js' }, null, 2));
}

function removeFrom(resources) {
  if (detectMod(resources) !== 'ZeroCord') return false;
  restoreOriginal(resources);
  return true;
}

// ---------------------------------------------------------------
//  Discord processes
// ---------------------------------------------------------------
function runningClients(ids) {
  return new Promise((resolve) => {
    if (!isWindows) return resolve([]);
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve([]);
      const txt = String(stdout).toLowerCase();
      resolve(VARIANTS.filter((v) => ids.includes(v.id) && txt.includes('"' + v.exe.toLowerCase() + '"')).map((v) => v.id));
    });
  });
}

function closeClients(ids) {
  const targets = VARIANTS.filter((v) => ids.includes(v.id));
  return Promise.all(targets.map((v) => new Promise((res) => {
    if (!isWindows) return res();
    execFile('taskkill', ['/F', '/T', '/IM', v.exe], { windowsHide: true }, () => res());
  }))).then(() => new Promise((r) => setTimeout(r, 1500)));
}

function launch(id) {
  const v = list().find((x) => x.id === id);
  if (!v || !isWindows) return;
  const update = path.join(v.root, 'Update.exe');
  if (exists(update)) spawn(update, ['--processStart', v.exe], { detached: true, stdio: 'ignore' }).unref();
}

// ---------------------------------------------------------------
//  Shortcut icons (Desktop, Start Menu, Taskbar)
// ---------------------------------------------------------------
function powershell(script) {
  return new Promise((resolve) => {
    if (!isWindows) return resolve('');
    const file = path.join(os.tmpdir(), `zerocord-${Date.now()}.ps1`);
    fs.writeFileSync(file, '﻿' + script, 'utf8');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, timeout: 30000 }, (err, stdout) => {
      try { fs.unlinkSync(file); } catch {}
      resolve(err ? '' : String(stdout));
    });
  });
}

const psStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";

async function setShortcutIcons(variants, useOurs, log) {
  if (!isWindows) return;
  const ico = path.join(CODE_DIR(), 'icons', 'discord.ico');
  const memoryFile = path.join(DATA_DIR(), 'original-shortcuts.json');
  let memory = {};
  try { memory = JSON.parse(fs.readFileSync(memoryFile, 'utf8')); } catch {}

  const roots = variants.map((v) => v.root);
  const findScript = `
$ErrorActionPreference = 'SilentlyContinue'
$sh = New-Object -ComObject WScript.Shell
$folders = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  [Environment]::GetFolderPath('Programs'),
  [Environment]::GetFolderPath('StartMenu'),
  (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar'),
  (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch')
)
$roots = @(${roots.map(psStr).join(',')})
$out = @()
foreach ($f in $folders) {
  if (-not (Test-Path $f)) { continue }
  Get-ChildItem -Path $f -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $l = $sh.CreateShortcut($_.FullName)
    foreach ($r in $roots) {
      if ($l.TargetPath -and $l.TargetPath.ToLower().StartsWith($r.ToLower())) {
        $out += [pscustomobject]@{ path = $_.FullName; icon = $l.IconLocation; root = $r }
      }
    }
  }
}
$out | ConvertTo-Json -Compress
`;
  let shortcuts = [];
  try { shortcuts = JSON.parse((await powershell(findScript)).trim() || '[]'); } catch {}
  if (!Array.isArray(shortcuts)) shortcuts = [shortcuts];
  if (!shortcuts.length) { log('No Discord shortcuts found to update'); return; }

  const changes = [];
  for (const s of shortcuts) {
    if (useOurs) {
      if (!memory[s.path] && !/zerocord|meudiscord/i.test(String(s.icon))) memory[s.path] = s.icon;
      changes.push({ path: s.path, icon: ico + ',0' });
    } else {
      changes.push({ path: s.path, icon: memory[s.path] || path.join(s.root, 'app.ico') + ',0' });
      delete memory[s.path];
    }
  }
  await powershell(`
$ErrorActionPreference = 'SilentlyContinue'
$sh = New-Object -ComObject WScript.Shell
${changes.map((c) => `$l = $sh.CreateShortcut(${psStr(c.path)}); $l.IconLocation = ${psStr(c.icon)}; $l.Save()`).join('\n')}
ie4uinit.exe -show
`);
  fs.mkdirSync(DATA_DIR(), { recursive: true });
  fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2));
  log(useOurs ? `Zero Two icon applied to ${changes.length} shortcut(s)` : `Original Discord icon restored on ${changes.length} shortcut(s)`);
}

function friendlyError(e) {
  if (['EBUSY', 'EPERM', 'EACCES'].includes(e && e.code)) {
    return "Discord's files are in use by another program. Fully quit any app that may be using them " +
      '(other Electron apps, an antivirus scan) or restart your PC, then try again.';
  }
  return String((e && e.message) || e);
}

// ---------------------------------------------------------------
async function install(ids, options = {}, log = () => {}) {
  const targets = list().filter((v) => ids.includes(v.id));
  if (!targets.length) throw new Error('No Discord selected');
  log('Copying ZeroCord to your computer…');
  copyFiles(log);

  // The window icon preference is stored in the config
  try {
    const cfgFile = path.join(DATA_DIR(), 'config.json');
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch {}
    cfg.zeroTwoIcon = options.zeroTwoIcon !== false;
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  } catch {}

  for (const v of targets) {
    try {
      if (v.otherMod) {
        if (!options.replaceOtherMods) {
          log(`⚠ ${v.name}: skipped, ${v.mod} is installed there.`);
          continue;
        }
        for (const a of v.apps) removeOtherMod(path.join(v.root, a, 'resources'));
        log(`${v.name}: ${v.mod} removed (ZeroCord already includes Equicord)`);
      }
      for (const a of v.apps) injectInto(path.join(v.root, a, 'resources'));
      log(`✓ ${v.name} ${v.version}: installed`);
    } catch (e) {
      log(`✗ ${v.name}: ${friendlyError(e)}`);
    }
  }
  await setShortcutIcons(targets, options.zeroTwoIcon !== false, log);
  return list();
}

async function uninstall(ids, options = {}, log = () => {}) {
  const targets = list().filter((v) => ids.includes(v.id));
  for (const v of targets) {
    try {
      let n = 0;
      for (const a of v.apps) if (removeFrom(path.join(v.root, a, 'resources'))) n++;
      log(n ? `✓ ${v.name}: ZeroCord removed` : `${v.name}: was not installed`);
    } catch (e) {
      log(`✗ ${v.name}: ${friendlyError(e)}`);
    }
  }
  await setShortcutIcons(targets, false, log);
  if (options.deleteData && !list().some((v) => v.installed)) {
    fs.rmSync(DATA_DIR(), { recursive: true, force: true });
    log('Your ZeroCord settings were deleted');
  }
  return list();
}

module.exports = { list, install, uninstall, runningClients, closeClients, launch, DATA_DIR, VARIANTS };
