// Lógica do instalador: acha o Discord (Stable/PTB/Canary/Dev), instala, desinstala e troca ícones.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');

const VARIANTES = [
  { id: 'stable', nome: 'Discord', pasta: 'Discord', exe: 'Discord.exe' },
  { id: 'ptb', nome: 'Discord PTB', pasta: 'DiscordPTB', exe: 'DiscordPTB.exe' },
  { id: 'canary', nome: 'Discord Canary', pasta: 'DiscordCanary', exe: 'DiscordCanary.exe' },
  { id: 'dev', nome: 'Discord Development', pasta: 'DiscordDevelopment', exe: 'DiscordDevelopment.exe' }
];

const MARCA = 'ZeroCord';
const MARCAS = ['ZeroCord', 'MeuDiscord']; // MeuDiscord = nome antigo
const LOCAL = () => process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const ROAMING = () => process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const PASTA_DADOS = () => path.join(ROAMING(), 'ZeroCord');
const PASTA_CODIGO = () => path.join(PASTA_DADOS(), 'app');
const RAIZ_PROJETO = path.join(__dirname, '..');

const ARQUIVOS_CODIGO = [
  'nucleo.js', 'patcher.js', 'preload.js', 'runtime.js', 'painel-preload.js', 'estilo.css',
  'painel', 'temas-embutidos', 'badges', 'vendor', 'icones'
];

const existe = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const ehWindows = process.platform === 'win32';

function versaoDe(nome) {
  return (nome.match(/\d+/g) || []).map(Number);
}
function compararVersao(a, b) {
  const x = versaoDe(a), y = versaoDe(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

function estadoPastaApp(resources) {
  const indexNosso = path.join(resources, 'app', 'index.js');
  if (existe(indexNosso)) {
    try { const t = fs.readFileSync(indexNosso, 'utf8'); if (MARCAS.some((m) => t.includes(m))) return 'instalado'; } catch {}
    return 'outro-mod';
  }
  if (existe(path.join(resources, '_app.asar'))) return 'outro-mod'; // Vencord / Equicord oficiais
  return 'limpo';
}

// ---------------------------------------------------------------
function listar() {
  const lista = [];
  for (const v of VARIANTES) {
    const raiz = path.join(LOCAL(), v.pasta);
    if (!existe(raiz)) continue;
    let apps = [];
    try {
      apps = fs.readdirSync(raiz)
        .filter((n) => /^app-\d/.test(n) && existe(path.join(raiz, n, 'resources', 'app.asar')))
        .sort(compararVersao);
    } catch {}
    if (!apps.length) continue;
    const atual = apps[apps.length - 1];
    const estado = estadoPastaApp(path.join(raiz, atual, 'resources'));
    lista.push({
      ...v, raiz, versao: atual.replace(/^app-/, ''), apps, estado,
      instalado: estado === 'instalado', outroMod: estado === 'outro-mod'
    });
  }
  return lista;
}

// ---------------------------------------------------------------
// Quem já tinha instalado com o nome antigo: leva as configurações pra pasta nova
function migrarNomeAntigo(log) {
  const antiga = path.join(ROAMING(), 'MeuDiscord');
  if (existe(antiga) && !existe(PASTA_DADOS())) {
    try { fs.renameSync(antiga, PASTA_DADOS()); log('Suas configurações antigas (MeuDiscord) vieram junto'); }
    catch { try { fs.cpSync(antiga, PASTA_DADOS(), { recursive: true }); } catch {} }
  }
}

function copiarCodigo(log) {
  migrarNomeAntigo(log);
  const destino = PASTA_CODIGO();
  fs.mkdirSync(destino, { recursive: true });
  for (const item of ARQUIVOS_CODIGO) {
    const de = path.join(RAIZ_PROJETO, item);
    if (!existe(de)) continue;
    const para = path.join(destino, item);
    if (fs.statSync(de).isDirectory()) {
      fs.rmSync(para, { recursive: true, force: true });
      fs.cpSync(de, para, { recursive: true });
    } else {
      fs.copyFileSync(de, para);
    }
  }
  log('Arquivos do ZeroCord copiados');

  // Dados do usuário: só cria o que ainda não existe (não apaga suas configurações)
  const dados = PASTA_DADOS();
  for (const pasta of ['temas', 'sons', 'perfil']) fs.mkdirSync(path.join(dados, pasta), { recursive: true });
  for (const arq of ['config.json', 'personalizado.css']) {
    const de = path.join(RAIZ_PROJETO, arq);
    if (existe(de) && !existe(path.join(dados, arq))) fs.copyFileSync(de, path.join(dados, arq));
  }
  const fundos = ['fundo.mp4', 'fundo.webm', 'fundo.gif', 'fundo.png', 'fundo.jpg', 'fundo.jpeg', 'fundo.webp'];
  if (!fundos.some((f) => existe(path.join(dados, f)))) {
    const f = fundos.find((x) => existe(path.join(RAIZ_PROJETO, x)));
    if (f) { fs.copyFileSync(path.join(RAIZ_PROJETO, f), path.join(dados, f)); log('Seu fundo animado foi copiado'); }
  }
  // Temas que você já tinha no app separado
  try {
    for (const t of fs.readdirSync(path.join(RAIZ_PROJETO, 'temas'))) {
      const para = path.join(dados, 'temas', t);
      if (!existe(para)) fs.copyFileSync(path.join(RAIZ_PROJETO, 'temas', t), para);
    }
  } catch {}
}

function injetarEm(resources) {
  const app = path.join(resources, 'app');
  fs.mkdirSync(app, { recursive: true });
  const patcher = path.join(PASTA_CODIGO(), 'patcher.js');
  fs.writeFileSync(path.join(app, 'index.js'), `// ${MARCA}: carrega o ZeroCord e depois o Discord normal\nrequire(${JSON.stringify(patcher)});\n`);
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'discord', main: 'index.js' }, null, 2));
}

function removerDe(resources) {
  const app = path.join(resources, 'app');
  const idx = path.join(app, 'index.js');
  if (!existe(idx)) return false;
  let nosso = false;
  try { const t = fs.readFileSync(idx, 'utf8'); nosso = MARCAS.some((m) => t.includes(m)); } catch {}
  if (!nosso) return false;
  fs.rmSync(app, { recursive: true, force: true });
  return true;
}

// ---------------------------------------------------------------
//  Processos do Discord
// ---------------------------------------------------------------
function processosAbertos(ids) {
  return new Promise((resolve) => {
    if (!ehWindows) return resolve([]);
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, saida) => {
      if (err) return resolve([]);
      const txt = String(saida).toLowerCase();
      resolve(VARIANTES.filter((v) => ids.includes(v.id) && txt.includes('"' + v.exe.toLowerCase() + '"')).map((v) => v.id));
    });
  });
}

function fecharDiscord(ids) {
  const alvos = VARIANTES.filter((v) => ids.includes(v.id));
  return Promise.all(alvos.map((v) => new Promise((res) => {
    if (!ehWindows) return res();
    execFile('taskkill', ['/F', '/T', '/IM', v.exe], { windowsHide: true }, () => res());
  }))).then(() => new Promise((r) => setTimeout(r, 1500)));
}

function abrirDiscord(id) {
  const v = listar().find((x) => x.id === id);
  if (!v || !ehWindows) return;
  const update = path.join(v.raiz, 'Update.exe');
  if (existe(update)) spawn(update, ['--processStart', v.exe], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
}

// ---------------------------------------------------------------
//  Ícones dos atalhos (Área de Trabalho, Menu Iniciar, Barra de tarefas)
// ---------------------------------------------------------------
function powershell(script) {
  return new Promise((resolve) => {
    if (!ehWindows) return resolve('');
    const arq = path.join(os.tmpdir(), `zerocord-${Date.now()}.ps1`);
    fs.writeFileSync(arq, '﻿' + script, 'utf8');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', arq], { windowsHide: true, timeout: 30000 }, (err, saida) => {
      try { fs.unlinkSync(arq); } catch {}
      resolve(err ? '' : String(saida));
    });
  });
}

const psStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";

async function trocarIconesAtalhos(variantes, usarNosso, log) {
  if (!ehWindows) return;
  const ico = path.join(PASTA_CODIGO(), 'icones', 'icone-discord.ico');
  const arqMemoria = path.join(PASTA_DADOS(), 'atalhos-originais.json');
  let memoria = {};
  try { memoria = JSON.parse(fs.readFileSync(arqMemoria, 'utf8')); } catch {}

  const raizes = variantes.map((v) => v.raiz);
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$sh = New-Object -ComObject WScript.Shell
$pastas = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  [Environment]::GetFolderPath('Programs'),
  [Environment]::GetFolderPath('StartMenu'),
  (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar'),
  (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch')
)
$raizes = @(${raizes.map(psStr).join(',')})
$saida = @()
foreach ($p in $pastas) {
  if (-not (Test-Path $p)) { continue }
  Get-ChildItem -Path $p -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $l = $sh.CreateShortcut($_.FullName)
    foreach ($r in $raizes) {
      if ($l.TargetPath -and $l.TargetPath.ToLower().StartsWith($r.ToLower())) {
        $saida += [pscustomobject]@{ caminho = $_.FullName; icone = $l.IconLocation; raiz = $r }
      }
    }
  }
}
$saida | ConvertTo-Json -Compress
`;
  let atalhos = [];
  try { atalhos = JSON.parse((await powershell(script)).trim() || '[]'); } catch {}
  if (!Array.isArray(atalhos)) atalhos = [atalhos];
  if (!atalhos.length) { log('Nenhum atalho do Discord encontrado pra trocar o ícone'); return; }

  const mudar = [];
  for (const a of atalhos) {
    if (usarNosso) {
      if (!memoria[a.caminho] && !/zerocord|meudiscord/i.test(String(a.icone))) memoria[a.caminho] = a.icone;
      mudar.push({ caminho: a.caminho, icone: ico + ',0' });
    } else {
      const original = memoria[a.caminho] || path.join(a.raiz, 'app.ico') + ',0';
      mudar.push({ caminho: a.caminho, icone: original });
      delete memoria[a.caminho];
    }
  }
  const script2 = `
$ErrorActionPreference = 'SilentlyContinue'
$sh = New-Object -ComObject WScript.Shell
${mudar.map((m) => `$l = $sh.CreateShortcut(${psStr(m.caminho)}); $l.IconLocation = ${psStr(m.icone)}; $l.Save()`).join('\n')}
ie4uinit.exe -show
`;
  await powershell(script2);
  fs.mkdirSync(PASTA_DADOS(), { recursive: true });
  fs.writeFileSync(arqMemoria, JSON.stringify(memoria, null, 2));
  log(usarNosso ? `Ícone da Zero Two aplicado em ${mudar.length} atalho(s)` : `Ícone original do Discord restaurado em ${mudar.length} atalho(s)`);
}

// ---------------------------------------------------------------
async function instalar(ids, opcoes = {}, log = () => {}) {
  const alvos = listar().filter((v) => ids.includes(v.id));
  if (!alvos.length) throw new Error('Nenhum Discord escolhido');
  log('Copiando o ZeroCord pro seu computador…');
  copiarCodigo(log);

  // ícone da janela do Discord fica salvo na configuração
  try {
    const cfgArq = path.join(PASTA_DADOS(), 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgArq, 'utf8'));
    cfg.iconeZeroTwo = opcoes.trocarIcone !== false;
    fs.writeFileSync(cfgArq, JSON.stringify(cfg, null, 2));
  } catch {}

  for (const v of alvos) {
    if (v.outroMod && !opcoes.forcar) {
      log(`⚠ ${v.nome}: já tem outro mod instalado (Vencord/Equicord oficial?). Desinstale ele antes, o ZeroCord já inclui o Equicord.`);
      continue;
    }
    for (const a of v.apps) injetarEm(path.join(v.raiz, a, 'resources'));
    log(`✓ ${v.nome} ${v.versao}: instalado`);
  }
  await trocarIconesAtalhos(alvos, opcoes.trocarIcone !== false, log);
  return listar();
}

async function desinstalar(ids, opcoes = {}, log = () => {}) {
  const alvos = listar().filter((v) => ids.includes(v.id));
  for (const v of alvos) {
    let n = 0;
    for (const a of v.apps) if (removerDe(path.join(v.raiz, a, 'resources'))) n++;
    log(n ? `✓ ${v.nome}: ZeroCord removido` : `${v.nome}: não estava instalado`);
  }
  await trocarIconesAtalhos(alvos, false, log);
  const sobrou = listar().some((v) => v.instalado);
  if (opcoes.apagarDados && !sobrou) {
    fs.rmSync(PASTA_DADOS(), { recursive: true, force: true });
    log('Suas configurações do ZeroCord foram apagadas');
  }
  return listar();
}

module.exports = { listar, instalar, desinstalar, processosAbertos, fecharDiscord, abrirDiscord, PASTA_DADOS, VARIANTES };
